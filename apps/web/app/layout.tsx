import type { Metadata } from 'next';
// Yazı tipi yerelden sunulur: kullanıcı tarayıcısı Google'a istek göndermez (KVKK).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@lawgent/ui/styles.css';

export const metadata: Metadata = {
  title: { default: 'Lawgent', template: '%s · Lawgent' },
  description: 'Türk hukuk büroları için dosya yönetimi ve dosyayla sohbet',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
