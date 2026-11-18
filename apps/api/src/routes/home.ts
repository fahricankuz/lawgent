import type { FastifyInstance } from 'fastify';

/** Ana sayfa özeti: yalnızca kullanıcının ekibinde olduğu dosyalar (RLS). Saatler İstanbul'a göre. */
export async function homeRoutes(app: FastifyInstance) {
  app.get('/home', async (req) =>
    app.db(req, async (tx) => {
      const [stats] = await tx`
        with today as (
          select (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul') as s
        )
        select
          (select count(*)::int from matters where status <> 'kapali') as "openMatters",
          (select count(*)::int from hearings, today where starts_at >= today.s and starts_at < today.s + interval '1 day') as "hearingsToday",
          (select count(*)::int from deadlines where completed_at is null and is_critical and due_at < now() + interval '7 days') as "criticalDeadlines",
          (select count(*)::int from deadlines where completed_at is null and due_at < now() + interval '7 days') as "deadlinesThisWeek",
          (select count(*)::int from document_versions v join documents d on d.current_version_id = v.id
             where v.ocr_status in ('pending', 'processing')) as "documentsProcessing"`;
      const deadlines = await tx`
        select d.id, d.title, d.due_at as "dueAt", d.is_critical as "isCritical",
               m.id as "matterId", m.title as "matterTitle", c.display_name as "clientName"
        from deadlines d join matters m on m.id = d.matter_id join clients c on c.id = m.client_id
        where d.completed_at is null and d.due_at < now() + interval '14 days'
        order by d.due_at limit 8`;
      const hearings = await tx`
        select h.id, h.starts_at as "startsAt", h.court, h.room, m.id as "matterId", m.title as "matterTitle",
               m.esas_no as "esasNo", c.display_name as "clientName"
        from hearings h join matters m on m.id = h.matter_id join clients c on c.id = m.client_id
        where h.starts_at >= date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'
          and h.starts_at < (date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '1 day') at time zone 'Europe/Istanbul'
        order by h.starts_at`;
      return { stats, deadlines, hearings };
    }),
  );
}
