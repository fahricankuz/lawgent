const TZ = 'Europe/Istanbul';

export const fmtDate = (d: string | Date, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, ...opts }).format(new Date(d));

export const fmtTime = (d: string | Date) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d));

export const fmtDayLong = (d: Date = new Date()) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);

export const fmtNumber = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}

/** İstanbul saatine göre bugünden kaç gün sonra (takvim günü). */
export function daysUntil(d: string | Date): number {
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x);
  const a = new Date(day(new Date()) + 'T00:00:00Z').getTime();
  const b = new Date(day(new Date(d)) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

export function dueLabel(d: string | Date) {
  const n = daysUntil(d);
  if (n < 0) return `${-n} gün geçti`;
  if (n === 0) return 'Bugün';
  if (n === 1) return 'Yarın';
  return `${n} gün`;
}

export function dueTone(d: string | Date, critical = false): 'red' | 'orange' | 'neutral' {
  const n = daysUntil(d);
  if (n <= 3 || (critical && n <= 7)) return 'red';
  if (n <= 7) return 'orange';
  return 'neutral';
}

export const initials = (name: string) =>
  name
    .replace(/\b(A\.Ş\.|Ltd\.|Şti\.|Av\.)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase('tr-TR'))
    .join('');
