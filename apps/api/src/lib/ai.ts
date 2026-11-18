/**
 * Dosyayla sohbet: yetki filtreli hibrit arama + kaynak gösteren yanıt.
 *
 * Yetki veritabanında uygulanır: chunks tablosunun RLS politikası yalnızca
 * kullanıcının ekibinde olduğu, AI'a açık ve duvarsız dosyaların parçalarını döndürür.
 */
import type { Tx } from '@lawgent/db';
import type { Citation } from '@lawgent/shared';
import type { Config } from '../config.js';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  versionId: string;
  pageFrom: number;
  pageTo: number;
  articleRef: string | null;
  content: string;
  score: number;
}

export interface AiClient {
  embed(texts: string[]): Promise<number[][] | null>;
  complete(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]): Promise<{ text: string; model: string } | null>;
}

export class HttpAiClient implements AiClient {
  constructor(private readonly cfg: Config) {}

  async embed(texts: string[]) {
    if (!this.cfg.EMBEDDING_URL) return null;
    try {
      const r = await fetch(`${this.cfg.EMBEDDING_URL}/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts, kind: 'query' }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return null;
      return ((await r.json()) as { vectors: number[][] }).vectors;
    } catch {
      return null;
    }
  }

  async complete(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
    if (this.cfg.LLM_PROVIDER === 'none') return null;
    const r = await fetch(`${this.cfg.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.cfg.LLM_MODEL, messages, temperature: 0.1 }),
      signal: AbortSignal.timeout(this.cfg.LLM_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`Model sunucusu hata döndürdü (${r.status})`);
    const j = (await r.json()) as { choices: { message: { content: string } }[]; model?: string };
    return { text: j.choices[0]?.message.content ?? '', model: j.model ?? this.cfg.LLM_MODEL };
  }
}

/** Türkçe tam metin (VEYA mantığıyla) + vektör araması, Reciprocal Rank Fusion ile birleştirilir. */
export async function retrieve(
  tx: Tx,
  opts: { matterId: string; question: string; documentIds?: string[]; embedding?: number[] | null; k?: number },
): Promise<RetrievedChunk[]> {
  const k = opts.k ?? 8;
  const docs = opts.documentIds?.length ? opts.documentIds : null;
  const emb = opts.embedding ? `[${opts.embedding.join(',')}]` : null;
  const rows = await tx<
    {
      id: string; document_id: string; title: string; version_id: string; page_from: number;
      page_to: number; article_ref: string | null; content: string; score: number;
    }[]
  >`
    with q as (
      select app.tr_tsquery_or(${opts.question}) as tq
    ),
    scope as (
      select c.* from chunks c
      join documents d on d.id = c.document_id and d.current_version_id = c.version_id and d.deleted_at is null
      where c.matter_id = ${opts.matterId}
        and (${docs}::uuid[] is null or c.document_id = any(${docs}::uuid[]))
    ),
    fts as (
      select s.id, row_number() over (order by ts_rank_cd(s.tsv, q.tq) desc) as r
      from scope s, q where q.tq is not null and s.tsv @@ q.tq
      limit 40
    ),
    vec as (
      select s.id, row_number() over (order by s.embedding <=> ${emb}::vector) as r
      from scope s where ${emb}::vector is not null and s.embedding is not null
      order by s.embedding <=> ${emb}::vector
      limit 40
    ),
    fused as (
      select id, sum(1.0 / (60 + r)) as score from (select * from fts union all select * from vec) u group by id
    )
    select s.id, s.document_id, d.title, s.version_id, s.page_from, s.page_to, s.article_ref, s.content,
           f.score::float8 as score
    from fused f join scope s on s.id = f.id join documents d on d.id = s.document_id
    order by f.score desc
    limit ${k}`;
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    documentTitle: r.title,
    versionId: r.version_id,
    pageFrom: r.page_from,
    pageTo: r.page_to,
    articleRef: r.article_ref,
    content: r.content,
    score: r.score,
  }));
}

export const SYSTEM_PROMPT = `Sen Lawgent'sın: Türk hukuk bürolarında avukatlara yardım eden bir asistansın.
Kurallar:
- Yalnızca aşağıda numaralandırılmış KAYNAKLAR'daki bilgiye dayan. Kaynakta olmayan bir şeyi uydurma.
- Her iddianın sonunda kaynağını köşeli parantezle göster: [1], [2] gibi.
- Kaynaklar soruyu yanıtlamaya yetmiyorsa bunu açıkça söyle ve hangi belgenin gerekebileceğini belirt.
- Türkçe, kısa ve net yaz. Hukuki terimleri doğru kullan. Kesin hukuki görüş değil, avukatın inceleyeceği bir taslak sunduğunu unutma.`;

export function buildMessages(question: string, chunks: RetrievedChunk[], history: { role: 'user' | 'assistant'; content: string }[] = []) {
  const sources = chunks
    .map((c, i) => {
      const page = c.pageFrom === c.pageTo ? `s.${c.pageFrom}` : `s.${c.pageFrom}-${c.pageTo}`;
      return `[${i + 1}] ${c.documentTitle} · ${page}${c.articleRef ? `, ${c.articleRef}` : ''}\n${c.content}`;
    })
    .join('\n\n');
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...history.slice(-6),
    { role: 'user' as const, content: `KAYNAKLAR:\n${sources || '(ilgili kaynak bulunamadı)'}\n\nSORU: ${question}` },
  ];
}

export function toCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    n: i + 1,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    versionId: c.versionId,
    pageFrom: c.pageFrom,
    pageTo: c.pageTo,
    articleRef: c.articleRef,
    excerpt: c.content.length > 400 ? c.content.slice(0, 400) + '…' : c.content,
  }));
}

/** Yanıtta geçen [n] numaralarını ayıklar. */
export function usedCitationNumbers(text: string, max: number): Set<number> {
  const used = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= max) used.add(n);
  }
  return used;
}

/** Model yapılandırılmamışsa: en ilgili bölümleri kaynaklarıyla listeler. */
export function extractiveAnswer(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return 'Seçili belgelerde bu soruyla ilgili bir bölüm bulamadım.';
  const lines = chunks.slice(0, 3).map((c, i) => {
    const t = c.content.length > 280 ? c.content.slice(0, 280) + '…' : c.content;
    return `• ${t} [${i + 1}]`;
  });
  return `Dil modeli bu ortamda kapalı. Sorunuzla en ilgili bölümler:\n\n${lines.join('\n')}`;
}
