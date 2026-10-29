'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, XCircle, FileText, ChevronDown, ChevronUp, Send, BarChart3, Sparkles } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { BILLING_STAFF_ONLY, canUpdateDenialStatus } from '@/lib/billing/billingAccess';
import {
  Alert, Button, Card, CardBody, CardHeader, EmptyState, FormField, LoadingState, Modal, Page, PageHeader,
  StatCard, StatGrid, StatusBadge, Tabs, cx, FOCUS_RING, inputClasses, type Tone,
} from '@/components/ui';

type DenialStatus = 'open' | 'in_appeal' | 'appeal_won' | 'appeal_lost' | 'corrected_resubmit' | 'written_off';
type DenialCategory = 'authorization' | 'eligibility' | 'coding' | 'missing_info' | 'timely_filing' | 'medical_necessity' | 'non_covered' | 'patient_responsibility';

interface Denial {
  denialId: string;
  claimId: string;
  patientName: string;
  payer: string;
  cptCode: string;
  serviceDate: string;
  billedAmount: number;
  deniedAmount: number;
  carcCode: string;
  category: DenialCategory;
  description: string;
  status: DenialStatus;
  createdAt: string;
  appealDeadline: string | null;
  appealSubmittedAt: string | null;
  appealNotes: string;
}

function mapCarcToCategory(code?: string): DenialCategory {
  if (!code) return 'coding';
  const c = code.toUpperCase();
  if (c.includes('197') || c.includes('97')) return 'authorization';
  if (c.includes('27') || c.includes('31')) return 'eligibility';
  if (c.includes('16') || c.includes('4')) return 'missing_info';
  if (c.includes('29')) return 'timely_filing';
  if (c.includes('50') || c.includes('57')) return 'medical_necessity';
  if (c.includes('96') || c.includes('204')) return 'non_covered';
  if (c.includes('PR') || c.includes('1')) return 'patient_responsibility';
  return 'coding';
}

function mapStatus(s?: string): DenialStatus {
  if (!s) return 'open';
  const lower = s.toLowerCase();
  if (lower === 'appealed' || lower === 'in_appeal') return 'in_appeal';
  if (lower === 'won' || lower === 'appeal_won') return 'appeal_won';
  if (lower === 'lost' || lower === 'appeal_lost') return 'appeal_lost';
  if (lower === 'corrected_resubmit') return 'corrected_resubmit';
  if (lower === 'written_off') return 'written_off';
  return 'open';
}

const DEMO: Denial[] = [];

const STATUS_CONFIG: Record<DenialStatus, { label: string; tone: Tone; icon: React.ReactNode }> = {
  open:               { label: 'Open',              tone: 'danger',  icon: <AlertTriangle /> },
  in_appeal:          { label: 'In Appeal',         tone: 'warning', icon: <Clock /> },
  appeal_won:         { label: 'Appeal Won',        tone: 'success', icon: <CheckCircle2 /> },
  appeal_lost:        { label: 'Appeal Lost',       tone: 'neutral', icon: <XCircle /> },
  corrected_resubmit: { label: 'Corrected/Resubmit', tone: 'info',   icon: <Send /> },
  written_off:        { label: 'Written Off',       tone: 'neutral', icon: <XCircle /> },
};

const CATEGORY_TONES: Record<DenialCategory, Tone> = {
  authorization:       'brand',
  eligibility:         'info',
  coding:              'warning',
  missing_info:        'info',
  timely_filing:       'danger',
  medical_necessity:   'warning',
  non_covered:         'neutral',
  patient_responsibility: 'success',
};

/** Bar fill per category tone (analytics). */
const TONE_BAR: Record<Tone, string> = {
  brand: 'bg-blue-600',
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  neutral: 'bg-slate-400',
  success: 'bg-emerald-500',
};

