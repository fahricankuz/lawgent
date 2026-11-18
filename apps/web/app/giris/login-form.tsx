'use client';
import { useState } from 'react';
import { Button } from '@lawgent/ui';
import { ApiError, call } from '@/lib/client';

type LoginResult =
  | { status: 'ok'; mfaSetupRequired: boolean }
  | { status: 'totp_required' }
  | { status: 'choose_tenant'; tenants: { id: string; name: string }[] };

export function LoginForm() {
  const [step, setStep] = useState<'password' | 'totp' | 'tenant'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(tenantId?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await call<LoginResult>('/auth/login', {
        method: 'POST',
        json: { email, password, totp: totp || undefined, tenantId },
      });
      if (r.status === 'totp_required') setStep('totp');
      else if (r.status === 'choose_tenant') {
        setTenants(r.tenants);
        setStep('tenant');
      } else window.location.href = '/';
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 429 ? 'Çok fazla deneme. Bir dakika sonra tekrar deneyin.' : e.message) : 'Sunucuya ulaşılamadı');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'tenant') {
    return (
      <div className="lg-form">
        <p className="lg-label">Hangi büroda çalışacaksınız?</p>
        <div className="lg-actions" style={{ flexDirection: 'column' }}>
          {tenants.map((t) => (
            <Button key={t.id} variant="secondary" disabled={busy} onClick={() => submit(t.id)}>
              {t.name}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form
      className="lg-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {step === 'password' ? (
        <>
          <div className="lg-field">
            <label htmlFor="email">E-posta</label>
            <input id="email" className="lg-input" type="email" autoComplete="username" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="lg-field">
            <label htmlFor="password">Parola</label>
            <input id="password" className="lg-input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="lg-field">
          <label htmlFor="totp">Doğrulama kodu</label>
          <input id="totp" className="lg-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}"
            maxLength={6} required autoFocus value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} />
          <span className="lg-hint">Kimlik doğrulama uygulamanızdaki 6 haneli kodu girin.</span>
        </div>
      )}
      {error && <div role="alert" className="lg-alert lg-alert--red">{error}</div>}
      <Button type="submit" disabled={busy}>{busy ? 'Kontrol ediliyor…' : 'Giriş yap'}</Button>
    </form>
  );
}
