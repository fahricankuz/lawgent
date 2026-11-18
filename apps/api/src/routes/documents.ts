import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '@lawgent/db';
import { sha256 } from '@lawgent/crypto';
import { uuid } from '@lawgent/shared';
import { badRequest, notFound } from '../lib/errors.js';
import { clientIp } from '../server.js';

const ALLOWED: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/tiff': (b) => ['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1')),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => b.subarray(0, 2).toString('latin1') === 'PK',
  'text/plain': (b) => !b.subarray(0, 4096).includes(0),
};

function sniffMime(declared: string, fileName: string, buf: Buffer): string {
  const byExt: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff',
    tiff: 'image/tiff', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain',
  };
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mime = ALLOWED[declared] ? declared : byExt[ext];
  if (!mime || !ALLOWED[mime]!(buf)) throw badRequest('Desteklenmeyen veya bozuk dosya türü');
  return mime;
}

const safeName = (n: string) => n.replace(/[\\/\0\r\n"]/g, '_').slice(0, 200) || 'belge';

export async function documentRoutes(app: FastifyInstance) {
  const { storage, keys } = app.deps;

  app.get('/matters/:id/documents', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, (tx) => tx`
      select d.id, d.title, d.category, d.created_at as "createdAt",
             v.id as "versionId", v.version_no as "versionNo", v.file_name as "fileName", v.mime_type as "mimeType",
             v.size_bytes::int as "sizeBytes", v.ocr_status as "ocrStatus", v.page_count as "pageCount",
             v.is_evidence_copy as "isEvidence", u.full_name as "uploadedBy", v.created_at as "updatedAt"
      from documents d
      join document_versions v on v.id = d.current_version_id
      join users u on u.id = v.created_by
      where d.matter_id = ${id} and d.deleted_at is null
      order by v.created_at desc`);
  });

  /**
   * Çok parçalı yükleme. Alanlar: file (zorunlu), title, category, evidence ("true"), documentId (yeni versiyon için).
   * Nesne, veritabanı kaydıyla aynı transaction içinde yazılır; depo hatasında kayıt geri alınır.
   */
  app.post('/matters/:id/documents', async (req, reply) => {
    const { id: matterId } = z.object({ id: uuid }).parse(req.params);
    const fields: Record<string, string> = {};
    let file: { name: string; mime: string; buf: Buffer } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.file.truncated) throw badRequest('Dosya çok büyük');
        file = { name: safeName(part.filename), mime: part.mimetype, buf };
      } else {
        fields[part.fieldname] = String(part.value).slice(0, 500);
      }
    }
    if (!file || file.buf.length === 0) throw badRequest('Dosya seçilmedi');
    const meta = z
      .object({
        title: z.string().trim().max(200).optional(),
        category: z.string().trim().max(60).optional(),
        evidence: z.enum(['true', 'false']).optional(),
        documentId: uuid.optional(),
      })
      .parse(fields);
    const mime = sniffMime(file.mime, file.name, file.buf);
    const evidence = meta.evidence === 'true';

    const result = await app.db(req, async (tx, ctx) => {
      let documentId = meta.documentId;
      if (documentId) {
        const [d] = await tx`select id from documents where id = ${documentId} and matter_id = ${matterId} and deleted_at is null`;
        if (!d) throw notFound('Belge');
      } else {
        const [d] = await tx<{ id: string }[]>`
          insert into documents (tenant_id, matter_id, title, category, created_by)
          values (${ctx.tenantId}, ${matterId}, ${meta.title || file!.name.replace(/\.[^.]+$/, '')}, ${meta.category ?? null}, ${ctx.userId})
          returning id`;
        documentId = d!.id;
      }
      const versionId = randomUUID();
      const objectKey = `${ctx.tenantId}/${matterId}/${documentId}/${versionId}`;
      const [v] = await tx<{ version_no: number }[]>`
        insert into document_versions (tenant_id, id, document_id, matter_id, object_key, file_name, mime_type,
                                       size_bytes, sha256, is_evidence_copy, created_by)
        values (${ctx.tenantId}, ${versionId}, ${documentId}, ${matterId}, ${objectKey}, ${file!.name}, ${mime},
                ${file!.buf.length}, ${sha256(file!.buf)}, ${evidence}, ${ctx.userId})
        returning version_no`;
      const sealed = await keys.encryptObject(tx, ctx.tenantId, objectKey, file!.buf);
      await storage.put(objectKey, sealed, { evidence });
      await audit(tx, {
        action: 'document.upload',
        entityType: 'document',
        entityId: documentId,
        matterId,
        meta: { versionId, versionNo: v!.version_no, sha256: sha256(file!.buf).toString('hex'), evidence },
        ip: clientIp(req) ?? undefined,
      });
      return { documentId, versionId, versionNo: v!.version_no };
    });
    return reply.status(201).send(result);
  });

  app.get('/documents/:id/versions', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return app.db(req, (tx) => tx`
      select v.id, v.version_no as "versionNo", v.file_name as "fileName", v.size_bytes::int as "sizeBytes",
             encode(v.sha256, 'hex') as sha256, v.is_evidence_copy as "isEvidence", v.ocr_status as "ocrStatus",
             v.page_count as "pageCount", u.full_name as "uploadedBy", v.created_at as "createdAt"
      from document_versions v join users u on u.id = v.created_by
      where v.document_id = ${id} order by v.version_no desc`);
  });

  app.get('/documents/:id/download', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { version } = z.object({ version: uuid.optional() }).parse(req.query);
    const out = await app.db(req, async (tx, ctx) => {
      const [v] = await tx<{ id: string; object_key: string; file_name: string; mime_type: string; matter_id: string }[]>`
        select v.id, v.object_key, v.file_name, v.mime_type, v.matter_id
        from documents d join document_versions v on v.document_id = d.id
        where d.id = ${id} and v.id = coalesce(${version ?? null}::uuid, d.current_version_id)`;
      if (!v) throw notFound('Belge');
      const plain = await keys.decryptObject(tx, ctx.tenantId, v.object_key, await storage.get(v.object_key));
      await audit(tx, {
        action: 'document.view',
        entityType: 'document',
        entityId: id,
        matterId: v.matter_id,
        meta: { versionId: v.id },
        ip: clientIp(req) ?? undefined,
      });
      return { plain, v };
    });
    return reply
      .header('content-type', out.v.mime_type)
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(out.v.file_name)}`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(out.plain);
  });
}
