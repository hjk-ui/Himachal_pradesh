'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BedDouble,
  Siren,
  Receipt,
  ShieldCheck,
  Shield,
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
  CalendarDays,
} from 'lucide-react';
import ClaimEditorModal, { type EditableClaim } from '@/components/ClaimEditorModal';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  buttonClasses,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';
import { STICKY_ACTIONS_TD, STICKY_ACTIONS_TH, STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';

// ---------------------------------------------------------------------------
// Queue data — loaded from /api/billing/residential-crisis
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
  /** Status of the stored charge for the selected date: held | ready | approved | routed */
  chargeStatus?: string | null;
}

/** Stored per-diem charge (SpecializedBillingCharge) */
interface PerDiemCharge {
  id: string;
  residentId: string;
  clientId: string | null;
  clientName: string;
  serviceDate: string;
  code: string;
  units: number;
  rate: number;
  totalAmount: number;
  pos: string;
  payer: string;
  status: string;
  blockReason: string | null;
  claimId: string | null;
  authNumber: string | null;
}

function localToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const CHARGE_STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  held: { label: 'Held', tone: 'danger' },
  ready: { label: 'Ready', tone: 'info' },
  approved: { label: 'Approved', tone: 'warning' },
  routed: { label: 'Claim created', tone: 'success' },
};

