'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cx, FOCUS_RING, inputClasses } from '@/components/ui';
import { fetchClientPage } from '@/features/clients/api/clientsApi';
import type { Client } from '@/features/clients';

type Option = { id: string; name: string; mrn?: string | null; dateOfBirth?: string | null };

const MIN_CHARS = 2;
const PAGE = 20;

/**
 * Appointment form client picker: searches every client the user may see on the server (name,
 * MRN, phone, email or Valant code), instead of a dropdown capped at the first page of the roster.
 * Discharged clients are not offered (they can't be scheduled).
 */
export function ClientSearchField({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  /** Name shown for the current value (e.g. prefilled or edited appointment) */
  label?: string | null;
  disabled?: boolean;
  onChange: (client: Option | null) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < MIN_CHARS) {
      setOptions([]);
      setError(null);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        // A–Z by last name (src/lib/clients/listQuery.ts), same order as the client list
        const params = new URLSearchParams({ q, sort: 'last', dir: 'asc', limit: String(PAGE) }).toString();
        const res = await fetchClientPage({ page: 0, pageSize: PAGE, params });
        if (n !== seq.current) return;
        setOptions(
          res.clients
            .filter((c: Client) => c.status !== 'DISCHARGED')
            .map((c: Client) => ({ id: c.id, name: c.name, mrn: c.mrn, dateOfBirth: c.dateOfBirth }))
        );
        setActive(0);
        setError(null);
      } catch (err: any) {
        if (n === seq.current) setError(err?.message || 'Search failed. Try again.');
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const pick = (o: Option) => {
    onChange(o);
    setQuery('');
    setOpen(false);
  };

  if (value && !open) {
    return (
      <div className={cx(inputClasses, 'mt-1 flex items-center justify-between gap-2')}>
        <span className="min-w-0 truncate font-normal text-slate-900">{label || 'Selected client'}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(true);
            }}
            aria-label="Change client"
            className={cx('-my-1 shrink-0 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700', FOCUS_RING)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative mt-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      <input
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder="Search name, MRN, phone or Valant code"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cx(inputClasses, 'pl-8 font-normal')}
      />
      {open && query.trim().length >= MIN_CHARS && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {loading && options.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">Searching…</li>
          ) : error ? (
            <li className="px-3 py-2 text-rose-700">{error}</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-slate-500">
              No active client matches. New patient? Use Clients › New intake.
            </li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cx('cursor-pointer break-words px-3 py-2', i === active ? 'bg-blue-50 text-blue-800' : 'text-slate-800')}
              >
                <span className="font-medium">{o.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {[o.dateOfBirth ? `DOB ${o.dateOfBirth.slice(0, 10)}` : null, o.mrn ? `MRN ${o.mrn}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
