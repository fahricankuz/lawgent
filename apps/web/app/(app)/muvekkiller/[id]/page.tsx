import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Stat, Stats } from '@lawgent/ui';
import { matterStatusLabel, matterTypeLabel } from '@lawgent/shared';
import { api } from '@/lib/api';
import { fmtDate, initials } from '@/lib/format';

export const metadata: Metadata = { title: 'Müvekkil' };

interface ClientDetail {
  client: {
    id: string; kind: 'person' | 'company'; displayName: string; tcknLast4: string | null; vkn: string | null;
    taxOffice: string | null; email: string | null; phone: string | null; address: string | null;
    kvkkConsentAt: string | null; isRestricted: boolean; createdAt: string;
  };
  matters: {
    id: string; type: keyof typeof matterTypeLabel; title: string; status: keyof typeof matterStatusLabel;
    court: string | null; esasNo: string | null; nextHearing: string | null; team: { id: string; fullName: string }[] | null;
  }[];
  stats: { openMatters: number; upcomingDeadlines: number; documents: number; upcomingHearings: number };
  conflicts: { source: string; id: string | null; name: string; exactIdMatch: boolean }[];
  relations: { relation: string; id: string; displayName: string }[];
}

const statusTone = { acik: 'blue', beklemede: 'orange', kapali: 'neutral' } as const;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client: c, matters, stats, conflicts, relations } = await api<ClientDetail>(`/clients/${id}`);
  const leads = [...new Set(matters.flatMap((m) => (m.team ?? []).slice(0, 1).map((t) => t.fullName)))];

  return (
    <div className="lg-container">
      <nav aria-label="Konum" className="lg-crumbs"><Link href="/muvekkiller">Müvekkiller</Link> / <span aria-current="page">{c.displayName}</span></nav>

      <section className="lg-head-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div aria-hidden="true" className="lg-avatar">{initials(c.displayName)}</div>
          <div>
            <h1 className="lg-h1" style={{ fontSize: 'clamp(30px, 4vw, 40px)', lineHeight: 1.1, letterSpacing: '-0.03em' }}>{c.displayName}</h1>
            <p className="lg-meta" style={{ marginTop: 6 }}>
              {c.kind === 'company' ? 'Tüzel kişi' : 'Gerçek kişi'} · {fmtDate(c.createdAt, { month: 'long', year: 'numeric' })} tarihinden beri müvekkil
              {leads.length > 0 && ` · Sorumlu: ${leads.join(', ')}`}
            </p>
          </div>
        </div>
        <div className="lg-actions">
          {c.email && <a className="lg-btn lg-btn--secondary" href={`mailto:${c.email}`}>İletişime geç</a>}
          <Link className="lg-btn lg-btn--primary" href={`/dosyalar/yeni?muvekkil=${c.id}`}>Yeni dosya aç</Link>
        </div>
      </section>

      <div className="lg-actions" style={{ marginTop: -24, gap: 8 }}>
        {conflicts.length === 0 ? (
          <Badge tone="green" large>Çıkar çatışması yok · {fmtDate(new Date(), { day: 'numeric', month: 'short' })} kontrol edildi</Badge>
        ) : (
          <Badge tone="red" large>{conflicts.length} olası çıkar çatışması</Badge>
        )}
        {c.kvkkConsentAt ? <Badge large>KVKK aydınlatma onayı alındı</Badge> : <Badge tone="orange" large>KVKK onayı bekleniyor</Badge>}
        {c.isRestricted && <Badge tone="orange" large>Kısıtlı müvekkil</Badge>}
      </div>

      {conflicts.length > 0 && (
        <section aria-label="Olası çıkar çatışmaları" className="lg-alert lg-alert--red">
          <strong style={{ fontWeight: 600 }}>İnceleyin:</strong>{' '}
          {conflicts.map((x, i) => (
            <span key={i}>{i > 0 && ', '}{x.name} ({x.source === 'client' ? 'müvekkil' : 'karşı taraf'}{x.exactIdMatch ? ', kimlik eşleşmesi' : ''})</span>
          ))}
        </section>
      )}

      <Stats>
        <Stat value={stats.openMatters} label="Açık dosya" />
        <Stat value={stats.upcomingHearings} label="Yaklaşan duruşma" />
        <Stat value={stats.upcomingDeadlines} label="30 gün içinde süre" />
        <Stat value={stats.documents} label="Belge" />
      </Stats>

      <section>
        <div className="lg-section-head"><h2 className="lg-h2">Dosyalar</h2></div>
        <div className="lg-table-wrap">
          <table className="lg-table">
            <thead><tr><th>Dosya</th><th>Tür</th><th>Mahkeme / Esas</th><th>Sonraki duruşma</th><th>Durum</th></tr></thead>
            <tbody>
              {matters.length === 0 && (
                <tr><td colSpan={5} className="lg-empty">Görebildiğiniz dosya yok. Yalnızca ekibinde olduğunuz dosyalar listelenir.</td></tr>
              )}
              {matters.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/dosyalar/${m.id}`}>{m.title}</Link></td>
                  <td>{matterTypeLabel[m.type]}</td>
                  <td>{[m.court, m.esasNo].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{m.nextHearing ? fmtDate(m.nextHearing, { day: 'numeric', month: 'short' }) : '—'}</td>
                  <td><Badge tone={statusTone[m.status]}>{matterStatusLabel[m.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lg-info-grid" aria-label="İletişim bilgileri">
        <Info label="E-posta" value={c.email} />
        <Info label="Telefon" value={c.phone} />
        {c.kind === 'company' ? <Info label="Vergi dairesi / VKN" value={[c.taxOffice, c.vkn].filter(Boolean).join(' · ')} /> : <Info label="T.C. kimlik no" value={c.tcknLast4 ? `••••••• ${c.tcknLast4}` : null} />}
        <Info label="Adres" value={c.address} />
        {relations.length > 0 && <Info label="İlişkili kişi ve şirketler" value={relations.map((r) => `${r.displayName} (${r.relation})`).join(', ')} />}
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="lg-info__label">{label}</div>
      <div className="lg-info__value">{value || '—'}</div>
    </div>
  );
}
