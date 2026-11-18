/**
 * İzolasyon testleri. CI'da zorunludur: bu testler kırmızıysa hiçbir şey birleşmez.
 *
 * Gerekli ortam değişkenleri (varsayılanlar yerel geliştirme içindir):
 *   TEST_DATABASE_OWNER_URL, TEST_DATABASE_URL, TEST_DATABASE_WORKER_URL, TEST_DATABASE_SUPER_URL
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { migrate } from '../scripts/migrate.js';
import { audit, createSql, withContext, withTenant, type Sql } from '../src/index.js';

const OWNER = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://lawgent_owner:lawgent_owner@localhost:5432/lawgent_test';
const APP = process.env.TEST_DATABASE_URL ?? 'postgres://lawgent_app:lawgent_app@localhost:5432/lawgent_test';
const WORKER = process.env.TEST_DATABASE_WORKER_URL ?? 'postgres://lawgent_worker:lawgent_worker@localhost:5432/lawgent_test';
const SUPER = process.env.TEST_DATABASE_SUPER_URL ?? 'postgres://postgres@localhost:5432/lawgent_test';

let owner: Sql;
let app: Sql;
let worker: Sql;

// İki büro: A (Yılmaz Hukuk) ve B (Demir Hukuk)
const A = { tenant: randomUUID(), partner: randomUUID(), lawyer1: randomUUID(), lawyer2: randomUUID() };
const B = { tenant: randomUUID(), partner: randomUUID() };
let clientA: string;
let restrictedClientA: string;
let matterA: string;
let docA: string;

const ctx = (tenantId: string, userId: string) => ({ tenantId, userId });

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/row-level security|permission denied|Etik duvar|violates foreign key|üye değil/);
}

beforeAll(async () => {
  await migrate(OWNER, () => {});
  owner = createSql(OWNER, { max: 2, onnotice: () => {} });
  app = createSql(APP, { max: 4 });
  worker = createSql(WORKER, { max: 2 });

  const sfx = randomBytes(4).toString('hex');
  await owner`insert into tenants (id, name, slug) values
    (${A.tenant}, 'Yılmaz Hukuk', ${'yilmaz-' + sfx}), (${B.tenant}, 'Demir Hukuk', ${'demir-' + sfx})`;
  for (const [id, name] of [
    [A.partner, 'Ayşe Yılmaz'],
    [A.lawyer1, 'Mehmet Kaya'],
    [A.lawyer2, 'Zeynep Arslan'],
    [B.partner, 'Can Demir'],
  ] as const) {
    await owner`insert into users (id, email, full_name, password_hash)
                values (${id}, ${id + '@test.lawgent.tr'}, ${name}, 'x')`;
  }
  await owner`insert into tenant_members (tenant_id, user_id, role) values
    (${A.tenant}, ${A.partner}, 'partner'), (${A.tenant}, ${A.lawyer1}, 'lawyer'),
    (${A.tenant}, ${A.lawyer2}, 'lawyer'), (${B.tenant}, ${B.partner}, 'partner')`;

  // A bürosunda lawyer1 müvekkil + dosya açar.
  await withContext(app, ctx(A.tenant, A.lawyer1), async (tx) => {
    [{ id: clientA }] = await tx`insert into clients (tenant_id, kind, display_name, created_by)
      values (${A.tenant}, 'company', 'Anadolu Gıda A.Ş.', ${A.lawyer1}) returning id`;
    [{ id: restrictedClientA }] = await tx`insert into clients (tenant_id, kind, display_name, is_restricted, created_by)
      values (${A.tenant}, 'person', 'Gizli Müvekkil', true, ${A.lawyer1}) returning id`;
    matterA = randomUUID();
    await tx`insert into matters (tenant_id, id, client_id, type, title, created_by)
      values (${A.tenant}, ${matterA}, ${clientA}, 'dava', 'Kira tespit davası', ${A.lawyer1})`;
    await tx`insert into matters (tenant_id, client_id, type, title, created_by)
      values (${A.tenant}, ${restrictedClientA}, 'danismanlik', 'Gizli danışmanlık', ${A.lawyer1})`;
    [{ id: docA }] = await tx`insert into documents (tenant_id, matter_id, title, created_by)
      values (${A.tenant}, ${matterA}, 'Kira sözleşmesi', ${A.lawyer1}) returning id`;
  });
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end(), worker?.end()]);
});

describe('büro izolasyonu', () => {
  it('bağlam yoksa hiçbir satır görünmez', async () => {
    const rows = await app`select id from clients`;
    expect(rows).toHaveLength(0);
  });

  it('B bürosu A bürosunun müvekkilini göremez', async () => {
    const rows = await withContext(app, ctx(B.tenant, B.partner), (tx) => tx`select id from clients where id = ${clientA}`);
    expect(rows).toHaveLength(0);
  });

  it('B bürosu A bürosu adına kayıt ekleyemez', async () => {
    await expectDenied(
      withContext(app, ctx(B.tenant, B.partner), (tx) =>
        tx`insert into clients (tenant_id, kind, display_name, created_by)
           values (${A.tenant}, 'person', 'Sızma', ${B.partner})`),
    );
  });

  it('B bürosu A bürosunun müvekkiline dosya bağlayamaz', async () => {
    await expectDenied(
      withContext(app, ctx(B.tenant, B.partner), (tx) =>
        tx`insert into matters (tenant_id, client_id, type, title, created_by)
           values (${B.tenant}, ${clientA}, 'dava', 'x', ${B.partner})`),
    );
  });

  it('başkası adına kayıt açılamaz (created_by sahteciliği)', async () => {
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer2), (tx) =>
        tx`insert into clients (tenant_id, kind, display_name, created_by)
           values (${A.tenant}, 'person', 'x', ${A.lawyer1})`),
    );
  });

  it('bağlam transaction dışına sızmaz', async () => {
    await withContext(app, ctx(A.tenant, A.lawyer1), (tx) => tx`select 1`);
    const [r] = await app`select app.tid() as t`;
    expect(r!.t).toBeNull();
  });
});

describe('dosya düzeyinde yetki', () => {
  it('ekip dışındaki avukat dosyayı ve belgelerini göremez', async () => {
    await withContext(app, ctx(A.tenant, A.lawyer2), async (tx) => {
      expect(await tx`select id from matters where id = ${matterA}`).toHaveLength(0);
      expect(await tx`select id from documents where id = ${docA}`).toHaveLength(0);
    });
  });

  it('büro ortağı bile ekipte değilse dosyayı göremez', async () => {
    const rows = await withContext(app, ctx(A.tenant, A.partner), (tx) => tx`select id from matters where id = ${matterA}`);
    expect(rows).toHaveLength(0);
  });

  it('dosyayı açan otomatik olarak ekip lideridir', async () => {
    const [m] = await withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
      tx`select role from matter_members where matter_id = ${matterA} and user_id = ${A.lawyer1}`);
    expect(m?.role).toBe('lead');
  });

  it('lider olmayan ekibe üye ekleyemez', async () => {
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer2), (tx) =>
        tx`insert into matter_members (tenant_id, matter_id, user_id) values (${A.tenant}, ${matterA}, ${A.lawyer2})`),
    );
  });

  it('başka büronun kullanıcısı ekibe eklenemez', async () => {
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
        tx`insert into matter_members (tenant_id, matter_id, user_id) values (${A.tenant}, ${matterA}, ${B.partner})`),
    );
  });

  it('kısıtlı müvekkil yalnızca ekiplerce görülür', async () => {
    const seen = await withContext(app, ctx(A.tenant, A.lawyer2), (tx) =>
      tx`select id from clients where id = ${restrictedClientA}`);
    expect(seen).toHaveLength(0);
    const open = await withContext(app, ctx(A.tenant, A.lawyer2), (tx) => tx`select id from clients where id = ${clientA}`);
    expect(open).toHaveLength(1);
  });

  it('çatışma taraması kısıtlı kaydı adsız gösterir', async () => {
    const rows = await withContext(app, ctx(A.tenant, A.lawyer2), (tx) =>
      tx`select * from app.conflict_search('gizli muvekkil')`);
    expect(rows[0]).toMatchObject({ display_name: 'Kısıtlı kayıt', restricted: true, id: null });
  });
});

describe('belgeler, parçalar ve worker', () => {
  let versionId: string;

  it('versiyon yüklenince numara verilir ve işleme kuyruğa alınır', async () => {
    const [v] = await withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
      tx`insert into document_versions (tenant_id, document_id, matter_id, object_key, file_name, mime_type, size_bytes, sha256, created_by)
         values (${A.tenant}, ${docA}, ${matterA}, 'k', 'kira.pdf', 'application/pdf', 10, ${randomBytes(32)}, ${A.lawyer1})
         returning id, version_no`);
    versionId = v!.id;
    expect(v!.version_no).toBe(1);
    const [d] = await withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
      tx`select current_version_id from documents where id = ${docA}`);
    expect(d!.current_version_id).toBe(versionId);
  });

  it('versiyon değiştirilemez', async () => {
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
        tx`update document_versions set object_key = 'baska' where id = ${versionId}`),
    );
  });

  it('uygulama rolü kuyruktan iş alamaz', async () => {
    await expectDenied(app`select * from app.claim_job(array['ingest_version'])`);
  });

  it('worker işi alır ve yalnızca o büroda parça yazar', async () => {
    let job;
    // Önceki test koşularından kalan işler olabilir; bu versiyonun işini bul.
    for (let i = 0; i < 1000; i++) {
      [job] = await worker`select * from app.claim_job(array['ingest_version'])`;
      if (!job || job.payload.version_id === versionId) break;
      await worker`select app.finish_job(${job.id}, true)`;
    }
    expect(job?.payload.version_id).toBe(versionId);
    await withTenant(worker, job!.tenant_id, async (tx) => {
      await tx`insert into chunks (tenant_id, matter_id, document_id, version_id, ordinal, page_from, page_to, article_ref, content)
               values (${A.tenant}, ${matterA}, ${docA}, ${versionId}, 0, 4, 4, 'm.7.2', 'Kira bedeli her yıl TÜFE oranında artırılır.')`;
      await tx`update document_versions set ocr_status = 'done', page_count = 5 where id = ${versionId}`;
      await audit(tx, { action: 'document.ingested', entityType: 'document_version', entityId: versionId, matterId: matterA });
    });
    await worker`select app.finish_job(${job!.id}, true)`;
    await expectDenied(
      withTenant(worker, B.tenant, (tx) =>
        tx`insert into chunks (tenant_id, matter_id, document_id, version_id, ordinal, page_from, page_to, content)
           values (${A.tenant}, ${matterA}, ${docA}, ${versionId}, 1, 1, 1, 'x')`),
    );
  });

  it('ekip üyesi parçaları görür, ekip dışı göremez', async () => {
    const own = await withContext(app, ctx(A.tenant, A.lawyer1), (tx) => tx`select id from chunks where matter_id = ${matterA}`);
    expect(own.length).toBeGreaterThan(0);
    const other = await withContext(app, ctx(A.tenant, A.lawyer2), (tx) => tx`select id from chunks where matter_id = ${matterA}`);
    expect(other).toHaveLength(0);
  });
});

describe('etik duvar', () => {
  it('lider ekibe ekler, duvar konunca üyelik düşer ve tekrar eklenemez', async () => {
    await withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
      tx`insert into matter_members (tenant_id, matter_id, user_id) values (${A.tenant}, ${matterA}, ${A.lawyer2})`);
    expect(
      await withContext(app, ctx(A.tenant, A.lawyer2), (tx) => tx`select id from matters where id = ${matterA}`),
    ).toHaveLength(1);

    await withContext(app, ctx(A.tenant, A.partner), (tx) =>
      tx`insert into ethical_wall_exclusions (tenant_id, matter_id, user_id, reason, created_by)
         values (${A.tenant}, ${matterA}, ${A.lawyer2}, 'Karşı tarafı önceki büroda temsil etti', ${A.partner})`);

    expect(
      await withContext(app, ctx(A.tenant, A.lawyer2), (tx) => tx`select id from matters where id = ${matterA}`),
    ).toHaveLength(0);
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
        tx`insert into matter_members (tenant_id, matter_id, user_id) values (${A.tenant}, ${matterA}, ${A.lawyer2})`),
    );
  });

  it('avukat etik duvar koyamaz', async () => {
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
        tx`insert into ethical_wall_exclusions (tenant_id, matter_id, user_id, reason, created_by)
           values (${A.tenant}, ${matterA}, ${A.partner}, 'x', ${A.lawyer1})`),
    );
  });

  it('duvarlı dosyayı AI okuyamaz; sohbet açılamaz', async () => {
    await withContext(app, ctx(A.tenant, A.lawyer1), (tx) => tx`update matters set is_walled = true where id = ${matterA}`);
    await withContext(app, ctx(A.tenant, A.lawyer1), async (tx) => {
      expect(await tx`select id from chunks where matter_id = ${matterA}`).toHaveLength(0);
      // Ekip yine de belgeleri görür.
      expect(await tx`select id from documents where id = ${docA}`).toHaveLength(1);
    });
    await expectDenied(
      withContext(app, ctx(A.tenant, A.lawyer1), (tx) =>
        tx`insert into chat_threads (tenant_id, matter_id, title, created_by) values (${A.tenant}, ${matterA}, 'x', ${A.lawyer1})`),
    );
    await withContext(app, ctx(A.tenant, A.lawyer1), (tx) => tx`update matters set is_walled = false where id = ${matterA}`);
  });
});

describe('kimlik bilgileri', () => {
  it('uygulama parola hash’ini okuyamaz', async () => {
    await expectDenied(withContext(app, ctx(A.tenant, A.lawyer1), (tx) => tx`select password_hash from users`));
  });

  it('uygulama oturum tablosunu doğrudan okuyamaz', async () => {
    await expectDenied(app`select * from sessions`);
  });

  it('oturum yalnızca üye olunan büroda açılır', async () => {
    await expectDenied(
      app`select auth.create_session(${randomBytes(32)}, ${A.lawyer1}, ${B.tenant}, false, '1 hour', null, null)`,
    );
  });
});

describe('denetim kaydı', () => {
  it('uygulama denetim kaydını değiştiremez veya silemez', async () => {
    await withContext(app, ctx(A.tenant, A.lawyer1), (tx) => audit(tx, { action: 'document.view', entityId: docA, matterId: matterA }));
    await expectDenied(withContext(app, ctx(A.tenant, A.partner), (tx) => tx`update audit_events set action = 'x'`));
    await expectDenied(withContext(app, ctx(A.tenant, A.partner), (tx) => tx`delete from audit_events`));
    await expect(owner`delete from audit_events where tenant_id = ${A.tenant}`).rejects.toThrow(/değiştirilemez/);
  });

  it('avukat denetim kaydını okuyamaz, ortak okur', async () => {
    expect(await withContext(app, ctx(A.tenant, A.lawyer1), (tx) => tx`select id from audit_events`)).toHaveLength(0);
    expect(
      (await withContext(app, ctx(A.tenant, A.partner), (tx) => tx`select id from audit_events`)).length,
    ).toBeGreaterThan(0);
  });

  it('aktör sahte olamaz: kullanıcı bağlamdan alınır', async () => {
    const rows = await withContext(app, ctx(A.tenant, A.partner), (tx) =>
      tx`select actor_id, actor_kind from audit_events where action = 'document.view' order by id desc limit 1`);
    expect(rows[0]).toMatchObject({ actor_id: A.lawyer1, actor_kind: 'user' });
  });

  it('zincir sağlamdır; süper kullanıcı bile kurcalarsa tespit edilir', async () => {
    const [ok] = await withContext(app, ctx(A.tenant, A.partner), (tx) =>
      tx`select app.verify_audit_chain(${A.tenant}) as bad`);
    expect(ok!.bad).toBeNull();

    const su = postgres(SUPER, { max: 1, onnotice: () => {} });
    try {
      await su.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update audit_events set meta = '{"kurcalandi":true}' where tenant_id = ${A.tenant}
                 and id = (select min(id) from audit_events where tenant_id = ${A.tenant})`;
      });
    } finally {
      await su.end();
    }
    const [bad] = await withContext(app, ctx(A.tenant, A.partner), (tx) =>
      tx`select app.verify_audit_chain(${A.tenant}) as bad`);
    expect(bad!.bad).not.toBeNull();
  });
});
