/**
 * Demo büro verisi (yalnızca geliştirme). API'nin kendi uçlarını kullanır, böylece
 * şifreleme, denetim kaydı ve RLS gerçek akıştan geçer.
 *
 *   pnpm db:migrate && pnpm --filter @lawgent/api seed
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql } from '@lawgent/db';
import { loadConfig } from '../src/config.js';
import { HttpAiClient } from '../src/lib/ai.js';
import { TenantKeys } from '../src/lib/keys.js';
import { createStorage } from '../src/lib/storage.js';
import { createTenant, createUser } from '../src/lib/provision.js';
import { SESSION_COOKIE, buildApp } from '../src/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '../../../..');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Lawgent2026!';
const DOMAIN = 'demo.lawgent.tr';

if (process.env.NODE_ENV === 'production') throw new Error('Seed üretimde çalıştırılamaz');
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!ownerUrl) throw new Error('DATABASE_OWNER_URL tanımlı değil');

const cfg = loadConfig();
const owner = createSql(ownerUrl, { max: 1, onnotice: () => {} });
const sql = createSql(cfg.DATABASE_URL);
const keys = TenantKeys.local(cfg.MASTER_KEY);
const app = await buildApp({ cfg, sql, storage: createStorage(cfg), keys, ai: new HttpAiClient(cfg) });

const [existing] = await owner`select t.id from tenants t join clients c on c.tenant_id = t.id where t.slug = 'demo' limit 1`;
if (existing) {
  console.log('Demo büro zaten var; atlanıyor.');
  await Promise.all([app.close(), owner.end(), sql.end()]);
  process.exit(0);
}

const tenantId = await createTenant(owner, keys, { name: 'Yılmaz & Arslan Hukuk Bürosu', slug: 'demo' });
const people = [
  { key: 'ayse', fullName: 'Av. Ayşe Yılmaz', role: 'owner', title: 'Kurucu ortak' },
  { key: 'mert', fullName: 'Av. Mert Arslan', role: 'partner', title: 'Ortak' },
  { key: 'zeynep', fullName: 'Av. Zeynep Kaya', role: 'lawyer', title: 'Kıdemli avukat' },
  { key: 'elif', fullName: 'Elif Şahin', role: 'staff', title: 'Hukuk sekreteri' },
] as const;
const ids: Record<string, string> = {};
for (const p of people) {
  ids[p.key] = await createUser(owner, { tenantId, email: `${p.key}@${DOMAIN}`, fullName: p.fullName, password: PASSWORD, role: p.role, title: p.title });
}

async function session(key: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: `${key}@${DOMAIN}`, password: PASSWORD } });
  const c = r.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('Giriş başarısız: ' + r.body);
  return { [SESSION_COOKIE]: c.value };
}
const ayse = await session('ayse');
const mert = await session('mert');

async function post<T>(cookies: Record<string, string>, url: string, payload: unknown): Promise<T> {
  const r = await app.inject({ method: 'POST', url, cookies, payload: payload as object });
  if (r.statusCode >= 300) throw new Error(`${url}: ${r.statusCode} ${r.body}`);
  return r.json() as T;
}

async function upload(cookies: Record<string, string>, matterId: string, file: string, title: string, evidence = false) {
  const data = await readFile(join(ROOT, 'fixtures/demo', file));
  const b = '----lawgent-seed';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="evidence"\r\n\r\n${evidence}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file}"\r\nContent-Type: application/pdf\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const r = await app.inject({ method: 'POST', url: `/matters/${matterId}/documents`, cookies, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } });
  if (r.statusCode !== 201) throw new Error(`yükleme: ${r.body}`);
}

const at = (days: number, hour: number, minute = 0) => {
  const d = new Date();
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  ist.setDate(ist.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}T${pad(hour)}:${pad(minute)}:00+03:00`;
};

// --- Müvekkiller ---
const anadolu = await post<{ id: string }>(ayse, '/clients', {
  kind: 'company', displayName: 'Anadolu Gıda Sanayi ve Ticaret A.Ş.', vkn: '0680012345', taxOffice: 'Gebze',
  email: 'hukuk@anadolugida.example', phone: '+90 262 000 00 00', address: 'Organize Sanayi Bölgesi 4. Cadde No:12, Gebze/Kocaeli', kvkkConsent: true,
});
const ozdemir = await post<{ id: string }>(ayse, '/clients', {
  kind: 'person', displayName: 'Mert Özdemir', tckn: '10000000146', email: 'mert.ozdemir@example.com', kvkkConsent: true,
});
const bogazici = await post<{ id: string }>(mert, '/clients', {
  kind: 'company', displayName: 'Ege Lojistik Ltd. Şti.', vkn: '3210098765', taxOffice: 'Konak', kvkkConsent: false,
});

// --- Dosyalar ---
const kira = await post<{ id: string }>(ayse, '/matters', {
  clientId: anadolu.id, type: 'dava', title: 'Kira tespit davası', court: 'İstanbul 12. Sulh Hukuk Mahkemesi', esasNo: '2026/418 E.',
  description: 'Kiraya veren, sözleşmenin 7.2. maddesine dayanarak aylık kira bedelinin 312.000 TL olarak tespitini talep ediyor. Müvekkil TÜFE sınırını aşan artışa itiraz ediyor.',
  memberIds: [ids.zeynep], counterparties: ['Boğaziçi Gayrimenkul Yatırım A.Ş.'],
});
const icra = await post<{ id: string }>(ayse, '/matters', {
  clientId: anadolu.id, type: 'icra', title: 'Alacak takibi — Ege Market', court: 'İstanbul 9. İcra Dairesi', esasNo: '2026/8841 E.',
  memberIds: [ids.mert], counterparties: ['Ege Market Gıda Ltd. Şti.'],
});
const ise = await post<{ id: string }>(ayse, '/matters', {
  clientId: ozdemir.id, type: 'dava', title: 'İşe iade davası', court: 'Bakırköy 2. İş Mahkemesi', esasNo: '2026/233 E.', memberIds: [ids.zeynep],
});
await post(mert, '/matters', { clientId: bogazici.id, type: 'sozlesme', title: 'Distribütörlük sözleşmesi incelemesi' });

// --- Süreler ve duruşmalar ---
await post(ayse, `/matters/${kira.id}/deadlines`, { title: 'Cevap dilekçesi', dueAt: at(2, 17), isCritical: true });
await post(ayse, `/matters/${ise.id}/deadlines`, { title: 'Bilirkişi raporuna itiraz', dueAt: at(5, 17), isCritical: true });
await post(ayse, `/matters/${icra.id}/deadlines`, { title: 'Haciz talebi', dueAt: at(9, 17) });
await post(ayse, `/matters/${kira.id}/hearings`, { startsAt: at(0, 9, 30), court: 'İstanbul 12. Sulh Hukuk', room: 'Salon 3', note: 'Ön inceleme' });
await post(ayse, `/matters/${ise.id}/hearings`, { startsAt: at(0, 14, 15), court: 'Bakırköy 2. İş Mahkemesi' });
await post(ayse, `/matters/${kira.id}/hearings`, { startsAt: at(16, 10, 0), court: 'İstanbul 12. Sulh Hukuk', room: 'Salon 3' });

// --- Belgeler (worker işler) ---
await upload(ayse, kira.id, 'kira-sozlesmesi.pdf', 'Kira sözleşmesi');
await upload(ayse, kira.id, 'ihtarname-taranmis.pdf', 'İhtarname', true);

console.log(`\nDemo büro hazır: ${tenantId}`);
console.log(`Giriş: ayse@${DOMAIN} / ${PASSWORD} (ayrıca mert@, zeynep@, elif@)`);
console.log('Belgelerin okunması için worker çalışıyor olmalı: pnpm --filter @lawgent/worker dev');
await Promise.all([app.close(), owner.end(), sql.end()]);
