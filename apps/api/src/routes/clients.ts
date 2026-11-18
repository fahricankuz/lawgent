import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, type Tx } from '@lawgent/db';
import { isValidTckn } from '@lawgent/crypto';
import { createClientInput, uuid } from '@lawgent/shared';
import { badRequest, notFound } from '../lib/errors.js';
import { clientIp } from '../server.js';

interface ConflictHit {
  source: 'client' | 'party';
  id: string | null;
  display_name: string;
  similarity: number;
  exact_id_match: boolean;
  restricted: boolean;
}

async function conflictSearch(tx: Tx, name: string, tcknHmac: Buffer | null, excludeId?: string) {
  const rows = await tx<ConflictHit[]>`select * from app.conflict_search(${name}, ${tcknHmac}, 20)`;
  return rows
    .filter((r) => r.id !== excludeId && (r.exact_id_match || r.similarity >= 0.45))
    .map((r) => ({
      source: r.source,
      id: r.id,
      name: r.display_name,
      similarity: Math.round(r.similarity * 100) / 100,
      exactIdMatch: r.exact_id_match,
      restricted: r.restricted,
    }));
}

export async function clientRoutes(app: FastifyInstance) {
  const { keys } = app.deps;

  app.get('/clients', async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    return app.db(req, (tx) => tx`
      select c.id, c.kind, c.display_name as "displayName", c.email, c.phone, c.is_restricted as "isRestricted",
             c.kvkk_consent_at is not null as "kvkkConsent", c.created_at as "createdAt",
             (select count(*)::int from matters m where m.client_id = c.id and m.status <> 'kapali') as "openMatters"
      from clients c
      where ${q ? tx`c.name_norm % app.normalize_name(${q}) or c.name_norm like '%' || app.normalize_name(${q}) || '%'` : tx`true`}
      order by c.display_name
      limit 200`);
  });

  app.get('/conflicts', async (req) => {
    const { name, tckn } = z.object({ name: z.string().trim().min(2).max(200), tckn: z.string().regex(/^\d{11}$/).optional() }).parse(req.query);
    return app.db(req, async (tx, ctx) => {
      const hmac = tckn ? await keys.tcknHmac(tx, ctx.tenantId, tckn) : null;
      const hits = await conflictSearch(tx, name, hmac);
      await audit(tx, { action: 'conflict.search', meta: { name, tckn: Boolean(tckn), hits: hits.length } });
      return { hits };
    });
  });

  app.post('/clients', async (req, reply) => {
    const input = createClientInput.parse(req.body);
    if (input.tckn && !isValidTckn(input.tckn)) throw badRequest('TCKN geçersiz');
    const result = await app.db(req, async (tx, ctx) => {
      const t = input.tckn ? await keys.encryptTckn(tx, ctx.tenantId, input.tckn) : null;
      const [c] = await tx<{ id: string }[]>`
        insert into clients (tenant_id, kind, display_name, tckn_enc, tckn_hmac, tckn_last4, vkn, tax_office,
                             email, phone, address, kvkk_consent_at, is_restricted, notes, created_by)
        values (${ctx.tenantId}, ${input.kind}, ${input.displayName}, ${t?.enc ?? null}, ${t?.hmac ?? null},
                ${input.tckn ? input.tckn.slice(-4) : null}, ${input.vkn ?? null}, ${input.taxOffice ?? null},
                ${input.email ?? null}, ${input.phone ?? null}, ${input.address ?? null},
                ${input.kvkkConsent ? new Date() : null}, ${input.isRestricted}, ${input.notes ?? null}, ${ctx.userId})
        returning id`;
      const conflicts = await conflictSearch(tx, input.displayName, t?.hmac ?? null, c!.id);
      await audit(tx, {
        action: 'client.create',
        entityType: 'client',
        entityId: c!.id,
        meta: { conflicts: conflicts.length },
        ip: clientIp(req) ?? undefined,
      });
      return { id: c!.id, conflicts };
    });
    return reply.status(201).send(result);
  });

  app.get('/clients/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, async (tx) => {
      const [c] = await tx`
        select id, kind, display_name as "displayName", tckn_last4 as "tcknLast4", vkn, tax_office as "taxOffice",
               email, phone, address, kvkk_consent_at as "kvkkConsentAt", is_restricted as "isRestricted",
               notes, created_at as "createdAt", tckn_hmac
        from clients where id = ${id}`;
      if (!c) throw notFound('Müvekkil');
      const matters = await tx`
        select m.id, m.type, m.title, m.status, m.court, m.esas_no as "esasNo", m.opened_at as "openedAt",
               (select min(h.starts_at) from hearings h where h.matter_id = m.id and h.starts_at > now()) as "nextHearing",
               (select json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by mm.role, u.full_name)
                  from matter_members mm join users u on u.id = mm.user_id where mm.matter_id = m.id) as team
        from matters m where m.client_id = ${id} order by m.opened_at desc`;
      const [stats] = await tx`
        select
          (select count(*)::int from matters where client_id = ${id} and status <> 'kapali') as "openMatters",
          (select count(*)::int from deadlines d join matters m on m.id = d.matter_id
             where m.client_id = ${id} and d.completed_at is null and d.due_at < now() + interval '30 days') as "upcomingDeadlines",
          (select count(*)::int from documents d join matters m on m.id = d.matter_id
             where m.client_id = ${id} and d.deleted_at is null) as documents,
          (select count(*)::int from hearings h join matters m on m.id = h.matter_id
             where m.client_id = ${id} and h.starts_at > now()) as "upcomingHearings"`;
      const conflicts = await conflictSearch(tx, c.displayName as string, (c.tckn_hmac as Buffer | null) ?? null, id);
      const relations = await tx`
        select r.relation, rc.id, rc.display_name as "displayName", rc.kind
        from client_relations r join clients rc on rc.id = r.related_client_id where r.client_id = ${id}`;
      await audit(tx, { action: 'client.view', entityType: 'client', entityId: id, ip: clientIp(req) ?? undefined });
      delete c.tckn_hmac;
      return { client: c, matters, stats, conflicts, relations };
    });
  });
}
