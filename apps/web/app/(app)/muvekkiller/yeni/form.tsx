'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@lawgent/ui';
import { ApiError, call } from '@/lib/client';

interface Hit { source: 'client' | 'party'; id: string | null; name: string; exactIdMatch: boolean; restricted: boolean; similarity: number }

export function NewClientForm() {
  const router = useRouter();
  const [kind, setKind] = useState<'person' | 'company'>('company');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; conflicts: Hit[] } | null>(null);

  async function checkConflicts(name: string) {
    if (name.trim().length < 3) return setHits(null);
    try {
      setHits((await call<{ hits: Hit[] }>(`/conflicts?name=${encodeURIComponent(name.trim())}`)).hits);
    } catch {
      setHits(null);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setIssues({});
    try {
      const r = await call<{ id: string; conflicts: Hit[] }>('/clients', {
        method: 'POST',
        json: {
          kind,
          displayName: f.get('displayName'),
          tckn: kind === 'person' ? f.get('tckn') : undefined,
          vkn: kind === 'company' ? f.get('vkn') : undefined,
          taxOffice: f.get('taxOffice') || undefined,
          email: f.get('email'),
          phone: f.get('phone') || undefined,
          address: f.get('address') || undefined,
          kvkkConsent: f.get('kvkk') === 'on',
          isRestricted: f.get('restricted') === 'on',
        },
      });
      if (r.conflicts.length) setCreated(r);
      else router.push(`/muvekkiller/${r.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues(Object.fromEntries((err.issues ?? []).map((i) => [i.path, i.message])));
      } else setError('Sunucuya ulaşılamadı');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="lg-form">
        <div role="alert" className="lg-alert lg-alert--orange">
          Müvekkil kaydedildi, ancak {created.conflicts.length} olası çıkar çatışması bulundu. Dosya açmadan önce inceleyin.
        </div>
        <ConflictList hits={created.conflicts} />
        <div className="lg-actions">
          <Button onClick={() => router.push(`/muvekkiller/${created.id}`)}>Müvekkile git</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="lg-form" onSubmit={onSubmit} noValidate>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lg-label" style={{ marginBottom: 8 }}>Müvekkil türü</legend>
        <div className="lg-segment">
          <label><input type="radio" name="kind" checked={kind === 'company'} onChange={() => setKind('company')} />Tüzel kişi</label>
          <label><input type="radio" name="kind" checked={kind === 'person'} onChange={() => setKind('person')} />Gerçek kişi</label>
        </div>
      </fieldset>

      <div className="lg-field">
        <label htmlFor="displayName">{kind === 'company' ? 'Unvan' : 'Ad soyad'}</label>
        <input id="displayName" name="displayName" className="lg-input" required minLength={2}
          aria-invalid={Boolean(issues.displayName)} onBlur={(e) => checkConflicts(e.target.value)} />
        {hits && hits.length === 0 && <span className="lg-hint" style={{ color: 'var(--green)' }}>Çıkar çatışması bulunmadı.</span>}
        {hits && hits.length > 0 && <ConflictList hits={hits} />}
      </div>

      <div className="lg-row">
        {kind === 'person' ? (
          <div className="lg-field">
            <label htmlFor="tckn">T.C. kimlik no</label>
            <input id="tckn" name="tckn" className="lg-input" inputMode="numeric" maxLength={11} aria-invalid={Boolean(issues.tckn)} aria-describedby="tckn-hint" />
            <span id="tckn-hint" className="lg-hint">{issues.tckn ?? 'Şifreli saklanır; ekranda yalnızca son 4 hane görünür.'}</span>
          </div>
        ) : (
          <>
            <div className="lg-field">
              <label htmlFor="vkn">Vergi kimlik no</label>
              <input id="vkn" name="vkn" className="lg-input" inputMode="numeric" maxLength={10} aria-invalid={Boolean(issues.vkn)} />
              {issues.vkn && <span className="lg-hint">{issues.vkn}</span>}
            </div>
            <div className="lg-field">
              <label htmlFor="taxOffice">Vergi dairesi</label>
              <input id="taxOffice" name="taxOffice" className="lg-input" />
            </div>
          </>
        )}
      </div>

      <div className="lg-row">
        <div className="lg-field">
          <label htmlFor="email">E-posta</label>
          <input id="email" name="email" type="email" className="lg-input" aria-invalid={Boolean(issues.email)} />
        </div>
        <div className="lg-field">
          <label htmlFor="phone">Telefon</label>
          <input id="phone" name="phone" type="tel" className="lg-input" />
        </div>
      </div>

      <div className="lg-field">
        <label htmlFor="address">Adres</label>
        <textarea id="address" name="address" className="lg-textarea" rows={2} />
      </div>

      <div>
        <label className="lg-check"><input type="checkbox" name="kvkk" />KVKK aydınlatma metni verildi ve açık rıza alındı</label>
        <label className="lg-check">
          <input type="checkbox" name="restricted" />
          <span>Kısıtlı müvekkil<span className="lg-hint" style={{ display: 'block' }}>Yalnızca bu müvekkilin dosya ekipleri görebilir.</span></span>
        </label>
      </div>

      {error && <div role="alert" className="lg-alert lg-alert--red">{error}</div>}
      <div className="lg-actions">
        <Button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Müvekkili kaydet'}</Button>
      </div>
    </form>
  );
}

function ConflictList({ hits }: { hits: Hit[] }) {
  return (
    <ul className="lg-list" style={{ marginTop: 4 }} aria-label="Olası çıkar çatışmaları">
      {hits.map((h, i) => (
        <li key={i} style={{ padding: '10px 0' }}>
          <div>
            <div className="lg-list__title">
              {h.id && h.source === 'client' ? <a href={`/muvekkiller/${h.id}`}>{h.name}</a> : h.name}
            </div>
            <div className="lg-list__sub">
              {h.source === 'client' ? 'Mevcut müvekkil' : 'Bir dosyada karşı taraf'}
              {h.restricted && ' · ayrıntılar için büro yöneticisine danışın'}
            </div>
          </div>
          <span className={`lg-badge ${h.exactIdMatch || h.source === 'party' ? 'lg-badge--red' : 'lg-badge--orange'}`}>
            {h.exactIdMatch ? 'Kimlik eşleşmesi' : `%${Math.round(h.similarity * 100)} benzer`}
          </span>
        </li>
      ))}
    </ul>
  );
}
