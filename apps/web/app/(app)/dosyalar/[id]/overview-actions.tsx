'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@lawgent/ui';
import { ApiError, call } from '@/lib/client';

export function AddMember({ matterId, candidates }: { matterId: string; candidates: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await call(`/matters/${matterId}/members`, { method: 'POST', json: { userId } });
          setUserId('');
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Eklenemedi');
        }
      }}
    >
      <label htmlFor="member" className="sr-only">Ekibe ekle</label>
      <select id="member" className="lg-select" style={{ flex: '1 1 200px', width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)} required>
        <option value="" disabled>Ekibe kişi ekle</option>
        {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
      </select>
      <Button type="submit" variant="secondary" disabled={!userId}>Ekle</Button>
      {error && <div role="alert" className="lg-alert lg-alert--red" style={{ flexBasis: '100%' }}>{error}</div>}
    </form>
  );
}

export function MatterSettings({ matterId, aiEnabled, isWalled }: { matterId: string; aiEnabled: boolean; isWalled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const patch = async (json: Record<string, boolean>) => {
    setBusy(true);
    try {
      await call(`/matters/${matterId}`, { method: 'PATCH', json });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lg-actions" style={{ marginTop: 20 }}>
      <Button variant="secondary" disabled={busy} onClick={() => patch({ aiEnabled: !aiEnabled })}>
        {aiEnabled ? 'Sohbeti kapat' : 'Sohbeti aç'}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => patch({ isWalled: !isWalled })}>
        {isWalled ? 'Etik duvarı kaldır' : 'Etik duvar koy'}
      </Button>
    </div>
  );
}
