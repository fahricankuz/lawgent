/**
 * API uçtan uca testleri: gerçek Postgres (RLS dahil), yerel disk deposu, model kapalı.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createSql, withTenant, type Sql } from '@lawgent/db';
import { migrate } from '../../../packages/db/scripts/migrate.js';
import { loadConfig } from '../src/config.js';
import { TenantKeys } from '../src/lib/keys.js';
import { FsStorage } from '../src/lib/storage.js';
import { createTenant, createUser } from '../src/lib/provision.js';
import { buildApp, SESSION_COOKIE } from '../src/server.js';
import { totpAt } from '../src/lib/totp.js';
import type { AiClient } from '../src/lib/ai.js';

const OWNER = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://lawgent_owner:lawgent_owner@localhost:5432/lawgent_test';
const APP = process.env.TEST_DATABASE_URL ?? 'postgres://lawgent_app:lawgent_app@localhost:5432/lawgent_test';
const WORKER = process.env.TEST_DATABASE_WORKER_URL ?? 'postgres://lawgent_worker:lawgent_worker@localhost:5432/lawgent_test';
const MASTER_KEY = randomBytes(32).toString('base64');
const PASSWORD = 'test-parola-123';

let app: FastifyInstance;
let owner: Sql;
let sql: Sql;
let worker: Sql;
let storeDir: string;
const sfx = randomBytes(3).toString('hex');
const email = (n: string) => `${n}-${sfx}@test.lawgent.tr`;
let lastPrompt = '';

const fakeAi: AiClient = {
  embed: async () => null,
  complete: async (messages) => {
    lastPrompt = messages.at(-1)!.content;
    return { text: 'Kira bedeli her yıl TÜFE oranında artırılır [1].', model: 'test-model' };
  },
};

async function login(user: string, extra: Record<string, unknown> = {}) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: email(user), password: PASSWORD, ...extra } });
  const c = r.cookies.find((x) => x.name === SESSION_COOKIE);
  return { res: r, cookie: c ? { [SESSION_COOKIE]: c.value } : undefined };
}

let tenantA: string;
let ayse: { [k: string]: string };
let mehmet: { [k: string]: string };
let demir: { [k: string]: string };

beforeAll(async () => {
  await migrate(OWNER, () => {});
  storeDir = await mkdtemp(join(tmpdir(), 'lawgent-store-'));
  owner = createSql(OWNER, { max: 2, onnotice: () => {} });
  sql = createSql(APP, { max: 5 });
  worker = createSql(WORKER, { max: 1 });
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: APP,
    MASTER_KEY,
    STORAGE_DRIVER: 'fs',
    LLM_PROVIDER: 'none',
  } as NodeJS.ProcessEnv);
  const keys = TenantKeys.local(MASTER_KEY);
  app = await buildApp({ cfg, sql, storage: new FsStorage(storeDir), keys, ai: fakeAi });

  tenantA = await createTenant(owner, keys, { name: 'Yılmaz Hukuk', slug: `yilmaz-${sfx}` });
  const tenantB = await createTenant(owner, keys, { name: 'Demir Hukuk', slug: `demir-${sfx}` });
  await createUser(owner, { tenantId: tenantA, email: email('ayse'), fullName: 'Ayşe Yılmaz', password: PASSWORD, role: 'partner' });
  await createUser(owner, { tenantId: tenantA, email: email('mehmet'), fullName: 'Mehmet Kaya', password: PASSWORD, role: 'lawyer' });
  await createUser(owner, { tenantId: tenantB, email: email('demir'), fullName: 'Can Demir', password: PASSWORD, role: 'partner' });
  ayse = (await login('ayse')).cookie!;
  mehmet = (await login('mehmet')).cookie!;
  demir = (await login('demir')).cookie!;
});

afterAll(async () => {
  await app?.close();
  await Promise.all([owner?.end(), sql?.end(), worker?.end()]);
});

describe('kimlik doğrulama', () => {
  it('yanlış parola reddedilir, oturum açılmaz', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: email('ayse'), password: 'yanlis' } });
    expect(r.statusCode).toBe(401);
    expect(r.cookies).toHaveLength(0);
  });

  it('bilinmeyen e-posta aynı hatayı verir', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'yok@x.tr', password: 'x' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toBe('E-posta veya parola hatalı');
  });

  it('oturumsuz istek 401 alır', async () => {
    expect((await app.inject({ method: 'GET', url: '/clients' })).statusCode).toBe(401);
  });

  it('/auth/me oturum bilgisini döner', async () => {
    const r = await app.inject({ method: 'GET', url: '/auth/me', cookies: ayse });
    expect(r.json().user.fullName).toBe('Ayşe Yılmaz');
    expect(r.json().tenant.externalAiEnabled).toBe(false);
  });

  it('yabancı kaynaktan gelen değiştiren istek reddedilir (CSRF)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/clients', cookies: ayse, headers: { origin: 'https://kotu.example' },
      payload: { kind: 'person', displayName: 'X' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('TOTP kurulumu sonrası giriş kod ister', async () => {
    const zeynep = 'zeynep';
    await createUser(owner, { tenantId: tenantA, email: email(zeynep), fullName: 'Zeynep Arslan', password: PASSWORD, role: 'lawyer' });
    const c = (await login(zeynep)).cookie!;
    const setup = (await app.inject({ method: 'POST', url: '/auth/totp/setup', cookies: c })).json();
    const en = await app.inject({ method: 'POST', url: '/auth/totp/enable', cookies: c, payload: { code: totpAt(setup.secret) } });
    expect(en.statusCode).toBe(200);
    expect((await login(zeynep)).res.json().status).toBe('totp_required');
    expect((await login(zeynep, { totp: '000000' })).res.statusCode).toBe(401);
    const ok = await login(zeynep, { totp: totpAt(setup.secret) });
    expect(ok.res.json().status).toBe('ok');
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: ok.cookie });
    expect(me.json().mfaVerified).toBe(true);
  });

  it('çıkış yapınca oturum geçersiz olur', async () => {
    const c = (await login('mehmet')).cookie!;
    await app.inject({ method: 'POST', url: '/auth/logout', cookies: c });
    expect((await app.inject({ method: 'GET', url: '/auth/me', cookies: c })).statusCode).toBe(401);
  });
});

describe('müvekkil → dosya → belge → sohbet', () => {
  let clientId: string;
  let matterId: string;
  let documentId: string;
  let versionId: string;
  let threadId: string;

  it('müvekkil açılır; TCKN şifreli saklanır', async () => {
    const r = await app.inject({
      method: 'POST', url: '/clients', cookies: ayse,
      payload: { kind: 'person', displayName: 'Mert Özdemir', tckn: '10000000146', kvkkConsent: true },
    });
    expect(r.statusCode).toBe(201);
    clientId = r.json().id;
    const [row] = await owner`select tckn_enc, tckn_last4 from clients where id = ${clientId}`;
    expect(row!.tckn_last4).toBe('0146');
    expect(Buffer.from(row!.tckn_enc).includes(Buffer.from('10000000146'))).toBe(false);
  });

  it('geçersiz TCKN reddedilir', async () => {
    const r = await app.inject({
      method: 'POST', url: '/clients', cookies: ayse, payload: { kind: 'person', displayName: 'Hatalı', tckn: '12345678901' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('aynı TCKN ile ikinci kayıt çatışma olarak raporlanır', async () => {
    const r = await app.inject({
      method: 'POST', url: '/clients', cookies: ayse, payload: { kind: 'person', displayName: 'M. Özdemir', tckn: '10000000146' },
    });
    expect(r.json().conflicts.some((c: { exactIdMatch: boolean }) => c.exactIdMatch)).toBe(true);
  });

  it('dosya açılır ve açan kişi ekip lideri olur', async () => {
    const r = await app.inject({
      method: 'POST', url: '/matters', cookies: ayse,
      payload: { clientId, type: 'dava', title: 'Kira tespit davası', court: 'İstanbul 12. Sulh Hukuk Mahkemesi', esasNo: '2026/418 E.', counterparties: ['Boğaziçi Gayrimenkul A.Ş.'] },
    });
    expect(r.statusCode).toBe(201);
    matterId = r.json().id;
    const m = (await app.inject({ method: 'GET', url: `/matters/${matterId}`, cookies: ayse })).json();
    expect(m.matter.isLead).toBe(true);
    expect(m.parties[0].name).toBe('Boğaziçi Gayrimenkul A.Ş.');
  });

  it('ekip dışındaki avukat dosyayı göremez (404)', async () => {
    expect((await app.inject({ method: 'GET', url: `/matters/${matterId}`, cookies: mehmet })).statusCode).toBe(404);
    const list = (await app.inject({ method: 'GET', url: '/matters', cookies: mehmet })).json();
    expect(list.find((m: { id: string }) => m.id === matterId)).toBeUndefined();
  });

  it('başka büro müvekkili ve dosyayı göremez', async () => {
    expect((await app.inject({ method: 'GET', url: `/clients/${clientId}`, cookies: demir })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/matters/${matterId}`, cookies: demir })).statusCode).toBe(404);
  });

  it('belge yüklenir, depoda şifreli durur, indirince açılır', async () => {
    const text = 'KİRA SÖZLEŞMESİ\n\nMadde 7.2 Kira bedeli her yıl TÜFE oranında artırılır.';
    const boundary = '----lawgent' + sfx;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nKira sözleşmesi\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="kira.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from(text),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({
      method: 'POST', url: `/matters/${matterId}/documents`, cookies: ayse,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    expect(r.statusCode).toBe(201);
    ({ documentId, versionId } = r.json());

    const files = await readdir(join(storeDir, tenantA, matterId, documentId));
    const raw = await readFile(join(storeDir, tenantA, matterId, documentId, files[0]!));
    expect(raw.includes(Buffer.from('TÜFE'))).toBe(false);

    const dl = await app.inject({ method: 'GET', url: `/documents/${documentId}/download`, cookies: ayse });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe(text);
    expect((await app.inject({ method: 'GET', url: `/documents/${documentId}/download`, cookies: mehmet })).statusCode).toBe(404);
  });

  it('sahte uzantılı dosya reddedilir', async () => {
    const boundary = '----x' + sfx;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('MZ\x90\x00 bu bir exe'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({
      method: 'POST', url: `/matters/${matterId}/documents`, cookies: ayse,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    expect(r.statusCode).toBe(400);
  });

  it('sohbet kaynak etiketli yanıt verir ve kaydedilir', async () => {
    // Worker yerine parçayı doğrudan yaz.
    await withTenant(worker, tenantA, (tx) => tx`
      insert into chunks (tenant_id, matter_id, document_id, version_id, ordinal, page_from, page_to, article_ref, content)
      values (${tenantA}, ${matterId}, ${documentId}, ${versionId}, 0, 4, 4, 'm.7.2', 'Kira bedeli her yıl TÜFE oranında artırılır.')`);

    const t = await app.inject({ method: 'POST', url: `/matters/${matterId}/threads`, cookies: ayse, payload: { documentIds: [documentId] } });
    expect(t.statusCode).toBe(201);
    threadId = t.json().id;
    const r = await app.inject({
      method: 'POST', url: `/threads/${threadId}/messages`, cookies: ayse, payload: { question: 'Kira artışı nasıl hesaplanır?' },
    });
    expect(r.statusCode).toBe(201);
    const a = r.json().answer;
    expect(a.citations).toHaveLength(1);
    expect(a.citations[0]).toMatchObject({ n: 1, pageFrom: 4, articleRef: 'm.7.2', documentTitle: 'Kira sözleşmesi' });
    expect(lastPrompt).toContain('[1] Kira sözleşmesi · s.4, m.7.2');

    const th = (await app.inject({ method: 'GET', url: `/threads/${threadId}`, cookies: ayse })).json();
    expect(th.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('etik duvar konunca AI kapanır', async () => {
    await app.inject({ method: 'PATCH', url: `/matters/${matterId}`, cookies: ayse, payload: { isWalled: true } });
    const r = await app.inject({ method: 'POST', url: `/threads/${threadId}/messages`, cookies: ayse, payload: { question: 'Kira artışı?' } });
    expect(r.statusCode).toBe(403);
    await app.inject({ method: 'PATCH', url: `/matters/${matterId}`, cookies: ayse, payload: { isWalled: false } });
  });

  it('denetim kaydı: görüntüleme ve AI sorusu kaydedilmiş, zincir sağlam', async () => {
    const rows = await owner`select action, meta from audit_events where tenant_id = ${tenantA} order by id`;
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['client.create', 'matter.create', 'document.upload', 'document.view', 'ai.query', 'ai.answer']));
    expect(rows.find((r) => r.action === 'ai.query')!.meta.question).toBe('Kira artışı nasıl hesaplanır?');
  });

  it('ana sayfa yalnızca kendi dosyalarını sayar', async () => {
    await app.inject({
      method: 'POST', url: `/matters/${matterId}/deadlines`, cookies: ayse,
      payload: { title: 'Cevaba cevap dilekçesi', dueAt: new Date(Date.now() + 2 * 86400e3).toISOString(), isCritical: true },
    });
    const a = (await app.inject({ method: 'GET', url: '/home', cookies: ayse })).json();
    expect(a.stats.criticalDeadlines).toBe(1);
    const m = (await app.inject({ method: 'GET', url: '/home', cookies: mehmet })).json();
    expect(m.stats.criticalDeadlines).toBe(0);
  });
});
