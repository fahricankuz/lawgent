import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Sunucu bileşenlerinden API çağrısı; oturum çerezini iletir. */
export async function api<T>(path: string): Promise<T> {
  const jar = await cookies();
  const session = jar.get('lg_session')?.value;
  if (!session) redirect('/giris');
  const res = await fetch(`${API_URL}${path}`, {
    headers: { cookie: `lg_session=${session}` },
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/giris');
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'mfa_required') redirect('/guvenlik');
    notFound();
  }
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API ${res.status} ${path}`);
  return (await res.json()) as T;
}

export interface Me {
  user: { id: string; email: string; fullName: string; role: string; totpEnabled: boolean };
  tenant: { id: string; name: string; externalAiEnabled: boolean };
  mfaVerified: boolean;
}
