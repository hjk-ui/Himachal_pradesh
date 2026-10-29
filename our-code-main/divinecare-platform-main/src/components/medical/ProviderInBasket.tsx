'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { InBasketListItem, InBasketTile } from '@/lib/medical/inbasket';
import { CLOSE_LOOP_NOTIFY_METHODS, type NotifyMethod } from '@/lib/medical/close-loop';

export function ProviderInBasket() {
  const [tiles, setTiles] = useState<InBasketTile[]>([]);
  const [results, setResults] = useState<InBasketListItem[]>([]);
  const [closeTheLoop, setCloseTheLoop] = useState<InBasketListItem[]>([]);
  const [overdueLabs, setOverdueLabs] = useState<InBasketListItem[]>([]);
  const [referralsAwaiting, setReferralsAwaiting] = useState<InBasketListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notifyItemId, setNotifyItemId] = useState<string | null>(null);
  const [method, setMethod] = useState<NotifyMethod>('Phone');
  const [notifiedAt, setNotifiedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState('');

  async function load() {
    const res = await apiJson<{
      success: boolean;
      tiles?: InBasketTile[];
      results?: InBasketListItem[];
      closeTheLoop?: InBasketListItem[];
      overdueLabs?: InBasketListItem[];
      referralsAwaiting?: InBasketListItem[];
      error?: string;
    }>('/api/medical/inbasket');
    if (!res.success) {
      setError(res.error || 'Unable to load in-basket');
      return;
    }
    setTiles(res.tiles || []);
    setResults(res.results || []);
    setCloseTheLoop(res.closeTheLoop || []);
    setOverdueLabs(res.overdueLabs || []);
    setReferralsAwaiting(res.referralsAwaiting || []);
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load in-basket');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function patientNotified() {
    if (!notifyItemId) return;
    const res = await apiJson<{ success: boolean; error?: string }>('/api/medical/inbasket/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: notifyItemId,
        method,
        notifiedAt,
      }),
    });
    if (!res.success) {
      setMessage(res.error || 'Notify failed');
      return;
    }
    setMessage('Patient notified');
    setNotifyItemId(null);
    await load();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="provider-inbasket">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50">
          <Inbox size={18} className="text-sky-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">In-basket</h2>
          <p className="text-xs text-slate-500">Refills · results · close the loop · unsigned notes</p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-amber-800">{error}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 hover:bg-slate-50"
          >
            <p className="text-lg font-bold tabular-nums text-slate-900">{t.count}</p>
            <p className="text-xs font-medium text-slate-600">{t.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <ListBlock title="Results to review" items={results} empty="None on file" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Close the loop</p>
          {closeTheLoop.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">None on file</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {closeTheLoop.slice(0, 5).map((item) => (
                <li key={item.id} className="text-sm text-slate-800">
                  <span>{item.title}</span>
                  <span className="text-xs text-slate-500"> · {item.detail}</span>
                  {item.notified ? (
                    <span className="ml-2 text-xs font-semibold text-emerald-700">Patient notified</span>
                  ) : (
                    <button
                      type="button"
                      className="ml-2 text-xs font-semibold text-sky-800 underline"
                      onClick={() => setNotifyItemId(item.id)}
                    >
                      Notify…
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notifyItemId ? (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Notify method</p>
              <div className="flex flex-wrap gap-2">
                {CLOSE_LOOP_NOTIFY_METHODS.map((m) => (
                  <label key={m} className="inline-flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name="notify-method"
                      checked={method === m}
                      onChange={() => setMethod(m)}
                    />
                    {m}
                  </label>
                ))}
              </div>
              <label className="block text-xs font-semibold text-slate-600">
                Date
                <input
                  type="date"
                  className="mt-1 block rounded border px-2 py-1 text-sm"
                  value={notifiedAt}
                  onChange={(e) => setNotifiedAt(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white"
                onClick={() => void patientNotified()}
              >
                Patient notified
              </button>
            </div>
          ) : null}
        </div>
        <ListBlock title="Overdue labs" items={overdueLabs} empty="None on file" />
        <ListBlock title="Referrals awaiting reports" items={referralsAwaiting} empty="None on file" />
      </div>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}

function ListBlock({
  title,
  items,
  empty,
}: {
  title: string;
  items: InBasketListItem[];
  empty: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.slice(0, 5).map((item) => (
            <li key={item.id} className="text-sm text-slate-800">
              {item.href ? (
                <Link href={item.href} className="hover:underline">
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
              <span className="text-xs text-slate-500"> · {item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
