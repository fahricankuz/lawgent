import Link from 'next/link';
import { Badge } from '@lawgent/ui';
import { matterTypeLabel } from '@lawgent/shared';
import { api } from '@/lib/api';
import { MatterTabs } from './tabs';
import type { MatterDetail } from './types';

export default async function MatterLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { matter: m, team } = await api<MatterDetail>(`/matters/${id}`);
  const meta = [m.court, m.esasNo && `Esas ${m.esasNo}`, team.map((t) => t.fullName).join(', ')].filter(Boolean).join(' · ');
  return (
    <div className="lg-container lg-container--wide">
      <nav aria-label="Konum" className="lg-crumbs">
        <Link href="/muvekkiller">Müvekkiller</Link> / <Link href={`/muvekkiller/${m.clientId}`}>{m.clientName}</Link> /{' '}
        <span aria-current="page">{m.esasNo ?? m.title}</span>
      </nav>
      <header>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <h1 className="lg-h1">{m.title}</h1>
          {m.isWalled && <Badge tone="red">Etik duvar</Badge>}
          {m.status === 'kapali' && <Badge>Kapalı</Badge>}
        </div>
        <p className="lg-meta">{matterTypeLabel[m.type]}{meta && ` · ${meta}`}</p>
      </header>
      <MatterTabs id={id} />
      {children}
    </div>
  );
}
