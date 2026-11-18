import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@lawgent/ui';
import { matterStatusLabel, matterTypeLabel } from '@lawgent/shared';
import { api } from '@/lib/api';
import { dueLabel, dueTone, fmtDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Dosyalar' };

interface MatterRow {
  id: string; type: keyof typeof matterTypeLabel; title: string; status: keyof typeof matterStatusLabel;
  court: string | null; esasNo: string | null; openedAt: string; isWalled: boolean; clientId: string; clientName: string; nextDeadline: string | null;
}

export default async function MattersPage() {
  const matters = await api<MatterRow[]>('/matters');
  return (
    <div className="lg-container">
      <div className="lg-head-row">
        <div>
          <h1 className="lg-h1">Dosyalar</h1>
          <p className="lg-meta">Yalnızca ekibinde olduğunuz dosyalar görünür.</p>
        </div>
        <Link className="lg-btn lg-btn--primary" href="/dosyalar/yeni">Yeni dosya aç</Link>
      </div>
      <div className="lg-table-wrap">
        <table className="lg-table">
          <thead><tr><th>Dosya</th><th>Müvekkil</th><th>Tür</th><th>Mahkeme / Esas</th><th>Sonraki süre</th></tr></thead>
          <tbody>
            {matters.length === 0 && <tr><td colSpan={5} className="lg-empty">Henüz dosyanız yok.</td></tr>}
            {matters.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/dosyalar/${m.id}`}>{m.title}</Link>
                  {m.isWalled && <> <Badge tone="red">Etik duvar</Badge></>}
                  {m.status !== 'acik' && <> <Badge>{matterStatusLabel[m.status]}</Badge></>}
                </td>
                <td><Link href={`/muvekkiller/${m.clientId}`} style={{ fontWeight: 400, color: 'var(--text-3)' }}>{m.clientName}</Link></td>
                <td>{matterTypeLabel[m.type]}</td>
                <td>{[m.court, m.esasNo].filter(Boolean).join(' · ') || '—'}</td>
                <td>{m.nextDeadline ? <Badge tone={dueTone(m.nextDeadline)}>{dueLabel(m.nextDeadline)}</Badge> : <span className="lg-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lg-small">Son açılan: {matters[0] ? fmtDate(matters[0].openedAt) : '—'}</p>
    </div>
  );
}
