import Link from 'next/link';
import { Badge, Stat, Stats } from '@lawgent/ui';
import { QuickSearch } from '@/components/quick-search';
import { api } from '@/lib/api';
import { daysUntil, dueLabel, dueTone, fmtDayLong, fmtNumber, fmtTime } from '@/lib/format';

interface Home {
  stats: { openMatters: number; hearingsToday: number; criticalDeadlines: number; deadlinesThisWeek: number; documentsProcessing: number };
  deadlines: { id: string; title: string; dueAt: string; isCritical: boolean; matterId: string; matterTitle: string; clientName: string }[];
  hearings: { id: string; startsAt: string; court: string | null; room: string | null; matterId: string; matterTitle: string; esasNo: string | null; clientName: string }[];
}

function headline(h: number, c: number) {
  if (h > 0 && c > 0) return <>Bugün {h} duruşma,<br />{c} kritik süre var.</>;
  if (h > 0) return <>Bugün {h} duruşma var.</>;
  if (c > 0) return <>Bu hafta {c} kritik süre<br />doluyor.</>;
  return <>Bugün acil bir şey yok.</>;
}

export default async function HomePage() {
  const { stats, deadlines, hearings } = await api<Home>('/home');
  const urgent = deadlines.find((d) => d.isCritical && daysUntil(d.dueAt) <= 3) ?? deadlines.find((d) => daysUntil(d.dueAt) <= 2);

  return (
    <div className="lg-container">
      <QuickSearch />

      <section>
        <p style={{ margin: 0, fontSize: 15 }} className="lg-muted">{fmtDayLong()}</p>
        <h1 className="lg-display" style={{ marginTop: 8 }}>{headline(stats.hearingsToday, stats.criticalDeadlines)}</h1>
        <div className="lg-actions" style={{ marginTop: 28 }}>
          <Link className="lg-btn lg-btn--primary" href="/dosyalar/yeni">Yeni dosya aç</Link>
          <Link className="lg-btn lg-btn--secondary" href="/muvekkiller/yeni">Müvekkil ekle</Link>
        </div>
      </section>

      <Stats>
        <Stat value={fmtNumber(stats.openMatters)} label="Açık dosya" />
        <Stat value={fmtNumber(stats.deadlinesThisWeek)} label="Bu hafta dolan süre" />
        <Stat value={fmtNumber(stats.hearingsToday)} label="Bugünkü duruşma" />
        <Stat value={fmtNumber(stats.documentsProcessing)} label="İşlenen belge" />
      </Stats>

      {urgent && (
        <section className="lg-callout">
          <div className="lg-callout__body">
            <div className="lg-callout__eyebrow">Lawgent önerisi</div>
            <p className="lg-callout__text">
              {urgent.clientName} dosyasında “{urgent.title}” süresi {dueLabel(urgent.dueAt).toLocaleLowerCase('tr-TR')}
              {daysUntil(urgent.dueAt) > 1 ? ' sonra doluyor' : ' doluyor'}. Dosyanın belgelerine sorarak hazırlığa başlayabilirsiniz.
            </p>
          </div>
          <Link className="lg-btn lg-btn--dark" href={`/dosyalar/${urgent.matterId}/sohbet`} style={{ flex: '1 0 auto' }}>Dosyaya sor</Link>
        </section>
      )}

      <div className="lg-two-col">
        <section>
          <div className="lg-section-head">
            <h2 className="lg-h2">Yaklaşan süreler</h2>
            <Link href="/takvim" style={{ fontSize: 15 }}>Takvim →</Link>
          </div>
          <ul className="lg-list">
            {deadlines.length === 0 && <li className="lg-empty">Önümüzdeki iki hafta için süre yok.</li>}
            {deadlines.map((d) => (
              <li key={d.id}>
                <div>
                  <Link href={`/dosyalar/${d.matterId}/sureler`} className="lg-list__title">{d.title}</Link>
                  <div className="lg-list__sub">{d.clientName} · {d.matterTitle}</div>
                </div>
                <Badge tone={dueTone(d.dueAt, d.isCritical)}>{dueLabel(d.dueAt)}</Badge>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="lg-section-head">
            <h2 className="lg-h2">Bugünkü duruşmalar</h2>
            <Link href="/takvim" style={{ fontSize: 15 }}>Tümü →</Link>
          </div>
          <ul className="lg-list">
            {hearings.length === 0 && <li className="lg-empty">Bugün duruşma yok.</li>}
            {hearings.map((h) => (
              <li key={h.id} style={{ justifyContent: 'flex-start', gap: 20 }}>
                <div style={{ flex: 'none', width: 52, fontSize: 16, fontWeight: 600 }}>{fmtTime(h.startsAt)}</div>
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
