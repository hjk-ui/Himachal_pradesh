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
  CTA_GRADIENT,
  SPO2_ALERT_THRESHOLD,
  emptyAdtTrials,
  emptyPaChecklist,
  parseBp,
  shouldWithholdDose,
  hasLowSpo2,
  gad7Severity,
  type AdtTrial,
} from '@/features/ehr/tmsSpravatoConstants';

type Tab = 'tms' | 'spravato' | 'billing' | 'resources';
type TmsSubtab = 'screening' | 'sessions' | 'tracking';
type SpravatoSubtab = 'rems' | 'session' | 'tracking';

type TmsCourse = {
  id: string;
  clientId: string;
  clientName: string;
  targetSessions: number;
  screeningJson: Record<string, boolean> | null;
  paChecklistJson: boolean[] | null;
  adtTrialsJson: AdtTrial[] | null;
  status: string;
  sessionCount: number;
  phq9Scores?: {
    id: string;
    milestone: string;
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
  notes: string | null;
};

type Phq9Score = {
  id: string;
  milestone: string;
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
    <div className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
        <span className="text-purple-600">{icon}</span>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
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
  return 'Pre-treatment';
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
  const [targetSessions, setTargetSessions] = useState(36);

  const [tmsSessions, setTmsSessions] = useState<TmsSession[]>([]);
  const [phq9Scores, setPhq9Scores] = useState<Phq9Score[]>([]);
  const [sessionForm, setSessionForm] = useState({
    sessionDate: todayIso(),
    durationMin: '37',
    targetSite: 'Left DLPFC',
    frequencyHz: '10',
    pulses: '3000',
    sideEffects: '',
    phq9: '',
    clinician: '',
  });
  const [phq9Form, setPhq9Form] = useState({
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
  const [cadssScores, setCadssScores] = useState<number[]>([0, 0, 0, 0, 0]);
  const [moaasScore, setMoaasScore] = useState(5);
  const [sprSessionForm, setSprSessionForm] = useState({
    sessionDate: todayIso(),
    doseMg: '56',
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
      if (!clientId && data.length) setClientId(data[0].id);
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
        if (c.length && !courseId) {
          setCourseId(c[0].id);
          setClientId(c[0].clientId);
        }
        if (e.length && !enrollmentId) {
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
      setTargetSessions(36);
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
    setTargetSessions(activeCourse.targetSessions || 36);
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

  const baselinePhq =
    phq9Scores.find((p) => p.milestone === 'baseline')?.score ??
    (phq9Scores.length ? phq9Scores[0].score : null);
  const currentPhq =
    phq9Scores.length > 0 ? phq9Scores[phq9Scores.length - 1].score : null;
  const phq9Reduction =
    baselinePhq != null && currentPhq != null && baselinePhq > 0
      ? Math.round(((baselinePhq - currentPhq) / baselinePhq) * 100)
      : 0;

  const chartData = useMemo(() => {
    const order = ['baseline', '10', '15', '20', '25', '36', 'custom'];
    return [...phq9Scores]
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
  const totalCadss = cadssScores.reduce((a, b) => a + b, 0);
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
        sideEffects: sessionForm.sideEffects || null,
        phq9: sessionForm.phq9 !== '' ? Number(sessionForm.phq9) : null,
        clinician: sessionForm.clinician || null,
      };
      const json = (await saveTmsSessionOffline(payload, 'other')) as {
        success?: boolean;
        offline?: boolean;
      };
      if (json.offline) {
        notify('Session saved offline — will sync when back online');
        return;
      }
      const list = await fetch(`/api/tms/sessions?courseId=${id}`);
      const listJson = await list.json();
      if (listJson.success) setTmsSessions(listJson.sessions);
      await loadCourses();
      notify('Session logged');
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
          milestone: phq9Form.milestone,
          score: Number(phq9Form.score),
          gad7Score: phq9Form.gad7Score !== '' ? Number(phq9Form.gad7Score) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save PHQ-9');
      const list = await fetch(`/api/tms/phq9?courseId=${id}`);
      const listJson = await list.json();
      if (listJson.success) setPhq9Scores(listJson.scores);
      setPhq9Form((p) => ({ ...p, score: '', gad7Score: '' }));
      notify('PHQ-9 recorded' + (phq9Form.gad7Score !== '' ? ' (+ GAD-7)' : ''));
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

  const sessionCount = activeCourse?.sessionCount ?? tmsSessions.length;
  const target = activeCourse?.targetSessions ?? targetSessions;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-600">Altrixs</p>
          <h1 className="text-2xl font-bold text-gray-900">TMS & Spravato Program</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Transcranial Magnetic Stimulation · Esketamine (Spravato REMS) · Treatment-Resistant
            Depression
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700">
          <Shield size={13} />
          Spravato REMS certification required before first dose
        </div>
      </div>

      <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-bold">FDA REMS Requirement — Spravato (esketamine):</span> Must be
          administered in a certified healthcare setting only. Patients must be observed for at least{' '}
          <strong>2 hours</strong> after each dose. Cannot be dispensed for home use. Your facility
          must be enrolled at{' '}
          <span className="rounded bg-red-100 px-1 font-mono text-xs">spravatorems.com</span> before
          ordering.
        </div>
      </div>

      {flash && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {flash}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {!canWrite && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Therapist view is read-only. Session and enrollment writes require psychiatrist, NP,
          practice director, or admin.
        </div>
      )}
      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Loading Altrixs clinical data…
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
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
                ? 'border-purple-600 bg-purple-50/40 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">Patient</label>
            <select
              value={clientId}
              onChange={(e) => selectClientForTms(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-300"
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
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                style={{ background: CTA_GRADIENT }}
              >
                <Plus size={13} /> Start TMS course
              </button>
            )}
          </div>

          {!clientId && !clientsLoading && (
            <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50/40 px-5 py-8 text-center text-sm text-slate-500">
              Select a patient from your caseload to begin TMS screening and session logging.
            </div>
          )}

          {clientId && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  {
                    label: 'Sessions Completed',
                    value: `${sessionCount} / ${target}`,
                    color: '#5C2D91',
                  },
                  { label: 'PHQ-9 Baseline', value: baselinePhq ?? '—', color: '#DC2626' },
                  { label: 'PHQ-9 Current', value: currentPhq ?? '—', color: '#059669' },
                  {
                    label: 'Response',
                    value: baselinePhq != null ? `${phq9Reduction}% reduction` : '—',
                    color: phq9Reduction >= 50 ? '#059669' : '#D97706',
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm"
                  >
                    <p className="text-2xl font-extrabold" style={{ color: s.color }}>
                      {s.value}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">Treatment Course Progress</p>
                  <span className="text-xs text-gray-400">
                    {sessionCount} of {target} sessions
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-3 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (sessionCount / Math.max(1, target)) * 100)}%`,
                      background: CTA_GRADIENT,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-400">
                  <span>Session 1</span>
                  <span className="font-medium text-purple-600">
                    {responseLabel(baselinePhq, currentPhq)}
                  </span>
                  <span>Session {target}</span>
                </div>
              </div>

              <div className="flex gap-2 border-b border-gray-100 pb-0">
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
                        ? 'border-purple-500 text-purple-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
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
                    <p className="mb-3 text-xs text-gray-500">
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
                                ? 'border border-red-200 bg-red-50'
                                : 'border border-amber-200 bg-amber-50'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!contraChecks[c.id]}
                            onChange={(e) =>
                              setContraChecks((p) => ({ ...p, [c.id]: e.target.checked }))
                            }
                            className="mt-0.5 shrink-0 accent-red-600"
                          />
                          <div>
                            <span className="text-xs text-gray-700">{c.label}</span>
                            <span
                              className={`ml-2 text-xs font-semibold ${
                                c.absolute ? 'text-red-600' : 'text-amber-600'
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
                            ? 'bg-red-100 text-red-800'
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
                      <p className="mb-3 text-xs text-gray-500">
                        Document ≥ 2 adequate antidepressant trials (4+ weeks at therapeutic dose)
                        in the current episode. Most payers require 2–4 failed trials.
                      </p>
                      <div className="space-y-3">
                        {ADT_HISTORY_FIELDS.map((f, idx) => (
                          <div key={f.id} className="space-y-2 rounded-xl border border-gray-100 p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-gray-700">{f.label}</span>
                              {f.required && (
                                <span className="text-xs font-medium text-red-500">Required</span>
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
                                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
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
                                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
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
                                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
                              />
                              <select
                                value={adtTrials[idx]?.reasonStopped || ''}
                                onChange={(e) => {
                                  const next = [...adtTrials];
                                  next[idx] = { ...next[idx], reasonStopped: e.target.value };
                                  setAdtTrials(next);
                                }}
                                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
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
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={!!tmsPaChecks[i]}
                              onChange={(e) => {
                                const next = [...tmsPaChecks];
                                next[i] = e.target.checked;
                                setTmsPaChecks(next);
                              }}
                              className="mt-0.5 accent-purple-600"
                            />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 flex items-center gap-3">
                        <label className="text-xs text-gray-600">Target sessions</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={targetSessions}
                          onChange={(e) => setTargetSessions(Number(e.target.value) || 36)}
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void saveTmsScreening()}
                          disabled={saving || !canWrite}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                          style={{ background: CTA_GRADIENT }}
                        >
                          <Save size={13} /> Save to API
                        </button>
                      </div>
                    </SectionCard>
                  </div>
                </div>
              )}

              {tmsSub === 'sessions' && (
                <SectionCard title="Session Documentation Log" icon={<Activity size={15} />}>
                  <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
                    <input
                      type="date"
                      value={sessionForm.sessionDate}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, sessionDate: e.target.value }))
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Duration (min)"
                      value={sessionForm.durationMin}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, durationMin: e.target.value }))
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Target site"
                      value={sessionForm.targetSite}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, targetSite: e.target.value }))
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Hz"
                      value={sessionForm.frequencyHz}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, frequencyHz: e.target.value }))
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Pulses"
                      value={sessionForm.pulses}
                      onChange={(e) => setSessionForm((p) => ({ ...p, pulses: e.target.value }))}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="PHQ-9"
                      value={sessionForm.phq9}
                      onChange={(e) => setSessionForm((p) => ({ ...p, phq9: e.target.value }))}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Clinician"
                      value={sessionForm.clinician}
                      onChange={(e) =>
                        setSessionForm((p) => ({ ...p, clinician: e.target.value }))
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void addTmsSession()}
                      disabled={saving || !canWrite}
                      className="inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                      style={{ background: CTA_GRADIENT }}
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
                    className="mb-4 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                  />
                  {tmsSessions.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">
                      No sessions logged yet for this course.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100">
                            {[
                              '#',
                              'Date',
                              'Duration',
                              'Target',
                              'Hz',
                              'Pulses',
                              'PHQ-9',
                              'Side Effects',
                              'Clinician',
                              '',
                            ].map((h) => (
                              <th
                                key={h}
                                className="whitespace-nowrap px-2 py-2 text-left font-semibold text-gray-500"
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
                              <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                                <td className="px-2 py-2 font-bold text-purple-700">#{idx + 1}</td>
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
                                  {s.phq9 != null ? (
                                    <span className="font-bold text-green-700">{s.phq9}</span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
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
                                    className="text-red-500 hover:text-red-700"
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
                  <p className="mt-3 text-xs text-gray-400">
                    PHQ-9 assessed at baseline, session 10, 15, 20, 25, and 36 (end of course).
                  </p>
                </SectionCard>
              )}

              {tmsSub === 'tracking' && (
                <SectionCard title="PHQ-9 Response Trajectory" icon={<Activity size={15} />}>
                  <div className="mb-4 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Milestone</label>
                      <select
                        value={phq9Form.milestone}
                        onChange={(e) =>
                          setPhq9Form((p) => ({ ...p, milestone: e.target.value }))
                        }
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      >
                        {['baseline', '10', '15', '20', '25', '36', 'custom'].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">PHQ-9 (0–27)</label>
                      <input
                        type="number"
                        min={0}
                        max={27}
                        value={phq9Form.score}
                        onChange={(e) => setPhq9Form((p) => ({ ...p, score: e.target.value }))}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">GAD-7 optional (0–21)</label>
                      <input
                        type="number"
                        min={0}
                        max={21}
                        value={phq9Form.gad7Score}
                        onChange={(e) =>
                          setPhq9Form((p) => ({ ...p, gad7Score: e.target.value }))
                        }
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        placeholder="—"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void addPhq9()}
                      disabled={saving || phq9Form.score === ''}
                      className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                      style={{ background: CTA_GRADIENT }}
                    >
                      <Plus size={12} /> Record PHQ-9
                    </button>
                  </div>

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
                          className="font-semibold text-purple-700 underline"
                        >
                          Open Assessments
                        </a>{' '}
                        for the full instrument.
                      </p>
                    </div>
                  )}

                  {phq9Scores.some((p) => p.gad7Score != null) && (
                    <div className="mb-4 overflow-x-auto rounded-xl border border-gray-100">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Milestone</th>
                            <th className="px-3 py-2 font-semibold">PHQ-9</th>
                            <th className="px-3 py-2 font-semibold">GAD-7</th>
                            <th className="px-3 py-2 font-semibold">Recorded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {phq9Scores.map((p) => (
                            <tr key={p.id} className="border-t border-gray-100">
                              <td className="px-3 py-2">{p.milestone}</td>
                              <td className="px-3 py-2 font-semibold text-purple-700">{p.score}</td>
                              <td className="px-3 py-2">
                                {p.gad7Score != null ? (
                                  <span
                                    className={
                                      p.gad7Score >= 10
                                        ? 'font-semibold text-amber-700'
                                        : 'text-gray-700'
                                    }
                                  >
                                    {p.gad7Score} ({gad7Severity(p.gad7Score).label})
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-500">
                                {p.recordedAt.slice(0, 10)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {chartData.length === 0 ? (
                    <p className="py-10 text-center text-sm text-slate-400">
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
                  <div className="mt-4 space-y-1 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
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
            <label className="text-xs font-semibold text-gray-600">Patient</label>
            <select
              value={clientId}
              onChange={(e) => selectClientForSpr(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-300"
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
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                style={{ background: CTA_GRADIENT }}
              >
                <Plus size={13} /> Start enrollment
              </button>
            )}
          </div>

          {!clientId && (
            <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50/40 px-5 py-8 text-center text-sm text-slate-500">
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
                    color: '#5C2D91',
                  },
                  {
                    label: 'Doses (Total)',
                    value: activeEnrollment?.doseCount ?? 0,
                    color: '#00897B',
                  },
                  {
                    label: 'Sessions logged',
                    value: activeEnrollment?.sessionCount ?? sprSessions.length,
                    color: '#DC2626',
                  },
                  {
                    label: 'Latest PHQ-9',
                    value: activeEnrollment?.latestPhq9 ?? '—',
                    color: '#059669',
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm"
                  >
                    <p className="text-2xl font-extrabold" style={{ color: s.color }}>
                      {s.value}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 border-b border-gray-100">
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
                        ? 'border-purple-500 text-purple-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
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
                            ? 'border border-green-200 bg-green-50'
                            : 'border border-red-200 bg-red-50'
                        }`}
                      >
                        {enrolled ? (
                          <CheckCircle2 size={16} className="shrink-0 text-green-600" />
                        ) : (
                          <AlertTriangle size={16} className="shrink-0 text-red-600" />
                        )}
                        <div>
                          <p
                            className={`text-sm font-semibold ${
                              enrolled ? 'text-green-800' : 'text-red-800'
                            }`}
                          >
                            {enrolled
                              ? 'REMS Enrolled'
                              : 'NOT ENROLLED — Cannot Receive Spravato'}
                          </p>
                          {remsId && (
                            <p className="text-xs text-gray-500">REMS ID: {remsId}</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">
                          REMS ID
                        </label>
                        <input
                          value={remsId}
                          onChange={(e) => setRemsId(e.target.value)}
                          placeholder="e.g. REMS-12345"
                          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">
                          Phase
                        </label>
                        <select
                          value={phase}
                          onChange={(e) =>
                            setPhase(e.target.value as 'induction' | 'maint1' | 'maint2')
                          }
                          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                        >
                          {SPRAVATO_PHASES.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2 text-xs">
                        <p className="font-semibold text-gray-700">REMS Enrollment Checklist:</p>
                        {SPRAVATO_REMS_CHECKLIST.map((text, i) => (
                          <label
                            key={i}
                            className={`flex cursor-pointer items-center gap-2 ${
                              remsChecks[i] ? 'text-gray-700' : 'text-red-600'
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
                              className="accent-purple-600"
                            />
                            {text}
                          </label>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => void saveEnrollment()}
                        disabled={saving || !canWrite}
                        className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                        style={{ background: CTA_GRADIENT }}
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
                                ? 'border-purple-300 bg-purple-50'
                                : 'border-gray-100 bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <p
                                className={`font-semibold ${
                                  highlight ? 'text-purple-700' : 'text-gray-700'
                                }`}
                              >
                                {p.label}
                              </p>
                              {highlight && (
                                <span className="rounded-full bg-purple-600 px-2 py-0.5 text-xs text-white">
                                  Current
                                </span>
                              )}
                            </div>
                            <p className="text-gray-500">
                              {p.weeks} · {p.freq}
                            </p>
                            <p className="text-gray-500">{p.dose}</p>
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
                    <p className="mb-3 text-xs text-gray-500">
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
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="Dose mg (56 or 84)"
                        value={sprSessionForm.doseMg}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, doseMg: e.target.value }))
                        }
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="Clinician"
                        value={sprSessionForm.clinician}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, clinician: e.target.value }))
                        }
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        placeholder="PHQ-9 (optional)"
                        value={sprSessionForm.phq9}
                        onChange={(e) =>
                          setSprSessionForm((p) => ({ ...p, phq9: e.target.value }))
                        }
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="mb-2 grid grid-cols-[9rem_1fr_4.5rem] gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
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
                            <label className="text-xs text-gray-600">{t.label}</label>
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
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
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
                                  ? 'border-red-400 bg-red-50 text-red-800 focus:ring-red-300'
                                  : 'border-gray-200 focus:ring-purple-300'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {withholdNow && (
                      <div className="mt-3 rounded-xl border border-red-300 bg-red-100 p-3 text-xs font-bold text-red-800">
                        WITHHOLD DOSE — SBP &gt; 180 or DBP &gt; 110 detected. Notify prescriber.
                      </div>
                    )}
                    {lowSpo2Now && (
                      <div className="mt-3 rounded-xl border border-red-300 bg-red-100 p-3 text-xs font-bold text-red-800">
                        SpO₂ ALERT — reading below {SPO2_ALERT_THRESHOLD}%. Notify clinician /
                        continue O₂ monitoring per protocol.
                      </div>
                    )}

                    <div className="mt-4">
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                        rows={2}
                      />
                    </div>

                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <p className="mb-2 text-xs font-semibold text-gray-700">
                        MOAA/S Sedation Score (at discharge)
                      </p>
                      <div className="space-y-1.5">
                        {MOAAS_LEVELS.map((m) => (
                          <label
                            key={m.score}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg p-2 transition-colors ${
                              moaasScore === m.score
                                ? 'border border-purple-200 bg-purple-50'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="moaas"
                              checked={moaasScore === m.score}
                              onChange={() => setMoaasScore(m.score)}
                              className="accent-purple-600"
                            />
                            <span
                              className={`w-4 text-xs font-bold ${
                                m.score >= 4
                                  ? 'text-green-600'
                                  : m.score >= 2
                                    ? 'text-amber-600'
                                    : 'text-red-600'
                              }`}
                            >
                              {m.score}
                            </span>
                            <span className="text-xs text-gray-700">{m.label}</span>
                          </label>
                        ))}
                      </div>
                      {moaasScore < 4 && (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-700">
                          Patient is not ready for discharge. Continue monitoring until MOAA/S = 4
                          or 5.
                        </div>
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard title="CADSS — Dissociation Scale" icon={<Brain size={15} />}>
                    <p className="mb-3 text-xs text-gray-500">
                      Clinician-Administered Dissociative States Scale (CADSS). Score each item 0–4
                      (0 = not at all, 4 = extremely). Administered at 40 min post-dose.
                    </p>
                    <div className="space-y-4">
                      {CADSS_ITEMS.map((item, i) => (
                        <div key={i}>
                          <p className="mb-1.5 text-xs text-gray-700">
                            <span className="mr-1 font-semibold text-gray-500">{i + 1}.</span>
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
                                    ? 'border-purple-500 bg-purple-600 text-white'
                                    : 'border-gray-200 text-gray-600 hover:border-purple-300'
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
                        totalCadss >= 15
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : totalCadss >= 8
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-green-200 bg-green-50 text-green-700'
                      }`}
                    >
                      CADSS Total: {totalCadss} / 20 —{' '}
                      {totalCadss >= 15
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
                        and attach to this encounter — do not fake-embed here.
                      </p>
                    </div>
                    <textarea
                      placeholder="Session notes"
                      value={sprSessionForm.notes}
                      onChange={(e) =>
                        setSprSessionForm((p) => ({ ...p, notes: e.target.value }))
                      }
                      className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                      rows={2}
                    />
                    <button
                      type="button"
                      onClick={() => void addSpravatoSession()}
                      disabled={saving || !canWrite}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                      style={{ background: CTA_GRADIENT }}
                    >
                      <Save size={13} /> Save session
                    </button>

                    {sprSessions.length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                        <p className="text-xs font-semibold text-gray-700">Recent sessions</p>
                        {sprSessions.slice(0, 5).map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs"
                          >
                            <span>{s.sessionDate.slice(0, 10)}</span>
                            <span>{s.doseMg != null ? `${s.doseMg} mg` : '—'}</span>
                            <span>CADSS {s.cadssTotal ?? '—'}</span>
                            <span
                              className={
                                s.withheld ? 'font-semibold text-red-600' : 'text-green-700'
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
                      <p className="py-8 text-center text-sm text-slate-400">
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
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={!!sprPaChecks[i]}
                            onChange={(e) => {
                              const next = [...sprPaChecks];
                              next[i] = e.target.checked;
                              setSprPaChecks(next);
                            }}
                            className="mt-0.5 accent-purple-600"
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => void saveEnrollment()}
                      disabled={saving || !canWrite}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
                      style={{ background: CTA_GRADIENT }}
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
                  <div key={b.cpt} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-purple-700">{b.cpt}</span>
                      <span className="shrink-0 text-xs text-gray-400">{b.unit}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-700">{b.desc}</p>
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
                    <li>PHQ-9 score (at milestones — sessions 10, 15, 20, 25, 36)</li>
                  </ul>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Spravato / Esketamine Codes" icon={<DollarSign size={15} />}>
              <div className="space-y-3">
                {SPRAVATO_BILLING.map((b) => (
                  <div key={b.cpt} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-purple-700">{b.cpt}</span>
                      <span className="shrink-0 text-xs text-gray-400">{b.unit}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-700">{b.desc}</p>
                    <p className="mt-1 text-xs italic text-amber-700">{b.note}</p>
                  </div>
                ))}
                <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800">
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
                <div key={p.payer} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="mb-1.5 font-semibold text-gray-800">{p.payer}</p>
                  <p className="text-gray-600">
                    <span className="font-medium text-purple-700">TMS:</span> {p.tms}
                  </p>
                  <p className="mt-1 text-gray-600">
                    <span className="font-medium text-teal-700">Spravato:</span> {p.spravato}
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
              className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedRes(expandedRes === section.key ? null : section.key)
                }
                className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <span className="text-purple-600">{section.icon}</span>
                  {section.label}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {section.items.length} resources
                  </span>
                </div>
                {expandedRes === section.key ? (
                  <ChevronDown size={16} className="text-gray-400" />
                ) : (
                  <ChevronRight size={16} className="text-gray-400" />
                )}
              </button>

              {expandedRes === section.key && (
                <div className="divide-y divide-gray-50 border-t border-gray-100">
                  {section.items.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-gray-50"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{r.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{r.desc}</p>
                        <p className="mt-1 text-xs font-medium text-purple-600">{r.org}</p>
                      </div>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                        style={{ background: CTA_GRADIENT }}
                      >
                        <ExternalLink size={11} /> Open
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-900">
              <Phone size={15} className="text-purple-600" />
              Key Phone Numbers — Quick Reference
            </h3>
            <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {QUICK_PHONES.map((p) => (
                <div key={p.org} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="font-semibold text-gray-800">{p.org}</p>
                  <p className="mt-0.5 text-base font-bold text-purple-700">{p.number}</p>
                  <p className="mt-1 leading-snug text-gray-500">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
