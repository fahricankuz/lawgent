-- POSTGRES_DB (lawgent) içinde süper kullanıcıyla çalışır.
ALTER DATABASE lawgent OWNER TO lawgent_owner;
-- pgvector "trusted" değil; süper kullanıcı oluşturur.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
