-- Lawgent çekirdek şeması
-- Hiyerarşi: Büro (tenant) → Müvekkil → Dosya → (Belgeler, Süreler, Duruşmalar, Sohbetler)
--
-- İzolasyon ilkeleri
--  1. Her tabloda tenant_id var; yabancı anahtarlar (tenant_id, id) çiftine bağlanır,
--     böylece bir büronun kaydı başka büronun kaydına bağlanamaz.
--  2. Uygulama lawgent_app rolüyle bağlanır; her istek transaction başında
--     app.tenant_id ve app.user_id ayarlar. Ayarlanmamışsa hiçbir satır görünmez.
--  3. Dosya içeriğine erişim yalnızca dosya ekibi üyeliği ile olur (app.can_access_matter).
--  4. Etik duvar: dışlanan kullanıcı ekibe eklenemez; duvarlı dosyayı AI okuyamaz.
--  5. Denetim kaydı yalnızca eklenebilir, hash zinciriyle korunur.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA app;
CREATE SCHEMA auth;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app, auth TO lawgent_app, lawgent_worker;

-- ---------------------------------------------------------------------------
-- Bağlam yardımcıları
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.tid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Türkçe karakterleri sadeleştirip küçük harfe çevirir (çatışma taraması için).
CREATE FUNCTION app.normalize_name(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           lower(translate(coalesce(t, ''), 'ÇĞİIÖŞÜçğıöşüÂâÎîÛû', 'cgiiosucgiosuaaiiuu')),
           '[^a-z0-9 ]', ' ', 'g')
$$;

-- ---------------------------------------------------------------------------
-- Enum'lar
-- ---------------------------------------------------------------------------
CREATE TYPE tenant_role   AS ENUM ('owner', 'partner', 'lawyer', 'staff');
CREATE TYPE client_kind   AS ENUM ('person', 'company');
CREATE TYPE matter_type   AS ENUM ('dava', 'icra', 'danismanlik', 'sozlesme');
CREATE TYPE matter_status AS ENUM ('acik', 'beklemede', 'kapali');
CREATE TYPE member_role   AS ENUM ('lead', 'member');
CREATE TYPE ocr_status    AS ENUM ('pending', 'processing', 'done', 'failed');
CREATE TYPE chat_role     AS ENUM ('user', 'assistant');
CREATE TYPE job_status    AS ENUM ('queued', 'running', 'done', 'failed');

-- ---------------------------------------------------------------------------
-- Büro ve kullanıcılar
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  slug                 citext NOT NULL UNIQUE,
  -- Harici AI varsayılan kapalı; yalnızca büro sahibi açabilir.
  external_ai_enabled  boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Büro başına veri şifreleme anahtarı (ana anahtarla sarılmış).
CREATE TABLE tenant_keys (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id),
  wrapped_dek  bytea NOT NULL,
  kek_id       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  full_name        text NOT NULL,
  password_hash    text NOT NULL,
  totp_secret_enc  bytea,
  totp_enabled     boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        tenant_role NOT NULL,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Oturumlar yalnızca auth.* fonksiyonlarıyla okunur/yazılır.
CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  mfa_verified  boolean NOT NULL DEFAULT false,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX ON sessions (user_id);

CREATE FUNCTION app.tenant_role() RETURNS tenant_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM tenant_members WHERE tenant_id = app.tid() AND user_id = app.uid()
$$;

CREATE FUNCTION app.is_tenant_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(app.tenant_role() IN ('owner', 'partner'), false) $$;

-- ---------------------------------------------------------------------------
-- Müvekkiller ve taraflar
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  kind             client_kind NOT NULL,
  display_name     text NOT NULL,
  name_norm        text GENERATED ALWAYS AS (app.normalize_name(display_name)) STORED,
  -- TCKN şifreli saklanır; eşleşme için büro anahtarıyla HMAC'i tutulur.
  tckn_enc         bytea,
  tckn_hmac        bytea,
  tckn_last4       text,
  vkn              text,
  tax_office       text,
  email            citext,
  phone            text,
  address          text,
  kvkk_consent_at  timestamptz,
  -- Kısıtlı müvekkil yalnızca dosya ekiplerince görülür.
  is_restricted    boolean NOT NULL DEFAULT false,
  notes            text,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX clients_name_trgm ON clients USING gin (name_norm gin_trgm_ops);
