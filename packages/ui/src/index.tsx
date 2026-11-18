import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, SVGProps } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'dark';
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...rest} className={cx('lg-btn', `lg-btn--${variant}`, className)} />;
}

/** Bağlantı görünümlü buton yerine buton görünümlü bağlantı (gezinme için). */
export function ButtonLink({
  variant = 'primary',
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a {...rest} className={cx('lg-btn', `lg-btn--${variant}`, className)} />;
}

export type Tone = 'neutral' | 'red' | 'orange' | 'green' | 'blue';
export function Badge({ tone = 'neutral', large, children }: { tone?: Tone; large?: boolean; children: ReactNode }) {
  return <span className={cx('lg-badge', tone !== 'neutral' && `lg-badge--${tone}`, large && 'lg-badge--lg')}>{children}</span>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="lg-stat">
      <div className="lg-stat__value">{value}</div>
      <div className="lg-stat__label">{label}</div>
    </div>
  );
}

export function Stats({ children, label = 'Özet' }: { children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="lg-stats">
      {children}
    </section>
  );
}

const icon = (path: ReactNode) =>
  function Icon(p: SVGProps<SVGSVGElement> & { size?: number }) {
    const { size = 16, ...rest } = p;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        {path}
      </svg>
    );
  };

export const LockIcon = icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const SearchIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const SendIcon = icon(<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>);
export const UploadIcon = icon(<><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></>);
export const ShieldIcon = icon(<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />);
