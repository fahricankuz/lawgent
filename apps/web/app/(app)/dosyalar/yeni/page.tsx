import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { NewMatterForm } from './form';

export const metadata: Metadata = { title: 'Yeni dosya' };

export default async function NewMatterPage({ searchParams }: { searchParams: Promise<{ muvekkil?: string }> }) {
  const { muvekkil } = await searchParams;
  const [clients, team, me] = await Promise.all([
    api<{ id: string; displayName: string }[]>('/clients'),
    api<{ id: string; fullName: string; role: string; title: string | null }[]>('/team'),
    api<{ user: { id: string } }>('/auth/me'),
  ]);
  return (
    <div className="lg-container">
      <nav aria-label="Konum" className="lg-crumbs"><Link href="/dosyalar">Dosyalar</Link> / <span aria-current="page">Yeni</span></nav>
      <div>
        <h1 className="lg-h1">Yeni dosya</h1>
        <p className="lg-meta">Dosyayı açan kişi ekip lideri olur. Dosyayı ve belgelerini yalnızca ekip görür.</p>
      </div>
      {clients.length === 0 ? (
        <div className="lg-actions">
          <p className="lg-muted" style={{ margin: 0 }}>Önce bir müvekkil ekleyin.</p>
          <Link className="lg-btn lg-btn--primary" href="/muvekkiller/yeni">Müvekkil ekle</Link>
        </div>
      ) : (
        <NewMatterForm clients={clients} team={team.filter((t) => t.id !== me.user.id && t.role !== 'staff')} defaultClientId={muvekkil} />
      )}
    </div>
  );
}
