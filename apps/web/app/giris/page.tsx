import type { Metadata } from 'next';
import { LockIcon } from '@lawgent/ui';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Giriş' };

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 40 }}>
        <div>
          <div className="lg-nav__logo" style={{ fontSize: 24 }}>Lawgent</div>
          <h1 className="lg-h1" style={{ marginTop: 32 }}>Büronuza giriş yapın</h1>
        </div>
        <LoginForm />
        <p className="lg-nav__secure">
          <LockIcon size={14} />
          Veriler Türkiye'deki sunucularda, şifreli saklanır.
        </p>
      </div>
    </main>
  );
}
