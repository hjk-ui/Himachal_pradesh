'use client';
import { useEffect, useState } from 'react';
import { Star, AlertTriangle, MessageSquare, Plus, ThumbsUp, ThumbsDown } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  Section,
  StatCard,
  StatGrid,
  StatusBadge,
  cx,
  inputClasses,
} from '@/components/ui';
import { useClients } from '@/features/clients';
import { fetchAppointments, type Appointment } from '@/features/appointments';
import { useModuleList } from '@/lib/modules/useModuleList';

interface Survey {
  surveyId: string;
  clientId?: string;
  patientName: string;
  clinicianName: string;
  clinicianId: string;
  sessionDate: string;
  status: 'sent' | 'completed';
  nps: number | null;
  therapistCommunication: number | null;
  easeOfScheduling: number | null;
  overallCare: number | null;
  openFeedback: string | null;
}

function npsCategory(score: number) {
  return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor';
}

function calcNPS(surveys: Survey[]): number {
  const c = surveys.filter(s => s.nps !== null);
  if (!c.length) return 0;
  const p = c.filter(s => s.nps! >= 9).length;
  const d = c.filter(s =>s.nps!<= 6).length;
  return Math.round(((p - d) / c.length) * 100);
}

function avg(surveys: Survey[], field: keyof Survey): number {
  const c = surveys.filter(s => s[field] !== null);
  if (!c.length) return 0;
  return Math.round(c.reduce((sum, s) => sum + (s[field] as number), 0) / c.length * 10) / 10;
}

function Stars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex justify-center gap-0.5" role="img" aria-label={`${rating} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} size={12} aria-hidden className={i < Math.round(rating) ? 'fill-amber-500 text-amber-500' : 'fill-none text-slate-300'} />
      ))}
    </div>
  );
}

function NPSBadge({ score }: { score: number }) {
  const cat = npsCategory(score);
  const config = {
    promoter:  { tone: 'success', label: 'Promoter' },
    passive:   { tone: 'warning', label: 'Passive' },
    detractor: { tone: 'danger', label: 'Detractor' },
  } as const;
  const c = config[cat];
  return (
    <StatusBadge tone={c.tone}>
      {score} · {c.label}
    </StatusBadge>
  );
}

