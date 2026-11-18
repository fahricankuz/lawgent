'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LockIcon } from '@lawgent/ui';
import { call } from '@/lib/client';

const LINKS = [
  { href: '/', label: 'Ana sayfa' },
  { href: '/dosyalar', label: 'Dosyalar' },
  { href: '/muvekkiller', label: 'Müvekkiller' },
  { href: '/sozlesme', label: 'Sözleşme inceleme', soon: true },
  { href: '/takvim', label: 'Takvim' },
  { href: '/faturalar', label: 'Faturalar', soon: true },
];

export function Sidebar({ tenantName, userName }: { tenantName: string; userName: string }) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <nav aria-label="Ana menü" className="lg-nav">
      <div className="lg-nav__brand">
        <Link href="/" className="lg-nav__logo">Lawgent</Link>
        <div className="lg-nav__tenant">{tenantName}</div>
      </div>
      <div className="lg-nav__links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={active(l.href) ? 'page' : undefined}>
            {l.label}
            {l.soon && <span className="lg-nav__soon">Yakında</span>}
          </Link>
        ))}
      </div>
      <div className="lg-nav__foot">
        <div className="lg-nav__secure"><LockIcon size={14} />Veriler Türkiye'de, şifreli</div>
        <div className="lg-nav__user">
          <Link href="/guvenlik" style={{ color: 'var(--text)' }}>{userName}</Link>
          <button
            type="button"
            className="lg-link-btn lg-link-btn--muted"
            onClick={async () => {
              await call('/auth/logout', { method: 'POST' }).catch(() => undefined);
              window.location.href = '/giris';
            }}
          >
            Çıkış
          </button>
        </div>
      </div>
    </nav>
  );
}