CREATE INDEX ON clients (tenant_id, tckn_hmac);

CREATE TABLE client_relations (
  tenant_id          uuid NOT NULL,
  client_id          uuid NOT NULL,
  related_client_id  uuid NOT NULL,
  relation           text NOT NULL,          -- ör. "yönetim kurulu üyesi", "eş", "iştirak"
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, client_id, related_client_id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id),
  FOREIGN KEY (tenant_id, related_client_id) REFERENCES clients (tenant_id, id),
  CHECK (client_id <> related_client_id)
);

-- Karşı taraflar ve diğer ilgililer (çatışma taraması bunlar üzerinde de yapılır).
CREATE TABLE parties (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  kind        client_kind NOT NULL,
  name        text NOT NULL,
  name_norm   text GENERATED ALWAYS AS (app.normalize_name(name)) STORED,
  tckn_hmac   bytea,
  vkn         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX parties_name_trgm ON parties USING gin (name_norm gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Dosyalar (matter) ve ekip
-- ---------------------------------------------------------------------------
CREATE TABLE matters (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL,
  type         matter_type NOT NULL,
  title        text NOT NULL,
  status       matter_status NOT NULL DEFAULT 'acik',
  court        text,
  esas_no      text,
  description  text,
  opened_at    date NOT NULL DEFAULT current_date,
  closed_at    date,
  ai_enabled   boolean NOT NULL DEFAULT true,
  is_walled    boolean NOT NULL DEFAULT false,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id)
);
CREATE INDEX ON matters (tenant_id, client_id);
CREATE INDEX matters_esas_trgm ON matters USING gin (esas_no gin_trgm_ops);

CREATE TABLE matter_members (
  tenant_id   uuid NOT NULL,
  matter_id   uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id),
  role        member_role NOT NULL DEFAULT 'member',
  added_by    uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, user_id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members (tenant_id, user_id)
);
CREATE INDEX ON matter_members (user_id);

-- Etik duvar: bu kullanıcı bu dosyaya hiçbir koşulda erişemez.
CREATE TABLE ethical_wall_exclusions (
  tenant_id   uuid NOT NULL,
  matter_id   uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, user_id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);

CREATE TABLE matter_parties (
  tenant_id   uuid NOT NULL,
  matter_id   uuid NOT NULL,
  party_id    uuid NOT NULL,
  role        text NOT NULL,                 -- davacı, davalı, alacaklı, borçlu, karşı taraf...
  PRIMARY KEY (matter_id, party_id, role),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES parties (tenant_id, id)
);

-- Erişim kontrolünün tek kaynağı.
CREATE FUNCTION app.can_access_matter(m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
           SELECT 1 FROM matter_members mm
           WHERE mm.matter_id = m AND mm.user_id = app.uid() AND mm.tenant_id = app.tid())
     AND NOT EXISTS (
           SELECT 1 FROM ethical_wall_exclusions w
           WHERE w.matter_id = m AND w.user_id = app.uid())
$$;

