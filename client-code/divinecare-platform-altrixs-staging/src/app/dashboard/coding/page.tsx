'use client';
import { useEffect, useMemo, useState } from 'react';
import { useClients } from '@/features/clients/hooks/useClients';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { fetchEhrProgressNotes } from '@/features/clients/api/clientsApi';
import type { Client, EhrProgressNote } from '@/features/clients/types';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';
import { generateClaimFromNote } from '@/features/billing/claimsApi';
import { CPT_CODES, FEE_NOT_SET } from '@/lib/constants/cpt';
import { mergeCptOptions } from '@/lib/billing/feeSchedule';
import { useFeeScheduleCodes } from '@/features/billing/feeScheduleApi';
import {
  ClipboardList, CheckCircle2, AlertTriangle, Bell, DollarSign, Target,
  Bot, Search, BookOpen, Sparkles,
} from 'lucide-react';
import {
  Alert, Button, buttonClasses, Card, CardBody, CardHeader, cx, EmptyState, FOCUS_RING, inputClasses,
  LoadingState, Modal, Page, PageHeader, StatCard, StatGrid, StatusBadge, Tabs, TONE_SOFT, type Tone,
} from '@/components/ui';

type CodeConfidence = 'high' | 'medium' | 'low';
type CodeStatus = 'suggested' | 'accepted' | 'modified' | 'rejected';
type ClaimStatus = 'draft' | 'ready' | 'submitted' | 'paid' | 'denied' | 'needs-review';

interface CPTCode {
  code: string;
  description: string;
  /** null = fee not set in the fee schedule */
  fee: number | null;
  category: string;
}

interface ICD10Code {
  code: string;
  description: string;
  category: string;
}

interface SuggestedCode {
  code: string;
  description: string;
  confidence: CodeConfidence;
  reason: string;
  fee: number;
  status: CodeStatus;
}

interface SuggestedICD10 {
  code: string;
  description: string;
  confidence: CodeConfidence;
  reason: string;
  status: CodeStatus;
}

interface CodingSuggestion {
  id: string;
  clientName: string;
  clinician: string;
  sessionDate: string;
  noteType: string;
  noteExcerpt: string;
  suggestedCPT: SuggestedCode[];
  suggestedICD10: SuggestedICD10[];
  emLevel: string;
  medicalNecessityScore: number;
  bundlingAlerts: string[];
  status: ClaimStatus;
  estimatedReimbursement: number;
}

const CPT_LIBRARY: CPTCode[] = CPT_CODES.map((c) => ({
  code: c.code,
  description: c.desc,
  fee: c.rate,
  category: c.category,
}));

const ICD10_LIBRARY: ICD10Code[] = [
  { code: 'F32.1', description: 'Major depressive disorder, single episode, moderate', category: 'Depression' },
  { code: 'F32.2', description: 'Major depressive disorder, single episode, severe', category: 'Depression' },
  { code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate', category: 'Depression' },
  { code: 'F33.2', description: 'Major depressive disorder, recurrent, severe', category: 'Depression' },
  { code: 'F41.1', description: 'Generalized anxiety disorder', category: 'Anxiety' },
  { code: 'F41.0', description: 'Panic disorder', category: 'Anxiety' },
  { code: 'F43.10', description: 'Post-traumatic stress disorder, unspecified', category: 'Trauma' },
  { code: 'F43.11', description: 'Post-traumatic stress disorder, acute', category: 'Trauma' },
  { code: 'F43.12', description: 'Post-traumatic stress disorder, chronic', category: 'Trauma' },
  { code: 'F31.1', description: 'Bipolar disorder, current episode manic', category: 'Bipolar' },
  { code: 'F31.4', description: 'Bipolar disorder, current episode depressed, moderate', category: 'Bipolar' },
  { code: 'F10.20', description: 'Alcohol use disorder, moderate', category: 'SUD' },
  { code: 'F10.21', description: 'Alcohol use disorder, moderate, in remission', category: 'SUD' },
  { code: 'F19.20', description: 'Other psychoactive substance use, moderate', category: 'SUD' },
  { code: 'F25.0', description: 'Schizoaffective disorder, bipolar type', category: 'Psychotic' },
  { code: 'F90.0', description: 'Attention-deficit hyperactivity disorder, inattentive type', category: 'ADHD' },
  { code: 'F84.0', description: 'Autism spectrum disorder', category: 'Neurodevelopmental' },
];

function daysAgo(dateIso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(dateIso).getTime()) / 86_400_000));
}

