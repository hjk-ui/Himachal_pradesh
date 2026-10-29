'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Zap,
  FileText,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  DollarSign,
  Phone,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Shield,
  Thermometer,
  Info,
  Users,
  ClipboardList,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { fetchClients, type Client } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { canWriteTmsSpravato } from '@/lib/ehr/tmsSpravato';
import { useOfflineDraft } from '@/lib/offline/useOfflineDraft';
import {
  TMS_CONTRAINDICATIONS,
  CADSS_ITEMS,
  MOAAS_LEVELS,
  ADT_HISTORY_FIELDS,
  TMS_PA_CHECKLIST,
  SPRAVATO_REMS_CHECKLIST,
  SPRAVATO_PA_CHECKLIST,
  TMS_BILLING,
  SPRAVATO_BILLING,
  PAYER_COVERAGE_NOTES,
  RESOURCES,
  QUICK_PHONES,
  SPRAVATO_PHASES,
  VITAL_TIMEPOINTS,
  SPO2_ALERT_THRESHOLD,
  emptyAdtTrials,
  emptyPaChecklist,
  parseBp,
  shouldWithholdDose,
  hasLowSpo2,
  gad7Severity,
  type AdtTrial,
} from '@/features/ehr/tmsSpravatoConstants';
import { PageHeader, buttonClasses, StatCard, Alert } from '@/components/ui';
import { TmsWorkflowHelp, TmsWorkflowPanel } from '@/components/tms/TmsWorkflowPanel';
import { TMS_ATTENDANCE, TMS_SCORE_INSTRUMENTS, TMS_SCORE_MILESTONES, courseTargetLabel, scoreInstrument, ybocsSeverity } from '@/lib/tms/workflow';

type Tab = 'tms' | 'spravato' | 'billing' | 'resources';
type TmsSubtab = 'screening' | 'sessions' | 'tracking';
type SpravatoSubtab = 'rems' | 'session' | 'tracking';

type TmsCourse = {
  id: string;
  clientId: string;
  clientName: string;
  /** Entered target; null = not entered */
  targetSessions: number | null;
  /** Entered, booked or authorized count (GET /api/tms/courses); null = "Not set" */
  courseTarget?: number | null;
  screeningJson: Record<string, boolean> | null;
  paChecklistJson: boolean[] | null;
  adtTrialsJson: AdtTrial[] | null;
  status: string;
  sessionCount: number;
  phq9Scores?: {
    id: string;
    milestone: string;
    instrument?: string;
    score: number;
    gad7Score?: number | null;
    recordedAt: string;
  }[];
};

type TmsSession = {
  id: string;
  courseId: string;
  sessionDate: string;
  durationMin: number | null;
  targetSite: string | null;
  frequencyHz: number | null;
  pulses: number | null;
  sideEffects: string | null;
  phq9: number | null;
  clinician: string | null;
  motorThresholdPct: number | null;
  notes: string | null;
};

type Phq9Score = {
  id: string;
  milestone: string;
  /** phq-9 | ybocs | ham-d | madrs (score only) */
  instrument?: string;
  score: number;
  gad7Score?: number | null;
  recordedAt: string;
};

type SpravatoEnrollment = {
  id: string;
  clientId: string;
  clientName: string;
  remsId: string | null;
  enrolledAt: string | null;
  phase: string;
  doseCount: number;
  remsChecklistJson: boolean[] | null;
  paChecklistJson: boolean[] | null;
  status: string;
  sessionCount: number;
  latestPhq9: number | null;
};

type SpravatoSession = {
  id: string;
  enrollmentId: string;
  sessionDate: string;
  doseMg: number | null;
  vitalsJson: Record<
    string,
    { bp?: string; sbp?: number; dbp?: number; hr?: number; spo2?: number }
  > | null;
  moaas: number | null;
  cadssItemsJson: number[] | null;
  cadssTotal: number | null;
  withheld: boolean;
  clinician: string | null;
  notes: string | null;
  otherSideEffects: string | null;
  phq9: number | null;
};

type VitalRow = { bp: string; spo2: string };
type VitalInputs = Record<string, VitalRow>;

const emptyVitalRow = (): VitalRow => ({ bp: '', spo2: '' });
const emptyVitalInputs = (): VitalInputs =>
  Object.fromEntries(VITAL_TIMEPOINTS.map((t) => [t.key, emptyVitalRow()]));

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <span className="text-blue-600">{icon}</span>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function responseLabel(baseline: number | null, current: number | null) {
  if (baseline == null || current == null || baseline <= 0) return 'Pre-treatment';
  if (current <= 4) return 'Remission';
  const pct = ((baseline - current) / baseline) * 100;
  if (pct >= 50) return 'Response';
  if (pct > 0) return 'Partial Response';
  return pct < 0 ? 'Worse than baseline' : 'Pre-treatment';
}

