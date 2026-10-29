'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  BedDouble,
  Siren,
  Receipt,
  ShieldCheck,
  ShieldAlert,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  FileText,
  ChevronRight,
  Timer,
  DollarSign,
  BadgeCheck,
  Hourglass,
  ScanSearch,
  Send,
  Lock,
} from 'lucide-react';
import ClaimEditorModal, { EditableClaim, BILLING_PROVIDERS } from '@/components/ClaimEditorModal';

// ---------------------------------------------------------------------------
// Demo data — mirrors the Residential bed board & Mobile Crisis episode log
// ---------------------------------------------------------------------------

type Program = '3.1' | '3.5';

const PER_DIEM: Record<Program, { code: string; rate: number; pos: string }> = {
  '3.5': { code: 'H0018', rate: 385, pos: '55' },
  '3.1': { code: 'H0019', rate: 245, pos: '55' },
};

type BlockReason = 'csr_overdue' | 'pa_missing' | 'pa_exhausted' | null;

interface PerDiemRow {
  id: string;
  resident: string;
  program: Program;
  room: string;
  payer: string;
  csrStatus: 'current' | 'due_soon' | 'overdue';
  csrDetail: string;
  paUnitsLeft: number | null; // null = no PA on file
  block: BlockReason;
  charged: boolean;
}

const INITIAL_PER_DIEMS: PerDiemRow[] = [];

const BLOCK_INFO: Record<Exclude<BlockReason, null>, { label: string; fix: string; href: string }> = {
  csr_overdue: { label: 'Continued-stay review overdue', fix: 'Complete ASAM review', href: '/dashboard/ehr/locus' },
  pa_missing: { label: 'Prior authorization not on file', fix: 'Submit PA request', href: '/dashboard/ehr/prior-auths' },
  pa_exhausted: { label: 'PA units exhausted', fix: 'Request concurrent review / extension', href: '/dashboard/ehr/prior-auths' },
};

// ── Mobile crisis charge queue ─────────────────────────────────────────────

interface CrisisCharge {
  id: string;
  episode: string;
  client: string;
  date: string;
  mode: 'mobile' | 'telehealth';
  minutes: number;
  payer: string;
  docComplete: boolean;
  clinicianNotified: boolean;
  status: 'in_progress' | 'held' | 'ready' | 'routed';
}

const INITIAL_CRISIS_CHARGES: CrisisCharge[] = [];

function crisisCodeAndAmount(c: CrisisCharge): { code: string; units: number; amount: number } {
  if (c.mode === 'telehealth') {
    // Crisis psychotherapy: 90839 first 60 min, 90840 each addl 30
    const addl = Math.max(0, Math.ceil((c.minutes - 60) / 30));
    return { code: addl ? `90839 + 90840×${addl}` : '90839', units: 1 + addl, amount: 220 + addl * 110 };
  }
  const units = Math.max(1, Math.ceil(c.minutes / 15));
  return { code: `H2011 ×${units}`, units, amount: units * 34 };
}

// ── Scrubber rules enforced by this queue ──────────────────────────────────

