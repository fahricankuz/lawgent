'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from '@lawgent/ui';
import { call } from '@/lib/client';

interface Results {
  matters: { id: string; title: string; esasNo: string | null; clientName: string }[];
  clients: { id: string; displayName: string }[];
}

/** ⌘K: dosya, müvekkil ya da esas no ile hızlı geçiş. */
export function QuickSearch() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const t = setTimeout(() => {
      call<Results>(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => {
        setRes(r);
        setActive(0);
      }).catch(() => setRes(null));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const items = [
    ...(res?.matters ?? []).map((m) => ({ href: `/dosyalar/${m.id}`, title: m.title, sub: [m.clientName, m.esasNo].filter(Boolean).join(' · '), kind: 'Dosya' })),
    ...(res?.clients ?? []).map((c) => ({ href: `/muvekkiller/${c.id}`, title: c.displayName, sub: '', kind: 'Müvekkil' })),
  ];

  return (
    <div style={{ position: 'relative' }}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (items[active]) router.push(items[active].href);
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 56, border: '1px solid var(--line)', borderRadius: 16 }}
      >
        <SearchIcon size={18} style={{ color: 'var(--text-2)', flex: 'none' }} />
        <label htmlFor="quick" className="sr-only">Dosya veya müvekkil ara</label>
        <input
          id="quick"
          ref={input}
          type="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="quick-results"
          aria-activedescendant={items.length ? `quick-${active}` : undefined}
          placeholder="Dosya, müvekkil ya da esas no ara"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Escape') setQ('');
          }}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 16 }}
        />
        <kbd className="lg-small" style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px', fontFamily: 'inherit' }}>⌘K</kbd>
      </form>
      {res && (
        <ul id="quick-results" role="listbox" style={{ position: 'absolute', zIndex: 10, top: 64, left: 0, right: 0, margin: 0, padding: 8, listStyle: 'none', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.08)' }}>
          {items.length === 0 && <li className="lg-empty" style={{ padding: '12px 12px' }}>Sonuç yok</li>}
          {items.map((it, i) => (
            <li key={it.href} id={`quick-${i}`} role="option" aria-selected={i === active}>
              <a href={it.href} onMouseEnter={() => setActive(i)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, background: i === active ? 'var(--surface)' : undefined, color: 'var(--text)' }}>
                <span><span style={{ fontWeight: 500 }}>{it.title}</span>{it.sub && <span className="lg-small"> · {it.sub}</span>}</span>
                <span className="lg-small">{it.kind}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
