# ADR 0001 — Büro ve dosya izolasyonu veritabanında uygulanır

**Durum:** Kabul edildi · 2026-11

## Bağlam
Avukatlık sır saklama yükümlülüğü ve KVKK, bir büronun verisinin başka büroya, bir dosyanın ekip dışına
sızmamasını gerektirir. Uygulama kodundaki tek bir eksik `WHERE` koşulu bu garantiyi bozabilir.

## Karar
1. **Postgres RLS** tüm tablolarda açık. Uygulama tablo sahibi olmayan, `NOBYPASSRLS` bir rolle bağlanır.
2. Bağlam (`app.tenant_id`, `app.user_id`) her istekte `SET LOCAL` ile transaction'a bağlanır; havuzdaki
   bağlantıya sızmaz. Bağlam yoksa politikalar `NULL` döndürür → hiçbir satır görünmez.
3. Dosya erişiminin tek kaynağı `app.can_access_matter()`: ekip üyeliği VE etik duvar dışlaması yok.
   Büro ortakları da ekipte değilse dosyayı göremez. AI için `app.ai_can_read_matter()` ek olarak
   `ai_enabled AND NOT is_walled` ister; `chunks` tablosunun politikası bunu kullanır.
4. Çapraz büro bağları birleşik yabancı anahtarlarla `(tenant_id, id)` imkânsız kılınır.
5. Oturum, kuyruk ve denetim yazımı yalnızca `SECURITY DEFINER` fonksiyonlarla yapılır; uygulama rolünün
   bu tablolara doğrudan yazma yetkisi yoktur. Parola hash'i sütun düzeyinde uygulamaya kapalıdır.
6. Denetim kaydı UPDATE/DELETE/TRUNCATE tetikleyicileriyle engellenir ve büro başına hash zinciri tutar;
   süper kullanıcının müdahalesi bile `app.verify_audit_chain()` ile tespit edilir.
7. Worker ayrı bir rolle, yalnızca o an işlediği büronun bağlamında ve gerekli sütunlarda çalışır.

## Sonuçlar
- Her yeni tablo için RLS politikası ve izolasyon testi zorunludur (CI).
- `COPY FROM` RLS altında desteklenmez; toplu yazımlar `INSERT` ile yapılır.
- `SECURITY DEFINER` içinde bağlanan rol `session_user` ile okunur (`current_user` tablo sahibidir).
- Kurumsal pakette ayrı veritabanı veya on-prem kurulum aynı şemayla çalışır.

## Bilinçli sapmalar (ilk öneriden)
- **ORM:** Drizzle yerine `postgres.js` ile doğrudan SQL. Şemanın ağırlığı RLS ve SQL fonksiyonlarında;
  iki ayrı şema tanımını senkron tutmak yerine SQL migrasyonları tek kaynak.
- **Auth:** Better Auth yerine küçük, denetlenebilir bir uygulama (argon2id, hash'lenmiş oturum token'ı,
  RFC 6238 TOTP). Oturum tablosu RLS rol ayrımına uysun diye yalnızca `auth.*` fonksiyonlarıyla erişilir.
- **Stil:** Tailwind yerine tasarım token'larıyla düz CSS (`packages/ui`); bağımlılık az, tasarım dili birebir.
- **OCR:** `ocrmypdf` yerine sayfa başına `pdftotext` → gerekirse `pdftoppm` + Tesseract; karma belgelerde
  sayfa numarası korunur.
