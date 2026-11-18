import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@lawgent/ui';
import { api } from '@/lib/api';
import { dueLabel, dueTone, fmtDate, fmtTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Takvim' };

interface Cal {
  deadlines: { id: string; title: string; dueAt: string; isCritical: boolean; matterId: string; matterTitle: string; clientName: string; esasNo: string | null }[];
  hearings: { id: string; startsAt: string; court: string | null; room: string | null; matterId: string; matterTitle: string; clientName: string; esasNo: string | null }[];
}

export default async function CalendarPage() {
  const { deadlines, hearings } = await api<Cal>('/calendar');
  return (
    <div className="lg-container">
      <div>
        <h1 className="lg-h1">Takvim</h1>
        <p className="lg-meta">Önümüzdeki 60 gün · yalnızca ekibinde olduğunuz dosyalar</p>
      </div>
      <div className="lg-two-col">
        <section>
          <h2 className="lg-h2">Süreler</h2>
          <ul className="lg-list">
            {deadlines.length === 0 && <li className="lg-empty">Yaklaşan süre yok.</li>}
            {deadlines.map((d) => (
              <li key={d.id}>
                <div>
                  <Link href={`/dosyalar/${d.matterId}/sureler`} className="lg-list__title">{d.title}</Link>
                  <div className="lg-list__sub">{d.clientName} · {d.esasNo ?? d.matterTitle} · {fmtDate(d.dueAt, { day: 'numeric', month: 'short' })}</div>
                </div>
                <Badge tone={dueTone(d.dueAt, d.isCritical)}>{dueLabel(d.dueAt)}</Badge>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="lg-h2">Duruşmalar</h2>
          <ul className="lg-list">
            {hearings.length === 0 && <li className="lg-empty">Yaklaşan duruşma yok.</li>}
            {hearings.map((h) => (
              <li key={h.id} style={{ justifyContent: 'flex-start', gap: 20 }}>
                <div style={{ flex: 'none', width: 92 }}>
                  <div style={{ fontWeight: 600 }}>{fmtDate(h.startsAt, { day: 'numeric', month: 'short' })}</div>
                  <div className="lg-small">{fmtTime(h.startsAt)}</div>
                </div>
                <div>
                  <Link href={`/dosyalar/${h.matterId}`} className="lg-list__title">{h.clientName} — {h.matterTitle}</Link>
                  <div className="lg-list__sub">{[h.court, h.room, h.esasNo].filter(Boolean).join(' · ')}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
