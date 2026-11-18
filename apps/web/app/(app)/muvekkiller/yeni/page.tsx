import type { Metadata } from 'next';
import Link from 'next/link';
import { NewClientForm } from './form';

export const metadata: Metadata = { title: 'Yeni müvekkil' };

export default function NewClientPage() {
  return (
    <div className="lg-container">
      <nav aria-label="Konum" className="lg-crumbs"><Link href="/muvekkiller">Müvekkiller</Link> / <span aria-current="page">Yeni</span></nav>
      <div>
        <h1 className="lg-h1">Yeni müvekkil</h1>
        <p className="lg-meta">Kaydetmeden önce çıkar çatışması taraması otomatik yapılır.</p>
      </div>
      <NewClientForm />
    </div>
  );
}