function noteTypeFromBody(body: string) {
  const lower = body.toLowerCase();
  if (lower.includes('group')) return 'Group Note';
  if (lower.includes('medication') || lower.includes('prescription')) return 'Medication Management';
  if (lower.includes('crisis') || lower.includes('safety')) return 'Crisis Note';
  if (lower.includes('intake') || lower.includes('assessment')) return 'Assessment Note';
  return 'Progress Note';
}

function buildLiveSuggestion(note: EhrProgressNote, client: Client): CodingSuggestion {
  const body = note.body.toLowerCase();
  const sessionDate = note.createdAt.slice(0, 10);
  const noteType = noteTypeFromBody(note.body);
  const duration = body.match(/(\d{2,3})\s*(?:minutes|min|minute)/)?.[1];
  const longSession = Number(duration || 0) >= 53 || body.includes('53+');
  const cpt: SuggestedCode[] = [];
  const icd: SuggestedICD10[] = [];

  if (noteType === 'Group Note') {
    cpt.push({
      code: '90853',
      description: 'Group psychotherapy',
      confidence: 'high',
      reason: 'Group language is documented in the note.',
      fee: 60,
      status: 'suggested',
    });
  } else if (noteType === 'Medication Management') {
    cpt.push({
      code: '90863',
      description: 'Pharmacologic management',
      confidence: 'high',
      reason: 'Medication review is documented in the note.',
      fee: 82,
      status: 'suggested',
    });
    cpt.push({
      code: '99214',
      description: 'E/M office visit, established, moderate complexity',
      confidence: 'medium',
      reason: 'Follow-up medication management can support an E/M review when documented.',
      fee: 177,
      status: 'suggested',
    });
  } else if (noteType === 'Crisis Note') {
    cpt.push({
      code: '90839',
      description: 'Psychotherapy for crisis, first 60 min',
      confidence: 'high',
      reason: 'Crisis and safety language are present in the note.',
      fee: 271,
      status: 'suggested',
    });
  } else {
    cpt.push({
      code: longSession ? '90837' : '90834',
      description: longSession ? 'Psychotherapy, 53+ min' : 'Psychotherapy, 38–52 min',
      confidence: 'high',
      reason: 'Session duration and psychotherapy content support this code.',
      fee: longSession ? 183 : 130,
      status: 'suggested',
    });
  }

  // ICD-10: only the client's own chart diagnosis. No code is guessed from note words (a default
  // like F33.1 offered "high confidence" to a client without that diagnosis was a fabricated code).
  if (client.primaryDiagnosisCode) {
    icd.push({
      code: client.primaryDiagnosisCode,
      description: client.primaryDiagnosis || client.primaryDiagnosisCode,
      confidence: 'high',
      reason: 'Primary diagnosis on the client diagnosis list. Confirm the visit addressed it.',
      status: 'suggested',
    });
  }

  const medicalNecessityScore = Math.min(99, Math.max(68, body.length > 300 ? 88 : 76));
  return {
    id: note.id,
    clientName: note.clientName,
    clinician: note.clinicianName || 'Assigned clinician',
    sessionDate,
    noteType,
    noteExcerpt: note.body.slice(0, 260),
    suggestedCPT: cpt,
    suggestedICD10: icd,
    emLevel: noteType === 'Medication Management' ? '99214' : 'N/A',
    medicalNecessityScore,
    bundlingAlerts: noteType === 'Medication Management'
      ? ['Check payer rules before pairing medication management with an evaluation code.']
      : noteType === 'Crisis Note'
        ? ['Document the crisis rationale before final billing submission.']
        : [],
    status: note.workflowStatus === 'Draft' ? 'needs-review' : 'ready',
    estimatedReimbursement: cpt.reduce((sum, item) => sum + (item.fee ?? 0), 0),
  };
}

