'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, UploadIcon, type Tone } from '@lawgent/ui';
import { ApiError } from '@/lib/client';
import { fmtBytes, fmtDate } from '@/lib/format';
import type { DocumentRow } from '../types';

const STATUS: Record<DocumentRow['ocrStatus'], { label: string; tone: Tone }> = {
  pending: { label: 'Sırada', tone: 'neutral' },
  processing: { label: 'Okunuyor', tone: 'blue' },
  done: { label: 'Hazır', tone: 'green' },
  failed: { label: 'Okunamadı', tone: 'red' },
};

export function DocumentsView({ matterId, docs }: { matterId: string; docs: DocumentRow[] }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [evidence, setEvidence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processing = docs.some((d) => d.ocrStatus === 'pending' || d.ocrStatus === 'processing');

  // Belgeler okunurken listeyi kendiliğinden yenile.
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [processing, router]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        const body = new FormData();
        body.set('evidence', String(evidence));
        body.set('file', f);
        const res = await fetch(`/api/matters/${matterId}/documents`, { method: 'POST', body, credentials: 'same-origin' });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          throw new ApiError(res.status, `${f.name}: ${j.message ?? 'yüklenemedi'}`);
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yüklenemedi');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
        <input ref={file} id="upload" type="file" multiple className="sr-only"
          accept=".pdf,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt" onChange={(e) => upload(e.target.files)} />
        <Button onClick={() => file.current?.click()} disabled={busy}>
          <UploadIcon size={16} />{busy ? 'Yükleniyor…' : 'Belge yükle'}
        </Button>
        <label className="lg-check" style={{ padding: 0 }}>
          <input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} />
          <span>Delil kopyası olarak kilitle<span className="lg-hint" style={{ display: 'block' }}>Değiştirilemez ve silinemez saklanır.</span></span>
        </label>
      </div>
      {error && <div role="alert" className="lg-alert lg-alert--red">{error}</div>}

      <div className="lg-table-wrap">
        <table className="lg-table">
          <thead><tr><th>Belge</th><th>Sayfa</th><th>Boyut</th><th>Yükleyen</th><th>Durum</th></tr></thead>
          <tbody>
            {docs.length === 0 && (
              <tr><td colSpan={5} className="lg-empty">Henüz belge yok. PDF, Word, görüntü veya metin yükleyebilirsiniz; taranmış belgeler Türkçe OCR ile okunur.</td></tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <a href={`/api/documents/${d.id}/download`} target="_blank" rel="noopener">{d.title}</a>
                  <div className="lg-small" style={{ marginTop: 2 }}>
                    {d.fileName}{d.versionNo > 1 && ` · v${d.versionNo}`}{d.isEvidence && ' · Delil kopyası'}
                  </div>
                </td>
                <td>{d.pageCount ?? '—'}</td>
                <td>{fmtBytes(d.sizeBytes)}</td>
                <td>{d.uploadedBy}<div className="lg-small">{fmtDate(d.updatedAt)}</div></td>
                <td><Badge tone={STATUS[d.ocrStatus].tone}>{STATUS[d.ocrStatus].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lg-small">Belgeler büronuza özel anahtarla şifrelenir. Her açılış denetim kaydına yazılır.</p>
    </div>
  );
}
