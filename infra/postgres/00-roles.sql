-- Küme düzeyinde roller. Docker'da ilk açılışta, CI'da test kurulumunda çalışır.
-- Üretimde parolalar Vault'tan gelir; buradakiler yalnızca geliştirme içindir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lawgent_owner') THEN
    CREATE ROLE lawgent_owner LOGIN PASSWORD 'lawgent_owner';
  END IF;
  -- Uygulama rolü: tabloların sahibi değil, BYPASSRLS yok.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lawgent_app') THEN
    CREATE ROLE lawgent_app LOGIN PASSWORD 'lawgent_app' NOBYPASSRLS;
  END IF;
  -- Worker rolü: yalnızca yükleme hattının ihtiyaç duyduğu sütunlara dokunur.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lawgent_worker') THEN
    CREATE ROLE lawgent_worker LOGIN PASSWORD 'lawgent_worker' NOBYPASSRLS;
  END IF;
END $$;
