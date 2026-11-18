-- Satır düzeyinde güvenlik ve yetkiler.
-- Varsayılan: kimse hiçbir şeye erişemez. Aşağıda tek tek açılır.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, lawgent_app, lawgent_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, auth FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO lawgent_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO lawgent_app;
-- Worker yalnızca kuyruk, bağlam ve denetim fonksiyonlarını çağırabilir.
GRANT EXECUTE ON FUNCTION app.tid(), app.uid(), app.claim_job(text[]),
  app.finish_job(bigint, boolean, text),
  app.audit(text, text, uuid, uuid, jsonb, inet), app.normalize_name(text) TO lawgent_worker;
REVOKE EXECUTE ON FUNCTION app.claim_job(text[]), app.finish_job(bigint, boolean, text) FROM lawgent_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','tenant_keys','users','tenant_members','sessions','clients','client_relations',
    'parties','matters','matter_members','ethical_wall_exclusions','matter_parties',
    'documents','document_versions','document_pages','chunks','deadlines','hearings',
    'chat_threads','chat_thread_documents','chat_messages','jobs','audit_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Büro, anahtarlar, kullanıcılar
-- ---------------------------------------------------------------------------
GRANT SELECT ON tenants TO lawgent_app;
GRANT UPDATE (name, external_ai_enabled) ON tenants TO lawgent_app;
CREATE POLICY tenants_select ON tenants FOR SELECT TO lawgent_app USING (id = app.tid());
CREATE POLICY tenants_update ON tenants FOR UPDATE TO lawgent_app
  USING (id = app.tid() AND app.tenant_role() = 'owner') WITH CHECK (id = app.tid());

GRANT SELECT ON tenant_keys TO lawgent_app, lawgent_worker;
CREATE POLICY tenant_keys_select ON tenant_keys FOR SELECT TO lawgent_app, lawgent_worker
  USING (tenant_id = app.tid());

-- Parola hash'i ve TOTP sırrı uygulamaya sütun düzeyinde kapalı.
GRANT SELECT (id, email, full_name, totp_enabled, is_active, created_at) ON users TO lawgent_app;
CREATE POLICY users_select ON users FOR SELECT TO lawgent_app USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = users.id AND tm.tenant_id = app.tid()));

GRANT SELECT ON tenant_members TO lawgent_app;
CREATE POLICY tenant_members_select ON tenant_members FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid());

-- sessions: yalnızca auth.* fonksiyonları (politika yok = erişim yok).

-- ---------------------------------------------------------------------------
-- Müvekkiller ve taraflar: büro geneli görünür; kısıtlılar yalnızca ilgili ekiplere.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON clients TO lawgent_app;
GRANT UPDATE (kind, display_name, tckn_enc, tckn_hmac, tckn_last4, vkn, tax_office, email, phone,
              address, kvkk_consent_at, is_restricted, notes) ON clients TO lawgent_app;
-- created_by satır içinde kontrol edilir: INSERT ... RETURNING anında yeni satır
-- STABLE fonksiyonun anlık görüntüsünde henüz yoktur.
CREATE POLICY clients_select ON clients FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND (NOT is_restricted OR created_by = app.uid() OR app.can_access_client(id)));
CREATE POLICY clients_insert ON clients FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND created_by = app.uid());
CREATE POLICY clients_update ON clients FOR UPDATE TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_client(id))
  WITH CHECK (tenant_id = app.tid());

GRANT SELECT, INSERT, DELETE ON client_relations TO lawgent_app;
CREATE POLICY client_relations_all ON client_relations FOR ALL TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_client(client_id) AND app.can_access_client(related_client_id))
  WITH CHECK (tenant_id = app.tid() AND app.can_access_client(client_id) AND app.can_access_client(related_client_id));

GRANT SELECT, INSERT ON parties TO lawgent_app;
CREATE POLICY parties_all ON parties FOR ALL TO lawgent_app
  USING (tenant_id = app.tid()) WITH CHECK (tenant_id = app.tid());

-- ---------------------------------------------------------------------------
-- Dosyalar ve ekip
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON matters TO lawgent_app;
GRANT UPDATE (title, status, court, esas_no, description, closed_at, ai_enabled, is_walled) ON matters TO lawgent_app;
CREATE POLICY matters_select ON matters FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(id));
CREATE POLICY matters_insert ON matters FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND created_by = app.uid() AND app.can_access_client(client_id)
              AND app.tenant_role() <> 'staff');
CREATE POLICY matters_update ON matters FOR UPDATE TO lawgent_app
  USING (tenant_id = app.tid() AND app.is_matter_lead(id))
  WITH CHECK (tenant_id = app.tid());

GRANT SELECT, INSERT, DELETE ON matter_members TO lawgent_app;
GRANT UPDATE (role) ON matter_members TO lawgent_app;
CREATE POLICY matter_members_select ON matter_members FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
CREATE POLICY matter_members_insert ON matter_members FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.is_matter_lead(matter_id));
CREATE POLICY matter_members_update ON matter_members FOR UPDATE TO lawgent_app
  USING (tenant_id = app.tid() AND app.is_matter_lead(matter_id))
  WITH CHECK (tenant_id = app.tid());
CREATE POLICY matter_members_delete ON matter_members FOR DELETE TO lawgent_app
  USING (tenant_id = app.tid() AND app.is_matter_lead(matter_id) AND user_id <> app.uid());

