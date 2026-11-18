import { Badge } from '@lawgent/ui';
import { api } from '@/lib/api';
import { dueLabel, dueTone, fmtDate, fmtTime } from '@/lib/format';
import { CompleteButton, NewDeadline, NewHearing } from './forms';

interface Cal {
  deadlines: { id: string; title: string; dueAt: string; isCritical: boolean; completedAt: string | null }[];
  hearings: { id: string; startsAt: string; court: string | null; room: string | null; note: string | null }[];
}

export default async function DeadlinesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deadlines, hearings } = await api<Cal>(`/matters/${id}/calendar`);
  const open = deadlines.filter((d) => !d.completedAt);
  const done = deadlines.filter((d) => d.completedAt);
  return (
    <div className="lg-two-col" style={{ marginTop: 12 }}>
      <section>
        <h2 className="lg-h2">Süreler</h2>
        <ul className="lg-list">
          {open.length === 0 && <li className="lg-empty">Açık süre yok.</li>}
          {open.map((d) => (
            <li key={d.id}>
              <div>
                <div className="lg-list__title">{d.title}</div>
                <div className="lg-list__sub">{fmtDate(d.dueAt, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{d.isCritical && ' · Kritik'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Badge tone={dueTone(d.dueAt, d.isCritical)}>{dueLabel(d.dueAt)}</Badge>
                <CompleteButton id={d.id} />
              </div>
            </li>
          ))}
          {done.map((d) => (
            <li key={d.id}>
              <div><div className="lg-list__title" style={{ color: 'var(--text-2)', textDecoration: 'line-through' }}>{d.title}</div></div>
              <Badge tone="green">Tamamlandı</Badge>
            </li>
          ))}
        </ul>
        <NewDeadline matterId={id} />
      </section>
      <section>
        <h2 className="lg-h2">Duruşmalar</h2>
        <ul className="lg-list">
          {hearings.length === 0 && <li className="lg-empty">Duruşma yok.</li>}
          {hearings.map((h) => (
            <li key={h.id} style={{ justifyContent: 'flex-start', gap: 20 }}>
              <div style={{ flex: 'none', width: 92 }}>
                <div style={{ fontWeight: 600 }}>{fmtDate(h.startsAt, { day: 'numeric', month: 'short' })}</div>
                <div className="lg-small">{fmtTime(h.startsAt)}</div>
              </div>
              <div>
                <div className="lg-list__title">{[h.court, h.room].filter(Boolean).join(' · ') || 'Duruşma'}</div>
                {h.note && <div className="lg-list__sub">{h.note}</div>}
              </div>
            </li>
          ))}
        </ul>
        <NewHearing matterId={id} />
      </section>
    </div>
  );
}
