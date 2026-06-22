import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  sub?: string; // secondary line (e.g. path), also searched
  tag?: string; // small chip (e.g. "registered")
}

/** Type-to-filter combobox. Closed: shows the selected label; open: filters. */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  emptyText,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q))
    : options;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (o: SelectOption) => {
    onChange(o.value);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="ssel" ref={ref}>
      <input
        className="ssel-input"
        value={open ? query : selected?.label ?? ''}
        placeholder={selected ? selected.label : placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && filtered[active]) {
              e.preventDefault();
              pick(filtered[active]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="ssel-list">
          {filtered.length === 0 && <div className="ssel-empty muted small">{emptyText || 'no matches'}</div>}
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.value}
              className={`ssel-opt ${i === active ? 'active' : ''} ${o.value === value ? 'sel' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              <span className="ssel-opt-label">{o.label}</span>
              {o.tag && <span className="chip">{o.tag}</span>}
              {o.sub && <span className="ssel-opt-sub muted small mono">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