CREATE FUNCTION app.is_matter_lead(m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.can_access_matter(m) AND EXISTS (
    SELECT 1 FROM matter_members mm
    WHERE mm.matter_id = m AND mm.user_id = app.uid() AND mm.role = 'lead')
$$;

-- AI yalnızca erişilebilen, AI'a açık ve duvarsız dosyaları okuyabilir.
CREATE FUNCTION app.ai_can_read_matter(m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.can_access_matter(m) AND EXISTS (
    SELECT 1 FROM matters x WHERE x.id = m AND x.ai_enabled AND NOT x.is_walled)
$$;

CREATE FUNCTION app.can_access_client(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM clients x WHERE x.id = c AND x.tenant_id = app.tid() AND (
      NOT x.is_restricted
      OR x.created_by = app.uid()
      OR EXISTS (SELECT 1 FROM matters m WHERE m.client_id = c AND app.can_access_matter(m.id))))
$$;

-- Dosyayı açan kişi otomatik olarak ekip lideri olur.
CREATE FUNCTION app.trg_matter_add_creator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO matter_members (tenant_id, matter_id, user_id, role, added_by)
  VALUES (NEW.tenant_id, NEW.id, NEW.created_by, 'lead', NEW.created_by);
  RETURN NEW;
END $$;
CREATE TRIGGER matter_add_creator AFTER INSERT ON matters
  FOR EACH ROW EXECUTE FUNCTION app.trg_matter_add_creator();

-- Dışlanan kullanıcı ekibe eklenemez.
CREATE FUNCTION app.trg_member_wall_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ethical_wall_exclusions w
             WHERE w.matter_id = NEW.matter_id AND w.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Etik duvar: kullanıcı bu dosyaya eklenemez' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER member_wall_check BEFORE INSERT OR UPDATE ON matter_members
  FOR EACH ROW EXECUTE FUNCTION app.trg_member_wall_check();

-- Duvar eklendiğinde mevcut üyelik kaldırılır.
CREATE FUNCTION app.trg_wall_remove_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM matter_members WHERE matter_id = NEW.matter_id AND user_id = NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER wall_remove_member AFTER INSERT ON ethical_wall_exclusions
  FOR EACH ROW EXECUTE FUNCTION app.trg_wall_remove_member();

-- ---------------------------------------------------------------------------
-- Belgeler
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  tenant_id           uuid NOT NULL,
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  matter_id           uuid NOT NULL,
  title               text NOT NULL,
  category            text,
  current_version_id  uuid,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);
CREATE INDEX ON documents (tenant_id, matter_id);

-- Versiyonlar değiştirilemez; yalnızca işleme durumu worker tarafından güncellenir.
CREATE TABLE document_versions (
  tenant_id         uuid NOT NULL,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL,
  matter_id         uuid NOT NULL,
  version_no        int NOT NULL,
  object_key        text NOT NULL,
  file_name         text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes >= 0),
  sha256            bytea NOT NULL,
  -- Delil kopyası: depoda object lock ile korunur, silinemez.
  is_evidence_copy  boolean NOT NULL DEFAULT false,
  ocr_status        ocr_status NOT NULL DEFAULT 'pending',
  ocr_error         text,
  page_count        int,
  processed_at      timestamptz,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (document_id, version_no),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);

ALTER TABLE documents ADD FOREIGN KEY (tenant_id, current_version_id)
  REFERENCES document_versions (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;

-- Versiyon numarası ve matter_id belgeden türetilir (istemci yanlış dosyaya bağlayamaz).
CREATE FUNCTION app.trg_version_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d documents;
BEGIN
  SELECT * INTO d FROM documents WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Belge bulunamadı'; END IF;
  NEW.matter_id := d.matter_id;
  SELECT coalesce(max(version_no), 0) + 1 INTO NEW.version_no
    FROM document_versions WHERE document_id = NEW.document_id;
  NEW.ocr_status := 'pending';
  NEW.ocr_error := NULL;
  NEW.page_count := NULL;
  NEW.processed_at := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER version_before BEFORE INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION app.trg_version_before();

CREATE TABLE document_pages (
  tenant_id   uuid NOT NULL,
  version_id  uuid NOT NULL,
  matter_id   uuid NOT NULL,
  page_no     int NOT NULL,
  text        text NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('turkish', text)) STORED,
  PRIMARY KEY (version_id, page_no),
  FOREIGN KEY (tenant_id, version_id) REFERENCES document_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);
CREATE INDEX document_pages_tsv ON document_pages USING gin (tsv);

