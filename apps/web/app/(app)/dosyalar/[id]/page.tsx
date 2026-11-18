import { Badge } from '@lawgent/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { AddMember, MatterSettings } from './overview-actions';
import type { MatterDetail } from './types';

export default async function MatterOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ matter: m, team, parties }, allTeam] = await Promise.all([
    api<MatterDetail>(`/matters/${id}`),
    api<{ id: string; fullName: string; role: string }[]>('/team'),
  ]);
  const candidates = allTeam.filter((u) => !team.some((t) => t.id === u.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48, marginTop: 12 }}>
      {m.description && <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, maxWidth: 720 }}>{m.description}</p>}

      <section className="lg-info-grid" aria-label="Dosya bilgileri">
        <div><div className="lg-info__label">Açılış</div><div className="lg-info__value">{fmtDate(m.openedAt)}</div></div>
        <div><div className="lg-info__label">Mahkeme</div><div className="lg-info__value">{m.court ?? '—'}</div></div>
        <div><div className="lg-info__label">Esas no</div><div className="lg-info__value">{m.esasNo ?? '—'}</div></div>
        <div>
          <div className="lg-info__label">Karşı taraf</div>
          <div className="lg-info__value">{parties.length ? parties.map((p) => p.name).join(', ') : '—'}</div>
        </div>
      </section>

      <div className="lg-two-col">
        <section>
          <h2 className="lg-h2">Ekip</h2>
          <ul className="lg-list">
            {team.map((t) => (
              <li key={t.id}>
                <span className="lg-list__title">{t.fullName}</span>
                {t.role === 'lead' ? <Badge tone="blue">Ekip lideri</Badge> : <Badge>Üye</Badge>}
              </li>
            ))}
          </ul>
          {m.isLead && candidates.length > 0 && <AddMember matterId={m.id} candidates={candidates} />}
        </section>

        <section>
          <h2 className="lg-h2">Erişim</h2>
          <ul className="lg-list">
            <li>
              <div>
                <div className="lg-list__title">Dosyayla sohbet</div>
                <div className="lg-list__sub">
                  {m.aiAvailable ? 'AI yalnızca bu dosyanın belgelerini okur.' : m.isWalled ? 'Etik duvar nedeniyle kapalı.' : 'Bu dosyada kapalı.'}
                </div>
              </div>
              {m.aiAvailable ? <Badge tone="green">Açık</Badge> : <Badge tone="orange">Kapalı</Badge>}
            </li>
            <li>
              <div>
                <div className="lg-list__title">Etik duvar</div>
                <div className="lg-list__sub">Açıkken ekip dışı ve AI dosyaya erişemez.</div>
              </div>
              {m.isWalled ? <Badge tone="red">Açık</Badge> : <Badge>Kapalı</Badge>}
            </li>
          </ul>
          {m.isLead && <MatterSettings matterId={m.id} aiEnabled={m.aiEnabled} isWalled={m.isWalled} />}
        </section>
      </div>
    </div>
  );
}
