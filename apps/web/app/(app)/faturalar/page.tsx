import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Faturalar' };

export default function InvoicesPage() {
  return (
    <div className="lg-container">
      <div>
        <h1 className="lg-h1">Faturalar</h1>
        <p className="lg-meta" style={{ maxWidth: 620, lineHeight: 1.6 }}>
          Zaman ve masraf kaydı ile Avukatlık Asgari Ücret Tarifesi'ne uyumlu faturalama Profesyonel pakette geliyor.
        </p>
      </div>
    </div>
  );
}
