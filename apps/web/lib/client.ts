/** Tarayıcıdan API çağrısı (aynı kaynak: /api → API sunucusu). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function call<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string; issues?: { path: string; message: string }[] };
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    window.location.href = '/giris';
  }
  if (!res.ok) throw new ApiError(res.status, body.message ?? 'Bir hata oluştu', body.error, body.issues);
  return body as T;
}
