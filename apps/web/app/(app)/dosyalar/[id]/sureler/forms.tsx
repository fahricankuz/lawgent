'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@lawgent/ui';
import { ApiError, call } from '@/lib/client';

/** "2026-11-20T10:00" (İstanbul saati, UTC+3 sabit) → ISO */
const toIso = (local: string) => new Date(`${local}:00+03:00`).toISOString();

function useSubmit(fn: (f: FormData) => Promise<unknown>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(form));
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, onSubmit };
}

export function NewDeadline({ matterId }: { matterId: string }) {
  const s = useSubmit((f) =>
    call(`/matters/${matterId}/deadlines`, {
      method: 'POST',
      json: { title: f.get('title'), dueAt: toIso(String(f.get('dueAt'))), isCritical: f.get('critical') === 'on' },
    }),
  );
  return (
    <form onSubmit={s.onSubmit} className="lg-form" style={{ marginTop: 24, gap: 16 }}>
      <h3 className="lg-h3">Süre ekle</h3>
      <div className="lg-field"><label htmlFor="dl-title">Ne yapılacak?</label><input id="dl-title" name="title" className="lg-input" required minLength={2} placeholder="Cevaba cevap dilekçesi" /></div>
      <div className="lg-field"><label htmlFor="dl-due">Son gün</label><input id="dl-due" name="dueAt" type="datetime-local" className="lg-input" required /></div>
      <label className="lg-check" style={{ padding: 0 }}><input type="checkbox" name="critical" />Kritik süre (hak düşürücü)</label>
      {s.error && <div role="alert" className="lg-alert lg-alert--red">{s.error}</div>}
      <div><Button type="submit" variant="secondary" disabled={s.busy}>Süreyi ekle</Button></div>
    </form>
  );
}

export function NewHearing({ matterId }: { matterId: string }) {
  const s = useSubmit((f) =>
    call(`/matters/${matterId}/hearings`, {
      method: 'POST',
      json: { startsAt: toIso(String(f.get('startsAt'))), court: f.get('court') || undefined, room: f.get('room') || undefined, note: f.get('note') || undefined },
    }),
  );
  return (
    <form onSubmit={s.onSubmit} className="lg-form" style={{ marginTop: 24, gap: 16 }}>
      <h3 className="lg-h3">Duruşma ekle</h3>
      <div className="lg-field"><label htmlFor="h-at">Tarih ve saat</label><input id="h-at" name="startsAt" type="datetime-local" className="lg-input" required /></div>
      <div className="lg-row">
        <div className="lg-field"><label htmlFor="h-court">Mahkeme</label><input id="h-court" name="court" className="lg-input" /></div>
        <div className="lg-field"><label htmlFor="h-room">Salon</label><input id="h-room" name="room" className="lg-input" /></div>
      </div>
      <div className="lg-field"><label htmlFor="h-note">Not</label><input id="h-note" name="note" className="lg-input" /></div>
      {s.error && <div role="alert" className="lg-alert lg-alert--red">{s.error}</div>}
      <div><Button type="submit" variant="secondary" disabled={s.busy}>Duruşmayı ekle</Button></div>
    </form>
  );
}

export function CompleteButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button type="button" className="lg-link-btn" onClick={async () => { await call(`/deadlines/${id}/complete`, { method: 'POST' }); router.refresh(); }}>
      Tamamlandı
    </button>
  );
}