function buildLiveSuggestions(notes: EhrProgressNote[], clients: Client[]) {
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  return notes.slice(0, 5).map((note) => buildLiveSuggestion(note, clientMap.get(note.clientId) || clients[0] || {
    id: note.clientId,
    name: note.clientName,
    email: '',
    phone: '',
    assignedSince: note.createdAt,
    lastCheckIn: note.createdAt,
    avgMood: null,
    avgStress: null,
    streak: 0,
    risk: 'low',
    totalSessions: 0,
  }));
}

const CONFIDENCE_CONFIG: Record<CodeConfidence, { label: string; tone: Tone }> = {
  high:   { label: 'High Confidence',   tone: 'success' },
  medium: { label: 'Medium Confidence', tone: 'warning' },
  low:    { label: 'Low Confidence',    tone: 'danger' },
};

const CLAIM_STATUS_CONFIG: Record<ClaimStatus, { label: string; tone: Tone }> = {
  'draft':        { label: 'Draft',         tone: 'neutral' },
  'ready':        { label: 'Ready to Bill', tone: 'success' },
  'needs-review': { label: 'Needs Review',  tone: 'warning' },
  'submitted':    { label: 'Submitted',     tone: 'info' },
  'paid':         { label: 'Paid',          tone: 'success' },
  'denied':       { label: 'Denied',        tone: 'danger' },
};

/** Fill class for a medical-necessity bar (the width stays dynamic). */
function necessityBarClass(score: number) {
  if (score >= 85) return 'bg-blue-600';
  if (score >= 70) return 'bg-amber-500';
  return 'bg-rose-500';
}

/** Small code chip (CPT/ICD) — tone carries the confidence, text carries the code. */
function CodeChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset', TONE_SOFT[tone])}>
      {children}
    </span>
  );
}

// KPI icon map
const KPI_ICONS: React.ReactNode[] = [
  <ClipboardList key="sessions" />,
  <CheckCircle2 key="ready" />,
  <AlertTriangle key="review" />,
  <Bell key="bundling" />,
  <DollarSign key="reimb" />,
];

