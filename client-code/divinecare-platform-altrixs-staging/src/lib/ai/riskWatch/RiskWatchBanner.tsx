'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ClipboardCopy, Lock, MessageSquare, Phone, ShieldAlert, ShieldPlus } from 'lucide-react';
import type { RiskWatchBannerView } from './view';

type Props = { kind: 'message'; threadId: string } | { kind: 'note'; noteId: string };

const TONE = {
  high: { box: 'border-red-200 bg-red-50 text-red-900', icon: 'text-red-600', pill: 'bg-red-600 text-white', label: 'HIGH — same-day contact' },
  medium: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-600', pill: 'bg-amber-500 text-white', label: 'MEDIUM — review' },
  low: { box: 'border-slate-200 bg-slate-50 text-slate-800', icon: 'text-slate-500', pill: 'bg-slate-500 text-white', label: 'LOW — review' },
} as const;

/**
 * Risk language watch banner for a portal thread or a note. Decision support only: it shows the
 * flagged words, contact shortcuts, the 988 reminder for staff to share and a safety-plan prompt.
 * It never messages the client.
 */
export function RiskWatchBanner(props: Props) {
  const [view, setView] = useState<RiskWatchBannerView | null>(null);
  const [copied, setCopied] = useState(false);
  const key = props.kind === 'message' ? props.threadId : props.noteId;

  useEffect(() => {
    let cancelled = false;
    const qs = props.kind === 'message' ? `kind=message&threadId=${encodeURIComponent(key)}` : `kind=note&noteId=${encodeURIComponent(key)}`;
    setView(null);
    fetch(`/api/ai/risk-watch?${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.success) setView(d.view as RiskWatchBannerView);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.kind, key]);

  if (!view || !view.active) return null;
  const tone = TONE[view.severity];

  if (view.protected) {
    return (
      <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${tone.box}`} role="alert">
        <span className="flex items-center gap-1.5 font-semibold">
          <Lock size={14} className={tone.icon} /> {view.label} · risk language flagged ({view.severity})
        </span>
        <Link href={view.breakGlassHref} className="rounded-lg border border-current px-2.5 py-1 font-semibold hover:opacity-80">
          Open chart (break-glass)
        </Link>
      </div>
    );
  }

  const v = view as Extract<RiskWatchBannerView, { protected: false }>;
  const copyReminder = async () => {
    try {
      await navigator.clipboard.writeText(v.reminder);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the text is visible to read aloud */
    }
  };

  return (
    <div className={`mb-3 space-y-2 rounded-xl border px-3.5 py-3 text-xs ${tone.box}`} role="alert">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={15} className={`${tone.icon} shrink-0`} />
        <span className="font-bold">Risk language watch</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.pill}`}>{tone.label}</span>
        {v.unreviewed === 0 ? <span className="text-[11px] opacity-75">Reviewed</span> : null}
        <Link href={v.links.alerts} className="ml-auto text-[11px] font-semibold underline">
          Review alert
        </Link>
      </div>
      {v.hits.map((h, i) => (
        <blockquote key={i} className="border-l-2 border-current pl-2.5 opacity-90">
          <span className="font-semibold">{h.concept}:</span> “{h.quote}”
        </blockquote>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        {v.phone ? (
          <a href={`tel:${v.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 rounded-lg bg-white/80 px-2.5 py-1 font-semibold shadow-xs hover:bg-white">
            <Phone size={12} /> Call client
          </a>
        ) : null}
        <Link href={v.links.message} className="inline-flex items-center gap-1 rounded-lg bg-white/80 px-2.5 py-1 font-semibold shadow-xs hover:bg-white">
          <MessageSquare size={12} /> Message client
        </Link>
        <button type="button" onClick={copyReminder} className="inline-flex items-center gap-1 rounded-lg bg-white/80 px-2.5 py-1 font-semibold shadow-xs hover:bg-white">
          <ClipboardCopy size={12} /> {copied ? 'Copied' : 'Copy 988 reminder'}
        </button>
        {v.safetyPlanOnFile === false ? (
          <Link href={v.links.safetyPlan} className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-2.5 py-1 font-semibold text-white hover:opacity-90">
            <ShieldPlus size={12} /> Create safety plan
          </Link>
        ) : (
          <Link href={v.links.chartSafety} className="inline-flex items-center gap-1 rounded-lg bg-white/80 px-2.5 py-1 font-semibold shadow-xs hover:bg-white">
            <ShieldAlert size={12} /> Safety tab
          </Link>
        )}
      </div>
      <p className="text-[11px] leading-5 opacity-80">
        To share: {v.reminder}
      </p>
      {v.safetyPlanOnFile === false ? <p className="text-[11px] font-semibold">No safety plan on file for this client.</p> : null}
      <p className="text-[10px] opacity-60">Keyword screen — decision support. Confirm with the client and document your assessment.</p>
    </div>
  );
}
