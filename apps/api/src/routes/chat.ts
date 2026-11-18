import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '@lawgent/db';
import { askInput, createThreadInput, uuid, type Citation } from '@lawgent/shared';
import { buildMessages, extractiveAnswer, retrieve, toCitations, usedCitationNumbers } from '../lib/ai.js';
import { HttpError, notFound } from '../lib/errors.js';

export async function chatRoutes(app: FastifyInstance) {
  const { ai } = app.deps;

  app.get('/matters/:id/threads', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, (tx) => tx`
      select t.id, t.title, t.created_at as "createdAt", u.full_name as "createdBy",
             (select count(*)::int from chat_messages m where m.thread_id = t.id) as messages
      from chat_threads t join users u on u.id = t.created_by
      where t.matter_id = ${id} order by t.created_at desc`);
  });

  app.post('/matters/:id/threads', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = createThreadInput.parse(req.body ?? {});
    const r = await app.db(req, async (tx, ctx) => {
      const [ok] = await tx<{ ok: boolean }[]>`select app.ai_can_read_matter(${id}) as ok`;
      if (!ok?.ok) throw new HttpError(403, 'Bu dosyada AI kullanımı kapalı (etik duvar veya dosya ayarı)', 'ai_disabled');
      const [t] = await tx<{ id: string }[]>`
        insert into chat_threads (tenant_id, matter_id, title, created_by)
        values (${ctx.tenantId}, ${id}, ${input.title}, ${ctx.userId}) returning id`;
      for (const docId of input.documentIds) {
        await tx`insert into chat_thread_documents (tenant_id, thread_id, document_id, matter_id)
                 values (${ctx.tenantId}, ${t!.id}, ${docId}, ${id})`;
      }
      await audit(tx, { action: 'ai.thread_create', entityType: 'chat_thread', entityId: t!.id, matterId: id });
      return t!;
    });
    return reply.status(201).send(r);
  });

  app.get('/threads/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, async (tx) => {
      const [thread] = await tx`
        select id, matter_id as "matterId", title, created_at as "createdAt" from chat_threads where id = ${id}`;
      if (!thread) throw notFound('Sohbet');
      const documentIds = (await tx<{ document_id: string }[]>`
        select document_id from chat_thread_documents where thread_id = ${id}`).map((r) => r.document_id);
      const messages = await tx`
        select m.id, m.role, m.content, m.citations, m.model, m.created_at as "createdAt", u.full_name as "author"
        from chat_messages m left join users u on u.id = m.created_by
        where m.thread_id = ${id} order by m.created_at, m.role desc`;
      return { thread, documentIds, messages };
    });
  });

  /**
   * Soru sor. Akış: bağlamı doğrula → soruyu kaydet → (embedding) → yetki filtreli hibrit arama
   * → model → yanıtı kaynaklarıyla kaydet. Denetim kaydına soru ve kullanılan kaynaklar yazılır.
   * Model çağrısı transaction dışında yapılır; uzun süren çağrı bağlantı tutmaz.
   */
  app.post('/threads/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = askInput.parse(req.body);

    const embedding = (await ai.embed([input.question]))?.[0] ?? null;

    const prep = await app.db(req, async (tx, ctx) => {
      const [t] = await tx<{ matter_id: string }[]>`select matter_id from chat_threads where id = ${id}`;
      if (!t) throw notFound('Sohbet');
      const [ok] = await tx<{ ok: boolean }[]>`select app.ai_can_read_matter(${t.matter_id}) as ok`;
      if (!ok?.ok) throw new HttpError(403, 'Bu dosyada AI kullanımı kapalı', 'ai_disabled');

      let documentIds = input.documentIds;
      if (documentIds) {
        await tx`delete from chat_thread_documents where thread_id = ${id}`;
        for (const d of documentIds) {
          await tx`insert into chat_thread_documents (tenant_id, thread_id, document_id, matter_id)
                   values (${ctx.tenantId}, ${id}, ${d}, ${t.matter_id}) on conflict do nothing`;
        }
      } else {
        documentIds = (await tx<{ document_id: string }[]>`
          select document_id from chat_thread_documents where thread_id = ${id}`).map((r) => r.document_id);
      }

      const history = await tx<{ role: 'user' | 'assistant'; content: string }[]>`
        select role, content from chat_messages where thread_id = ${id} order by created_at desc limit 6`;
      const [userMsg] = await tx<{ id: string; created_at: Date }[]>`
        insert into chat_messages (tenant_id, thread_id, matter_id, role, content, created_by)
        values (${ctx.tenantId}, ${id}, ${t.matter_id}, 'user', ${input.question}, ${ctx.userId})
        returning id, created_at`;
      const chunks = await retrieve(tx, { matterId: t.matter_id, question: input.question, documentIds, embedding });
      await audit(tx, {
        action: 'ai.query',
        entityType: 'chat_thread',
        entityId: id,
        matterId: t.matter_id,
        meta: { question: input.question, documentIds, chunkIds: chunks.map((c) => c.id), hybrid: Boolean(embedding) },
      });
      return { matterId: t.matter_id, chunks, history: history.reverse(), userMsg: userMsg! };
    });

    let text: string;
    let model: string;
    try {
      const out = await ai.complete(buildMessages(input.question, prep.chunks, prep.history));
      text = out?.text ?? extractiveAnswer(prep.chunks);
      model = out?.model ?? 'extractive';
    } catch (err) {
      req.log.error({ err }, 'model çağrısı başarısız');
      throw new HttpError(503, 'Model sunucusuna şu an ulaşılamıyor. Sorunuz kaydedildi; birazdan tekrar deneyin.', 'llm_unavailable');
    }

    const all = toCitations(prep.chunks);
    const used = usedCitationNumbers(text, all.length);
    const citations: Citation[] = used.size ? all.filter((c) => used.has(c.n)) : [];

    const saved = await app.db(req, async (tx, ctx) => {
      const [m] = await tx<{ id: string; created_at: Date }[]>`
        insert into chat_messages (tenant_id, thread_id, matter_id, role, content, citations, model)
        values (${ctx.tenantId}, ${id}, ${prep.matterId}, 'assistant', ${text},
                ${tx.json(citations as unknown as Parameters<typeof tx.json>[0])}, ${model})
        returning id, created_at`;
      await audit(tx, {
        action: 'ai.answer',
        entityType: 'chat_message',
        entityId: m!.id,
        matterId: prep.matterId,
        meta: { model, citations: citations.map((c) => ({ d: c.documentId, p: c.pageFrom })) },
      });
      return m!;
    });

    return reply.status(201).send({
      question: { id: prep.userMsg.id, content: input.question, createdAt: prep.userMsg.created_at },
      answer: { id: saved.id, content: text, citations, model, createdAt: saved.created_at },
    });
  });
}