function phaseLabel(phase: string) {
  const found = SPRAVATO_PHASES.find((p) => p.id === phase);
  return found?.label ?? phase;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function TMSSpravatoPage() {
  const { user } = useAuth();
  const canWrite = canWriteTmsSpravato(
    (user?.role || 'THERAPIST') as import('@prisma/client').Role
  );
  const [tab, setTab] = useState<Tab>('tms');
  const [tmsSub, setTmsSub] = useState<TmsSubtab>('screening');
  const [sprSub, setSprSub] = useState<SpravatoSubtab>('rems');

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [courses, setCourses] = useState<TmsCourse[]>([]);
  const [enrollments, setEnrollments] = useState<SpravatoEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');

  const [contraChecks, setContraChecks] = useState<Record<string, boolean>>({});
  const [adtTrials, setAdtTrials] = useState<AdtTrial[]>(emptyAdtTrials());
  const [tmsPaChecks, setTmsPaChecks] = useState<boolean[]>(
    emptyPaChecklist(TMS_PA_CHECKLIST.length)
  );
  // Course length is never assumed: null = "Not set" until authorized / entered
  const [targetSessions, setTargetSessions] = useState<number | null>(null);

  const [tmsSessions, setTmsSessions] = useState<TmsSession[]>([]);
  const [phq9Scores, setPhq9Scores] = useState<Phq9Score[]>([]);
  // No protocol values are pre-filled: every parameter is what was delivered this session
  // (use "Copy last session" to carry the previous session's parameters forward).
  const [sessionForm, setSessionForm] = useState({
    sessionDate: todayIso(),
    durationMin: '',
    targetSite: '',
    frequencyHz: '',
    pulses: '',
    motorThresholdPct: '',
    sideEffects: '',
    phq9: '',
    clinician: '',
    attendance: 'attended',
    suicidalIdeation: false,
  });
  const [phq9Form, setPhq9Form] = useState({
    instrument: 'phq-9',
    milestone: 'baseline',
    score: '',
    gad7Score: '',
  });

  const [remsId, setRemsId] = useState('');
  const [phase, setPhase] = useState<'induction' | 'maint1' | 'maint2'>('induction');
  const [remsChecks, setRemsChecks] = useState<boolean[]>(
    emptyPaChecklist(SPRAVATO_REMS_CHECKLIST.length)
  );
  const [sprPaChecks, setSprPaChecks] = useState<boolean[]>(
    emptyPaChecklist(SPRAVATO_PA_CHECKLIST.length)
  );
  const [sprSessions, setSprSessions] = useState<SpravatoSession[]>([]);
  const [vitalInputs, setVitalInputs] = useState<VitalInputs>(emptyVitalInputs);
  // Observations start unscored (-1 / null) so an unobserved item is never saved as 0 or "alert".
  const [cadssScores, setCadssScores] = useState<number[]>([-1, -1, -1, -1, -1]);
  const [moaasScore, setMoaasScore] = useState<number | null>(null);
  const [sprSessionForm, setSprSessionForm] = useState({
    sessionDate: todayIso(),
    doseMg: '',
    clinician: '',
    notes: '',
    otherSideEffects: '',
    phq9: '',
  });
  const [expandedRes, setExpandedRes] = useState<string | null>('provider');

  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2800);
  };

  const { save: saveTmsSessionOffline } = useOfflineDraft({
    url: '/api/tms/sessions',
    onlinePost: async (body) => {
      const res = await fetch('/api/tms/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not add session');
      return json;
    },
  });

  const { save: saveSprSessionOffline } = useOfflineDraft({
    url: '/api/spravato/sessions',
    onlinePost: async (body) => {
      const res = await fetch('/api/spravato/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not add session');
      return json;
    },
  });

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const data = await fetchClients();
      setClients(data);
    } catch {
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }, [clientId]);

  const loadCourses = useCallback(async () => {
    const res = await fetch('/api/tms/courses');
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load courses');
    setCourses(json.courses as TmsCourse[]);
    return json.courses as TmsCourse[];
  }, []);

  const loadEnrollments = useCallback(async () => {
    const res = await fetch('/api/spravato/enrollments');
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load enrollments');
    setEnrollments(json.enrollments as SpravatoEnrollment[]);
    return json.enrollments as SpravatoEnrollment[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadClients();
        const [c, e] = await Promise.all([loadCourses(), loadEnrollments()]);
        if (cancelled) return;
        // ?clientId=&program= (Service Eligibility Scanner "Refer"): open that client's chart here.
        const preset = new URLSearchParams(window.location.search);
        const presetClient = preset.get('clientId');
        if (presetClient) {
          setClientId(presetClient);
          setCourseId(c.find((x) => x.clientId === presetClient)?.id || '');
          setEnrollmentId(e.find((x) => x.clientId === presetClient)?.id || '');
          if (preset.get('program') === 'spravato') setTab('spravato');
          else if (preset.get('program') === 'tms') setTab('tms');
        } else if (c.length && !courseId) {
          setCourseId(c[0].id);
          setClientId(c[0].clientId);
        }
        if (!presetClient && e.length && !enrollmentId) {
          setEnrollmentId(e[0].id);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCourse = useMemo(
    () => courses.find((c) => c.id === courseId) || courses.find((c) => c.clientId === clientId),
    [courses, courseId, clientId]
  );

  const activeEnrollment = useMemo(
    () =>
      enrollments.find((e) => e.id === enrollmentId) ||
      enrollments.find((e) => e.clientId === clientId),
    [enrollments, enrollmentId, clientId]
  );

  useEffect(() => {
    if (!activeCourse) {
      setContraChecks({});
      setAdtTrials(emptyAdtTrials());
      setTmsPaChecks(emptyPaChecklist(TMS_PA_CHECKLIST.length));
      setTargetSessions(null);
      setTmsSessions([]);
      setPhq9Scores([]);
      return;
    }
    setCourseId(activeCourse.id);
    setClientId(activeCourse.clientId);
    setContraChecks((activeCourse.screeningJson as Record<string, boolean>) || {});
    setAdtTrials(
      Array.isArray(activeCourse.adtTrialsJson) && activeCourse.adtTrialsJson.length
        ? activeCourse.adtTrialsJson
        : emptyAdtTrials()
    );
    setTmsPaChecks(
      Array.isArray(activeCourse.paChecklistJson) &&
        activeCourse.paChecklistJson.length === TMS_PA_CHECKLIST.length
        ? activeCourse.paChecklistJson
        : emptyPaChecklist(TMS_PA_CHECKLIST.length)
    );
    setTargetSessions(activeCourse.targetSessions ?? null);
    setPhq9Scores(activeCourse.phq9Scores || []);

    (async () => {
      const [sessRes, phqRes] = await Promise.all([
        fetch(`/api/tms/sessions?courseId=${activeCourse.id}`),
        fetch(`/api/tms/phq9?courseId=${activeCourse.id}`),
      ]);
      const sessJson = await sessRes.json();
      const phqJson = await phqRes.json();
      if (sessJson.success) setTmsSessions(sessJson.sessions);
      if (phqJson.success) setPhq9Scores(phqJson.scores);
    })();
  }, [activeCourse?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeEnrollment) {
      setRemsId('');
      setPhase('induction');
      setRemsChecks(emptyPaChecklist(SPRAVATO_REMS_CHECKLIST.length));
      setSprPaChecks(emptyPaChecklist(SPRAVATO_PA_CHECKLIST.length));
      setSprSessions([]);
      return;
    }
    setEnrollmentId(activeEnrollment.id);
    setRemsId(activeEnrollment.remsId || '');
    setPhase((activeEnrollment.phase as 'induction' | 'maint1' | 'maint2') || 'induction');
    setRemsChecks(
      Array.isArray(activeEnrollment.remsChecklistJson) &&
        activeEnrollment.remsChecklistJson.length === SPRAVATO_REMS_CHECKLIST.length
        ? activeEnrollment.remsChecklistJson
        : emptyPaChecklist(SPRAVATO_REMS_CHECKLIST.length)
    );
    setSprPaChecks(
      Array.isArray(activeEnrollment.paChecklistJson) &&
        activeEnrollment.paChecklistJson.length === SPRAVATO_PA_CHECKLIST.length
        ? activeEnrollment.paChecklistJson
        : emptyPaChecklist(SPRAVATO_PA_CHECKLIST.length)
    );

    (async () => {
      const res = await fetch(`/api/spravato/sessions?enrollmentId=${activeEnrollment.id}`);
      const json = await res.json();
      if (json.success) setSprSessions(json.sessions);
    })();
  }, [activeEnrollment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const absoluteHit = TMS_CONTRAINDICATIONS.filter((c) => c.absolute).some(
    (c) => contraChecks[c.id]
  );
  const relativeHit = TMS_CONTRAINDICATIONS.filter((c) => !c.absolute).some(
    (c) => contraChecks[c.id]
  );

  // PHQ-9 only (course scores also hold Y-BOCS / HAM-D / MADRS totals)
  const phqOnly = phq9Scores.filter((p) => (p.instrument ?? 'phq-9') === 'phq-9');
  const ybocsScores = phq9Scores.filter((p) => p.instrument === 'ybocs');
  const latestYbocs = ybocsScores.length ? ybocsScores[ybocsScores.length - 1].score : null;
  const baselinePhq =
    phqOnly.find((p) => p.milestone === 'baseline')?.score ??
    (phqOnly.length ? phqOnly[0].score : null);
  const currentPhq =
    phqOnly.length > 0 ? phqOnly[phqOnly.length - 1].score : null;
  const phq9Reduction =
    baselinePhq != null && currentPhq != null && baselinePhq > 0
      ? Math.round(((baselinePhq - currentPhq) / baselinePhq) * 100)
      : 0;

  const chartData = useMemo(() => {
    const order: string[] = [...TMS_SCORE_MILESTONES];
    return [...phq9Scores.filter((p) => (p.instrument ?? 'phq-9') === 'phq-9')]
      .sort((a, b) => order.indexOf(a.milestone) - order.indexOf(b.milestone))
      .map((p) => ({
        point: p.milestone === 'baseline' ? 'Baseline' : `Ses. ${p.milestone}`,
        score: p.score,
        session: p.milestone === 'baseline' ? 0 : Number(p.milestone) || 0,
      }));
  }, [phq9Scores]);

  const vitalsForCheck = useMemo(() => {
    const out: Record<string, { bp: string; sbp?: number; dbp?: number; spo2?: number }> = {};
    for (const [k, row] of Object.entries(vitalInputs)) {
      const parsed = parseBp(row.bp);
      const spo2Raw = row.spo2.trim();
      const spo2 = spo2Raw !== '' && !Number.isNaN(Number(spo2Raw)) ? Number(spo2Raw) : undefined;
      out[k] = { bp: row.bp, ...(parsed || {}), ...(spo2 != null ? { spo2 } : {}) };
    }
    return out;
  }, [vitalInputs]);
  const withholdNow = shouldWithholdDose(vitalsForCheck);
  const lowSpo2Now = hasLowSpo2(vitalsForCheck);
  const gad7Preview =
    phq9Form.gad7Score !== '' && !Number.isNaN(Number(phq9Form.gad7Score))
      ? gad7Severity(Number(phq9Form.gad7Score))
      : null;
  const cadssComplete = cadssScores.every((x) => x >= 0);
  const totalCadss = cadssScores.reduce((a, b) => a + Math.max(0, b), 0);
  const enrolled = remsChecks.slice(3, 5).every(Boolean) || !!remsId;

  async function ensureCourse(): Promise<string | null> {
    if (activeCourse) return activeCourse.id;
    if (!clientId) {
      setError('Select a patient first');
      return null;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tms/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          targetSessions,
          screeningJson: contraChecks,
          paChecklistJson: tmsPaChecks,
          adtTrialsJson: adtTrials,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not create course');
      await loadCourses();
      setCourseId(json.course.id);
      notify('TMS course created');
      return json.course.id as string;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveTmsScreening() {
    const id = await ensureCourse();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tms/courses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSessions,
          screeningJson: contraChecks,
          paChecklistJson: tmsPaChecks,
          adtTrialsJson: adtTrials,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');
      await loadCourses();
      notify('Screening & ADT saved to Altrixs');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addTmsSession() {
    const id = await ensureCourse();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        courseId: id,
        sessionDate: sessionForm.sessionDate,
        durationMin: sessionForm.durationMin ? Number(sessionForm.durationMin) : null,
        targetSite: sessionForm.targetSite || null,
        frequencyHz: sessionForm.frequencyHz ? Number(sessionForm.frequencyHz) : null,
        pulses: sessionForm.pulses ? Number(sessionForm.pulses) : null,
        motorThresholdPct: sessionForm.motorThresholdPct ? Number(sessionForm.motorThresholdPct) : null,
        sideEffects: sessionForm.sideEffects || null,
        phq9: sessionForm.phq9 !== '' ? Number(sessionForm.phq9) : null,
        clinician: sessionForm.clinician || null,
        attendance: sessionForm.attendance || null,
        suicidalIdeation: sessionForm.suicidalIdeation,
      };
      const json = (await saveTmsSessionOffline(payload, 'other')) as {
        success?: boolean;
        offline?: boolean;
        flags?: { si: boolean; worsening: boolean };
      };
      if (json.offline) {
        notify('Session saved offline — will sync when back online');
        return;
      }
      const list = await fetch(`/api/tms/sessions?courseId=${id}`);
      const listJson = await list.json();
      if (listJson.success) setTmsSessions(listJson.sessions);
      await loadCourses();
      setSessionForm((p) => ({ ...p, sideEffects: '', phq9: '', attendance: 'attended', suicidalIdeation: false }));
      notify(
        json.flags?.si || json.flags?.worsening
          ? `Session logged. ${json.flags.si ? 'Suicidal ideation' : 'PHQ-9 worsening'} flagged to the prescriber (Alerts).`
          : 'Session logged'
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTmsSession(id: string) {
    if (!confirm('Delete this TMS session?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tms/sessions/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed');
      setTmsSessions((prev) => prev.filter((s) => s.id !== id));
      await loadCourses();
      notify('Session deleted');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addPhq9() {
    const id = await ensureCourse();
    if (!id || phq9Form.score === '') return;
    setSaving(true);
    try {
      const res = await fetch('/api/tms/phq9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: id,
          instrument: phq9Form.instrument,
          milestone: phq9Form.milestone,
          score: Number(phq9Form.score),
          gad7Score: phq9Form.instrument === 'phq-9' && phq9Form.gad7Score !== '' ? Number(phq9Form.gad7Score) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save the score');
      const list = await fetch(`/api/tms/phq9?courseId=${id}`);
      const listJson = await list.json();
      if (listJson.success) setPhq9Scores(listJson.scores);
      setPhq9Form((p) => ({ ...p, score: '', gad7Score: '' }));
      notify(`${scoreInstrument(phq9Form.instrument)?.label ?? 'Score'} recorded` + (phq9Form.instrument === 'phq-9' && phq9Form.gad7Score !== '' ? ' (+ GAD-7)' : ''));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function ensureEnrollment(): Promise<string | null> {
    if (activeEnrollment) return activeEnrollment.id;
    if (!clientId) {
      setError('Select a patient first');
      return null;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/spravato/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          remsId: remsId || null,
          enrolledAt: enrolled ? new Date().toISOString() : null,
          phase,
          remsChecklistJson: remsChecks,
          paChecklistJson: sprPaChecks,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not create enrollment');
      await loadEnrollments();
      setEnrollmentId(json.enrollment.id);
      notify('Spravato enrollment created');
      return json.enrollment.id as string;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveEnrollment() {
    const id = await ensureEnrollment();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/spravato/enrollments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remsId: remsId || null,
          enrolledAt: enrolled ? new Date().toISOString() : null,
          phase,
          remsChecklistJson: remsChecks,
          paChecklistJson: sprPaChecks,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');
      await loadEnrollments();
      notify('Enrollment saved to Altrixs');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addSpravatoSession() {
    if (moaasScore == null || !cadssComplete) {
      setError('Score the MOAA/S and all five CADSS items before saving the session.');
      return;
    }
    const id = await ensureEnrollment();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const vitalsJson: Record<
        string,
        { bp: string; sbp?: number; dbp?: number; spo2?: number }
      > = {};
      for (const [k, row] of Object.entries(vitalInputs)) {
        if (!row.bp.trim() && !row.spo2.trim()) continue;
        const parsed = parseBp(row.bp);
        const spo2Raw = row.spo2.trim();
        const spo2 =
          spo2Raw !== '' && !Number.isNaN(Number(spo2Raw)) ? Number(spo2Raw) : undefined;
        vitalsJson[k] = {
          bp: row.bp,
          ...(parsed || {}),
          ...(spo2 != null ? { spo2 } : {}),
        };
      }
      const payload = {
          enrollmentId: id,
          sessionDate: sprSessionForm.sessionDate,
          doseMg: sprSessionForm.doseMg ? Number(sprSessionForm.doseMg) : null,
          vitalsJson,
          moaas: moaasScore,
          cadssItemsJson: cadssScores,
          cadssTotal: totalCadss,
          withheld: withholdNow,
          clinician: sprSessionForm.clinician || null,
          notes: sprSessionForm.notes || null,
          otherSideEffects: sprSessionForm.otherSideEffects || null,
          phq9: sprSessionForm.phq9 !== '' ? Number(sprSessionForm.phq9) : null,
      };
      const json = (await saveSprSessionOffline(payload, 'other')) as {
        success?: boolean;
        offline?: boolean;
      };
      if (json.offline) {
        notify('Spravato session saved offline — will sync when back online');
        return;
      }
      const list = await fetch(`/api/spravato/sessions?enrollmentId=${id}`);
      const listJson = await list.json();
      if (listJson.success) setSprSessions(listJson.sessions);
      await loadEnrollments();
      setVitalInputs(emptyVitalInputs());
      setMoaasScore(null);
      setCadssScores([-1, -1, -1, -1, -1]);
      setSprSessionForm((p) => ({ ...p, otherSideEffects: '', notes: '', phq9: '' }));
      notify(withholdNow ? 'Session saved — dose WITHHELD' : 'Spravato session saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function selectClientForTms(id: string) {
    setClientId(id);
    const existing = courses.find((c) => c.clientId === id && c.status !== 'archived');
    setCourseId(existing?.id || '');
  }

  function selectClientForSpr(id: string) {
    setClientId(id);
    const existing = enrollments.find((e) => e.clientId === id && e.status !== 'archived');
    setEnrollmentId(existing?.id || '');
  }

  const lastTmsSession = useMemo(
    () =>
      [...tmsSessions].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))[0] ?? null,
    [tmsSessions]
  );
  const latestMotorThreshold =
    [...tmsSessions]
      .filter((x) => x.motorThresholdPct != null)
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))[0]?.motorThresholdPct ?? null;
  const activeTmsCourses = courses.filter((c) => c.status === 'active').length;
  const activeSprEnrollments = enrollments.filter((e) => e.status === 'active').length;
  const sessionCount = activeCourse?.sessionCount ?? tmsSessions.length;
  const target: number | null = activeCourse?.courseTarget ?? activeCourse?.targetSessions ?? targetSessions ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>TMS & Spravato Program</>}
        description={<>Transcranial Magnetic Stimulation · Esketamine (Spravato REMS) · Treatment-Resistant Depression</>}
        actions={<>
          <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            <Shield size={13} />
            Spravato REMS certification required before first dose
          </div>
          <div className="flex gap-3 text-xs">
            <a href="/dashboard/ehr/scanner?program=tms" className="font-medium text-blue-700 hover:underline">
              TMS candidates (Service Eligibility Scanner)
            </a>
            <a href="/dashboard/ehr/scanner?program=spravato" className="font-medium text-blue-700 hover:underline">
              Spravato candidates
            </a>
          </div>
        </div>
        </>}
      />

      {!loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Active TMS courses', value: activeTmsCourses },
            { label: 'TMS courses on file', value: courses.length },
            { label: 'Active Spravato enrollments', value: activeSprEnrollments },
            { label: 'Spravato enrollments on file', value: enrollments.length },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xl font-semibold text-slate-900">{t.value}</p>
              <p className="text-xs text-slate-500">{t.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-bold">FDA REMS Requirement — Spravato (esketamine):</span> Must be
          administered in a certified healthcare setting only. Patients must be observed for at least{' '}
          <strong>2 hours</strong> after each dose. Cannot be dispensed for home use. Your facility
          must be enrolled at{' '}
          <span className="rounded bg-rose-100 px-1 font-mono text-xs">spravatorems.com</span> before
          ordering.
        </div>
      </div>

      {flash && (
        <Alert tone="success">
          {flash}
        </Alert>
      )}
      {error && (
        <Alert tone="danger">
          {error}
        </Alert>
      )}
      {!canWrite && (
        <Alert tone="warning">
          Therapist view is read-only. Session and enrollment writes require psychiatrist, NP,
          practice director, or admin.
        </Alert>
      )}
      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Loading Altrixs clinical data…
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            { key: 'tms' as const, label: 'TMS', icon: <Zap size={14} /> },
            { key: 'spravato' as const, label: 'Spravato', icon: <Brain size={14} /> },
            { key: 'billing' as const, label: 'Billing & PA', icon: <DollarSign size={14} /> },
            { key: 'resources' as const, label: 'Resources', icon: <BookOpen size={14} /> },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-blue-600 bg-blue-50/40 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════ TMS TAB ══════════════════════ */}
      {tab === 'tms' && (
        <div className="space-y-5">
          <TmsWorkflowHelp />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Patient</label>
            <select
              value={clientId}
              onChange={(e) => selectClientForTms(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
              disabled={clientsLoading}
            >
              <option value="">
                {clientsLoading ? 'Loading clients…' : clients.length ? 'Select patient' : 'No clients'}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {courses.some((x) => x.clientId === c.id) ? ' · TMS course' : ''}
                </option>
              ))}
            </select>
            {clientId && !activeCourse && (
              <button
                type="button"
                onClick={() => void ensureCourse()}
                disabled={saving || !canWrite}
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                <Plus size={13} /> Start TMS course
              </button>
            )}
          </div>

          {!clientId && !clientsLoading && (
            <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-5 py-8 text-center text-sm text-slate-500">
              Select a patient from your caseload to begin TMS screening and session logging.
            </div>
          )}

          {clientId && !activeCourse && (
            <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-5 py-6 text-center text-sm text-slate-500">
              No TMS course on file for this patient. Start a course to record screening, sessions and PHQ-9.
            </div>
          )}

          {clientId && activeCourse && (
            <>
              <TmsWorkflowPanel courseId={activeCourse.id} clientId={activeCourse.clientId} canWrite={canWrite} onScheduled={() => void loadCourses()} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  {
                    label: 'Sessions logged / target',
                    value: target ? `${sessionCount} / ${target}` : `${sessionCount} / Not set`,
                  },
                  {
                    label: 'Motor threshold (latest)',
                    value: latestMotorThreshold != null ? `${latestMotorThreshold}%` : 'Not recorded',
                  },
                  { label: 'PHQ-9 Baseline', value: baselinePhq ?? '—' },
                  { label: 'PHQ-9 Current', value: currentPhq ?? '—' },
                  {
                    label: 'Change from baseline',
                    value: baselinePhq != null && phqOnly.length > 1 ? `${phq9Reduction}% reduction` : latestYbocs != null ? `Y-BOCS ${latestYbocs} (${ybocsSeverity(latestYbocs)})` : '—',
                  },
                ].map((s) => (
                  <StatCard key={s.label} label={s.label} value={s.value} />
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">Treatment Course Progress</p>
                  <span className="text-xs text-slate-500">
                    {target ? `${sessionCount} of ${target} sessions` : `${sessionCount} sessions · target ${courseTargetLabel(null)}`}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-3 rounded-full bg-blue-600 transition-all"
                    style={{ width: target ? `${Math.min(100, (sessionCount / Math.max(1, target)) * 100)}%` : '0%' }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>Session 1</span>
                  <span className="font-medium text-blue-600">
                    {responseLabel(baselinePhq, currentPhq)}
                  </span>
                  <span>{target ? `Session ${target}` : 'Target not set'}</span>
                </div>
              </div>

              <div className="flex gap-2 border-b border-slate-100 pb-0">
                {(
                  [
                    { key: 'screening' as const, label: 'Contraindication Screening' },
                    { key: 'sessions' as const, label: 'Session Log' },
                    { key: 'tracking' as const, label: 'PHQ-9 Tracking' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setTmsSub(s.key)}
                    className={`rounded-t-lg border-b-2 px-4 py-2 text-xs font-medium transition-colors ${
                      tmsSub === s.key
                        ? 'border-blue-500 text-blue-700'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {tmsSub === 'screening' && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <SectionCard
                    title="Contraindication Screening Checklist"
                    icon={<ClipboardList size={15} />}
                  >
                    <p className="mb-3 text-xs text-slate-500">
                      Check ALL that apply. Any absolute contraindication = TMS is not indicated.
                      Relative contraindications require physician review.
                    </p>
                    <div className="space-y-2">
                      {TMS_CONTRAINDICATIONS.map((c) => (
                        <label
                          key={c.id}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5 transition-colors ${
                            contraChecks[c.id]
                              ? c.absolute
                                ? 'border border-rose-200 bg-rose-50'
                                : 'border border-amber-200 bg-amber-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!contraChecks[c.id]}
                            onChange={(e) =>
                              setContraChecks((p) => ({ ...p, [c.id]: e.target.checked }))
                            }
                            className="mt-0.5 shrink-0 accent-rose-600"
                          />
                          <div>
                            <span className="text-xs text-slate-700">{c.label}</span>
                            <span
                              className={`ml-2 text-xs font-semibold ${
                                c.absolute ? 'text-rose-600' : 'text-amber-700'
                              }`}
                            >
                              {c.absolute ? 'Absolute' : 'Relative'}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                    {(absoluteHit || relativeHit) && (
                      <div
                        className={`mt-3 rounded-xl p-3 text-xs font-medium ${
                          absoluteHit
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {absoluteHit
                          ? 'ABSOLUTE CONTRAINDICATION IDENTIFIED — TMS is not indicated. Consult with attending physician.'
                          : 'Relative contraindication(s) identified — physician review and informed consent documentation required before proceeding.'}
                      </div>
                    )}
                  </SectionCard>

                  <div className="space-y-4">
                    <SectionCard
                      title="Antidepressant Treatment History (Prior Auth)"
                      icon={<FileText size={15} />}
                    >
                      <p className="mb-3 text-xs text-slate-500">
                        Document ≥ 2 adequate antidepressant trials (4+ weeks at therapeutic dose)
                        in the current episode. Most payers require 2–4 failed trials.
                      </p>
                      <div className="space-y-3">
                        {ADT_HISTORY_FIELDS.map((f, idx) => (
                          <div key={f.id} className="space-y-2 rounded-xl border border-slate-100 p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-700">{f.label}</span>
                              {f.required && (
                                <span className="text-xs font-medium text-rose-600">Required</span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                placeholder="Medication name"
                                value={adtTrials[idx]?.medication || ''}
                                onChange={(e) => {
                                  const next = [...adtTrials];
                                  next[idx] = { ...next[idx], medication: e.target.value };
                                  setAdtTrials(next);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                              />
                              <input
                                type="text"
                                placeholder="Dose (e.g. 150 mg)"
                                value={adtTrials[idx]?.dose || ''}
                                onChange={(e) => {
                                  const next = [...adtTrials];
                                  next[idx] = { ...next[idx], dose: e.target.value };
                                  setAdtTrials(next);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                              />
                              <input
                                type="text"
                                placeholder="Duration (e.g. 8 weeks)"
                                value={adtTrials[idx]?.duration || ''}
                                onChange={(e) => {
                                  const next = [...adtTrials];
                                  next[idx] = { ...next[idx], duration: e.target.value };
                                  setAdtTrials(next);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                              />
                              <select
                                value={adtTrials[idx]?.reasonStopped || ''}
                                onChange={(e) => {
                                  const next = [...adtTrials];
                                  next[idx] = { ...next[idx], reasonStopped: e.target.value };
                                  setAdtTrials(next);
                                }}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                              >
                                <option value="">Reason stopped</option>
                                <option>Inadequate response</option>
                                <option>Intolerable side effects</option>
                                <option>Allergy / hypersensitivity</option>
                                <option>Patient preference</option>
                                <option>Drug interaction</option>
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </SectionCard>

                    <SectionCard title="Prior Auth Checklist — TMS" icon={<CheckCircle2 size={15} />}>
                      <ul className="space-y-1.5">
                        {TMS_PA_CHECKLIST.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={!!tmsPaChecks[i]}
                              onChange={(e) => {
                                const next = [...tmsPaChecks];
                                next[i] = e.target.checked;
                                setTmsPaChecks(next);
                              }}
                              className="mt-0.5 accent-blue-600"
                            />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 flex items-center gap-3">
                        <label className="text-xs text-slate-600" htmlFor="tms-target-sessions">Target sessions (authorized / ordered)</label>
                        <input
                          id="tms-target-sessions"
                          type="number"
                          min={1}
                          max={200}
                          placeholder="Not set"
                          value={targetSessions ?? ''}
                          onChange={(e) => setTargetSessions(Number(e.target.value) > 0 ? Math.floor(Number(e.target.value)) : null)}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void saveTmsScreening()}
                          disabled={saving || !canWrite}
                          className={buttonClasses({ variant: 'primary', size: 'sm', className: 'ml-auto' })}
                        >
                          <Save size={13} /> Save screening
                        </button>
                      </div>
                    </SectionCard>
                  </div>
                </div>
              )}

              {tmsSub === 'sessions' && (
                <SectionCard title="Session Documentation Log" icon={<Activity size={15} />}>
                  {lastTmsSession && (
                    <button
                      type="button"
                      onClick={() =>
                        setSessionForm((p) => ({
                          ...p,
                          durationMin: lastTmsSession.durationMin != null ? String(lastTmsSession.durationMin) : '',
                          targetSite: lastTmsSession.targetSite ?? '',
                          frequencyHz: lastTmsSession.frequencyHz != null ? String(lastTmsSession.frequencyHz) : '',
                          pulses: lastTmsSession.pulses != null ? String(lastTmsSession.pulses) : '',
                        }))
                      }
                      className="mb-2 text-xs font-medium text-blue-700 hover:underline"
                    >
                      Copy parameters from last session ({lastTmsSession.sessionDate.slice(0, 10)})
                    </button>
                  )}
                  <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-9">
                    <input
                      type="date"
                      value={sessionForm.sessionDate}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, sessionDate: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Duration (min)"
                      value={sessionForm.durationMin}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, durationMin: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Target site"
                      value={sessionForm.targetSite}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, targetSite: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Hz"
                      value={sessionForm.frequencyHz}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, frequencyHz: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Pulses"
                      value={sessionForm.pulses}
                      onChange={(e) => setSessionForm((p) => ({ ...p, pulses: e.target.value }))}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Motor threshold %"
                      title="Resting motor threshold (% machine output) when determined or re-checked this session"
                      value={sessionForm.motorThresholdPct}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, motorThresholdPct: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="PHQ-9"
                      value={sessionForm.phq9}
                      onChange={(e) => setSessionForm((p) => ({ ...p, phq9: e.target.value }))}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Clinician"
                      value={sessionForm.clinician}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, clinician: e.target.value }))
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void addTmsSession()}
                      disabled={saving || !canWrite}
                      className={buttonClasses({ variant: 'primary', size: 'sm', className: 'justify-center' })}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                  <input
                    placeholder="Side effects"
                    value={sessionForm.sideEffects}
                    onChange={(e) =>
                      setSessionForm((p) => ({ ...p, sideEffects: e.target.value }))
                    }
                    className="mb-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-700">
                    <label className="flex items-center gap-1.5">
                      Attendance
                      <select
                        aria-label="Attendance"
                        value={sessionForm.attendance}
                        onChange={(e) => setSessionForm((p) => ({ ...p, attendance: e.target.value }))}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        {TMS_ATTENDANCE.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-rose-600"
                        checked={sessionForm.suicidalIdeation}
                        onChange={(e) => setSessionForm((p) => ({ ...p, suicidalIdeation: e.target.checked }))}
                      />
                      New or worsening suicidal ideation (flags the prescriber)
                    </label>
                  </div>
                  {tmsSessions.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">
                      No sessions logged yet for this course.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-100">
                            {[
                              '#',
                              'Date',
                              'Duration',
                              'Target',
                              'Hz',
                              'Pulses',
                              'MT %',
                              'PHQ-9',
                              'Side Effects',
                              'Clinician',
                              '',
                            ].map((h) => (
                              <th
                                key={h}
                                className="whitespace-nowrap px-2 py-2 text-left font-semibold text-slate-500"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...tmsSessions]
                            .sort(
                              (a, b) =>
                                new Date(a.sessionDate).getTime() -
                                new Date(b.sessionDate).getTime()
                            )
                            .map((s, idx) => (
                              <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-2 py-2 font-bold text-blue-700">#{idx + 1}</td>
                                <td className="whitespace-nowrap px-2 py-2">
                                  {s.sessionDate.slice(0, 10)}
                                </td>
                                <td className="px-2 py-2">
                                  {s.durationMin != null ? `${s.durationMin} min` : '—'}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2">
                                  {s.targetSite || '—'}
                                </td>
                                <td className="px-2 py-2">
                                  {s.frequencyHz != null ? `${s.frequencyHz} Hz` : '—'}
                                </td>
                                <td className="px-2 py-2">
                                  {s.pulses != null ? s.pulses.toLocaleString() : '—'}
                                </td>
                                <td className="px-2 py-2">
                                  {s.motorThresholdPct != null ? `${s.motorThresholdPct}%` : '—'}
                                </td>
                                <td className="px-2 py-2">
                                  {s.phq9 != null ? (
                                    <span className="font-bold text-emerald-700">{s.phq9}</span>
                                  ) : (
                                    <span className="text-slate-500">—</span>
                                  )}
                                </td>
                                <td className="px-2 py-2">{s.sideEffects || '—'}</td>
                                <td className="whitespace-nowrap px-2 py-2">
                                  {s.clinician || '—'}
                                </td>
                                <td className="px-2 py-2">
                                  <button
                                    type="button"
                                    onClick={() => void deleteTmsSession(s.id)}
                                    className="text-rose-600 hover:text-rose-700"
                                    title="Delete"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500">
                    PHQ-9 at baseline, weekly or at milestones, and at the end of the course (MDD); Y-BOCS total (score only) weekly for OCD; HAM-D or MADRS total optional at baseline.
                  </p>
                </SectionCard>
              )}

              {tmsSub === 'tracking' && (
                <SectionCard title="PHQ-9 Response Trajectory" icon={<Activity size={15} />}>
                  <div className="mb-4 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="tms-score-instrument">Measure (score only)</label>
                      <select
                        id="tms-score-instrument"
                        value={phq9Form.instrument}
                        onChange={(e) =>
                          setPhq9Form((p) => ({
                            ...p,
                            instrument: e.target.value,
                            milestone: scoreInstrument(e.target.value)?.baselineOnly ? 'baseline' : p.milestone,
                            gad7Score: e.target.value === 'phq-9' ? p.gad7Score : '',
                          }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        {TMS_SCORE_INSTRUMENTS.map((i) => (
                          <option key={i.value} value={i.value}>
                            {i.label} (0–{i.max}){i.baselineOnly ? ', baseline' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Milestone</label>
                      <select
                        value={phq9Form.milestone}
                        onChange={(e) =>
                          setPhq9Form((p) => ({ ...p, milestone: e.target.value }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        {TMS_SCORE_MILESTONES.filter((m) => !scoreInstrument(phq9Form.instrument)?.baselineOnly || m === 'baseline').map((m) => (
                          <option key={m} value={m}>
                            {m === 'end' ? 'end of course' : m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">
                        {scoreInstrument(phq9Form.instrument)?.label ?? 'PHQ-9'} (0–{scoreInstrument(phq9Form.instrument)?.max ?? 27})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={scoreInstrument(phq9Form.instrument)?.max ?? 27}
                        value={phq9Form.score}
                        onChange={(e) => setPhq9Form((p) => ({ ...p, score: e.target.value }))}
                        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    {phq9Form.instrument === 'phq-9' && (<div>
                      <label className="mb-1 block text-xs text-slate-500">GAD-7 optional (0–21)</label>
                      <input
                        type="number"
                        min={0}
                        max={21}
                        value={phq9Form.gad7Score}
                        onChange={(e) =>
                          setPhq9Form((p) => ({ ...p, gad7Score: e.target.value }))
                        }
                        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        placeholder="—"
                      />
                    </div>)}
                    <button
                      type="button"
                      onClick={() => void addPhq9()}
                      disabled={saving || phq9Form.score === ''}
                      className={buttonClasses({ variant: 'primary', size: 'sm' })}
                    >
                      <Plus size={12} /> Record score
                    </button>
                  </div>
                  {phq9Form.instrument !== 'phq-9' && (
                    <p className="mb-3 text-xs text-slate-600">
                      Score only: give the {scoreInstrument(phq9Form.instrument)?.label} from the clinic&apos;s licensed form and enter the total here. No items are stored.
                      {phq9Form.instrument === 'ybocs' && phq9Form.score !== '' ? ` Severity: ${ybocsSeverity(Number(phq9Form.score))}. Bands: 0–7 subclinical · 8–15 mild · 16–23 moderate · 24–31 severe · 32–40 extreme. A rise of 5 or more points is flagged to the prescriber.` : ''}
                    </p>
                  )}

                  {gad7Preview && (
                    <div
                      className={`mb-4 rounded-xl border p-3 text-xs ${
                        Number(phq9Form.gad7Score) >= 10
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <p className="font-semibold">
                        GAD-7 {phq9Form.gad7Score}/21 — {gad7Preview.label}
                      </p>
                      <p className="mt-1">{gad7Preview.cutoffNote}</p>
                      <p className="mt-1">
                        Cutoffs: 0–4 minimal · 5–9 mild · 10–14 moderate · 15–21 severe (clinical
                        screen ≥10).{' '}
                        <a
                          href={`/dashboard/ehr/assessments${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`}
                          className="font-semibold text-blue-700 underline"
                        >
                          Open Assessments
                        </a>{' '}
                        for the full instrument.
                      </p>
                    </div>
                  )}

                  {phq9Scores.some((p) => p.gad7Score != null) && (
                    <div className="mb-4 overflow-x-auto rounded-xl border border-slate-100">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-semibold">Milestone</th>
                            <th scope="col" className="px-3 py-2 font-semibold">Score</th>
                            <th scope="col" className="px-3 py-2 font-semibold">GAD-7</th>
                            <th scope="col" className="px-3 py-2 font-semibold">Recorded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {phq9Scores.map((p) => (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="px-3 py-2">{p.milestone}</td>
                              <td className="px-3 py-2 font-semibold text-blue-700">
                                {(p.instrument ?? 'phq-9') === 'phq-9' ? 'PHQ-9' : scoreInstrument(p.instrument)?.label ?? p.instrument} {p.score}
                                {p.instrument === 'ybocs' ? ` (${ybocsSeverity(p.score)})` : ''}
                              </td>
                              <td className="px-3 py-2">
                                {p.gad7Score != null ? (
                                  <span
                                    className={
                                      p.gad7Score >= 10
                                        ? 'font-semibold text-amber-700'
                                        : 'text-slate-700'
                                    }
                                  >
                                    {p.gad7Score} ({gad7Severity(p.gad7Score).label})
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-500">
                                {p.recordedAt.slice(0, 10)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {chartData.length === 0 ? (
                    <p className="py-10 text-center text-sm text-slate-500">
                      No PHQ-9 scores yet — record baseline to start the trajectory chart.
                    </p>
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis dataKey="point" tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 27]} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <ReferenceLine
                            y={4}
                            stroke="#059669"
                            strokeDasharray="4 4"
                            label={{ value: 'Remission ≤4', fontSize: 10, fill: '#059669' }}
                          />
                          <Line
                            type="monotone"
                            dataKey="score"
                            stroke="#5C2D91"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#7C3AED' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    <p>
                      <span className="font-semibold">Response:</span> ≥50% reduction in PHQ-9 from
                      baseline
                    </p>
                    <p>
                      <span className="font-semibold">Remission:</span> PHQ-9 ≤ 4
                    </p>
                    <p>
                      <span className="font-semibold">Current:</span> {phq9Reduction}% reduction —{' '}
                      {responseLabel(baselinePhq, currentPhq)}
                    </p>
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════ SPRAVATO TAB ══════════════════════ */}
      {tab === 'spravato' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Patient</label>
            <select
              value={clientId}
              onChange={(e) => selectClientForSpr(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
            >
              <option value="">Select patient</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {enrollments.some((x) => x.clientId === c.id) ? ' · Enrolled' : ''}
                </option>
              ))}
            </select>
            {clientId && !activeEnrollment && (
              <button
                type="button"
                onClick={() => void ensureEnrollment()}
                disabled={saving || !canWrite}
                className={buttonClasses({ variant: 'primary', size: 'sm' })}
              >
                <Plus size={13} /> Start enrollment
              </button>
            )}
          </div>

          {!clientId && (
            <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-5 py-8 text-center text-sm text-slate-500">
              Select a patient to manage Spravato REMS enrollment and session monitoring.
            </div>
          )}

          {clientId && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  {
                    label: 'Phase',
                    value: phaseLabel(activeEnrollment?.phase || phase),
                  },
                  {
                    label: 'Doses given (sessions not withheld)',
                    value: activeEnrollment?.doseCount ?? 0,
                  },
                  {
                    label: 'Sessions Logged',
                    value: activeEnrollment?.sessionCount ?? sprSessions.length,
                  },
                  {
                    label: 'Latest PHQ-9',
                    value: activeEnrollment?.latestPhq9 ?? '—',
                  },
                ].map((s) => (
                  <StatCard key={s.label} label={s.label} value={s.value} />
                ))}
              </div>

              <div className="flex gap-2 border-b border-slate-100">
                {(
                  [
                    { key: 'rems' as const, label: 'REMS & Enrollment' },
                    { key: 'session' as const, label: 'Session Monitoring' },
                    { key: 'tracking' as const, label: 'PHQ-9 + PA Checklist' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSprSub(s.key)}
                    className={`rounded-t-lg border-b-2 px-4 py-2 text-xs font-medium transition-colors ${
                      sprSub === s.key
                        ? 'border-blue-500 text-blue-700'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {sprSub === 'rems' && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <SectionCard title="REMS Enrollment Status" icon={<Shield size={15} />}>
                    <div className="space-y-3">
                      <div
                        className={`flex items-center gap-3 rounded-xl p-3 ${
                          enrolled
                            ? 'border border-emerald-200 bg-emerald-50'
                            : 'border border-rose-200 bg-rose-50'
                        }`}
                      >
                        {enrolled ? (
                          <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />
                        ) : (
                          <AlertTriangle size={16} className="shrink-0 text-rose-600" />
                        )}
                        <div>
                          <p
                            className={`text-sm font-semibold ${
                              enrolled ? 'text-emerald-800' : 'text-rose-800'
                            }`}
                          >
                            {enrolled
                              ? 'REMS Enrolled'
                              : 'NOT ENROLLED — Cannot Receive Spravato'}
                          </p>
                          {remsId && (
                            <p className="text-xs text-slate-500">REMS ID: {remsId}</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          REMS ID
                        </label>
                        <input
                          value={remsId}
                          onChange={(e) => setRemsId(e.target.value)}
                          placeholder="e.g. REMS-12345"
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Phase
                        </label>
                        <select
                          value={phase}
                          onChange={(e) =>
                            setPhase(e.target.value as 'induction' | 'maint1' | 'maint2')
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                        >
                          {SPRAVATO_PHASES.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2 text-xs">
                        <p className="font-semibold text-slate-700">REMS Enrollment Checklist:</p>
                        {SPRAVATO_REMS_CHECKLIST.map((text, i) => (
                          <label
                            key={i}
                            className={`flex cursor-pointer items-center gap-2 ${
                              remsChecks[i] ? 'text-slate-700' : 'text-rose-600'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={!!remsChecks[i]}
                              onChange={(e) => {
                                const next = [...remsChecks];
                                next[i] = e.target.checked;
                                setRemsChecks(next);
                              }}
                              className="accent-blue-600"
                            />
                            {text}
                          </label>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => void saveEnrollment()}
                        disabled={saving || !canWrite}
                        className={buttonClasses({ variant: 'primary', size: 'sm' })}
                      >
                        <Save size={13} /> Save enrollment
                      </button>
                    </div>
                  </SectionCard>

                  <SectionCard title="Spravato Treatment Schedule" icon={<Clock size={15} />}>
                    <div className="space-y-3 text-xs">
                      {SPRAVATO_PHASES.map((p) => {
                        const highlight = phase === p.id;
                        return (
                          <div
                            key={p.id}
                            className={`rounded-xl border p-3 ${
                              highlight
                                ? 'border-blue-300 bg-blue-50'
                                : 'border-slate-100 bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <p
                                className={`font-semibold ${
                                  highlight ? 'text-blue-700' : 'text-slate-700'
                                }`}
                              >
                                {p.label}
                              </p>
                              {highlight && (
                                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
                                  Current
                                </span>
                              )}
                            </div>
                            <p className="text-slate-500">
                              {p.weeks} · {p.freq}
                            </p>
                            <p className="text-slate-500">{p.dose}</p>
                          </div>
                        );
                      })}
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                        <p className="font-semibold">
                          Each dose: 2-hour post-administration observation required.
                        </p>
                        <p className="mt-1">
                          Vital signs at 0, 40 min, 1 hr, 1.5 hr, 2 hr. Document on session form.
                        </p>
                      </div>
                    </div>
                  </SectionCard>
                </div>
              )}

              {sprSub === 'session' && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <SectionCard title="Vital Signs Monitoring Log" icon={<Thermometer size={15} />}>
                    <p className="mb-3 text-xs text-slate-500">
                      Record BP + SpO₂ at each required time point (0 / 40 / 60 / 90 / 120 min; keep
                      minute 14). Diastolic &gt; 110 or SBP &gt; 180 = withhold dose. SpO₂ &lt;{' '}
                      {SPO2_ALERT_THRESHOLD}% = alert.
                    </p>
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={sprSessionForm.sessionDate}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, sessionDate: e.target.value }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="Dose mg (56 or 84)"
                        value={sprSessionForm.doseMg}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, doseMg: e.target.value }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="Clinician"
                        value={sprSessionForm.clinician}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, clinician: e.target.value }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="PHQ-9 (optional)"
                        value={sprSessionForm.phq9}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, phq9: e.target.value }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="mb-2 grid grid-cols-[9rem_1fr_4.5rem] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <span>Timepoint</span>
                      <span>BP (sys/dia)</span>
                      <span>SpO₂ %</span>
                    </div>
                    <div className="space-y-3">
                      {VITAL_TIMEPOINTS.map((t) => {
                        const row = vitalInputs[t.key] || emptyVitalRow();
                        const spo2Num =
                          row.spo2.trim() !== '' && !Number.isNaN(Number(row.spo2))
                            ? Number(row.spo2)
                            : null;
                        const spo2Low = spo2Num != null && spo2Num < SPO2_ALERT_THRESHOLD;
                        return (
                          <div key={t.key} className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-2">
                            <label className="text-xs text-slate-600">{t.label}</label>
                            <input
                              type="text"
                              placeholder="e.g. 122/78"
                              value={row.bp}
                              onChange={(e) =>
                                setVitalInputs((p) => ({
                                  ...p,
                                  [t.key]: { ...(p[t.key] || emptyVitalRow()), bp: e.target.value },
                                }))
                              }
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                            />
                            <input
                              type="number"
                              min={70}
                              max={100}
                              placeholder="%"
                              value={row.spo2}
                              onChange={(e) =>
                                setVitalInputs((p) => ({
                                  ...p,
                                  [t.key]: {
                                    ...(p[t.key] || emptyVitalRow()),
                                    spo2: e.target.value,
                                  },
                                }))
                              }
                              className={`rounded-lg border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 ${
                                spo2Low
                                  ? 'border-rose-400 bg-rose-50 text-rose-800 focus:ring-rose-300'
                                  : 'border-slate-200 focus:ring-blue-300'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {withholdNow && (
                      <div className="mt-3 rounded-xl border border-rose-300 bg-rose-100 p-3 text-xs font-bold text-rose-800">
                        WITHHOLD DOSE — SBP &gt; 180 or DBP &gt; 110 detected. Notify prescriber.
                      </div>
                    )}
                    {lowSpo2Now && (
                      <div className="mt-3 rounded-xl border border-rose-300 bg-rose-100 p-3 text-xs font-bold text-rose-800">
                        SpO₂ ALERT — reading below {SPO2_ALERT_THRESHOLD}%. Notify clinician /
                        continue O₂ monitoring per protocol.
                      </div>
                    )}

                    <div className="mt-4">
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Other side effects
                      </label>
                      <textarea
                        placeholder="Nausea, dissociation, sedation, other observations…"
                        value={sprSessionForm.otherSideEffects}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({
                            ...p,
                            otherSideEffects: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        rows={2}
                      />
                    </div>

                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <p className="mb-2 text-xs font-semibold text-slate-700">
                        MOAA/S Sedation Score (at discharge)
                      </p>
                      <div className="space-y-1.5">
                        {MOAAS_LEVELS.map((m) => (
                          <label
                            key={m.score}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg p-2 transition-colors ${
                              moaasScore === m.score
                                ? 'border border-blue-200 bg-blue-50'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="moaas"
                              checked={moaasScore === m.score}
                              onChange={() => setMoaasScore(m.score)}
                              className="accent-blue-600"
                            />
                            <span
                              className={`w-4 text-xs font-bold ${
                                m.score >= 4
                                  ? 'text-emerald-700'
                                  : m.score >= 2
                                    ? 'text-amber-700'
                                    : 'text-rose-600'
                              }`}
                            >
                              {m.score}
                            </span>
                            <span className="text-xs text-slate-700">{m.label}</span>
                          </label>
                        ))}
                      </div>
                      {moaasScore != null && moaasScore < 4 && (
                        <Alert tone="danger" className="mt-2">
                          Patient is not ready for discharge. Continue monitoring until MOAA/S = 4
                          or 5.
                        </Alert>
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard title="CADSS — Dissociation Scale" icon={<Brain size={15} />}>
                    <p className="mb-3 text-xs text-slate-500">
                      Clinician-Administered Dissociative States Scale (CADSS). Score each item 0–4
                      (0 = not at all, 4 = extremely). Administered at 40 min post-dose.
                    </p>
                    <div className="space-y-4">
                      {CADSS_ITEMS.map((item, i) => (
                        <div key={i}>
                          <p className="mb-1.5 text-xs text-slate-700">
                            <span className="mr-1 font-semibold text-slate-500">{i + 1}.</span>
                            {item}
                          </p>
                          <div className="flex gap-2">
                            {[0, 1, 2, 3, 4].map((score) => (
                              <button
                                key={score}
                                type="button"
                                onClick={() =>
                                  setCadssScores((p) => {
                                    const n = [...p];
                                    n[i] = score;
                                    return n;
                                  })
                                }
                                className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all ${
                                  cadssScores[i] === score
                                    ? 'border-blue-500 bg-blue-600 text-white'
                                    : 'border-slate-200 text-slate-600 hover:border-blue-300'
                                }`}
                              >
                                {score}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div
                      className={`mt-4 rounded-xl border p-3 text-center text-xs font-semibold ${
                        !cadssComplete
                          ? 'border-slate-200 bg-slate-50 text-slate-600'
                          : totalCadss >= 15
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : totalCadss >= 8
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {!cadssComplete
                        ? `CADSS: ${cadssScores.filter((x) => x >= 0).length} of 5 items scored`
                        : null}
                      {cadssComplete && <>CADSS Total: {totalCadss} / 20 —{' '}</>}
                      {!cadssComplete ? null : totalCadss >= 15
                        ? 'Severe dissociation — notify prescriber'
                        : totalCadss >= 8
                          ? 'Moderate dissociation — monitor closely'
                          : 'Mild / None'}
                    </div>
                    <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-800">
                      <p className="mb-1 font-semibold">
                        C-SSRS (Columbia) also required at each Spravato session.
                      </p>
                      <p>
                        Run the C-SSRS from the{' '}
                        <a
                          href={`/dashboard/ehr/assessments${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`}
                          className="font-bold underline"
                        >
                          Assessments module
                        </a>{' '}
                        and attach it to this encounter.
                      </p>
                    </div>
                    <textarea
                      placeholder="Session notes"
                      value={sprSessionForm.notes}
                      onChange={(e) =>
                        setSprSessionForm((p) => ({ ...p, notes: e.target.value }))
                      }
                      className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                      rows={2}
                    />
                    <button
                      type="button"
                      onClick={() => void addSpravatoSession()}
                      disabled={saving || !canWrite}
                      className={buttonClasses({ variant: 'primary', size: 'sm', className: 'mt-3' })}
                    >
                      <Save size={13} /> Save session
                    </button>

                    {sprSessions.length === 0 && activeEnrollment && (
                      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                        No Spravato sessions recorded for this enrollment yet.
                      </p>
                    )}
                    {sprSessions.length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                        <p className="text-xs font-semibold text-slate-700">Recent sessions</p>
                        {sprSessions.slice(0, 5).map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                          >
                            <span>{s.sessionDate.slice(0, 10)}</span>
                            <span>{s.doseMg != null ? `${s.doseMg} mg` : 'dose —'}</span>
                            <span title="Blood pressure pre-dose / 120 min">
                              BP {s.vitalsJson?.['0']?.bp || '—'} / {s.vitalsJson?.['120']?.bp || '—'}
                            </span>
                            <span>MOAA/S {s.moaas ?? '—'}</span>
                            <span>CADSS {s.cadssTotal ?? '—'}</span>
                            <span className={s.vitalsJson?.['120'] ? 'text-emerald-700' : 'text-amber-700'}>
                              {s.vitalsJson?.['120'] ? '2h obs documented' : '2h obs not documented'}
                            </span>
                            <span
                              className={
                                s.withheld ? 'font-semibold text-rose-600' : 'text-emerald-700'
                              }
                            >
                              {s.withheld ? 'WITHHELD' : 'Given'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>
              )}

              {sprSub === 'tracking' && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <SectionCard title="PHQ-9 Tracking Over Treatment" icon={<Activity size={15} />}>
                    {sprSessions.filter((s) => s.phq9 != null).length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">
                        Record PHQ-9 on session saves to build the Spravato trajectory.
                      </p>
                    ) : (
                      <div className="h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={[...sprSessions]
                              .filter((s) => s.phq9 != null)
                              .reverse()
                              .map((s) => ({
                                point: s.sessionDate.slice(0, 10),
                                score: s.phq9 as number,
                              }))}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                            <XAxis dataKey="point" tick={{ fontSize: 10 }} />
                            <YAxis domain={[0, 27]} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Line
                              type="monotone"
                              dataKey="score"
                              stroke="#5C2D91"
                              strokeWidth={2.5}
                              dot={{ r: 4, fill: '#7C3AED' }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Prior Authorization Checklist — Spravato"
                    icon={<CheckCircle2 size={15} />}
                  >
                    <ul className="space-y-2">
                      {SPRAVATO_PA_CHECKLIST.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={!!sprPaChecks[i]}
                            onChange={(e) => {
                              const next = [...sprPaChecks];
                              next[i] = e.target.checked;
                              setSprPaChecks(next);
                            }}
                            className="mt-0.5 accent-blue-600"
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => void saveEnrollment()}
                      disabled={saving || !canWrite}
                      className={buttonClasses({ variant: 'primary', size: 'sm', className: 'mt-4' })}
                    >
                      <Save size={13} /> Save PA checklist
                    </button>
                    <div className="mt-4 rounded-xl bg-blue-50 p-3 text-xs text-blue-800">
                      <p className="font-semibold">Janssen CarePath Support:</p>
                      <p className="mt-1">
                        Call <strong>1-844-757-2826</strong> for prior auth reimbursement navigation
                        support, copay assistance setup, and specialty pharmacy connection.
                      </p>
                    </div>
                  </SectionCard>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════ BILLING TAB ══════════════════════ */}
      {tab === 'billing' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard title="TMS CPT Codes" icon={<DollarSign size={15} />}>
              <div className="space-y-3">
                {TMS_BILLING.map((b) => (
                  <div key={b.cpt} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-blue-700">{b.cpt}</span>
                      <span className="shrink-0 text-xs text-slate-500">{b.unit}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{b.desc}</p>
                    <p className="mt-1 text-xs italic text-amber-700">{b.note}</p>
                  </div>
                ))}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-semibold">Documentation required per session (90868):</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    <li>Target location and coil placement</li>
                    <li>Stimulation parameters (Hz, pulse count, intensity % MT)</li>
                    <li>Motor threshold if re-determined</li>
                    <li>Adverse effects and clinical response note</li>
                    <li>PHQ-9 score (weekly / at milestones through the end of the course); Y-BOCS total for OCD</li>
                  </ul>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Spravato / Esketamine Codes" icon={<DollarSign size={15} />}>
              <div className="space-y-3">
                {SPRAVATO_BILLING.map((b) => (
                  <div key={b.cpt} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-blue-700">{b.cpt}</span>
                      <span className="shrink-0 text-xs text-slate-500">{b.unit}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{b.desc}</p>
                    <p className="mt-1 text-xs italic text-amber-700">{b.note}</p>
                  </div>
                ))}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <p className="font-semibold">Spravato billing tip — J0718:</p>
                  <p className="mt-1">
                    56 mg dose = bill 56 units of J0718. 84 mg dose = 84 units. Bill on CMS-1500
                    with place of service 11 (office) or 22 (outpatient). Attach REMS patient
                    enrollment confirmation to claim.
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Payer Coverage Notes — MD / DC / VA" icon={<Info size={15} />}>
            <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {PAYER_COVERAGE_NOTES.map((p) => (
                <div key={p.payer} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="mb-1.5 font-semibold text-slate-800">{p.payer}</p>
                  <p className="text-slate-600">
                    <span className="font-medium text-blue-700">TMS:</span> {p.tms}
                  </p>
                  <p className="mt-1 text-slate-600">
                    <span className="font-medium text-sky-700">Spravato:</span> {p.spravato}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══════════════════════ RESOURCES TAB ══════════════════════ */}
      {tab === 'resources' && (
        <div className="space-y-4">
          {(
            [
              {
                key: 'provider',
                label: 'For Providers / Clinicians',
                icon: <Users size={15} />,
                items: RESOURCES.provider,
              },
              {
                key: 'biller',
                label: 'For Billers / Revenue Cycle',
                icon: <DollarSign size={15} />,
                items: RESOURCES.biller,
              },
              {
                key: 'client',
                label: 'For Clients / Patients',
                icon: <Activity size={15} />,
                items: RESOURCES.client,
              },
              {
                key: 'clinic',
                label: 'For Clinic Administration',
                icon: <Shield size={15} />,
                items: RESOURCES.clinic,
              },
            ] as const
          ).map((section) => (
            <div
              key={section.key}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedRes(expandedRes === section.key ? null : section.key)
                }
                className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <span className="text-blue-600">{section.icon}</span>
                  {section.label}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {section.items.length} resources
                  </span>
                </div>
                {expandedRes === section.key ? (
                  <ChevronDown size={16} className="text-slate-500" />
                ) : (
                  <ChevronRight size={16} className="text-slate-500" />
                )}
              </button>

              {expandedRes === section.key && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {section.items.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{r.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{r.desc}</p>
                        <p className="mt-1 text-xs font-medium text-blue-600">{r.org}</p>
                      </div>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClasses({ variant: 'primary', size: 'sm', className: 'shrink-0' })}
                      >
                        <ExternalLink size={11} /> Open
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
              <Phone size={15} className="text-blue-600" />
              Key Phone Numbers — Quick Reference
            </h3>
            <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {QUICK_PHONES.map((p) => (
                <div key={p.org} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-800">{p.org}</p>
                  <p className="mt-0.5 text-base font-bold text-blue-700">{p.number}</p>
                  <p className="mt-1 leading-snug text-slate-500">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