const CATEGORY_LABELS: Record<DenialCategory, string> = {
  authorization: 'Authorization', eligibility: 'Eligibility', coding: 'Coding',
  missing_info: 'Missing Info', timely_filing: 'Timely Filing', medical_necessity: 'Med Necessity',
  non_covered: 'Non-Covered', patient_responsibility: 'Pt Responsibility',
};

function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

export default function DenialsPage() {
  const [denials, setDenials] = useState<Denial[]>(DEMO);
  const [statusFilter, setStatusFilter] = useState<'all' | DenialStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAppealModal, setShowAppealModal] = useState<Denial | null>(null);
  const [tab, setTab] = useState<'list' | 'analytics'>('list');

  // AI appeal letter drafting (AWS Bedrock — demo mode)
  const [appealText, setAppealText] = useState('');
  const [appealError, setAppealError] = useState<string | null>(null);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaultAppealDeadline] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  const router = useRouter();

  const { user } = useAuth();
  // Office Manager reads denials; status changes (appeal, won / lost, write-off) are billing core
  // only (canUpdateDenialStatus on PUT /api/billing/denials/[id]/status).
  const canChangeStatus = canUpdateDenialStatus(user?.role);
  const canOpenClaims = canAccessPath(user?.role, '/dashboard/billing/claims');

  useEffect(() => {
    let isMounted = true;
    async function loadDenials() {
      try {
        const res = await fetch('/api/billing/denials');
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.denials)) {
          setDenials(
            data.denials.map((d: any) => ({
              denialId: d.id || d.denialId,
              claimId: d.claimId || `cl-${d.id?.slice(0, 5)}`,
              patientName: d.clientName || d.patientName || 'Unknown client',
              payer: d.payer || 'Medicaid',
              cptCode: d.cptCode || '90837',
              serviceDate: d.serviceDate || d.createdAt?.slice(0, 10) || '2026-06-16',
              billedAmount: d.billedAmount || (d.amountCents ? d.amountCents / 100 : 180),
              deniedAmount: d.deniedAmount || (d.amountCents ? d.amountCents / 100 : 180),
              carcCode: d.reasonCode || d.carcCode || 'CO-16',
              category: d.category || mapCarcToCategory(d.reasonCode),
              description: d.reasonText || d.description || 'Payer claim denial',
              status: mapStatus(d.status),
              createdAt: d.createdAt?.slice(0, 10) || '2026-06-20',
              appealDeadline: d.appealDeadline || null,
              appealSubmittedAt: d.appealSubmittedAt || null,
              appealNotes: d.appealNotes || d.appealResolutionNote || '',
            }))
          );
        }
      } catch (err) {
        console.warn('Denials API fetch error:', err);
        if (isMounted) setLoadError(err instanceof Error ? err.message : 'The denials list could not be loaded.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadDenials();
    return () => { isMounted = false; };
  }, []);

  const updateStatus = async (denialId: string, newStatus: DenialStatus, notes?: string) => {
    if (!canChangeStatus) return;
    const before = denials;
    setStatusError(null);
    setDenials(prev => prev.map(d => {
      if (d.denialId !== denialId) return d;
      return {
        ...d,
        status: newStatus,
        appealSubmittedAt: newStatus === 'in_appeal' ? new Date().toISOString().split('T')[0] : d.appealSubmittedAt,
        appealNotes: notes !== undefined ? notes : d.appealNotes,
      };
    }));

    try {
      const res = await fetch(`/api/billing/denials/${denialId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          resolutionNote: notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data && typeof data.error === 'string' ? data.error : `Could not update the denial (${res.status})`);
      }
    } catch (err) {
      // Not saved: put the row back so the page never shows a status the server refused.
      setDenials(before);
      setStatusError(err instanceof Error ? err.message : 'Could not update the denial');
    }
  };

  // Correct & Resubmit opens the real claim on the Claims page: its editor loads the stored claim
  // (diagnoses, providers, lines) and "Send corrected claim" builds a frequency-7 replacement with
  // REF*F8 = the payer's claim number. Nothing is pre-filled or resubmitted from this page.
  const handleCorrectAndResubmit = (d: Denial) => {
    router.push(`/dashboard/billing/claims?claimId=${encodeURIComponent(d.claimId)}`);
  };

  const draftAppeal = async (d: Denial) => {
    setAiDrafting(true);
    setAppealError(null);
    try {
      const res = await fetch('/api/billing/denials/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimId: d.claimId,
          patientName: d.patientName,
          payer: d.payer,
          cptCode: d.cptCode,
          serviceDate: d.serviceDate,
          billedAmount: d.billedAmount,
          deniedAmount: d.deniedAmount,
          carcCode: d.carcCode,
          category: d.category,
          description: d.description,
          appealNotes: d.appealNotes,
        }),
      });
      const data = await res.json();
      if (data.success && data.appealLetter) {
        setAppealText(data.appealLetter);
        return;
      }
      setAppealError(data.error || 'AI appeal drafting is unavailable right now. Write the appeal manually.');
    } catch (err) {
      setAppealError(err instanceof Error ? err.message : 'AI appeal drafting is unavailable right now. Write the appeal manually.');
    } finally {
      setAiDrafting(false);
    }
  };

  const filtered = statusFilter === 'all' ? denials : denials.filter(d => d.status === statusFilter);
  const openAmount = denials.filter(d => d.status === 'open' || d.status === 'in_appeal').reduce((s, d) => s + d.deniedAmount, 0);
  const wonAmount  = denials.filter(d => d.status === 'appeal_won').reduce((s, d) => s + d.deniedAmount, 0);
  const wonCount   = denials.filter(d => d.status === 'appeal_won').length;
  const lostCount  = denials.filter(d => d.status === 'appeal_lost').length;

  // Analytics
  const categoryTotals: Record<string, { count: number; amount: number }> = {};
  for (const d of denials) {
    if (!categoryTotals[d.category]) categoryTotals[d.category] = { count: 0, amount: 0 };
    categoryTotals[d.category].count++;
    categoryTotals[d.category].amount += d.deniedAmount;
  }
  const appealed = denials.filter(d => d.appealSubmittedAt || d.status === 'in_appeal' || d.status === 'appeal_won' || d.status === 'appeal_lost');
  const appealWinRate = (wonCount + lostCount > 0)
    ? Math.round((wonCount / (wonCount + lostCount)) * 100)
    : (appealed.length ? Math.round((wonCount / appealed.length) * 100) : 0);

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Denial Management"
        description="Track denied claims, manage appeals, recover revenue"
      >
        <Tabs
          label="Denial views"
          controlsPanels={false}
          value={tab}
          onChange={setTab}
          items={(['list', 'analytics'] as const).map(t => ({ key: t, label: t === 'list' ? 'Denials' : 'Analytics' }))}
        />
      </PageHeader>

      {loadError && <Alert tone="danger" title="Could not load denials">{loadError}</Alert>}

      {/* KPI row */}
      <StatGrid columns={4}>
        <StatCard label="Open + In Appeal" value={`$${openAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone="danger" icon={<AlertTriangle />} />
        <StatCard label="Recovered (Won)" value={`$${wonAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone="success" icon={<CheckCircle2 />} />
        <StatCard label="Total Denials" value={denials.length} tone="brand" icon={<FileText />} />
        <StatCard label="Appeal Win Rate" value={`${appealWinRate}%`} tone="warning" icon={<BarChart3 />} />
      </StatGrid>

      {tab === 'analytics' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Denials by Category" icon={<BarChart3 />} />
            <CardBody className="space-y-3">
              {loading && denials.length === 0 ? <LoadingState rows={3} className="p-0" /> : denials.length === 0 && <p className="text-sm text-slate-500">No denials yet</p>}
              {Object.entries(categoryTotals).sort((a, b) => b[1].count - a[1].count).map(([cat, v]) => {
                const pct = denials.length > 0 ? Math.round((v.count / denials.length) * 100) : 0;
                return (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700">{CATEGORY_LABELS[cat as DenialCategory]}</span>
                      <span className="text-slate-500">{v.count} denial{v.count !== 1 ? 's' : ''} · ${v.amount}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className={cx('h-2 rounded-full', TONE_BAR[CATEGORY_TONES[cat as DenialCategory]])} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="By Payer" />
              <CardBody className="py-3">
                {Object.entries(denials.reduce((acc, d) => { acc[d.payer] = (acc[d.payer] ?? 0) + 1; return acc; }, {} as Record<string, number>)).map(([payer, count]) => (
                  <div key={payer} className="flex justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-slate-700">{payer}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{count}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Appeal Outcomes" />
              <CardBody className="py-3">
                {[
                  { label: 'Appeals Submitted', value: appealed.length, color: 'text-amber-700' },
                  { label: 'Won / Recovered',   value: wonCount,        color: 'text-emerald-700' },
                  { label: 'Lost',              value: lostCount,       color: 'text-rose-700' },
                  { label: 'Pending',           value: denials.filter(d => d.status === 'in_appeal').length, color: 'text-sky-700' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-slate-700">{r.label}</span>
                    <span className={cx('font-semibold tabular-nums', r.color)}>{r.value}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <>
          {!canChangeStatus && (
            <Alert tone="neutral">
              Read-only. {BILLING_STAFF_ONLY}: file appeals, correct and resubmit, mark appeals won or lost, and write off.
            </Alert>
          )}
          {statusError && (
            <Alert tone="danger">{statusError}</Alert>
          )}
          {/* Status filters */}
          <Tabs
            variant="pill"
            label="Filter denials by status"
            controlsPanels={false}
            value={statusFilter}
            onChange={setStatusFilter}
            items={(['all', 'open', 'in_appeal', 'corrected_resubmit', 'appeal_won', 'appeal_lost', 'written_off'] as const).map(f => {
              const count = f === 'all' ? denials.length : denials.filter(d => d.status === f).length;
              return { key: f, label: f === 'all' ? `All (${count})` : `${STATUS_CONFIG[f as DenialStatus].label} (${count})` };
            })}
          />

          {/* Denial list */}
          <div className="space-y-3">
            {filtered.length === 0 && (
              <Card>
                {loading ? <LoadingState label="Loading denials…" /> : <EmptyState title="No denials yet" />}
              </Card>
            )}
            {filtered.map(denial => {
              const scfg = STATUS_CONFIG[denial.status];
              const isOpen = expanded === denial.denialId;
              const deadline = denial.appealDeadline ? daysUntil(denial.appealDeadline) : null;
              return (
                <Card key={denial.denialId}>
                  <button type="button" aria-expanded={isOpen} className={cx('w-full rounded-xl text-left px-5 py-4 flex items-start justify-between gap-3', FOCUS_RING)}
                    onClick={() => setExpanded(isOpen ? null : denial.denialId)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-slate-900">{denial.patientName}</span>
                        <StatusBadge tone={scfg.tone} icon={scfg.icon}>{scfg.label}</StatusBadge>
                        <StatusBadge tone={CATEGORY_TONES[denial.category]}>{CATEGORY_LABELS[denial.category]}</StatusBadge>
                      </div>
                      <p className="text-xs text-slate-500">{denial.payer} · {denial.cptCode} · {denial.serviceDate} · <span className="font-semibold text-rose-700">${denial.deniedAmount}</span></p>
                      <p className="text-xs text-slate-600 mt-0.5">{denial.carcCode} — {denial.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {deadline !== null && denial.status !== 'written_off' && denial.status !== 'appeal_won' && (
                        <span className={`text-xs font-medium ${deadline <= 7 ? 'text-rose-700' : deadline <= 14 ? 'text-amber-700' : 'text-slate-500'}`}>
                          {deadline > 0 ? `${deadline}d to appeal` : 'Deadline passed'}
                        </span>
                      )}
                      {isOpen ? <ChevronUp size={14} className="text-slate-500" aria-hidden /> : <ChevronDown size={14} className="text-slate-500" aria-hidden />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                      {denial.appealNotes && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-slate-500 mb-1">Notes</p>
                          <p className="text-sm text-slate-700">{denial.appealNotes}</p>
                        </div>
                      )}
                      {canChangeStatus && <div className="flex gap-3 flex-wrap">
                        {denial.status === 'open' && (
                          <Button size="sm" icon={<Send />} onClick={() => { setShowAppealModal(denial); setAppealText(''); }}>
                            File Appeal
                          </Button>
                        )}
                        {denial.status === 'open' && canOpenClaims && (
                          <Button size="sm" variant="secondary" icon={<FileText />} onClick={() => handleCorrectAndResubmit(denial)}>
                            Correct & Resubmit
                          </Button>
                        )}
                        {denial.status === 'in_appeal' && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<CheckCircle2 className="text-emerald-700" />}
                              onClick={() => updateStatus(denial.denialId, 'appeal_won', 'Appeal upheld by payer. Reprocessing initiated.')}
                            >
                              Mark Appeal Won
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<XCircle className="text-rose-700" />}
                              onClick={() => updateStatus(denial.denialId, 'appeal_lost', 'Appeal denied by payer on final reconsideration.')}
                            >
                              Mark Appeal Lost
                            </Button>
                          </>
                        )}
                        {(denial.status === 'open' || denial.status === 'appeal_lost') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateStatus(denial.denialId, 'written_off', 'Balance written off after review.')}
                          >
                            Write Off
                          </Button>
                        )}
                      </div>}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Appeal modal */}
      {canChangeStatus && showAppealModal && (
        <Modal
          title="File Appeal"
          onClose={() => setShowAppealModal(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setShowAppealModal(null)}>Cancel</Button>
            <Button
              icon={<Send />}
              onClick={() => {
                updateStatus(showAppealModal.denialId, 'in_appeal', appealText || 'Appeal submitted with documentation.');
                setShowAppealModal(null);
              }}>
              Submit Appeal
            </Button>
          </>}
        >
          <p className="text-sm text-slate-500">{showAppealModal.patientName} · {showAppealModal.payer} · {showAppealModal.carcCode} · ${showAppealModal.deniedAmount}</p>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="appeal-rationale" className="text-sm font-medium text-slate-700">Appeal Rationale</label>
              <Button
                size="sm"
                variant="secondary"
                icon={<Sparkles />}
                onClick={() => draftAppeal(showAppealModal)}
                disabled={aiDrafting}
              >
                {aiDrafting ? 'Drafting…' : 'Draft with AI'}
              </Button>
            </div>
            {appealError ? (
              <Alert tone="danger" className="mb-2">{appealError}</Alert>
            ) : null}
            <textarea id="appeal-rationale" rows={appealText ? 10 : 4} value={appealText} onChange={e => setAppealText(e.target.value)}
              className={cx(inputClasses, 'resize-none')}
              placeholder="Explain why this denial should be overturned — or let AI draft the letter from the claim and clinical record, then edit." />
            {appealText && (
              <p className="text-xs text-slate-500 mt-1">
                AI-drafted (AWS Bedrock, demo mode) from the denial reason and chart evidence — review and edit before submitting.
              </p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Supporting Documents</p>
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-500 cursor-pointer hover:border-blue-200">
              Click to attach authorization copies, clinical notes, or EOB
            </div>
          </div>
          <FormField label="Appeal Deadline">
            <input type="date" className={inputClasses}
              defaultValue={defaultAppealDeadline} />
          </FormField>
        </Modal>
      )}

    </Page>
  );
}