const SCRUB_RULES = [
  { code: 'H0018 / H0019', rule: 'Per diem billable only while the continued-stay review is current (7-day for 3.5, 30-day for 3.1). One unit per date of service, POS 55.' },
  { code: 'H0018 / H0019', rule: 'PA units must cover the date of service — charges auto-block at zero remaining and flag at ≤5 so concurrent review starts before revenue stops.' },
  { code: 'H2011', rule: 'Units must match the documented episode duration (timeline timestamps). Charge is held until episode documentation is complete and the clinician notification has been sent.' },
  { code: 'H2011 + 90839', rule: 'Same-day mobile crisis and crisis psychotherapy require Modifier 59 (distinct services) — flagged automatically.' },
  { code: '90839', rule: 'Requires ≥60 minutes documented crisis psychotherapy; 90840 add-on per additional 30 minutes.' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResidentialCrisisBillingPage() {
  const [perDiems, setPerDiems] = useState<PerDiemRow[]>(INITIAL_PER_DIEMS);
  const [crisisCharges, setCrisisCharges] = useState<CrisisCharge[]>(INITIAL_CRISIS_CHARGES);
  const [generated, setGenerated] = useState(false);
  const [editingClaim, setEditingClaim] = useState<EditableClaim | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadQueues() {
      try {
        const res = await fetch('/api/billing/residential-crisis');
        const data = await res.json();
        if (isMounted && data.success) {
          if (Array.isArray(data.perDiems)) {
            setPerDiems(data.perDiems);
          }
          if (Array.isArray(data.crisisCharges)) {
            setCrisisCharges(data.crisisCharges);
          }
        }
      } catch (err) {
        console.warn('Billing queues fetch error:', err);
      }
    }
    loadQueues();
    return () => { isMounted = false; };
  }, []);

  const readyRows = perDiems.filter((p) => !p.block && !p.charged);
  const blockedRows = perDiems.filter((p) => p.block);
  const chargedRows = perDiems.filter((p) => p.charged);
  const lowPaRows = perDiems.filter((p) => p.paUnitsLeft !== null && p.paUnitsLeft > 0 && p.paUnitsLeft <= 5);

  const readyRevenue = readyRows.reduce((s, p) => s + PER_DIEM[p.program].rate, 0);
  const chargedRevenue = chargedRows.reduce((s, p) => s + PER_DIEM[p.program].rate, 0);
  const blockedRevenue = blockedRows.reduce((s, p) => s + PER_DIEM[p.program].rate, 0);

  const crisisPending = crisisCharges.filter((c) => c.status === 'held' || c.status === 'ready');
  const crisisPendingAmt = crisisPending.reduce((s, c) => s + crisisCodeAndAmount(c).amount, 0);

  const generatePerDiems = () => {
    setPerDiems((prev) =>
      prev.map((p) =>
        p.block || p.charged
          ? p
          : { ...p, charged: true, paUnitsLeft: p.paUnitsLeft !== null ? p.paUnitsLeft - 1 : null }
      )
    );
    setGenerated(true);
  };

  const routeCrisisCharge = (id: string) =>
    setCrisisCharges((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'routed' } : c)));

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-100 rounded-xl">
            <Receipt className="h-6 w-6 text-cyan-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Residential & Crisis Billing</h1>
            <p className="text-xs text-gray-500">
              Census-driven per-diem capture (H0018/H0019) and mobile crisis charges (H2011) — compliance-gated before anything bills
            </p>
          </div>
        </div>
        <a
          href="/dashboard/billing/claim-scrubber"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
        >
          <ScanSearch className="h-4 w-4" /> Claim Scrubber
        </a>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Per-Diems Ready Tonight', value: `${readyRows.length} · $${readyRevenue.toLocaleString()}`, sub: `${chargedRows.length} already generated today`, Icon: BedDouble, cls: 'text-cyan-700 bg-cyan-50' },
          { label: 'Blocked Bed-Days', value: `${blockedRows.length} · $${blockedRevenue.toLocaleString()}`, sub: 'revenue held until compliance clears', Icon: Lock, cls: blockedRows.length ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50' },
          { label: 'Crisis Charges Pending', value: `${crisisPending.length} · $${crisisPendingAmt.toLocaleString()}`, sub: 'drafted from episode timelines', Icon: Siren, cls: 'text-rose-600 bg-rose-50' },
          { label: 'PA Units Running Low', value: String(lowPaRows.length), sub: '≤5 days left — start concurrent review', Icon: Hourglass, cls: lowPaRows.length ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${m.cls}`}>
              <m.Icon className="h-4 w-4" />
            </div>
            <p className="text-xl font-extrabold text-gray-900">{m.value}</p>
            <p className="text-xs font-semibold text-gray-600">{m.label}</p>
            <p className="text-[11px] text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* ===================================================================
          RESIDENTIAL PER-DIEM CAPTURE
      =================================================================== */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-cyan-600" /> Residential Per-Diem — Tonight's Census
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Every occupied bed generates one per-diem per date of service — automatically blocked when the
              continued-stay review lapses or PA units run out.
            </p>
          </div>
          <button
            onClick={generatePerDiems}
            disabled={readyRows.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-700 text-white text-sm font-bold hover:bg-cyan-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            <Zap className="h-4 w-4" /> Generate Tonight's Per-Diems ({readyRows.length})
          </button>
        </div>

        {generated && (
          <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2 text-sm text-green-700 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {chargedRows.length} per-diem charges generated (${chargedRevenue.toLocaleString()}) and routed to the claims queue.
            {blockedRows.length > 0 && ` ${blockedRows.length} bed-day(s) remain blocked — clear the compliance holds below to capture that revenue.`}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="px-5 py-2.5 font-semibold">Resident / Bed</th>
                <th className="px-3 py-2.5 font-semibold">Code · Rate</th>
                <th className="px-3 py-2.5 font-semibold">Payer</th>
                <th className="px-3 py-2.5 font-semibold">Continued-Stay Review</th>
                <th className="px-3 py-2.5 font-semibold">PA Units Left</th>
                <th className="px-3 py-2.5 font-semibold">Charge Status</th>
              </tr>
            </thead>
            <tbody>
              {perDiems.map((p) => {
                const pd = PER_DIEM[p.program];
                return (
                  <tr key={p.id} className={`border-b border-gray-50 last:border-0 ${p.block ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-900 text-xs">{p.resident}</p>
                      <p className="text-[11px] text-gray-400">
                        <span className={`font-bold ${p.program === '3.5' ? 'text-rose-600' : 'text-sky-600'}`}>ASAM {p.program}</span> · Room {p.room} · POS {pd.pos}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs font-mono font-bold text-gray-800">{pd.code}</p>
                      <p className="text-[11px] text-gray-400">${pd.rate}/day</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">{p.payer}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold ${
                        p.csrStatus === 'current' ? 'text-green-600' : p.csrStatus === 'due_soon' ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {p.csrStatus === 'current' ? <CheckCircle2 className="h-3.5 w-3.5" /> : p.csrStatus === 'due_soon' ? <Clock className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                        {p.csrStatus === 'current' ? 'Current' : p.csrStatus === 'due_soon' ? 'Due Soon' : 'Overdue'}
                      </span>
                      <p className="text-[11px] text-gray-400 mt-0.5">{p.csrDetail}</p>
                    </td>
                    <td className="px-3 py-3">
                      {p.paUnitsLeft === null ? (
                        <span className="text-xs font-bold text-red-600">No PA on file</span>
                      ) : (
                        <span className={`text-xs font-bold ${p.paUnitsLeft === 0 ? 'text-red-600' : p.paUnitsLeft <= 5 ? 'text-amber-600' : 'text-gray-700'}`}>
                          {p.paUnitsLeft} days
                          {p.paUnitsLeft > 0 && p.paUnitsLeft <= 5 && <span className="ml-1 text-[10px] font-semibold text-amber-500">· extend soon</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        {p.charged ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600">
                            <BadgeCheck className="h-3.5 w-3.5" /> Charged
                          </span>
                        ) : p.block ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
                              <Lock className="h-3.5 w-3.5" /> Blocked
                            </span>
                            <p className="text-[11px] text-gray-500">{BLOCK_INFO[p.block].label}</p>
                            <a href={BLOCK_INFO[p.block].href} className="text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-0.5">
                              {BLOCK_INFO[p.block].fix} <ChevronRight className="h-3 w-3" />
                            </a>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-cyan-700">
                            <Zap className="h-3.5 w-3.5" /> Ready
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingClaim({
                              id: p.id,
                              claimNumber: `CLM-RES-${p.room}`,
                              client: p.resident,
                              dos: new Date().toISOString().split('T')[0],
                              payer: p.payer,
                              renderingProvider: '',
                              billingProvider: BILLING_PROVIDERS[0] || '',
                              authNumber: '',
                              pos: PER_DIEM[p.program].pos,
                              icd10: 'F10.20',
                              lines: [
                                { cpt: PER_DIEM[p.program].code, modifier: 'HF', units: 1, charge: PER_DIEM[p.program].rate }
                              ],
                              totalCharge: PER_DIEM[p.program].rate,
                              status: 'DRAFT',
                            });
                          }}
                          className="px-2 py-1 rounded-lg border border-purple-200 bg-purple-50 text-[11px] font-semibold text-purple-700 hover:bg-purple-100"
                        >
                          Edit Claim
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {perDiems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-xs text-gray-400">
                    No active residential beds currently occupied. Admitted residents will appear here for per-diem batch generation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===================================================================
          MOBILE CRISIS CHARGE QUEUE
      =================================================================== */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Siren className="h-4 w-4 text-rose-600" /> Mobile Crisis Charge Queue
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Charges draft automatically from episode timelines when an episode resolves — units computed from documented
            duration, held until documentation and clinician notification are complete.
          </p>
        </div>
        <div className="divide-y divide-gray-50">
          {crisisCharges.map((c) => {
            const { code, amount } = crisisCodeAndAmount(c);
            return (
              <div key={c.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{c.client}</p>
                    <span className="text-xs font-mono text-gray-400">{c.episode}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.mode === 'mobile' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                      {c.mode === 'mobile' ? 'Mobile · POS 15' : 'Telehealth · POS 10'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {c.date} · {c.payer}
                    {c.minutes > 0 && <> · <Timer className="inline h-3 w-3 -mt-0.5" /> {c.minutes} min documented</>}
                  </p>
                  {c.status !== 'in_progress' && (
                    <div className="flex flex-wrap gap-3 mt-1.5">
                      <span className={`text-[11px] flex items-center gap-1 ${c.docComplete ? 'text-green-600' : 'text-red-500'}`}>
                        {c.docComplete ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} Episode documentation
                      </span>
                      <span className={`text-[11px] flex items-center gap-1 ${c.clinicianNotified ? 'text-green-600' : 'text-red-500'}`}>
                        {c.clinicianNotified ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} Clinician notification
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {c.status === 'in_progress' ? (
                    <p className="text-xs font-semibold text-gray-400 italic">Episode active — charge drafts on resolution</p>
                  ) : (
                    <>
                      <p className="text-xs font-mono font-bold text-gray-800">{code}</p>
                      <p className="text-sm font-extrabold text-gray-900">${amount.toLocaleString()}</p>
                    </>
                  )}
                </div>
                <div className="shrink-0 sm:w-44 text-right flex flex-col items-end gap-1.5">
                  {c.status === 'ready' && (
                    <button
                      onClick={() => routeCrisisCharge(c.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
                    >
                      <Send className="h-3.5 w-3.5" /> Approve → Superbill
                    </button>
                  )}
                  {c.status === 'held' && (
                    <div>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                        <Lock className="h-3.5 w-3.5" /> Held
                      </span>
                      <p className="text-[11px] text-gray-400">
                        {!c.docComplete ? 'Complete episode documentation' : 'Send clinician notification'}
                      </p>
                      <a href="/dashboard/crisis" className="text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-0.5">
                        Open episode <ChevronRight className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                  {c.status === 'routed' && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600">
                      <BadgeCheck className="h-3.5 w-3.5" /> On superbill
                    </span>
                  )}
                  {c.status === 'in_progress' && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-400">
                      <Clock className="h-3.5 w-3.5" /> In progress
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const { code, amount, units } = crisisCodeAndAmount(c);
                      setEditingClaim({
                        id: c.id,
                        claimNumber: c.episode,
                        client: c.client,
                        dos: c.date,
                        payer: c.payer,
                        renderingProvider: '',
                        billingProvider: BILLING_PROVIDERS[0] || '',
                        authNumber: '',
                        pos: c.mode === 'mobile' ? '15' : '10',
                        icd10: 'F43.10',
                        lines: [
                          { cpt: c.mode === 'mobile' ? 'H2011' : '90839', modifier: '', units, charge: amount / units }
                        ],
                        totalCharge: amount,
                        status: 'DRAFT',
                      });
                    }}
                    className="text-[11px] text-purple-700 hover:text-purple-900 font-semibold"
                  >
                    Edit Claim
                  </button>
                </div>
              </div>
            );
          })}
          {crisisCharges.length === 0 && (
            <div className="p-8 text-center text-xs text-gray-400">
              No mobile crisis episodes awaiting charge processing. Episodes routed from Mobile Crisis dispatch will appear here.
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================
          SCRUBBER RULES + REVENUE INTEGRITY
      =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-purple-500" /> Scrubber Rules Enforced Here
          </h3>
          <div className="space-y-2.5">
            {SCRUB_RULES.map((r, i) => (
              <div key={i} className="flex gap-2.5">
                <Shield className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-sm text-gray-600">
                  <span className="font-mono font-bold text-gray-800 text-xs">{r.code}</span> — {r.rule}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-gray-400">
            Verify code selection and per-diem rates against each payer's current fee schedule — H0018/H0019 mapping to
            ASAM 3.5/3.1 and mobile crisis codes vary by payer contract.
          </p>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-900 rounded-xl p-4 text-white">
            <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" /> Why Charges Gate on Compliance
            </h3>
            <ul className="space-y-2.5 text-xs text-slate-300">
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> A per-diem billed past a lapsed continued-stay review is a guaranteed recoupment — blocking it tonight is cheaper than refunding it in an audit.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> Crisis units tie to documented timeline minutes, so billed time always matches the clinical record.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> The same gates double as CARF evidence — medical necessity, documentation, and coordination are enforced by the workflow, not audited after the fact.</li>
            </ul>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex gap-3">
            <FileText className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-sm text-purple-800">
              Generated charges flow to <a href="/dashboard/billing" className="font-semibold underline">Claims</a> and{' '}
              <a href="/dashboard/billing/superbills" className="font-semibold underline">Superbills</a>; denials land in{' '}
              <a href="/dashboard/billing/denials" className="font-semibold underline">Denial Management</a>. Compliance
              holds link straight to the fix — <a href="/dashboard/ehr/locus" className="font-semibold underline">ASAM reviews</a>{' '}
              and <a href="/dashboard/ehr/prior-auths" className="font-semibold underline">prior auths</a>.
            </p>
          </div>
        </div>
      </div>

      {/* ClaimEditorModal Integration */}
      {editingClaim && (
        <ClaimEditorModal
          claim={editingClaim}
          isOpen={true}
          onClose={() => setEditingClaim(null)}
          onSave={updated => {
            setEditingClaim(null);
          }}
        />
      )}
    </div>
  );
}