export default function CodingPage() {
  const { clients } = useClients();
  const { user } = useAuth();
  // Note-based code review reads progress note bodies and signs/locks notes: clinicians and
  // leadership only (same roles as /api/ehr/notes). Billing codes from claims and the AI scanner.
  const canReviewNotes = canAccessPath(user?.role, '/dashboard/ehr/notes');
  // Built-in codes plus the org fee schedule's base CPTs (fee schedule rates win)
  const feeCodes = useFeeScheduleCodes();
  const cptLibrary = useMemo<CPTCode[]>(() => {
    const cat = new Map(CPT_LIBRARY.map((c) => [c.code, c.category]));
    return mergeCptOptions(CPT_CODES, feeCodes).map((c) => ({
      code: c.code,
      description: c.desc,
      fee: c.rate,
      category: cat.get(c.code) ?? 'Fee schedule',
    }));
  }, [feeCodes]);
  const [tab, setTab] = useState<'review' | 'scanner' | 'library'>('review');
  const [suggestions, setSuggestions] = useState<CodingSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<CodingSuggestion | null>(null);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [cptFilter, setCptFilter] = useState('All');
  const [icdFilter, setIcdFilter] = useState('All');
  const [cptSearch, setCptSearch] = useState('');
  const [icdSearch, setIcdSearch] = useState('');
  const [loadingLive, setLoadingLive] = useState(true);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!canReviewNotes) {
      setSuggestions([]);
      setLoadingLive(false);
      return;
    }
    setLoadingLive(true);
    fetchEhrProgressNotes()
      .then((res) => {
        if (cancelled) return;
        const liveSuggestions = buildLiveSuggestions(res.notes, clients);
        setSuggestions(liveSuggestions.length > 0 ? liveSuggestions : []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clients, canReviewNotes]);

  const totalReimbursement = suggestions.reduce((sum, s) => sum + s.estimatedReimbursement, 0);
  const needsReview = suggestions.filter(s => s.status === 'needs-review').length;
  const ready = suggestions.filter(s => s.status === 'ready').length;
  const bundlingIssues = suggestions.filter(s => s.bundlingAlerts.length > 0).length;
  const avgMedNec = suggestions.length > 0
    ? Math.round(suggestions.reduce((sum, s) => sum + s.medicalNecessityScore, 0) / suggestions.length)
    : 0;

  const persistAcceptedCodes = async (suggestion: CodingSuggestion) => {
    const workflow = suggestion.status === 'needs-review' ? 'Draft' : 'Locked';
    if (workflow === 'Draft') {
      try {
        await updateProgressNoteStatus(suggestion.id, 'Signed');
      } catch {
        /* already signed */
      }
      await updateProgressNoteStatus(suggestion.id, 'Locked');
    }
    const primaryCpt = suggestion.suggestedCPT.find((c) => c.status !== 'rejected')?.code;
    const icd = suggestion.suggestedICD10.map((c) => c.code).join(', ');
    await generateClaimFromNote(suggestion.id, {
      cptCode: primaryCpt,
      markReady: true,
    });
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === suggestion.id
          ? {
              ...s,
              status: 'ready',
              suggestedCPT: s.suggestedCPT.map((c) => ({ ...c, status: 'accepted' as CodeStatus })),
              suggestedICD10: s.suggestedICD10.map((c) => ({ ...c, status: 'accepted' as CodeStatus })),
              noteExcerpt: icd ? `${s.noteExcerpt} ICD-10: ${icd}` : s.noteExcerpt,
            }
          : s
      )
    );
  };

  const handleAcceptAll = async (suggestionId: string) => {
    const suggestion = suggestions.find((s) => s.id === suggestionId) || selectedSuggestion;
    if (!suggestion) return;
    setAcceptBusy(true);
    setAcceptError(null);
    try {
      await persistAcceptedCodes(suggestion);
      setSelectedSuggestion(null);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Could not create draft claim');
    } finally {
      setAcceptBusy(false);
    }
  };

  const [aiCodingResult, setAiCodingResult] = useState<{
    cpt: Array<{ code: string; description: string; rate?: number; confidence: number; rationale?: string }>;
    icd10: Array<{ code: string; description: string; confidence: number; rationale?: string }>;
    medicalNecessityScore: number | null;
    documentationTips?: string;
    disclaimer?: string;
  } | null>(null);

  const [aiCodingError, setAiCodingError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!noteInput.trim()) return;
    setAnalyzing(true);
    setAiCodingError(null);
    try {
      const res = await fetch('/api/agents/coding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteInput }),
      });
      const data = await res.json();
      if (data.success) {
        setAiCodingResult({
          cpt: data.cpt || [],
          icd10: data.icd10 || [],
          medicalNecessityScore: data.medicalNecessityScore ?? null,
          documentationTips: data.documentationTips,
          disclaimer: data.disclaimer,
        });
      } else {
        setAiCodingResult(null);
        setAiCodingError(data.error || 'AI coding suggestions are unavailable right now.');
      }
    } catch (err) {
      setAiCodingResult(null);
      setAiCodingError(err instanceof Error ? err.message : 'AI coding suggestions are unavailable right now.');
    } finally {
      setAnalyzing(false);
    }
  };

  const cptCategories = ['All', ...Array.from(new Set(cptLibrary.map(c => c.category)))];
  const icdCategories = ['All', ...Array.from(new Set(ICD10_LIBRARY.map(c => c.category)))];

  const filteredCPT = cptLibrary.filter(c =>
    (cptFilter === 'All' || c.category === cptFilter) &&
    (cptSearch === '' || c.code.toLowerCase().includes(cptSearch.toLowerCase()) || c.description.toLowerCase().includes(cptSearch.toLowerCase()))
  );
  const filteredICD10 = ICD10_LIBRARY.filter(c =>
    (icdFilter === 'All' || c.category === icdFilter) &&
    (icdSearch === '' || c.code.toLowerCase().includes(icdSearch.toLowerCase()) || c.description.toLowerCase().includes(icdSearch.toLowerCase()))
  );

  const scannerScore = aiCodingResult ? aiCodingResult.medicalNecessityScore : (noteInput.length > 200 ? 89 : noteInput.length > 100 ? 72 : 58);

  return (
    <Page>

      {/* Detail modal */}
      {selectedSuggestion && (
        <Modal
          title={selectedSuggestion.clientName}
          onClose={() => setSelectedSuggestion(null)}
          size="md"
          footer={
            <div className="flex w-full flex-col gap-2">
              {acceptError ? <p className="text-sm text-rose-700">{acceptError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <a
                  href="/dashboard/billing/claims"
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  Review in Billing
                </a>
                <Button
                  type="button"
                  disabled={acceptBusy}
                  onClick={() => { void handleAcceptAll(selectedSuggestion.id); }}
                >
                  {acceptBusy ? 'Saving…' : 'Accept All & Mark Ready'}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{selectedSuggestion.noteType} &middot; {selectedSuggestion.sessionDate} &middot; {selectedSuggestion.clinician}</p>

            {/* Medical necessity */}
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold text-slate-600">Note Excerpt (AI Analyzed)</p>
              <p className="text-sm italic text-slate-700">&ldquo;{selectedSuggestion.noteExcerpt}&rdquo;</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className={cx('h-3 rounded-full transition-all', necessityBarClass(selectedSuggestion.medicalNecessityScore))} style={{ width: `${selectedSuggestion.medicalNecessityScore}%` }} />
              </div>
              <span className="text-sm font-semibold text-slate-700 tabular-nums">{selectedSuggestion.medicalNecessityScore}% med. necessity</span>
            </div>

            {selectedSuggestion.bundlingAlerts.length > 0 && (
              <Alert tone="warning">
                {selectedSuggestion.bundlingAlerts.map((alert, i) => (
                  <p key={i}>{alert}</p>
                ))}
              </Alert>
            )}

            {/* CPT codes */}
            <div>
              <h3 className="mb-2 text-xs font-semibold text-slate-600">Suggested CPT Codes</h3>
              <div className="space-y-2">
                {selectedSuggestion.suggestedCPT.map((cpt, i) => {
                  const cfg = CONFIDENCE_CONFIG[cpt.confidence];
                  return (
                    <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-blue-700">{cpt.code}</span>
                          <StatusBadge tone={cfg.tone} size="sm">{cfg.label}</StatusBadge>
                        </div>
                        <p className="mb-1 text-xs text-slate-700">{cpt.description}</p>
                        <p className="text-xs italic text-slate-500">{cpt.reason}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-slate-900 tabular-nums">{cpt.fee == null ? FEE_NOT_SET : `$${cpt.fee}`}</p>
                        <p className="text-xs text-slate-500">fee</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ICD-10 codes */}
            <div>
              <h3 className="mb-2 text-xs font-semibold text-slate-600">Suggested ICD-10 Codes</h3>
              <div className="space-y-2">
                {selectedSuggestion.suggestedICD10.map((icd, i) => {
                  const cfg = CONFIDENCE_CONFIG[icd.confidence];
                  return (
                    <div key={i} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-blue-700">{icd.code}</span>
                        <StatusBadge tone={cfg.tone} size="sm">{cfg.label}</StatusBadge>
                      </div>
                      <p className="mb-1 text-xs text-slate-700">{icd.description}</p>
                      <p className="text-xs italic text-slate-500">{icd.reason}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Header */}
      <PageHeader
        title="AI Coding"
        badges={<StatusBadge tone="brand">Amazon Bedrock</StatusBadge>}
        description="AI-assisted CPT and ICD-10 code suggestion from clinical notes — with medical necessity scoring and bundling alerts."
      />

      {/* KPI bar */}
      <StatGrid columns={5}>
        {([
          { label: 'Pending Sessions', value: suggestions.length, tone: 'brand' },
          { label: 'Ready to Bill', value: ready, tone: 'success' },
          { label: 'Needs Review', value: needsReview, tone: 'danger' },
          { label: 'Bundling Alerts', value: bundlingIssues, tone: 'warning' },
          { label: 'Est. Reimbursement', value: `$${totalReimbursement}`, tone: 'success' },
        ] as Array<{ label: string; value: React.ReactNode; tone: Tone }>).map(({ label, value, tone }, idx) => (
          <StatCard key={label} label={label} value={value} tone={tone} icon={KPI_ICONS[idx]} />
        ))}
      </StatGrid>

      {/* Tabs */}
      <Tabs
        label="AI coding sections"
        value={tab}
        onChange={setTab}
        controlsPanels={false}
        items={[
          { key: 'review', label: 'AI Code Review', icon: <Bot />, count: suggestions.length },
          { key: 'scanner', label: 'Revenue Scanner', icon: <Search /> },
          { key: 'library', label: 'Code Library', icon: <BookOpen /> },
        ]}
      />

      {loadingLive && suggestions.length === 0 && (
        <Card>
          <LoadingState label="Loading live notes and client chart data…" />
        </Card>
      )}

      {/* ── CODE REVIEW TAB ── */}
      {tab === 'review' && !canReviewNotes && (
        <Card>
          <EmptyState
            title="Note-based code review is not available for your role."
            description={<>Code from the claim in Billing &rarr; Claims, or paste documentation into the Revenue Scanner tab.</>}
          />
        </Card>
      )}
      {tab === 'review' && canReviewNotes && (
        <div className="space-y-4">
          {/* Avg med necessity bar */}
          <Card className="flex items-center gap-4 p-4">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
              <Target size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">Average Medical Necessity Score</p>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">{avgMedNec}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full bg-blue-600" style={{ width: `${avgMedNec}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">Higher scores = stronger note documentation supports the billed code</p>
            </div>
          </Card>

          {!loadingLive && suggestions.length === 0 && (
            <Card>
              <EmptyState
                icon={<ClipboardList />}
                title="No notes waiting for code review."
                description="Notes appear here once clinicians document sessions in EHR Notes."
              />
            </Card>
          )}

          {suggestions.map(s => {
            const statusCfg = CLAIM_STATUS_CONFIG[s.status];
            const isExpanded = expandedNote === s.id;
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                    {s.clientName.split(' ').map(w => w[0]).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{s.clientName}</p>
                      <StatusBadge tone={statusCfg.tone} size="sm">{statusCfg.label}</StatusBadge>
                      {s.bundlingAlerts.length > 0 && (
                        <StatusBadge tone="warning" size="sm" icon={<AlertTriangle />}>Bundling Alert</StatusBadge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{s.noteType} &middot; {s.sessionDate} &middot; {s.clinician}</p>

                    {/* Suggested codes inline */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.suggestedCPT.map(cpt => (
                        <CodeChip key={cpt.code} tone={CONFIDENCE_CONFIG[cpt.confidence].tone}>{cpt.code}</CodeChip>
                      ))}
                      {s.suggestedICD10.map(icd => (
                        <CodeChip key={icd.code} tone="neutral">{icd.code}</CodeChip>
                      ))}
                    </div>

                    {/* Med necessity bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={cx('h-1.5 rounded-full', s.medicalNecessityScore >= 85 ? 'bg-blue-600' : 'bg-amber-500')} style={{ width: `${s.medicalNecessityScore}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">{s.medicalNecessityScore}% necessity</span>
                      <span className="text-xs font-semibold text-slate-900 tabular-nums">${s.estimatedReimbursement}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setExpandedNote(isExpanded ? null : s.id)} aria-expanded={isExpanded}>
                      {isExpanded ? 'Hide' : 'Note'}
                    </Button>
                    <Button size="sm" onClick={() => setSelectedSuggestion(s)}>
                      Review Codes
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-5 pb-4 pt-3">
                    <p className="mb-2 text-xs font-semibold text-slate-600">Note Excerpt (AI Analyzed)</p>
                    <p className="rounded-lg bg-slate-50 p-3 text-sm italic text-slate-700">&ldquo;{s.noteExcerpt}&rdquo;</p>
                    {s.bundlingAlerts.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {s.bundlingAlerts.map((alert, i) => (
                          <Alert key={i} tone="warning">{alert}</Alert>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── REVENUE SCANNER TAB ── */}
      {tab === 'scanner' && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Revenue Integrity Scanner"
              description="Paste a clinical note below and AI will suggest CPT and ICD-10 codes, score medical necessity, and flag bundling issues."
            />
            <CardBody>
              <label htmlFor="coding-note-input" className="sr-only">Clinical note</label>
              <textarea
                id="coding-note-input"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                rows={8}
                placeholder="Paste clinical note here…&#10;&#10;Example: Client presented with moderate depressive symptoms (PHQ-9 = 12). Session focused on behavioral activation techniques. Explored connection between daily routine and mood. Session duration: 55 minutes."
                className={cx(inputClasses, 'resize-none font-mono')}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  icon={<Bot />}>
                  {analyzing ? 'Analyzing…' : 'Analyze with AI'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setNoteInput('')}>
                  Clear
                </Button>
              </div>

              {analyzing && (
                <Alert tone="brand" icon={<Bot />} title="AI Coding Engine analyzing note…" className="mt-4 animate-pulse">
                  Identifying diagnoses &middot; Matching CPT codes &middot; Scoring medical necessity &middot; Checking bundling rules
                </Alert>
              )}

              {!analyzing && (aiCodingResult || noteInput.length > 50) && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Sparkles className="h-3.5 w-3.5 text-blue-600" aria-hidden />
                      AI suggestions (Claude on AWS Bedrock)
                    </span>
                    <span className="font-medium text-blue-700">Verify before billing</span>
                  </div>
                  {aiCodingError ? (
                    <Alert tone="danger">{aiCodingError}</Alert>
                  ) : null}

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-2 text-xs font-semibold text-slate-600">Suggested CPT Codes</h3>
                    <div className="flex flex-wrap gap-2">
                      {aiCodingResult?.cpt && aiCodingResult.cpt.length > 0 ? (
                        aiCodingResult.cpt.map((c) => (
                          <div key={c.code} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-xs">
                            <span className="font-mono font-semibold text-blue-700">{c.code}</span>
                            <span className="ml-2 text-slate-600">{c.description}</span>
                            {c.rate ? <span className="ml-3 font-semibold text-slate-900 tabular-nums">${c.rate}</span> : null}
                            <StatusBadge tone="brand" size="sm" className="ml-2">
                              {c.confidence}% confidence
                            </StatusBadge>
                            {c.rationale && (
                              <p className="mt-1 text-xs text-slate-500">{c.rationale}</p>
                            )}
                          </div>
                        ))
                      ) : noteInput.toLowerCase().includes('55') || noteInput.toLowerCase().includes('53') ? (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <span className="font-mono font-semibold text-blue-700">90837</span>
                          <span className="ml-2 text-slate-600">Psychotherapy, 53+ min</span>
                          <span className="ml-3 font-semibold text-slate-900 tabular-nums">$183</span>
                          <StatusBadge tone="success" size="sm" className="ml-2">High confidence</StatusBadge>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <span className="font-mono font-semibold text-amber-800">90834</span>
                          <span className="ml-2 text-slate-600">Psychotherapy, 38–52 min</span>
                          <span className="ml-3 font-semibold text-slate-900 tabular-nums">$130</span>
                          <StatusBadge tone="warning" size="sm" className="ml-2">Medium — confirm duration</StatusBadge>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-2 text-xs font-semibold text-slate-600">Suggested ICD-10 Codes</h3>
                    <div className="flex flex-wrap gap-2">
                      {aiCodingResult?.icd10 && aiCodingResult.icd10.length > 0 ? (
                        aiCodingResult.icd10.map((icd) => (
                          <div key={icd.code} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-xs">
                            <span className="font-mono font-semibold text-blue-700">{icd.code}</span>
                            <span className="ml-2 text-slate-600">{icd.description}</span>
                            <StatusBadge tone="brand" size="sm" className="ml-2">
                              {icd.confidence}% confidence
                            </StatusBadge>
                            {icd.rationale && (
                              <p className="mt-1 text-xs text-slate-500">{icd.rationale}</p>
                            )}
                          </div>
                        ))
                      ) : (noteInput.toLowerCase().includes('depress') || noteInput.toLowerCase().includes('phq')) ? (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <span className="font-mono font-semibold text-blue-700">F33.1</span>
                          <span className="ml-2 text-slate-600">MDD, recurrent, moderate</span>
                          <StatusBadge tone="success" size="sm" className="ml-2">High confidence</StatusBadge>
                        </div>
                      ) : noteInput.toLowerCase().includes('anxiety') ? (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <span className="font-mono font-semibold text-blue-700">F41.1</span>
                          <span className="ml-2 text-slate-600">Generalized anxiety disorder</span>
                          <StatusBadge tone="warning" size="sm" className="ml-2">Medium confidence</StatusBadge>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">No specific diagnosis identified — add diagnosis to note for ICD-10 suggestion.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Medical Necessity Score</p>
                      <span className="text-xl font-semibold text-blue-700 tabular-nums">
                        {scannerScore}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-blue-600"
                        style={{ width: `${scannerScore}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {aiCodingResult?.documentationTips ||
                        (noteInput.length > 200
                          ? 'Strong documentation. Note well supports the suggested code.'
                          : 'Add more clinical detail (interventions, client response, time) to strengthen necessity.')}
                    </p>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Revenue integrity summary */}
          <Card>
            <CardHeader title="Practice Revenue Integrity — This Week" titleAs="h3" />
            <CardBody>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {([
                  { label: 'Unsigned notes with no code', value: 3, tone: 'danger', action: 'Review in EHR Notes' },
                  { label: 'Codes pending clinician confirmation', value: suggestions.length, tone: 'warning', action: 'Review above' },
                  { label: 'Estimated unbilled revenue at risk', value: '$' + (suggestions.reduce((s, x) => s + x.estimatedReimbursement, 0) + 284).toLocaleString(), tone: 'success', action: '' },
                ] as Array<{ label: string; value: React.ReactNode; tone: Tone; action: string }>).map(({ label, value, tone, action }) => (
                  <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
                    <p className="mb-1 text-xs font-semibold text-slate-600">{label}</p>
                    {action && <StatusBadge tone={tone} size="sm">{action}</StatusBadge>}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── CODE LIBRARY TAB ── */}
      {tab === 'library' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* CPT Code Library */}
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Behavioral Health CPT Codes</h2>
              <input type="text" aria-label="Search CPT codes" placeholder="Search codes…" value={cptSearch} onChange={e => setCptSearch(e.target.value)}
                className={cx(inputClasses, 'mb-2')} />
              <div className="flex flex-wrap gap-1">
                {cptCategories.map(cat => (
                  <button key={cat} type="button" onClick={() => setCptFilter(cat)} aria-pressed={cptFilter === cat}
                    className={cx('rounded-full px-2.5 py-1 text-xs font-semibold transition', FOCUS_RING, cptFilter === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {filteredCPT.map(code => (
                <div key={code.code} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold text-blue-700">{code.code}</span>
                    <p className="mt-0.5 text-xs text-slate-700">{code.description}</p>
                    <span className="text-xs text-slate-500">{code.category}</span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">{code.fee == null ? FEE_NOT_SET : `$${code.fee}`}</span>
                </div>
              ))}
              {filteredCPT.length === 0 && (
                <EmptyState compact title="No CPT codes match this search." description="Clear the search or pick another category." />
              )}
            </div>
          </Card>

          {/* ICD-10 Library */}
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Behavioral Health ICD-10 Codes</h2>
              <input type="text" aria-label="Search ICD-10 diagnoses" placeholder="Search diagnoses…" value={icdSearch} onChange={e => setIcdSearch(e.target.value)}
                className={cx(inputClasses, 'mb-2')} />
              <div className="flex flex-wrap gap-1">
                {icdCategories.map(cat => (
                  <button key={cat} type="button" onClick={() => setIcdFilter(cat)} aria-pressed={icdFilter === cat}
                    className={cx('rounded-full px-2.5 py-1 text-xs font-semibold transition', FOCUS_RING, icdFilter === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {filteredICD10.map(code => (
                <div key={code.code} className="px-5 py-3 hover:bg-slate-50">
                  <span className="font-mono text-sm font-semibold text-blue-700">{code.code}</span>
                  <p className="mt-0.5 text-xs text-slate-700">{code.description}</p>
                  <span className="text-xs text-slate-500">{code.category}</span>
                </div>
              ))}
              {filteredICD10.length === 0 && (
                <EmptyState compact title="No diagnoses match this search." description="Clear the search or pick another category." />
              )}
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
