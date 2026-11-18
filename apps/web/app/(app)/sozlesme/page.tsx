import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sözleşme inceleme' };

export default function ContractReviewPage() {
  return (
    <div className="lg-container">
      <div>
        <h1 className="lg-h1">Sözleşme inceleme</h1>
        <p className="lg-meta" style={{ maxWidth: 620, lineHeight: 1.6 }}>
          Risk puanı, eksik madde tespiti ve büro standardınıza göre kırmızı kalem Profesyonel pakette geliyor.
          O zamana kadar sözleşmeyi bir dosyaya yükleyip dosyayla sohbetten maddeleri sorabilirsiniz.
        </p>
      </div>
      <div className="lg-actions"><Link className="lg-btn lg-btn--primary" href="/dosyalar">Dosyalara git</Link></div>
    </div>
  );
}