export default function SurveysPage() {
  const { clients } = useClients();
  const [surveys, setSurveys, surveysMeta] = useModuleList<Survey>('patient-surveys', []);
  const [clinicianFilter, setClinicianFilter] = useState('all');
  const [showLog, setShowLog] = useState(false);
  // Blank form: scores are only what the client answered; clinician + date come from the visit.
  const EMPTY_FORM = {
    clientId: '',
    appointmentId: '',
    nps: '',
    therapistCommunication: '',
    easeOfScheduling: '',
    overallCare: '',
    openFeedback: '',
  };
  const [form, setForm] = useState(EMPTY_FORM);
  const [clientAppts, setClientAppts] = useState<Appointment[]>([]);
  const [apptError, setApptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setClientAppts([]);
    setApptError(null);
    if (!form.clientId) return;
    fetchAppointments({ clientId: form.clientId })
      .then((rows) => {
        if (cancelled) return;
        setClientAppts(
          rows
            .filter((a) => a.status === 'completed')
            .sort((a, b) => (b.startsAt || b.date).localeCompare(a.startsAt || a.date))
            .slice(0, 25)
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setApptError(err instanceof Error ? err.message : 'Could not load visits');
      });
    return () => {
      cancelled = true;
    };
  }, [form.clientId]);

  const completed = surveys.filter(s => s.nps !== null);
  const filtered  = clinicianFilter === 'all' ? completed : completed.filter(s => s.clinicianId === clinicianFilter);
  const practiceNPS = calcNPS(surveys);
  const lowScoreAlerts = completed.filter(s =>s.nps!<= 5);

  // Older responses were saved without a clientId; fall back to a unique exact name match.
  const clientIdFor = (s: Survey) => {
    if (s.clientId) return s.clientId;
    const matches = clients.filter((c) => c.name === s.patientName);
    return matches.length === 1 ? matches[0].id : null;
  };

  const clinicians = [...new Map(surveys.map(s => [s.clinicianId, s.clinicianName])).entries()];

  const byClinician = clinicians.map(([id, name]) => {
    const cSurveys = surveys.filter(s => s.clinicianId === id && s.nps !== null);
    return {
      id, name,
      nps: calcNPS(surveys.filter(s => s.clinicianId === id)),
      avgCommunication: avg(cSurveys, 'therapistCommunication'),
      avgScheduling: avg(cSurveys, 'easeOfScheduling'),
      avgOverall: avg(cSurveys, 'overallCare'),
      count: cSurveys.length,
    };
  });

  const promoters  = completed.filter(s => s.nps! >= 9).length;
  const passives   = completed.filter(s => s.nps! >= 7 && s.nps!<= 8).length;
  const detractors = completed.filter(s =>s.nps!<= 6).length;
  const completedCount = completed.length || 1;

  const score = (v: string, min: number, max: number): number | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const npsValue = score(form.nps, 0, 10);
  const selectedAppt = clientAppts.find((a) => a.id === form.appointmentId) ?? null;

  const saveSurvey = () => {
    const client = clients.find((c) => c.id === form.clientId);
    if (!client || !selectedAppt || npsValue === null) return;
    setSurveys((prev) => [
      {
        surveyId: crypto.randomUUID(),
        clientId: client.id,
        patientName: client.name,
        clinicianName: selectedAppt.clinicianName || 'Clinician not recorded',
        clinicianId: selectedAppt.clinicianId || 'unassigned',
        sessionDate: selectedAppt.date,
        status: 'completed',
        nps: npsValue,
        therapistCommunication: score(form.therapistCommunication, 1, 5),
        easeOfScheduling: score(form.easeOfScheduling, 1, 5),
        overallCare: score(form.overallCare, 1, 5),
        openFeedback: form.openFeedback.trim() || null,
      },
      ...prev,
    ]);
    setShowLog(false);
    setForm(EMPTY_FORM);
  };

  const npsTextClass = (n: number) => (n >= 50 ? 'text-emerald-700' : n >= 0 ? 'text-amber-700' : 'text-rose-700');

  return (
    <Page className="max-w-5xl">
      {/* Header */}
      <PageHeader
        title="Patient Satisfaction"
        description="Post-session NPS — log responses here (SMS auto-send is not wired)"
        actions={
          <Button icon={<Plus />} onClick={() => setShowLog(true)}>
            Log survey response
          </Button>
        }
      />

      {surveysMeta.error ? (
        <Alert tone="danger" actions={<Button variant="secondary" size="sm" onClick={surveysMeta.retry}>Retry</Button>}>
          {surveysMeta.error}
        </Alert>
      ) : null}
      {surveysMeta.loading ? (
        <Card>
          <LoadingState label="Loading survey responses…" />
        </Card>
      ) : null}

      {/* NPS + response stats */}
      <StatGrid columns={4}>
        <StatCard
          label="Practice NPS"
          value={<span className={completed.length ? npsTextClass(practiceNPS) : undefined}>{completed.length ? practiceNPS : '—'}</span>}
          hint={!completed.length ? 'No responses yet' : practiceNPS >= 50 ? 'Excellent' : practiceNPS >= 0 ? 'Good' : 'Needs work'}
          icon={<Star />}
          tone="brand"
        />
        <StatCard
          label="Response Rate"
          value={`${surveys.length ? Math.round((completed.length / surveys.length) * 100) : 0}%`}
          hint={`${completed.length}/${surveys.length} responded`}
          icon={<MessageSquare />}
          tone="info"
        />
        <StatCard label="Promoters" value={promoters} hint="NPS 9–10" icon={<ThumbsUp />} tone="success" />
        <StatCard label="Detractors" value={detractors} hint="NPS 0–6" icon={<ThumbsDown />} tone="danger" />
      </StatGrid>

      {/* NPS breakdown bar */}
      <Card>
        <CardHeader title="NPS Breakdown" />
        <CardBody>
          <div className="flex h-6 overflow-hidden rounded-lg bg-slate-100">
            <div className="flex items-center justify-center bg-emerald-700 text-xs font-semibold text-white" style={{ width: `${Math.round(promoters / completedCount * 100)}%` }}>
              {completed.length ? `${Math.round(promoters / completed.length * 100)}%` : '0%'}
            </div>
            <div className="flex items-center justify-center bg-amber-600 text-xs font-semibold text-white" style={{ width: `${Math.round(passives / completedCount * 100)}%` }}>
              {completed.length ? `${Math.round(passives / completed.length * 100)}%` : ''}
            </div>
            <div className="flex items-center justify-center bg-rose-700 text-xs font-semibold text-white" style={{ width: `${Math.round(detractors / completedCount * 100)}%` }}>
              {completed.length ? `${Math.round(detractors / completed.length * 100)}%` : ''}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-700" /> Promoters ({promoters})</span>
            <span className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-amber-600" /> Passives ({passives})</span>
            <span className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-rose-700" /> Detractors ({detractors})</span>
          </div>
        </CardBody>
      </Card>

      {/* Per-clinician scores */}
      <Card>
        <CardHeader title="By Clinician" />
        <CardBody className="space-y-4">
          {byClinician.length === 0 && (
            <EmptyState compact title="No clinician scores yet." />
          )}
          {byClinician.map(c => (
            <div key={c.id} className="flex flex-col gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
              <div aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                {c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">{c.count} responses</p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 text-center text-xs sm:w-auto sm:grid-cols-4 sm:gap-6">
                <div>
                  <p className={cx('text-lg font-semibold tabular-nums', npsTextClass(c.nps))}>{c.nps}</p>
                  <p className="text-slate-500">NPS</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{c.avgCommunication}</p>
                  <Stars rating={c.avgCommunication} />
                  <p className="text-slate-500">Comm.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{c.avgScheduling}</p>
                  <Stars rating={c.avgScheduling} />
                  <p className="text-slate-500">Sched.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{c.avgOverall}</p>
                  <Stars rating={c.avgOverall} />
                  <p className="text-slate-500">Overall</p>
                </div>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Low-score alerts */}
      {lowScoreAlerts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            icon={<AlertTriangle className="text-rose-700" />}
            title={`${lowScoreAlerts.length} Low-Score Response${lowScoreAlerts.length !== 1 ? 's' : ''} — Review Required`}
          />
          <ul className="divide-y divide-slate-100">
            {lowScoreAlerts.map(s => (
              <li key={s.surveyId} className="px-5 py-3">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{s.patientName}</span>
                  <NPSBadge score={s.nps!} />
                </div>
                <p className="text-xs text-slate-500">{s.clinicianName} · {s.sessionDate}</p>
                {s.openFeedback && <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-xs italic text-slate-700">&quot;{s.openFeedback}&quot;</p>}
                {clientIdFor(s) ? (
                  <a href={`/dashboard/clients/${clientIdFor(s)}`} className="mt-2 inline-block text-xs font-medium text-blue-700 hover:underline">
                    Follow Up with Client — open chart
                  </a>
                ) : (
                  <span className="mt-2 inline-block text-xs font-medium text-slate-500" title="This response is not linked to a client record">
                    Follow up: client record not linked
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Individual responses */}
      <Section
        title="Individual Responses"
        actions={
          <select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)} aria-label="Filter by clinician"
            className={cx(inputClasses, 'w-auto py-1.5 text-xs')}>
            <option value="all">All Clinicians</option>
            {clinicians.map(([id, name]) =><option key={id} value={id}>{name}</option>)}
          </select>
        }
      >
        {filtered.length === 0 && (
          <Card>
            <EmptyState
              title="No survey responses yet."
              description={<>Use <strong>Log survey response</strong> after a session.</>}
            />
          </Card>
        )}
        {filtered.map(s => (
          <Card key={s.surveyId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{s.patientName}</span>
                  <NPSBadge score={s.nps!} />
                </div>
                <p className="text-xs text-slate-500">{s.clinicianName} · {s.sessionDate}</p>
              </div>
              <div className="flex shrink-0 gap-4 text-center text-xs">
                {[
                  { label: 'Comm', value: s.therapistCommunication },
                  { label: 'Sched', value: s.easeOfScheduling },
                  { label: 'Care', value: s.overallCare },
                ].map(m => (
                  <div key={m.label}>
                    <Stars rating={m.value ?? 0} />
                    <p className="mt-0.5 text-slate-500">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
            {s.openFeedback && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-600">
                <MessageSquare size={12} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
                &quot;{s.openFeedback}&quot;
              </p>
            )}
          </Card>
        ))}
      </Section>

      {showLog && (
        <Modal
          title="Log survey response"
          size="sm"
          onClose={() => setShowLog(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowLog(false)}>
                Cancel
              </Button>
              <Button disabled={!form.clientId || !selectedAppt || npsValue === null} onClick={saveSurvey}>
                Save response
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Client">
              <select
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value, appointmentId: '' }))}
                className={inputClasses}
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Visit (completed)" error={apptError ?? undefined}>
              <select
                value={form.appointmentId}
                onChange={(e) => setForm((f) => ({ ...f, appointmentId: e.target.value }))}
                disabled={!form.clientId}
                className={inputClasses}
              >
                <option value="">{form.clientId ? (clientAppts.length ? 'Select visit' : 'No completed visits found') : 'Select a client first'}</option>
                {clientAppts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.date} · {a.type} · {a.clinicianName || 'Clinician not recorded'}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="NPS (0–10)">
                <input type="number" min={0} max={10} value={form.nps}
                  onChange={(e) => setForm((f) => ({ ...f, nps: e.target.value }))} className={inputClasses} />
              </FormField>
              <FormField label="Overall care (1–5)">
                <input type="number" min={1} max={5} value={form.overallCare}
                  onChange={(e) => setForm((f) => ({ ...f, overallCare: e.target.value }))} className={inputClasses} />
              </FormField>
              <FormField label="Therapist communication (1–5)">
                <input type="number" min={1} max={5} value={form.therapistCommunication}
                  onChange={(e) => setForm((f) => ({ ...f, therapistCommunication: e.target.value }))} className={inputClasses} />
              </FormField>
              <FormField label="Ease of scheduling (1–5)">
                <input type="number" min={1} max={5} value={form.easeOfScheduling}
                  onChange={(e) => setForm((f) => ({ ...f, easeOfScheduling: e.target.value }))} className={inputClasses} />
              </FormField>
            </div>
            <FormField label="Feedback">
              <textarea
                rows={2}
                value={form.openFeedback}
                onChange={(e) => setForm((f) => ({ ...f, openFeedback: e.target.value }))}
                placeholder="Optional feedback"
                className={inputClasses}
              />
            </FormField>
          </div>
        </Modal>
      )}
    </Page>
  );
}
