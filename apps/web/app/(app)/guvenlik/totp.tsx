'use client';
import { useState } from 'react';
import { Button } from '@lawgent/ui';
import { ApiError, call } from '@/lib/client';

export function TotpSetup() {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="lg-alert lg-alert--green" style={{ marginTop: 24 }}>
        İki aşamalı doğrulama etkin. Bir sonraki girişte kod istenecek.
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="lg-actions" style={{ marginTop: 24 }}>
        <Button onClick={async () => setSetup(await call('/auth/totp/setup', { method: 'POST' }))}>Etkinleştir</Button>
      </div>
    );
  }
  return (
    <form
      className="lg-form"
      style={{ marginTop: 24 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await call('/auth/totp/enable', { method: 'POST', json: { code } });
          setDone(true);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Doğrulanamadı');
        }
      }}
    >
      <div className="lg-field">
        <span className="lg-label">1. Uygulamanıza bu anahtarı ekleyin</span>
        <code style={{ fontSize: 17, letterSpacing: '0.08em', padding: '12px 16px', background: 'var(--surface)', borderRadius: 12, overflowWrap: 'anywhere' }}>
          {setup.secret.match(/.{1,4}/g)?.join(' ')}
        </code>
        <a href={setup.otpauthUrl} className="lg-hint">Bu cihazdaki uygulamada aç</a>
      </div>
      <div className="lg-field">
        <label htmlFor="code">2. Uygulamadaki 6 haneli kodu girin</label>
        <input id="code" className="lg-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </div>
      {error && <div role="alert" className="lg-alert lg-alert--red">{error}</div>}
      <div><Button type="submit" disabled={code.length !== 6}>Doğrula</Button></div>
    </form>
  );
}
