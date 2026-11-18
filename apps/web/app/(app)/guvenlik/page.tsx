import type { Metadata } from 'next';
import { Badge } from '@lawgent/ui';
import { api, type Me } from '@/lib/api';
import { TotpSetup } from './totp';

export const metadata: Metadata = { title: 'Güvenlik' };

export default async function SecurityPage() {
  const me = await api<Me>('/auth/me');
  return (
    <div className="lg-container">
      <div>
        <h1 className="lg-h1">Güvenlik</h1>
        <p className="lg-meta">{me.user.fullName} · {me.user.email}</p>
      </div>
      <section style={{ maxWidth: 640 }}>
        <div className="lg-section-head">
          <h2 className="lg-h2">İki aşamalı doğrulama</h2>
          {me.user.totpEnabled ? <Badge tone="green">Etkin</Badge> : <Badge tone="orange">Kapalı</Badge>}
        </div>
        <p className="lg-meta" style={{ lineHeight: 1.6 }}>
          Girişte parolanın yanında kimlik doğrulama uygulamanızdaki kod istenir. Avukatlık sır saklama yükümlülüğü için önerilir.
        </p>
        {!me.user.totpEnabled && <TotpSetup />}
      </section>
    </div>
  );
}
