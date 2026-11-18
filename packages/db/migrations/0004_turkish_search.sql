-- Türkçe büyük/küçük harf: Postgres'in lower() fonksiyonu yerel ayardan bağımsız olarak
-- "I" → "i" yapar; Türkçede "I" → "ı", "İ" → "i" olmalı. Aksi halde "IŞIK" ile "ışık" eşleşmez.
CREATE FUNCTION app.tr_lower(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT lower(translate(coalesce(t, ''), 'Iİ', 'ıi')) $$;

CREATE FUNCTION app.tr_tsvector(t text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT to_tsvector('turkish', app.tr_lower(t)) $$;

-- Soru metni için VEYA mantıklı sorgu (sıralama ts_rank ile yapılır).
CREATE FUNCTION app.tr_tsquery_or(q text) RETURNS tsquery LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT nullif(replace(plainto_tsquery('turkish', app.tr_lower(q))::text, '&', '|'), '')::tsquery $$;

GRANT EXECUTE ON FUNCTION app.tr_lower(text), app.tr_tsvector(text), app.tr_tsquery_or(text) TO lawgent_app, lawgent_worker;

ALTER TABLE document_pages DROP COLUMN tsv;
ALTER TABLE document_pages ADD COLUMN tsv tsvector GENERATED ALWAYS AS (app.tr_tsvector(text)) STORED;
CREATE INDEX document_pages_tsv ON document_pages USING gin (tsv);

ALTER TABLE chunks DROP COLUMN tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (app.tr_tsvector(content)) STORED;
CREATE INDEX chunks_tsv ON chunks USING gin (tsv);

-- SECURITY DEFINER içinde current_user tablo sahibidir; bağlanan rol session_user'dır.
CREATE OR REPLACE FUNCTION app.audit(p_action text, p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL,
                          p_matter_id uuid DEFAULT NULL, p_meta jsonb DEFAULT '{}', p_ip inet DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app.tid() IS NULL THEN RAISE EXCEPTION 'Büro bağlamı yok'; END IF;
  INSERT INTO audit_events (tenant_id, actor_id, actor_kind, action, entity_type, entity_id, matter_id, meta, ip, prev_hash, hash)
  VALUES (app.tid(), app.uid(),
          CASE WHEN session_user = 'lawgent_worker' THEN 'worker' ELSE 'user' END,
          p_action, p_entity_type, p_entity_id, p_matter_id, coalesce(p_meta, '{}'), p_ip, '\x', '\x');
END $$;
