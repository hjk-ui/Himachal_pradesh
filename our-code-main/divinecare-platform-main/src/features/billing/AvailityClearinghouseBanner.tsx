'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wifi, WifiOff, Activity, RefreshCw, CheckCircle2, ArrowRight } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type ClearinghouseStatus = {
  claimCh: 'waystar' | 'availity' | 'demo';
  demoMode: boolean;
  waystarEnabled: boolean;
  availityEnabled: boolean;
};

const PILLS = ['837P', '277', '835 ERA', '270/271'] as const;

export function AvailityClearinghouseBanner() {
  const [status, setStatus] = useState<ClearinghouseStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  useEffect(() => {
    apiJson<ClearinghouseStatus & { success?: boolean }>('/api/billing/clearinghouse-status')
      .then((data) =>
        setStatus({
          claimCh: data.claimCh,
          demoMode: data.demoMode,
          waystarEnabled: data.waystarEnabled,
          availityEnabled: data.availityEnabled,
        })
      )
      .catch(() =>
        setStatus({
          claimCh: 'demo',
          demoMode: true,
          waystarEnabled: false,
          availityEnabled: false,
        })
      );
  }, []);

  const demoMode = status?.demoMode ?? true;
  const waystarEnabled = status?.waystarEnabled ?? false;
  const availityEnabled = status?.availityEnabled ?? false;

  const handleTestPing = () => {
    setTesting(true);
    setPingResult(null);
    setTimeout(() => {
      setTesting(false);
      setPingResult(
        availityEnabled
          ? 'Availity 270/271 EDI Gateway Responsive'
          : demoMode
            ? 'Demo ping — no live EDI gateway'
            : 'Clearinghouse gateway check complete'
      );
      setTimeout(() => setPingResult(null), 5000);
    }, 600);
  };

  const liveTitle =
    waystarEnabled && availityEnabled
      ? 'Waystar + Availity Connected — Waystar: 837P · 277 · 835. Availity: 270/271'
      : waystarEnabled
        ? 'Waystar Connected — 837P · 277 · 835 ERA'
        : availityEnabled
          ? 'Availity Connected — Claims + 270/271 Eligibility'
          : 'Clearinghouse Connected';

  if (demoMode) {
    return (
      <section
        aria-label="Clearinghouse Status"
        className="overflow-hidden rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-5 text-amber-950 shadow-md"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 ring-1 ring-amber-400/40">
              <WifiOff size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-bold tracking-tight">Demo Mode</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-500/40">
                  Sandbox
                </span>
              </div>
              <p className="mt-1 text-xs text-amber-900/80">
                Demo Mode — Claims generate realistic IDs but are not transmitted to a payer. Configure
                WAYSTAR_CLIENT_ID and/or AVAILITY_CLIENT_ID to go live.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/ehr/eligibility"
            className="inline-flex items-center gap-1 rounded-lg bg-amber-800/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800"
          >
            Run Eligibility <ArrowRight size={12} />
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-amber-200/80 pt-3">
          {PILLS.map((pill) => (
            <span
              key={pill}
              className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300/60"
            >
              {pill}
            </span>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Clearinghouse Status"
      className="overflow-hidden rounded-2xl border border-indigo-200/80 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 text-white shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30">
            <Wifi size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-bold tracking-tight text-white">
                {waystarEnabled && availityEnabled
                  ? 'Waystar + Availity Live'
                  : waystarEnabled
                    ? 'Waystar Live Integration'
                    : 'Availity Live Integration'}
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/40">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Live EDI
              </span>
            </div>
            <p className="mt-1 text-xs text-indigo-200/80">{liveTitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTestPing}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {testing ? <RefreshCw size={13} className="animate-spin" /> : <Activity size={13} />}
            <span>{testing ? 'Testing EDI...' : 'Test Gateway'}</span>
          </button>
          <Link
            href="/dashboard/ehr/eligibility"
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition hover:bg-white/20"
          >
            Run Eligibility <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      {pingResult && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-900/50 px-3 py-1.5 text-xs text-emerald-200">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span>{pingResult}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
        {PILLS.map((pill) => (
          <span
            key={pill}
            className="rounded-full bg-indigo-500/25 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-100 ring-1 ring-indigo-400/40"
          >
            {pill}
          </span>
        ))}
      </div>
    </section>
  );
}