const LINK_CLS = cx('inline-flex items-center gap-0.5 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING);
const TH = 'px-4 py-2.5 text-xs font-semibold text-slate-600';

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
  const [charges, setCharges] = useState<PerDiemCharge[]>([]);
  const [canBill, setCanBill] = useState(false);
  const [serviceDate, setServiceDate] = useState(localToday);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [perDiemBusy, setPerDiemBusy] = useState<string | null>(null);
  const [perDiemNotice, setPerDiemNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [selectedCharges, setSelectedCharges] = useState<Set<string>>(new Set());
  const [claimCharge, setClaimCharge] = useState<PerDiemCharge | null>(null);
  const [loading, setLoading] = useState(true);

  const loadQueues = useCallback(async (date: string) => {
    try {
      const res = await fetch(`/api/billing/residential-crisis?date=${encodeURIComponent(date)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not load billing queues');
      setPerDiems(Array.isArray(data.perDiems) ? data.perDiems : []);
      setCrisisCharges(Array.isArray(data.crisisCharges) ? data.crisisCharges : []);
      setCharges(Array.isArray(data.charges) ? data.charges : []);
      setCanBill(Boolean(data.canBill));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load billing queues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueues(serviceDate);
  }, [loadQueues, serviceDate]);

  const readyRows = perDiems.filter((p) => !p.block && !p.charged);
  const blockedRows = perDiems.filter((p) => p.block);
  const lowPaRows = perDiems.filter((p) => p.paUnitsLeft !== null && p.paUnitsLeft > 0 && p.paUnitsLeft <= 5);

  const readyRevenue = readyRows.reduce((s, p) => s + PER_DIEM[p.program].rate, 0);
  const blockedRevenue = blockedRows.reduce((s, p) => s + PER_DIEM[p.program].rate, 0);

  const crisisPending = crisisCharges.filter((c) => c.status === 'held' || c.status === 'ready');
  // Episodes without a documented duration have no billable amount yet, so they are counted but not priced.
  const crisisPendingAmt = crisisPending.filter((c) => c.minutes > 0).reduce((s, c) => s + crisisCodeAndAmount(c).amount, 0);
  const crisisNoDuration = crisisPending.filter((c) => c.minutes === 0).length;

  const generatePerDiems = async () => {
    setPerDiemBusy('generate');
    setPerDiemNotice(null);
    try {
      const res = await fetch('/api/billing/residential-crisis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_per_diems', serviceDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not generate per-diem charges');
      const r = data.result as { created: number; released: number; held: number; alreadyCharged: number };
      setPerDiemNotice({
        tone: 'ok',
        text: `Per-diems for ${serviceDate}: ${r.created} created, ${r.released} released from hold, ${r.held} held by compliance gates, ${r.alreadyCharged} already charged.`,
      });
      await loadQueues(serviceDate);
    } catch (err) {
      setPerDiemNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not generate per-diem charges' });
    } finally {
      setPerDiemBusy(null);
    }
  };

  const approveCharges = async (ids: string[]) => {
    if (!ids.length) return;
    setPerDiemBusy('approve');
    setPerDiemNotice(null);
    try {
      const res = await fetch('/api/billing/residential-crisis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_charges', chargeIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not approve the charges');
      setPerDiemNotice({ tone: 'ok', text: `Approved ${data.approved} charge(s). Create a claim from each approved charge.` });
      setSelectedCharges(new Set());
      await loadQueues(serviceDate);
    } catch (err) {
      setPerDiemNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not approve the charges' });
    } finally {
      setPerDiemBusy(null);
    }
  };

  const chargeToEditable = (c: PerDiemCharge): EditableClaim => ({
    id: c.id,
    client: c.clientName,
    dos: c.serviceDate,
    payer: c.payer,
    icd10: '',
    renderingProvider: '',
    billingProvider: 'MD Behavioral Health',
    authNumber: c.authNumber || '',
    pos: c.pos || '55',
    lines: [{ cpt: c.code, modifier: '', units: c.units, charge: c.rate }],
  });

  const createClaimFromCharge = async (chargeId: string, draft: EditableClaim) => {
    const res = await fetch('/api/billing/residential-crisis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_claim',
        chargeId,
        claim: {
          dos: draft.dos || undefined,
          payer: draft.payer,
          renderingProvider: draft.renderingProvider,
          billingProvider: draft.billingProvider,
          icd10: draft.icd10,
          authNumber: draft.authNumber,
          pos: draft.pos,
          lines: draft.lines.map((l) => ({
            cpt: l.cpt.trim().toUpperCase(),
            modifier: l.modifier,
            units: Number(l.units) || 1,
            charge: Number(l.charge) || 0,
          })),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Could not create the claim');
  };

  const readyCharges = charges.filter((c) => c.status === 'ready' && !c.claimId);

  // Records approval on the episode (chargeRouted). It does not create a claim.
  const approveCrisisCharge = async (id: string) => {
    setApprovingId(id);
    setActionError(null);
    try {
      const res = await fetch('/api/billing/residential-crisis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not approve the charge');
      setCrisisCharges((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'routed' } : c)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not approve the charge');
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <Page>
      {claimCharge && (
        <ClaimEditorModal
          claim={chargeToEditable(claimCharge)}
          title="New claim from per-diem charge"
          saveLabel="Create Claim"
          onClose={() => setClaimCharge(null)}
          onSubmit={(draft) => createClaimFromCharge(claimCharge.id, draft)}
          onSave={() => {
            setPerDiemNotice({ tone: 'ok', text: `Claim created for ${claimCharge.clientName} (${claimCharge.serviceDate}). It is in Claims as Ready.` });
            setClaimCharge(null);
            void loadQueues(serviceDate);
          }}
        />
      )}
      <PageHeader
        title="Residential & Crisis Billing"
        description="Census-driven per-diem capture (H0018/H0019) and mobile crisis charges (H2011) — compliance-gated before anything bills"
        actions={
          <a href="/dashboard/billing/claim-scrubber" className={buttonClasses({ variant: 'secondary' })}>
            <ScanSearch className="h-4 w-4" aria-hidden /> Claim Scrubber
          </a>
        }
      />

      {/* Metric tiles */}
      <StatGrid columns={4}>
        {[
          { label: 'Per-Diems Ready Tonight', value: `${readyRows.length} · $${readyRevenue.toLocaleString()}`, sub: `eligible bed-days for ${serviceDate} not yet charged`, Icon: BedDouble, tone: 'brand' as Tone },
          { label: 'Blocked Bed-Days', value: `${blockedRows.length} · $${blockedRevenue.toLocaleString()}`, sub: 'revenue held until compliance clears', Icon: Lock, tone: (blockedRows.length ? 'danger' : 'success') as Tone },
          { label: 'Crisis Charges Pending', value: `${crisisPending.length} · $${crisisPendingAmt.toLocaleString()}`, sub: crisisNoDuration > 0 ? `${crisisNoDuration} without documented duration (not priced)` : 'drafted from episode timelines', Icon: Siren, tone: 'danger' as Tone },
          { label: 'PA Units Running Low', value: String(lowPaRows.length), sub: '≤5 days left — start concurrent review', Icon: Hourglass, tone: (lowPaRows.length ? 'warning' : 'success') as Tone },
        ].map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} hint={m.sub} icon={<m.Icon />} tone={m.tone} />
        ))}
      </StatGrid>

      {/* ===================================================================
          RESIDENTIAL PER-DIEM CAPTURE
      =================================================================== */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<BedDouble />}
          title="Residential Per-Diem — Tonight's Census"
          description="Every occupied bed generates one per-diem per date of service — automatically blocked when the continued-stay review lapses or PA units run out."
          actions={
            <>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
                Date of service
                <input
                  type="date"
                  value={serviceDate}
                  max={localToday()}
                  onChange={(e) => e.target.value && setServiceDate(e.target.value)}
                  className={cx(inputClasses, 'w-auto py-1.5')}
                />
              </label>
              <Button
                onClick={() => void generatePerDiems()}
                disabled={!canBill || perDiemBusy !== null || perDiems.length === 0}
                title={canBill ? 'Creates one per-diem charge per eligible resident for this date' : 'Only billing staff can generate charges'}
                icon={<Zap />}
              >
                {perDiemBusy === 'generate' ? 'Generating…' : `Generate Per-Diems (${readyRows.length} ready)`}
              </Button>
            </>
          }
        />

        {(perDiemNotice || loadError || (!canBill && !loadError)) && (
          <div className="space-y-2 border-b border-slate-100 px-5 py-3">
            {perDiemNotice && <Alert tone={perDiemNotice.tone === 'ok' ? 'success' : 'danger'}>{perDiemNotice.text}</Alert>}
            {loadError && <Alert tone="danger">{loadError}</Alert>}
            {!canBill && !loadError && (
              <Alert tone="neutral">View only: per-diem charges are generated and approved by billing staff.</Alert>
            )}
          </div>
        )}

        {loading && perDiems.length === 0 ? (
          <LoadingState rows={4} label="Loading census…" />
        ) : (
          <div className="clinic-scroll-x">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left">
                  <th scope="col" className={cx(TH, STICKY_FIRST_TH)}>Resident / Bed</th>
                  <th scope="col" className={TH}>Code · Rate</th>
                  <th scope="col" className={TH}>Payer</th>
                  <th scope="col" className={TH}>Continued-Stay Review</th>
                  <th scope="col" className={TH}>PA Units Left</th>
                  <th scope="col" className={TH}>Charge Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {perDiems.map((p) => {
                  const pd = PER_DIEM[p.program];
                  return (
                    <tr key={p.id} className={p.block ? 'bg-rose-50/40' : 'group hover:bg-slate-50'}>
                      <td className={cx('px-4 py-3', p.block ? 'sticky left-0 z-10 bg-rose-50' : STICKY_FIRST_TD)}>
                        <p className="text-xs font-semibold text-slate-900">{p.resident}</p>
                        <p className="text-xs text-slate-500">
                          <span className={`font-semibold ${p.program === '3.5' ? 'text-rose-700' : 'text-sky-700'}`}>ASAM {p.program}</span> · Room {p.room} · POS {pd.pos}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-slate-800">{pd.code}</p>
                        <p className="text-xs text-slate-500">${pd.rate}/day</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{p.payer}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          size="sm"
                          tone={p.csrStatus === 'current' ? 'success' : p.csrStatus === 'due_soon' ? 'warning' : 'danger'}
                          icon={p.csrStatus === 'current' ? <CheckCircle2 /> : p.csrStatus === 'due_soon' ? <Clock /> : <XCircle />}
                        >
                          {p.csrStatus === 'current' ? 'Current' : p.csrStatus === 'due_soon' ? 'Due Soon' : 'Overdue'}
                        </StatusBadge>
                        <p className="mt-0.5 text-xs text-slate-500">{p.csrDetail}</p>
                      </td>
                      <td className="px-4 py-3">
                        {p.paUnitsLeft === null ? (
                          <span className="text-xs font-semibold text-rose-700">No PA on file</span>
                        ) : (
                          <span className={`text-xs font-semibold ${p.paUnitsLeft === 0 ? 'text-rose-700' : p.paUnitsLeft <= 5 ? 'text-amber-700' : 'text-slate-700'}`}>
                            {p.paUnitsLeft} days
                            {p.paUnitsLeft > 0 && p.paUnitsLeft <= 5 && <span className="ml-1 text-xs font-medium text-amber-700">· extend soon</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          {p.charged ? (
                            <StatusBadge size="sm" tone="success" icon={<BadgeCheck />}>
                              Charged
                              {p.chargeStatus ? ` · ${CHARGE_STATUS_LABEL[p.chargeStatus]?.label ?? p.chargeStatus}` : ''}
                            </StatusBadge>
                          ) : p.block ? (
                            <div>
                              <StatusBadge size="sm" tone="danger" icon={<Lock />}>Blocked</StatusBadge>
                              <p className="mt-0.5 text-xs text-slate-500">{BLOCK_INFO[p.block].label}</p>
                              <a href={BLOCK_INFO[p.block].href} className={LINK_CLS}>
                                {BLOCK_INFO[p.block].fix} <ChevronRight className="h-3 w-3" aria-hidden />
                              </a>
                            </div>
                          ) : (
                            <StatusBadge size="sm" tone="info" icon={<Zap />}>Ready</StatusBadge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {perDiems.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState compact icon={<BedDouble />} title="No residents in census yet" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===================================================================
          PER-DIEM CHARGES (stored) — approve, then create claims
      =================================================================== */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<Receipt />}
          title="Per-Diem Charges (last 45 days)"
          description="Approve ready charges, then create a claim from each one. Held charges release automatically when you re-generate after the block is cleared."
          actions={
            canBill && (
              <Button
                variant="secondary"
                icon={<BadgeCheck />}
                onClick={() => void approveCharges(selectedCharges.size ? Array.from(selectedCharges) : readyCharges.map((c) => c.id))}
                disabled={perDiemBusy !== null || readyCharges.length === 0}
              >
                {perDiemBusy === 'approve'
                  ? 'Approving…'
                  : selectedCharges.size
                    ? `Approve Selected (${selectedCharges.size})`
                    : `Approve All Ready (${readyCharges.length})`}
              </Button>
            )
          }
        />
        {loading && charges.length === 0 ? (
          <LoadingState rows={3} label="Loading per-diem charges…" />
        ) : (
          <div className="clinic-scroll-x">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left">
                  <th scope="col" className={cx(TH, 'w-8')}><span className="sr-only">Select</span></th>
                  <th scope="col" className={TH}>DOS</th>
                  <th scope="col" className={TH}>Resident</th>
                  <th scope="col" className={TH}>Code · Amount</th>
                  <th scope="col" className={TH}>Payer</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={cx(TH, 'text-right', STICKY_ACTIONS_TH)}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {charges.map((c) => {
                  const st = CHARGE_STATUS_LABEL[c.status] ?? { label: c.status, tone: 'neutral' as Tone };
                  const selectable = canBill && c.status === 'ready' && !c.claimId;
                  return (
                    <tr key={c.id} className="group hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        {selectable && (
                          <input
                            type="checkbox"
                            aria-label={`Select charge for ${c.clientName} on ${c.serviceDate}`}
                            checked={selectedCharges.has(c.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                            onChange={(e) =>
                              setSelectedCharges((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{c.serviceDate}</td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-slate-900">{c.clientName}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="font-mono font-semibold text-slate-800">{c.code}</span>
                        <span className="text-slate-500"> · ${c.totalAmount.toLocaleString()} · POS {c.pos}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{c.payer || 'Payer not on file'}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge size="sm" tone={st.tone}>{st.label}</StatusBadge>
                        {c.status === 'held' && c.blockReason && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {BLOCK_INFO[c.blockReason as Exclude<BlockReason, null>]?.label ?? c.blockReason}
                          </p>
                        )}
                      </td>
                      <td className={cx('whitespace-nowrap px-4 py-2.5 text-right', STICKY_ACTIONS_TD)}>
                        {canBill && c.status === 'ready' && !c.claimId && (
                          <Button size="sm" variant="ghost" onClick={() => void approveCharges([c.id])} disabled={perDiemBusy !== null}>
                            Approve
                          </Button>
                        )}
                        {canBill && c.status === 'approved' && !c.claimId && (
                          <Button size="sm" icon={<FileText />} onClick={() => setClaimCharge(c)}>
                            Create Claim
                          </Button>
                        )}
                        {c.claimId && (
                          <a href="/dashboard/billing/claims" className={LINK_CLS}>
                            View in Claims <ChevronRight className="h-3 w-3" aria-hidden />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {charges.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState compact icon={<Receipt />} title="No per-diem charges yet. Generate them from the census above." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===================================================================
          MOBILE CRISIS CHARGE QUEUE
      =================================================================== */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<Siren />}
          title="Mobile Crisis Charge Queue"
          description="Charges draft from crisis episodes — units computed from the documented dispatch and resolved times, held until documentation and clinician notification are complete. Approving records the approval on the episode; it does not create a claim."
        />
        {actionError && (
          <div className="border-b border-slate-100 px-5 py-3">
            <Alert tone="danger">{actionError}</Alert>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {loading && crisisCharges.length === 0 ? (
            <LoadingState rows={3} label="Loading crisis charges…" />
          ) : crisisCharges.length === 0 ? (
            <EmptyState compact icon={<Siren />} title="No crisis charges yet" />
          ) : null}
          {crisisCharges.map((c) => {
            const { code, amount } = crisisCodeAndAmount(c);
            return (
              <div key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{c.client}</p>
                    <span className="font-mono text-xs text-slate-500">{c.episode}</span>
                    <StatusBadge size="sm" tone={c.mode === 'mobile' ? 'danger' : 'info'}>
                      {c.mode === 'mobile' ? 'Mobile · POS 15' : 'Telehealth · POS 10'}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.date} · {c.payer}
                    {c.minutes > 0 && <> · <Timer className="-mt-0.5 inline h-3 w-3" aria-hidden /> {c.minutes} min documented</>}
                  </p>
                  {c.status !== 'in_progress' && (
                    <div className="mt-1.5 flex flex-wrap gap-3">
                      <span className={`flex items-center gap-1 text-xs ${c.docComplete ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {c.docComplete ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />} Episode documentation
                      </span>
                      <span className={`flex items-center gap-1 text-xs ${c.clinicianNotified ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {c.clinicianNotified ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />} Clinician notification
                      </span>
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {c.status === 'in_progress' ? (
                    <p className="text-xs font-medium italic text-slate-500">Episode active — charge drafts on resolution</p>
                  ) : c.minutes === 0 ? (
                    <p className="text-xs font-semibold text-amber-700">Duration not documented</p>
                  ) : (
                    <>
                      <p className="font-mono text-xs font-semibold text-slate-800">{code}</p>
                      <p className="text-sm font-semibold tabular-nums text-slate-900">${amount.toLocaleString()}</p>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right sm:w-44">
                  {c.status === 'ready' && (
                    <Button
                      size="sm"
                      icon={<Send />}
                      onClick={() => void approveCrisisCharge(c.id)}
                      disabled={approvingId === c.id || c.minutes === 0}
                      title={c.minutes === 0 ? 'Dispatch and resolved times are not both documented on the episode' : 'Records approval on the episode; enter the claim in Billing'}
                    >
                      {approvingId === c.id ? 'Approving…' : 'Approve for Billing'}
                    </Button>
                  )}
                  {c.status === 'held' && (
                    <div>
                      <StatusBadge size="sm" tone="warning" icon={<Lock />}>Held</StatusBadge>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {!c.docComplete ? 'Complete episode documentation' : 'Send clinician notification'}
                      </p>
                      <a href="/dashboard/crisis" className={LINK_CLS}>
                        Open episode <ChevronRight className="h-3 w-3" aria-hidden />
                      </a>
                    </div>
                  )}
                  {c.status === 'routed' && (
                    <StatusBadge size="sm" tone="success" icon={<BadgeCheck />}>Approved for billing</StatusBadge>
                  )}
                  {c.status === 'in_progress' && (
                    <StatusBadge size="sm" tone="neutral" icon={<Clock />}>In progress</StatusBadge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ===================================================================
          SCRUBBER RULES + REVENUE INTEGRITY
      =================================================================== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<ShieldCheck />} title="Scrubber Rules Enforced Here" titleAs="h3" />
          <CardBody>
            <div className="space-y-2.5">
              {SCRUB_RULES.map((r, i) => (
                <div key={i} className="flex gap-2.5">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <p className="text-sm text-slate-600">
                    <span className="font-mono text-xs font-semibold text-slate-800">{r.code}</span> — {r.rule}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Verify code selection and per-diem rates against each payer&apos;s current fee schedule — H0018/H0019 mapping to
              ASAM 3.5/3.1 and mobile crisis codes vary by payer contract.
            </p>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<DollarSign />} title="Why Charges Gate on Compliance" titleAs="h3" />
            <CardBody>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> A per-diem billed past a lapsed continued-stay review is a guaranteed recoupment — blocking it tonight is cheaper than refunding it in an audit.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> Crisis units tie to documented timeline minutes, so billed time always matches the clinical record.</li>
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> The same gates double as CARF evidence — medical necessity, documentation, and coordination are enforced by the workflow, not audited after the fact.</li>
              </ul>
            </CardBody>
          </Card>
          <Alert tone="brand" icon={<FileText />}>
            Generated charges flow to <a href="/dashboard/billing" className="font-semibold underline">Claims</a> and{' '}
            <a href="/dashboard/billing/superbills" className="font-semibold underline">Superbills</a>; denials land in{' '}
            <a href="/dashboard/billing/denials" className="font-semibold underline">Denial Management</a>. Compliance
            holds link straight to the fix — <a href="/dashboard/ehr/locus" className="font-semibold underline">ASAM reviews</a>{' '}
            and <a href="/dashboard/ehr/prior-auths" className="font-semibold underline">prior auths</a>.
          </Alert>
        </div>
      </div>
    </Page>
  );
}