CREATE TABLE chunks (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  matter_id    uuid NOT NULL,
  document_id  uuid NOT NULL,
  version_id   uuid NOT NULL,
  ordinal      int NOT NULL,
  page_from    int NOT NULL,
  page_to      int NOT NULL,
  article_ref  text,                         -- ör. "m.7.2"
  content      text NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('turkish', content)) STORED,
  embedding    vector(1024),
  PRIMARY KEY (id),
  UNIQUE (version_id, ordinal),
  FOREIGN KEY (tenant_id, version_id) REFERENCES document_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);
CREATE INDEX chunks_tsv ON chunks USING gin (tsv);
CREATE INDEX chunks_matter ON chunks (tenant_id, matter_id);
CREATE INDEX chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Takvim: süreler ve duruşmalar (MVP: elle giriş, süre hesaplama yok)
-- ---------------------------------------------------------------------------
CREATE TABLE deadlines (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  matter_id     uuid NOT NULL,
  title         text NOT NULL,
  due_at        timestamptz NOT NULL,
  is_critical   boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,
  assignee_id   uuid REFERENCES users(id),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);
CREATE INDEX ON deadlines (tenant_id, due_at);

CREATE TABLE hearings (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL,
  starts_at   timestamptz NOT NULL,
  court       text,
  room        text,
  note        text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);
CREATE INDEX ON hearings (tenant_id, starts_at);

-- ---------------------------------------------------------------------------
-- Dosyayla sohbet
-- ---------------------------------------------------------------------------
CREATE TABLE chat_threads (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL,
  title       text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);

