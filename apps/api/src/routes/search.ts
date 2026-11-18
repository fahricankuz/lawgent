import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/** Hızlı geçiş (⌘K): erişilebilen dosya ve müvekkillerde ad / esas no araması. */
export async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
    return app.db(req, async (tx) => {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const matters = await tx`
        select m.id, m.title, m.esas_no as "esasNo", c.display_name as "clientName"
        from matters m join clients c on c.id = m.client_id
        where m.title ilike ${like} or m.esas_no ilike ${like} or c.display_name ilike ${like}
           or app.normalize_name(m.title) like '%' || app.normalize_name(${q}) || '%'
        order by m.opened_at desc limit 6`;
      const clients = await tx`
        select id, display_name as "displayName", kind from clients
        where display_name ilike ${like} or name_norm like '%' || app.normalize_name(${q}) || '%'
        order by display_name limit 6`;
      return { matters, clients };
    });
  });

  /** Takvim: önümüzdeki 60 günün süreleri ve duruşmaları. */
  app.get('/calendar', async (req) =>
    app.db(req, async (tx) => ({
      deadlines: await tx`
        select d.id, d.title, d.due_at as "dueAt", d.is_critical as "isCritical",
               m.id as "matterId", m.title as "matterTitle", c.display_name as "clientName", m.esas_no as "esasNo"
        from deadlines d join matters m on m.id = d.matter_id join clients c on c.id = m.client_id
        where d.completed_at is null and d.due_at < now() + interval '60 days'
        order by d.due_at limit 200`,
      hearings: await tx`
        select h.id, h.starts_at as "startsAt", h.court, h.room,
               m.id as "matterId", m.title as "matterTitle", c.display_name as "clientName", m.esas_no as "esasNo"
        from hearings h join matters m on m.id = h.matter_id join clients c on c.id = m.client_id
        where h.starts_at > now() - interval '1 day' and h.starts_at < now() + interval '60 days'
        order by h.starts_at limit 200`,
    })),
  );
}
