import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@lawgent/ui';
import { api } from '@/lib/api';

export const metadata: Metadata = { title: 'Müvekkiller' };

interface ClientRow {
  id: string; kind: 'person' | 'company'; displayName: string; email: string | null; phone: string | null;
  isRestricted: boolean; kvkkConsent: boolean; openMatters: number;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const clients = await api<ClientRow[]>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return (
    <div className="lg-container">
      <div className="lg-head-row">
        <h1 className="lg-h1">Müvekkiller</h1>
        <Link className="lg-btn lg-btn--primary" href="/muvekkiller/yeni">Müvekkil ekle</Link>
      </div>
      <form role="search" className="lg-row" style={{ maxWidth: 480 }}>
        <label htmlFor="q" className="sr-only">Müvekkil ara</label>
        <input id="q" name="q" type="search" className="lg-input" placeholder="Ad veya unvan ara" defaultValue={q} />
      </form>
      <section aria-label="Müvekkil listesi">
        <div className="lg-table-wrap">
          <table className="lg-table">
            <thead>
              <tr><th>Müvekkil</th><th>Tür</th><th>İletişim</th><th>Açık dosya</th><th>KVKK</th></tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr><td colSpan={5} className="lg-empty">{q ? 'Eşleşen müvekkil yok.' : 'Henüz müvekkil yok. İlk müvekkilinizi ekleyin.'}</td></tr>
              )}
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/muvekkiller/${c.id}`}>{c.displayName}</Link>
                    {c.isRestricted && <> <Badge tone="orange">Kısıtlı</Badge></>}
                  </td>
                  <td>{c.kind === 'company' ? 'Tüzel kişi' : 'Gerçek kişi'}</td>
                  <td>{c.email ?? c.phone ?? '—'}</td>
                  <td>{c.openMatters}</td>
                  <td>{c.kvkkConsent ? <Badge tone="green">Onaylı</Badge> : <Badge tone="orange">Bekliyor</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