CREATE TABLE chat_thread_documents (
  tenant_id    uuid NOT NULL,
  thread_id    uuid NOT NULL,
  document_id  uuid NOT NULL,
  matter_id    uuid NOT NULL,
  PRIMARY KEY (thread_id, document_id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES chat_threads (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);

CREATE TABLE chat_messages (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL,
  matter_id   uuid NOT NULL,
  role        chat_role NOT NULL,
  content     text NOT NULL,
  citations   jsonb NOT NULL DEFAULT '[]',
  model       text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES chat_threads (tenant_id, id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters (tenant_id, id)
);
CREATE INDEX ON chat_messages (thread_id, created_at);

-- Sohbet tablolarında matter_id, bağlı olduğu kayıttan türetilir.
CREATE FUNCTION app.trg_matter_from_thread() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT matter_id INTO NEW.matter_id FROM chat_threads WHERE id = NEW.thread_id AND tenant_id = NEW.tenant_id;
  IF NEW.matter_id IS NULL THEN RAISE EXCEPTION 'Sohbet bulunamadı'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_messages_matter BEFORE INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION app.trg_matter_from_thread();

CREATE FUNCTION app.trg_thread_doc_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT matter_id INTO NEW.matter_id FROM chat_threads WHERE id = NEW.thread_id AND tenant_id = NEW.tenant_id;
  IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.matter_id = NEW.matter_id) THEN
    RAISE EXCEPTION 'Belge bu dosyaya ait değil';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_thread_documents_check BEFORE INSERT ON chat_thread_documents
  FOR EACH ROW EXECUTE FUNCTION app.trg_thread_doc_check();

-- ---------------------------------------------------------------------------
-- İş kuyruğu (Postgres; Redis yok). Uygulama rolü doğrudan erişemez.
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  kind        text NOT NULL,
  payload     jsonb NOT NULL,
  status      job_status NOT NULL DEFAULT 'queued',
  attempts    int NOT NULL DEFAULT 0,
  run_after   timestamptz NOT NULL DEFAULT now(),
  locked_at   timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue ON jobs (status, run_after) WHERE status IN ('queued', 'running');

-- Yeni versiyon yüklenince belge güncellenir ve işleme kuyruğa alınır.
CREATE FUNCTION app.trg_version_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE documents SET current_version_id = NEW.id WHERE id = NEW.document_id;
  INSERT INTO jobs (tenant_id, kind, payload)
  VALUES (NEW.tenant_id, 'ingest_version', jsonb_build_object('version_id', NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER version_after AFTER INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION app.trg_version_after();

CREATE FUNCTION app.claim_job(kinds text[]) RETURNS SETOF jobs
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
  WHERE id = (
    SELECT id FROM jobs
    WHERE kind = ANY(kinds)
      AND ((status = 'queued' AND run_after <= now())
           OR (status = 'running' AND locked_at < now() - interval '15 minutes'))
    ORDER BY run_after
    FOR UPDATE SKIP LOCKED
    LIMIT 1)
  RETURNING *
$$;

CREATE FUNCTION app.finish_job(job_id bigint, ok boolean, err text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE jobs SET
    status = CASE WHEN ok THEN 'done'::job_status
                  WHEN attempts >= 5 THEN 'failed'::job_status
                  ELSE 'queued'::job_status END,
    run_after = CASE WHEN ok THEN run_after ELSE now() + (attempts * interval '30 seconds') END,
    last_error = err, locked_at = NULL, updated_at = now()
  WHERE id = job_id
$$;

-- ---------------------------------------------------------------------------
-- Denetim kaydı: yalnızca eklenir, hash zinciriyle korunur.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  actor_id     uuid REFERENCES users(id),
  actor_kind   text NOT NULL DEFAULT 'user',   -- user | worker | system
  action       text NOT NULL,                  -- ör. document.view, ai.query, matter.create
  entity_type  text,
  entity_id    uuid,
  matter_id    uuid,
  meta         jsonb NOT NULL DEFAULT '{}',
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash    bytea NOT NULL,
  hash         bytea NOT NULL
);
CREATE INDEX ON audit_events (tenant_id, id);
CREATE INDEX ON audit_events (tenant_id, matter_id, id);

CREATE FUNCTION app.audit_payload(e audit_events) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(concat_ws('|',
    e.id, e.tenant_id, e.actor_id, e.actor_kind, e.action, e.entity_type, e.entity_id,
    e.matter_id, e.meta::text, host(e.ip), to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'UTF8')
$$;

CREATE FUNCTION app.trg_audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last bytea;
BEGIN
  -- Büro başına zinciri sıraya sok.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
  SELECT hash INTO last FROM audit_events WHERE tenant_id = NEW.tenant_id ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := coalesce(last, '\x00'::bytea);
  NEW.created_at := clock_timestamp();
  NEW.hash := sha256(NEW.prev_hash || app.audit_payload(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.trg_audit_chain();

CREATE FUNCTION app.trg_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Denetim kaydı değiştirilemez' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.trg_audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.trg_audit_immutable();

-- Uygulama denetim kaydını yalnızca bu fonksiyonla yazar; büro ve kullanıcı bağlamdan alınır.
CREATE FUNCTION app.audit(p_action text, p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL,
                          p_matter_id uuid DEFAULT NULL, p_meta jsonb DEFAULT '{}', p_ip inet DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app.tid() IS NULL THEN RAISE EXCEPTION 'Büro bağlamı yok'; END IF;
  INSERT INTO audit_events (tenant_id, actor_id, actor_kind, action, entity_type, entity_id, matter_id, meta, ip, prev_hash, hash)
  VALUES (app.tid(), app.uid(),
          CASE WHEN current_user = 'lawgent_worker' THEN 'worker' ELSE 'user' END,
          p_action, p_entity_type, p_entity_id, p_matter_id, coalesce(p_meta, '{}'), p_ip, '\x', '\x');
END $$;

-- Zinciri doğrular; ilk bozuk kaydın id'sini döner (sağlamsa NULL).
CREATE FUNCTION app.verify_audit_chain(p_tenant uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e audit_events; prev bytea := '\x00';
BEGIN
  IF p_tenant <> app.tid() OR NOT app.is_tenant_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  FOR e IN SELECT * FROM audit_events WHERE tenant_id = p_tenant ORDER BY id LOOP
    IF e.prev_hash <> prev OR e.hash <> sha256(e.prev_hash || app.audit_payload(e)) THEN
      RETURN e.id;
    END IF;
    prev := e.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Kimlik doğrulama fonksiyonları (oturum tablosuna doğrudan erişim yok)
-- ---------------------------------------------------------------------------
CREATE FUNCTION auth.login_lookup(p_email citext)
RETURNS TABLE (user_id uuid, password_hash text, totp_enabled boolean, totp_secret_enc bytea,
               tenant_id uuid, tenant_name text, role tenant_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.password_hash, u.totp_enabled, u.totp_secret_enc, t.id, t.name, tm.role
  FROM users u
  JOIN tenant_members tm ON tm.user_id = u.id
  JOIN tenants t ON t.id = tm.tenant_id
  WHERE u.email = p_email AND u.is_active
  ORDER BY t.name
$$;

CREATE FUNCTION auth.create_session(p_token_hash bytea, p_user uuid, p_tenant uuid, p_mfa boolean,
                                    p_ttl interval, p_ip inet, p_ua text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE exp timestamptz := now() + p_ttl;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_members WHERE user_id = p_user AND tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'Kullanıcı bu büroya üye değil' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sessions (token_hash, user_id, tenant_id, mfa_verified, ip, user_agent, expires_at)
  VALUES (p_token_hash, p_user, p_tenant, p_mfa, p_ip, p_ua, exp);
  RETURN exp;
END $$;

CREATE FUNCTION auth.resolve_session(p_token_hash bytea)
RETURNS TABLE (user_id uuid, tenant_id uuid, role tenant_role, mfa_verified boolean,
               email citext, full_name text, tenant_name text, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sessions s SET last_seen_at = now()
  FROM users u, tenant_members tm, tenants t
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
    AND u.id = s.user_id AND u.is_active
    AND tm.user_id = s.user_id AND tm.tenant_id = s.tenant_id AND t.id = s.tenant_id
  RETURNING s.user_id, s.tenant_id, tm.role, s.mfa_verified, u.email, u.full_name, t.name, s.expires_at
$$;

CREATE FUNCTION auth.revoke_session(p_token_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- Çatışma taraması: kısıtlı kayıtlar dahil tüm büroda arar, ama erişimi olmayan
-- kullanıcıya yalnızca "kısıtlı kayıt" bilgisini verir.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.conflict_search(p_name text, p_tckn_hmac bytea DEFAULT NULL, p_limit int DEFAULT 20)
RETURNS TABLE (source text, id uuid, display_name text, similarity real, exact_id_match boolean, restricted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT app.normalize_name(p_name) AS n),
  hits AS (
    SELECT 'client'::text AS source, c.id, c.display_name, similarity(c.name_norm, q.n) AS sim,
           (p_tckn_hmac IS NOT NULL AND c.tckn_hmac = p_tckn_hmac) AS exact,
           NOT app.can_access_client(c.id) AS restricted
    FROM clients c, q
    WHERE c.tenant_id = app.tid() AND (c.name_norm % q.n OR (p_tckn_hmac IS NOT NULL AND c.tckn_hmac = p_tckn_hmac))
    UNION ALL
    SELECT 'party', p.id, p.name, similarity(p.name_norm, q.n),
           (p_tckn_hmac IS NOT NULL AND p.tckn_hmac = p_tckn_hmac),
           false
    FROM parties p, q
    WHERE p.tenant_id = app.tid() AND (p.name_norm % q.n OR (p_tckn_hmac IS NOT NULL AND p.tckn_hmac = p_tckn_hmac))
  )
  SELECT source, CASE WHEN restricted THEN NULL ELSE id END,
         CASE WHEN restricted THEN 'Kısıtlı kayıt' ELSE display_name END,
         sim, exact, restricted
  FROM hits
  WHERE app.tid() IS NOT NULL
  ORDER BY exact DESC, sim DESC
  LIMIT p_limit
$$;