-- Etik duvarı büro yöneticileri (owner/partner) yönetir; dosya içeriğini görmeleri gerekmez.
GRANT SELECT, INSERT, DELETE ON ethical_wall_exclusions TO lawgent_app;
CREATE POLICY walls_select ON ethical_wall_exclusions FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.is_tenant_admin());
CREATE POLICY walls_insert ON ethical_wall_exclusions FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.is_tenant_admin() AND created_by = app.uid());
CREATE POLICY walls_delete ON ethical_wall_exclusions FOR DELETE TO lawgent_app
  USING (tenant_id = app.tid() AND app.is_tenant_admin());

GRANT SELECT, INSERT, DELETE ON matter_parties TO lawgent_app;
CREATE POLICY matter_parties_all ON matter_parties FOR ALL TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id))
  WITH CHECK (tenant_id = app.tid() AND app.can_access_matter(matter_id));

-- ---------------------------------------------------------------------------
-- Belgeler: yalnızca dosya ekibi. Versiyonlar değiştirilemez.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON documents TO lawgent_app;
GRANT UPDATE (title, category, deleted_at) ON documents TO lawgent_app;
CREATE POLICY documents_select ON documents FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
CREATE POLICY documents_insert ON documents FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.can_access_matter(matter_id) AND created_by = app.uid());
CREATE POLICY documents_update ON documents FOR UPDATE TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id))
  WITH CHECK (tenant_id = app.tid() AND app.can_access_matter(matter_id));

GRANT SELECT, INSERT ON document_versions TO lawgent_app;
CREATE POLICY versions_select ON document_versions FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
-- matter_id tetikleyiciyle belgeden türetilir; kontrol tetikleyiciden sonra yapılır.
CREATE POLICY versions_insert ON document_versions FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.can_access_matter(matter_id) AND created_by = app.uid());

GRANT SELECT ON document_pages, chunks TO lawgent_app;
CREATE POLICY pages_select ON document_pages FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
-- AI'ın okuduğu parçalar: duvarlı veya AI'a kapalı dosyalar hariç.
CREATE POLICY chunks_select ON chunks FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.ai_can_read_matter(matter_id));

-- Worker: yalnızca o an işlediği büronun bağlamında, yalnızca gereken sütunlar.
GRANT SELECT (tenant_id, id, document_id, matter_id, object_key, mime_type, sha256, ocr_status)
  ON document_versions TO lawgent_worker;
GRANT UPDATE (ocr_status, ocr_error, page_count, processed_at) ON document_versions TO lawgent_worker;
CREATE POLICY versions_worker ON document_versions FOR ALL TO lawgent_worker
  USING (tenant_id = app.tid()) WITH CHECK (tenant_id = app.tid());
GRANT SELECT, INSERT, DELETE ON document_pages, chunks TO lawgent_worker;
CREATE POLICY pages_worker ON document_pages FOR ALL TO lawgent_worker
  USING (tenant_id = app.tid()) WITH CHECK (tenant_id = app.tid());
CREATE POLICY chunks_worker ON chunks FOR ALL TO lawgent_worker
  USING (tenant_id = app.tid()) WITH CHECK (tenant_id = app.tid());

-- ---------------------------------------------------------------------------
-- Takvim
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON deadlines, hearings TO lawgent_app;
GRANT UPDATE (title, due_at, is_critical, completed_at, assignee_id) ON deadlines TO lawgent_app;
GRANT UPDATE (starts_at, court, room, note) ON hearings TO lawgent_app;
CREATE POLICY deadlines_all ON deadlines FOR ALL TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id))
  WITH CHECK (tenant_id = app.tid() AND app.can_access_matter(matter_id));
CREATE POLICY hearings_all ON hearings FOR ALL TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id))
  WITH CHECK (tenant_id = app.tid() AND app.can_access_matter(matter_id));

-- ---------------------------------------------------------------------------
-- Sohbet: sohbet açmak ve yazmak AI erişimi gerektirir.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON chat_threads, chat_thread_documents, chat_messages TO lawgent_app;
GRANT UPDATE (title) ON chat_threads TO lawgent_app;
CREATE POLICY threads_select ON chat_threads FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
CREATE POLICY threads_insert ON chat_threads FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.ai_can_read_matter(matter_id) AND created_by = app.uid());
CREATE POLICY threads_update ON chat_threads FOR UPDATE TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id))
  WITH CHECK (tenant_id = app.tid());
CREATE POLICY thread_docs_select ON chat_thread_documents FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
CREATE POLICY thread_docs_insert ON chat_thread_documents FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.ai_can_read_matter(matter_id));
CREATE POLICY messages_select ON chat_messages FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
CREATE POLICY messages_insert ON chat_messages FOR INSERT TO lawgent_app
  WITH CHECK (tenant_id = app.tid() AND app.ai_can_read_matter(matter_id));

-- ---------------------------------------------------------------------------
-- Denetim kaydı: okuma yalnızca büro yöneticilerine; yazma yalnızca app.audit() ile.
-- ---------------------------------------------------------------------------
GRANT SELECT ON audit_events TO lawgent_app;
CREATE POLICY audit_select ON audit_events FOR SELECT TO lawgent_app
  USING (tenant_id = app.tid() AND app.is_tenant_admin());

-- jobs: politika yok; yalnızca SECURITY DEFINER fonksiyonlar erişir.
