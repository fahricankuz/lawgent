# Lawgent

Türk hukuk büroları için işletim sistemi: dosya ve dava yönetimi, müvekkil CRM'i, belge arşivi ve **dosyayla sohbet**.
Tüm veri Türkiye'deki sunucularda kalır; AI varsayılan olarak yalnızca kendi sunucumuzdaki açık ağırlıklı modellerle çalışır.

## Mimari

```
apps/web      Next.js (App Router)   arayüz; tarayıcı yalnızca /api üzerinden konuşur
apps/api      Fastify + TypeScript   kimlik doğrulama, iş mantığı, RLS bağlamı, RAG
apps/worker   Python                 OCR (Tesseract tur), madde farkında parçalama, embedding
packages/db       SQL migrasyonları, RLS politikaları, izolasyon testleri
packages/crypto   zarf şifreleme (büro anahtarı), TCKN HMAC
packages/shared   Zod şemaları, API sözleşmesi
packages/ui       tasarım sistemi (token'lar, Button, Badge, Stat)
infra/            docker-compose (Postgres+pgvector, MinIO, Ollama)
fixtures/demo     demo belgeleri (kira sözleşmesi, taranmış ihtarname)
docs/adr          mimari karar kayıtları
```

**Veri hiyerarşisi:** Büro → Müvekkil → Dosya → Belgeler / Süreler / Duruşmalar / Sohbetler.

**Güvenlik ilkeleri** (ayrıntı: [docs/adr/0001-izolasyon.md](docs/adr/0001-izolasyon.md)):

- Uygulama `lawgent_app` rolüyle bağlanır (tablo sahibi değil, RLS'i atlayamaz). Her istek bir transaction'da
  `app.tenant_id` ve `app.user_id` ayarlar; ayarlanmamışsa hiçbir satır görünmez.
- Dosya içeriğini yalnızca dosya ekibi görür (büro ortakları dahil). AI'ın okuduğu parçalar da aynı politikadan geçer.
- Etik duvar: dışlanan kullanıcı ekibe eklenemez; duvarlı dosyayı AI okuyamaz.
- Denetim kaydı yalnızca eklenir, büro başına hash zinciriyle korunur (`app.verify_audit_chain`).
- Belgeler ve TCKN büroya özgü anahtarla (AES-256-GCM) şifrelenir; anahtarlar ana anahtarla sarılır (üretimde Vault Transit).

## Yerelde çalıştırma

Gereksinimler: Node 22, pnpm 10, Python 3.11+, Docker, `tesseract-ocr` + `tesseract-ocr-tur`, `poppler-utils`.

```bash
cp .env.example .env
```

```bash
docker compose -f infra/docker-compose.yml up -d
```

```bash
pnpm install && pnpm db:migrate && pnpm db:seed
```

```bash
cd apps/worker && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
```

Üç süreci ayrı terminallerde başlatın (`.env` değişkenleri yüklü olmalı):

```bash
pnpm --filter @lawgent/api dev
```

```bash
cd apps/worker && set -a && . ../../.env && set +a && .venv/bin/python -m lawgent_worker.main
```

```bash
pnpm --filter @lawgent/web dev
```

http://localhost:3000 — demo giriş: `ayse@demo.lawgent.tr` / `Lawgent2026!` (ayrıca `mert@`, `zeynep@`, `elif@`).

Dil modeli için: `docker compose -f infra/docker-compose.yml --profile ai up -d ollama` ve
`docker compose -f infra/docker-compose.yml exec ollama ollama pull qwen2.5:7b-instruct`. Model yoksa
`LLM_PROVIDER=none` ile sohbet, ilgili bölümleri kaynaklarıyla listeler. Anlam tabanlı arama için worker'da
`pip install -e '.[embeddings]'`, `EMBEDDING_PROVIDER=bge-m3` ve `uvicorn lawgent_worker.embed_server:app --port 8001`.

## Testler

```bash
psql -h localhost -U postgres -f infra/postgres/00-roles.sql && packages/db/scripts/reset-test-db.sh
```

```bash
pnpm test
```

```bash
cd apps/worker && .venv/bin/python -m pytest -q
```

İzolasyon testleri (`packages/db/test/rls.test.ts`) CI'da zorunludur: büro arası, dosya arası, etik duvar,
kimlik bilgileri ve denetim kaydı değiştirilemezliği.

## MVP kapsamı ve sonraki adımlar

Hazır: müvekkil (çatışma taraması, KVKK onayı, şifreli TCKN), dosya ve ekip, etik duvar, belge yükleme
(versiyon, delil kopyası, Türkçe OCR), elle süre/duruşma kaydı, kaynak gösteren dosyayla sohbet, TOTP, denetim kaydı.

Sırada: yanıt akışı (SSE), yönetici paneli (kullanıcı daveti, denetim kaydı ekranı, etik duvar yönetimi),
müvekkil açılınca kontrol listesi, süre hesaplama, OpenSearch, Vault Transit entegrasyonu, harici AI için maskeleme.
