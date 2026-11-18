import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '@lawgent/db';
import { MATTER_STATUSES, addMemberInput, createMatterInput, uuid } from '@lawgent/shared';
import { notFound } from '../lib/errors.js';
import { clientIp } from '../server.js';

export async function matterRoutes(app: FastifyInstance) {
  app.get('/team', async (req) =>
    app.db(req, (tx) => tx`
      select u.id, u.full_name as "fullName", u.email, tm.role, tm.title
      from tenant_members tm join users u on u.id = tm.user_id
      where u.is_active order by u.full_name`),
  );

  app.get('/matters', async (req) => {
    const { status } = z.object({ status: z.enum(MATTER_STATUSES).optional() }).parse(req.query);
    return app.db(req, (tx) => tx`
      select m.id, m.type, m.title, m.status, m.court, m.esas_no as "esasNo", m.opened_at as "openedAt",
             m.is_walled as "isWalled", c.id as "clientId", c.display_name as "clientName",
             (select min(d.due_at) from deadlines d where d.matter_id = m.id and d.completed_at is null) as "nextDeadline"
      from matters m join clients c on c.id = m.client_id
      where ${status ? tx`m.status = ${status}` : tx`true`}
      order by m.opened_at desc, m.title
      limit 500`);
  });

  app.post('/matters', async (req, reply) => {
    const input = createMatterInput.parse(req.body);
    const id = randomUUID();
    await app.db(req, async (tx, ctx) => {
      // RETURNING kullanılmaz: dosya ancak ekip tetikleyicisi çalıştıktan sonra görünür olur.
      await tx`insert into matters (tenant_id, id, client_id, type, title, court, esas_no, description, created_by)
               values (${ctx.tenantId}, ${id}, ${input.clientId}, ${input.type}, ${input.title},
                       ${input.court ?? null}, ${input.esasNo ?? null}, ${input.description ?? null}, ${ctx.userId})`;
      for (const userId of input.memberIds.filter((u) => u !== ctx.userId)) {
        await tx`insert into matter_members (tenant_id, matter_id, user_id, role, added_by)
                 values (${ctx.tenantId}, ${id}, ${userId}, 'member', ${ctx.userId})`;
      }
      for (const name of input.counterparties) {
        const [p] = await tx<{ id: string }[]>`
          insert into parties (tenant_id, kind, name) values (${ctx.tenantId}, 'company', ${name}) returning id`;
        await tx`insert into matter_parties (tenant_id, matter_id, party_id, role)
                 values (${ctx.tenantId}, ${id}, ${p!.id}, 'karşı taraf')`;
      }
      await audit(tx, { action: 'matter.create', entityType: 'matter', entityId: id, matterId: id, ip: clientIp(req) ?? undefined });
    });
    return reply.status(201).send({ id });
  });

  app.get('/matters/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, async (tx, ctx) => {
      const [m] = await tx`
        select m.id, m.type, m.title, m.status, m.court, m.esas_no as "esasNo", m.description,
               m.opened_at as "openedAt", m.ai_enabled as "aiEnabled", m.is_walled as "isWalled",
               c.id as "clientId", c.display_name as "clientName",
               app.is_matter_lead(m.id) as "isLead", app.ai_can_read_matter(m.id) as "aiAvailable"
        from matters m join clients c on c.id = m.client_id where m.id = ${id}`;
      if (!m) throw notFound('Dosya');
      const team = await tx`
        select u.id, u.full_name as "fullName", mm.role from matter_members mm join users u on u.id = mm.user_id
        where mm.matter_id = ${id} order by mm.role, u.full_name`;
      const parties = await tx`
        select p.id, p.name, mp.role from matter_parties mp join parties p on p.id = mp.party_id where mp.matter_id = ${id}`;
      await audit(tx, { action: 'matter.view', entityType: 'matter', entityId: id, matterId: id, ip: clientIp(req) ?? undefined });
      return { matter: m, team, parties, me: ctx.userId };
    });
  });

  app.post('/matters/:id/members', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = addMemberInput.parse(req.body);
    await app.db(req, async (tx, ctx) => {
      await tx`insert into matter_members (tenant_id, matter_id, user_id, role, added_by)
               values (${ctx.tenantId}, ${id}, ${input.userId}, ${input.role}, ${ctx.userId})`;
      await audit(tx, { action: 'matter.member_add', entityType: 'user', entityId: input.userId, matterId: id });
    });
    return reply.status(201).send({ ok: true });
  });

  app.patch('/matters/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = z
      .object({
        status: z.enum(MATTER_STATUSES).optional(),
        aiEnabled: z.boolean().optional(),
        isWalled: z.boolean().optional(),
      })
      .parse(req.body);
    return app.db(req, async (tx) => {
      const r = await tx`
        update matters set
          status = coalesce(${input.status ?? null}::matter_status, status),
          ai_enabled = coalesce(${input.aiEnabled ?? null}::boolean, ai_enabled),
          is_walled = coalesce(${input.isWalled ?? null}::boolean, is_walled)
        where id = ${id} returning id`;
      if (!r.length) throw notFound('Dosya');
      await audit(tx, { action: 'matter.update', entityType: 'matter', entityId: id, matterId: id, meta: input });
      return { ok: true };
    });
  });
}
