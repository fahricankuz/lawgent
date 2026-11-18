'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@lawgent/ui';
import { MATTER_TYPES, matterTypeLabel } from '@lawgent/shared';
import { ApiError, call } from '@/lib/client';

export function NewMatterForm({
  clients,
  team,
  defaultClientId,
}: {
  clients: { id: string; displayName: string }[];
  team: { id: string; fullName: string; title: string | null }[];
  defaultClientId?: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<(typeof MATTER_TYPES)[number]>('dava');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ id: string }>('/matters', {
        method: 'POST',
        json: {
          clientId: f.get('clientId'),
          type,
          title: f.get('title'),
          court: f.get('court') || undefined,
          esasNo: f.get('esasNo') || undefined,
          description: f.get('description') || undefined,
          memberIds: f.getAll('members'),
          counterparties: String(f.get('counterparties') ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
        },
      });
      router.push(`/dosyalar/${r.id}/belgeler`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sunucuya ulaşılamadı');
      setBusy(false);
    }
  }

  return (
    <form className="lg-form" onSubmit={onSubmit}>
      <div className="lg-field">
        <label htmlFor="clientId">Müvekkil</label>
        <select id="clientId" name="clientId" className="lg-select" defaultValue={defaultClientId ?? ''} required>
          <option value="" disabled>Seçin</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
        </select>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lg-label" style={{ marginBottom: 8 }}>Dosya türü</legend>
        <div className="lg-segment" style={{ flexWrap: 'wrap' }}>
          {MATTER_TYPES.map((t) => (
            <label key={t}><input type="radio" name="type" checked={type === t} onChange={() => setType(t)} />{matterTypeLabel[t]}</label>
          ))}
        </div>
      </fieldset>

      <div className="lg-field">
        <label htmlFor="title">Dosya adı</label>
        <input id="title" name="title" className="lg-input" required minLength={2} placeholder="ör. Kira tespit davası" />
      </div>

      {(type === 'dava' || type === 'icra') && (
        <div className="lg-row">
          <div className="lg-field">
            <label htmlFor="court">{type === 'icra' ? 'İcra dairesi' : 'Mahkeme'}</label>
            <input id="court" name="court" className="lg-input" placeholder={type === 'icra' ? 'İstanbul 9. İcra Dairesi' : 'İstanbul 12. Sulh Hukuk Mahkemesi'} />
          </div>
          <div className="lg-field">
            <label htmlFor="esasNo">Esas no</label>
            <input id="esasNo" name="esasNo" className="lg-input" placeholder="2026/418 E." />
          </div>
        </div>
      )}

      <div className="lg-field">
        <label htmlFor="counterparties">Karşı taraf(lar)</label>
        <textarea id="counterparties" name="counterparties" className="lg-textarea" rows={2} aria-describedby="cp-hint" />
        <span id="cp-hint" className="lg-hint">Her satıra bir taraf. Çıkar çatışması taramasında kullanılır.</span>
      </div>

      {team.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lg-label">Ekip</legend>
          {team.map((t) => (
            <label key={t.id} className="lg-check">
              <input type="checkbox" name="members" value={t.id} />
              <span>{t.fullName}{t.title && <span className="lg-hint"> · {t.title}</span>}</span>
            </label>
          ))}
        </fieldset>
      )}

      {error && <div role="alert" className="lg-alert lg-alert--red">{error}</div>}
      <div className="lg-actions">
        <Button type="submit" disabled={busy}>{busy ? 'Açılıyor…' : 'Dosyayı aç'}</Button>
      </div>
    </form>
  );
}
