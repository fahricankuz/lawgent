import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '@lawgent/db';
import { createDeadlineInput, createHearingInput, uuid } from '@lawgent/shared';
import { notFound } from '../lib/errors.js';

export async function calendarRoutes(app: FastifyInstance) {
  app.get('/matters/:id/calendar', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, async (tx) => ({
      deadlines: await tx`
        select id, title, due_at as "dueAt", is_critical as "isCritical", completed_at as "completedAt"
        from deadlines where matter_id = ${id} order by completed_at nulls first, due_at`,
      hearings: await tx`
        select id, starts_at as "startsAt", court, room, note from hearings where matter_id = ${id} order by starts_at`,
    }));
  });

  app.post('/matters/:id/deadlines', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = createDeadlineInput.parse(req.body);
    const r = await app.db(req, async (tx, ctx) => {
      const [d] = await tx<{ id: string }[]>`
        insert into deadlines (tenant_id, matter_id, title, due_at, is_critical, created_by)
        values (${ctx.tenantId}, ${id}, ${input.title}, ${input.dueAt}, ${input.isCritical}, ${ctx.userId}) returning id`;
      await audit(tx, { action: 'deadline.create', entityType: 'deadline', entityId: d!.id, matterId: id });
      return d!;
    });
    return reply.status(201).send(r);
  });

  app.post('/deadlines/:id/complete', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, async (tx) => {
      const [d] = await tx<{ matter_id: string }[]>`
        update deadlines set completed_at = now() where id = ${id} and completed_at is null returning matter_id`;
      if (!d) throw notFound('Süre');
      await audit(tx, { action: 'deadline.complete', entityType: 'deadline', entityId: id, matterId: d.matter_id });
      return { ok: true };
    });
  });

  app.post('/matters/:id/hearings', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = createHearingInput.parse(req.body);
    const r = await app.db(req, async (tx, ctx) => {
      const [h] = await tx<{ id: string }[]>`
        insert into hearings (tenant_id, matter_id, starts_at, court, room, note, created_by)
        values (${ctx.tenantId}, ${id}, ${input.startsAt}, ${input.court ?? null}, ${input.room ?? null},
                ${input.note ?? null}, ${ctx.userId}) returning id`;
      await audit(tx, { action: 'hearing.create', entityType: 'hearing', entityId: h!.id, matterId: id });
      return h!;
    });
    return reply.status(201).send(r);
  });
}
