'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import toast from 'react-hot-toast';
import { RETURN_HIDDEN_MIN_MS } from '@/lib/drfirst/screens';

type Counts = {
  pending_prescription?: number;
  need_signing?: number;
  refill?: number;
  rx_change?: number;
};

async function openDrFirstScreen(countKey: string) {
  const blank = window.open('about:blank', '_blank');
  try {
    const res = await fetch(`/api/integrations/drfirst/sso?count=${encodeURIComponent(countKey)}`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      blank?.close();
      toast.error(data.error || `DrFirst could not be opened (HTTP ${res.status}).`);
      return;
    }
    if (data.url && blank) {
      blank.location.href = data.url;
      toast.success(
        'DrFirst opened in a new tab. Changes you make in DrFirst appear here when you come back to this tab (or within 5 minutes).'
      );
    } else {
      blank?.close();
      toast.error('DrFirst could not be opened.');
    }
  } catch {
    blank?.close();
    toast.error('Could not reach DrFirst. Try again.');
  }
}

export function DrFirstCountsBadge({ counts }: { counts: Counts }) {
  const items = [
    { key: 'pending_prescription', label: `${counts.pending_prescription || 0} Rx pending` },
    { key: 'refill', label: `${counts.refill || 0} Renewals` },
    { key: 'rx_change', label: `${counts.rx_change || 0} Changes` },
    { key: 'need_signing', label: `${counts.need_signing || 0} To sign` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="DrFirst counts">
      <a href="/dashboard/ehr/prescriptions" className="text-sm font-semibold text-blue-600 hover:underline">
        DrFirst:
      </a>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20 hover:bg-blue-100"
          onClick={() => void openDrFirstScreen(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DrFirstWaitingPanel({
  counts,
  lastSyncLabel,
}: {
  counts: Counts;
  lastSyncLabel?: string;
}) {
  const cards = [
    { key: 'need_signing', title: 'Needs signing', n: counts.need_signing || 0 },
    { key: 'pending_prescription', title: 'Pending prescriptions', n: counts.pending_prescription || 0 },
    { key: 'refill', title: 'Renewal requests', n: counts.refill || 0 },
    { key: 'rx_change', title: 'Change requests', n: counts.rx_change || 0 },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Waiting in DrFirst</h2>
      <p className="text-xs text-slate-500">
        Your own items. Select a count to open it in DrFirst (pending and to-sign in Reports, renewals and
        changes in Messages).
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => void openDrFirstScreen(c.key)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs hover:border-blue-600"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{c.title}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{c.n}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Last download from DrFirst: {lastSyncLabel || 'not yet'} (every 5 minutes, and when you come back from
        DrFirst)
      </p>
    </section>
  );
}

export function DrFirstChartPanel({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/drfirst/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'DrFirst could not be opened.');
        return;
      }
      toast.success(data.message || 'Up to date with DrFirst.');
      window.dispatchEvent(new CustomEvent('altrixs:drfirst-synced', { detail: { clientId } }));
    } catch {
      toast.error('Could not reach DrFirst. Try again.');
    } finally {
      setBusy(false);
    }
  }, [clientId]);

  useEffect(() => {
    let hiddenAt = 0;
    function onVis() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt >= RETURN_HIDDEN_MIN_MS) {
        void fetch('/api/drfirst/sync/return', { method: 'POST' })
          .then((r) => r.json())
          .then((data) => {
            if (data?.soft) return;
            if (data?.changes > 0) toast.success(data.message);
            if (data?.event) {
              window.dispatchEvent(
                new CustomEvent(data.event, { detail: { clientId: data.clientId } })
              );
            }
          })
          .catch(() => undefined);
      }
      hiddenAt = 0;
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <Card>
      <CardHeader title="DrFirst" />
      <CardBody className="space-y-2">
        <p className="text-sm text-slate-700">
          Linked to DrFirst. Updates when you come back from DrFirst, and with the practice-wide sync.
        </p>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void refresh()}>
          {busy ? 'Refreshing…' : 'Refresh from DrFirst'}
        </Button>
      </CardBody>
    </Card>
  );
}
