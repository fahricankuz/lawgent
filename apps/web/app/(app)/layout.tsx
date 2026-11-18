import { Sidebar } from '@/components/sidebar';
import { api, type Me } from '@/lib/api';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api<Me>('/auth/me');
  return (
    <div className="lg-shell">
      <Sidebar tenantName={me.tenant.name} userName={me.user.fullName} />
      <main className="lg-main">{children}</main>
    </div>
  );
}
