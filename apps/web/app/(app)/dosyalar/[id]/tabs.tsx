'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function MatterTabs({ id }: { id: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/dosyalar/${id}`, label: 'Genel bakış' },
    { href: `/dosyalar/${id}/belgeler`, label: 'Belgeler' },
    { href: `/dosyalar/${id}/sureler`, label: 'Süreler ve duruşmalar' },
    { href: `/dosyalar/${id}/sohbet`, label: 'Sohbet' },
  ];
  return (
    <nav aria-label="Dosya bölümleri" className="lg-tabs">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
