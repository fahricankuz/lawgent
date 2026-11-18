'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, LockIcon, SendIcon } from '@lawgent/ui';
import { citationLabel, type Citation } from '@lawgent/shared';
import { ApiError, call } from '@/lib/client';
import { fmtDate } from '@/lib/format';
import type { DocumentRow } from '../types';

export interface Message { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; model?: string | null }

const citationHref = (c: Citation) => `/api/documents/${c.documentId}/download?version=${c.versionId}#page=${c.pageFrom}`;

/** Yanıt metnini sade biçimde işler: paragraflar, madde işaretleri, **kalın**, [n] kaynak bağlantıları. */
function Answer({ text, citations }: { text: string; citations: Citation[] }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*|\[\d{1,2}\])/g).map((part, i) => {
      const k = `${key}-${i}`;
      const bold = part.match(/^\*\*(.+)\*\*$/);
      if (bold) return <strong key={k} style={{ fontWeight: 600 }}>{bold[1]}</strong>;
      const ref = part.match(/^\[(\d{1,2})\]$/);
      if (ref) {
        const c = byN.get(Number(ref[1]));
        return c ? (
          <a key={k} href={citationHref(c)} target="_blank" rel="noopener" title={citationLabel(c)} style={{ fontWeight: 600 }}>
            [{c.n}]
          </a>
        ) : <Fragment key={k}>{part}</Fragment>;
      }
      return <Fragment key={k}>{part}</Fragment>;
    });

  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div style={{ fontSize: 16, lineHeight: 1.65 }}>
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={bi} style={{ margin: bi ? '12px 0 0' : 0, paddingLeft: 20 }}>
              {lines.map((l, li) => <li key={li} style={{ marginTop: li ? 6 : 0 }}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return <p key={bi} style={{ margin: bi ? '14px 0 0' : 0 }}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export function ChatView(props: {
  matterId: string;
  docs: DocumentRow[];
  threads: { id: string; title: string; createdAt: string; messages: number }[];
  threadId?: string;
  initialSelected: string[];
  initialMessages: Message[];
}) {
  const { matterId, docs } = props;
  const router = useRouter();
  const [threadId, setThreadId] = useState(props.threadId);
  const [selected, setSelected] = useState(new Set(props.initialSelected));
  const [messages, setMessages] = useState<Message[]>(props.initialMessages);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ready = docs.filter((d) => d.ocrStatus === 'done');

  // Süslü parantez şart: yeni tarayıcılarda scrollIntoView bir Promise döndürür ve React bunu temizleme fonksiyonu sanar.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const documentIds = [...selected];
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: tempId, role: 'user', content: q, citations: [] }]);
    setQuestion('');
    try {
      let tid = threadId;
      if (!tid) {
        tid = (await call<{ id: string }>(`/matters/${matterId}/threads`, { method: 'POST', json: { title: q.slice(0, 80), documentIds } })).id;
        setThreadId(tid);
        // router.replace sayfayı yeniden çizer ve bekleyen yanıtı kaybettirir; yalnızca adresi güncelle.
        window.history.replaceState(null, '', `/dosyalar/${matterId}/sohbet?t=${tid}`);
      }
      const r = await call<{ answer: Message }>(`/threads/${tid}/messages`, { method: 'POST', json: { question: q, documentIds } });
      setMessages((m) => [...m, { ...r.answer, role: 'assistant' }]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yanıt alınamadı');
      setQuestion(q);
      setMessages((m) => m.filter((x) => x.id !== tempId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start', marginTop: 4 }}>
      <aside style={{ flex: '1 1 280px', minWidth: 0 }}>
        <div className="lg-section-head">
          <h2 className="lg-h3">Sohbete dahil belgeler</h2>
          <span style={{ fontSize: 14 }} className="lg-muted">{selected.size} / {ready.length}</span>
        </div>
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
          {docs.length === 0 && <li className="lg-empty">Bu dosyada henüz belge yok.</li>}
          {docs.map((d) => {
            const isReady = d.ocrStatus === 'done';
            return (
              <li key={d.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <label className="lg-check" style={{ padding: '14px 0', cursor: isReady ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={selected.has(d.id)} disabled={!isReady} onChange={() => toggle(d.id)} />
                  <span>
                    <span style={{ display: 'block', fontWeight: 500, color: isReady ? 'var(--text)' : 'var(--text-2)' }}>{d.title}</span>
                    <span className="lg-small" style={{ display: 'block', marginTop: 2 }}>
                      {isReady ? `${d.pageCount ?? '?'} sayfa · ${fmtDate(d.updatedAt)}` : d.ocrStatus === 'failed' ? 'Okunamadı' : 'Okunuyor…'}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <Link href={`/dosyalar/${matterId}/belgeler`} className="lg-btn lg-btn--outline" style={{ marginTop: 20 }}>Belge yükle</Link>

        {props.threads.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <div className="lg-section-head">
              <h2 className="lg-h3">Önceki sohbetler</h2>
              <Link href={`/dosyalar/${matterId}/sohbet?t=yeni`} style={{ fontSize: 14 }}>Yeni sohbet</Link>
            </div>
            <ul className="lg-list" style={{ marginTop: 8 }}>
              {props.threads.slice(0, 8).map((t) => (
                <li key={t.id} style={{ padding: '10px 0' }}>
                  <Link href={`/dosyalar/${matterId}/sohbet?t=${t.id}`} aria-current={t.id === threadId ? 'page' : undefined}
                    style={{ color: t.id === threadId ? 'var(--text)' : 'var(--text-3)', fontWeight: t.id === threadId ? 600 : 400, fontSize: 14 }}>
                    {t.title}
                  </Link>
                  <span className="lg-small">{fmtDate(t.createdAt, { day: 'numeric', month: 'short' })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section aria-label="Dosya sohbeti" className="lg-panel" style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 520 }}>
        <div aria-live="polite" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
          {messages.length === 0 && !busy && (
            <div className="lg-muted" style={{ fontSize: 16, lineHeight: 1.6, maxWidth: 520 }}>
              Seçili belgeler hakkında soru sorun. Her yanıt, dayandığı belge, sayfa ve maddeyle birlikte gelir.
              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {['Kira artışı nasıl düzenlenmiş?', 'Fesih koşulları neler?', 'Karşı taraf ne talep ediyor?'].map((s) => (
                  <button key={s} type="button" className="lg-btn lg-btn--secondary" style={{ height: 44, fontSize: 14 }} onClick={() => setQuestion(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '80%', background: 'var(--surface)', borderRadius: 20, padding: '14px 18px', fontSize: 16, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.content}
              </div>
            ) : (
              <div key={m.id} style={{ maxWidth: 720 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Lawgent</span>
                  <span className="lg-small">
                    {m.citations.length ? `${new Set(m.citations.map((c) => c.documentId)).size} belgeden yanıtlandı` : 'Kaynak gösterilmedi'}
                  </span>
                </div>
                <div style={{ marginTop: 10 }}><Answer text={m.content} citations={m.citations} /></div>
                {m.citations.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                    {m.citations.map((c) => (
                      <a key={c.n} href={citationHref(c)} target="_blank" rel="noopener" title={c.excerpt}
                        style={{ display: 'inline-flex', alignItems: 'center', minHeight: 32, fontSize: 13, color: 'var(--text-3)', padding: '6px 12px', borderRadius: 10, border: '1px solid var(--line)' }}>
                        {citationLabel(c)}
                      </a>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
                  <button type="button" className="lg-link-btn" onClick={() => navigator.clipboard.writeText(m.content)}>Kopyala</button>
                </div>
              </div>
            ),
          )}
          {busy && <div className="lg-muted" role="status">Belgeler okunuyor, yanıt hazırlanıyor…</div>}
          <div ref={end} />
        </div>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--line)', padding: '16px 20px 18px' }}>
          {error && <div role="alert" className="lg-alert lg-alert--red" style={{ marginBottom: 12 }}>{error}</div>}
          <form onSubmit={ask} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="soru" className="sr-only">Bu dosya hakkında sor</label>
            <input id="soru" type="text" placeholder="Bu dosya hakkında sor…" value={question} maxLength={4000}
              onChange={(e) => setQuestion(e.target.value)} disabled={busy}
              style={{ flex: 1, minWidth: 0, height: 44, border: 0, outline: 'none', background: 'transparent', fontSize: 16 }} />
            <span className="lg-badge" style={{ fontWeight: 400 }}>{selected.size} belge</span>
            <Button type="submit" className="lg-btn--icon" aria-label="Gönder" disabled={busy || question.trim().length < 2 || selected.size === 0}>
              <SendIcon size={18} strokeWidth={2.2} />
            </Button>
          </form>
          <p className="lg-nav__secure" style={{ margin: '8px 0 0' }}>
            <LockIcon size={13} />Yanıtlar yalnızca bu dosyanın belgelerinden üretilir. Veriler Türkiye'deki sunucularda kalır.
          </p>
        </div>
      </section>
    </div>
  );
}
