'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClients, type Client } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';
import {
  Activity,
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  Send,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

interface Threshold {
  label: string;
  min: number;
  color: string;
  bg: string;
}

interface MeasureDef {
  name: string;
  shortName: string;
  maxScore: number;
  thresholds: Threshold[];
  alertAt: number;
}

interface Schedule {
  scheduleId: string;
  patientId: string;
  patientName: string;
  measure: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  deliveryMethod: 'sms' | 'email';
  nextSendDate: string;
  lastSentAt: string | null;
  active: boolean;
  completionRate: number;
}

interface Response {
  responseId: string;
  scheduleId: string;
  patientId: string;
  measure: string;
  score: number;
  date: string;
}

const MEASURES: Record<string, MeasureDef> = {
  'PHQ-9': {
    name: 'Patient Health Questionnaire-9',
    shortName: 'PHQ-9',
    maxScore: 27,
    alertAt: 15,
    thresholds: [
      { label: 'Minimal', min: 0, color: '#6868D0', bg: '#E0E2FC' },
      { label: 'Mild', min: 5, color: '#8888E8', bg: '#EEF2FF' },
      { label: 'Moderate', min: 10, color: '#f59e0b', bg: '#fef3c7' },
      { label: 'Mod-Severe', min: 15, color: '#ef4444', bg: '#fee2e2' },
      { label: 'Severe', min: 20, color: '#991b1b', bg: '#fecaca' },
    ],
  },
  'GAD-7': {
    name: 'Generalized Anxiety Disorder-7',
    shortName: 'GAD-7',
    maxScore: 21,
    alertAt: 15,
    thresholds: [
      { label: 'Minimal', min: 0, color: '#6868D0', bg: '#E0E2FC' },
      { label: 'Mild', min: 5, color: '#8888E8', bg: '#EEF2FF' },
      { label: 'Moderate', min: 10, color: '#f59e0b', bg: '#fef3c7' },
      { label: 'Severe', min: 15, color: '#ef4444', bg: '#fee2e2' },
    ],
  },
  'PCL-5': {
    name: 'PTSD Checklist for DSM-5',
    shortName: 'PCL-5',
    maxScore: 80,
    alertAt: 33,
    thresholds: [
      { label: 'Sub-threshold', min: 0, color: '#6868D0', bg: '#E0E2FC' },
      { label: 'Probable PTSD', min: 33, color: '#ef4444', bg: '#fee2e2' },
    ],
  },
  AUDIT: {
    name: 'Alcohol Use Disorders Identification',
    shortName: 'AUDIT',
    maxScore: 40,
    alertAt: 16,
    thresholds: [
      { label: 'Low Risk', min: 0, color: '#6868D0', bg: '#E0E2FC' },
      { label: 'Hazardous', min: 8, color: '#f59e0b', bg: '#fef3c7' },
      { label: 'Harmful', min: 16, color: '#ef4444', bg: '#fee2e2' },
      { label: 'Dependent', min: 20, color: '#991b1b', bg: '#fecaca' },
    ],
  },
  Columbia: {
    name: 'Columbia Suicide Severity Rating Scale',
    shortName: 'Columbia',
    maxScore: 6,
    alertAt: 2,
    thresholds: [
      { label: 'Low', min: 0, color: '#6868D0', bg: '#E0E2FC' },
      { label: 'Moderate', min: 2, color: '#f59e0b', bg: '#fef3c7' },
      { label: 'High', min: 4, color: '#ef4444', bg: '#fee2e2' },
    ],
  },
};

function getThreshold(measureKey: string, score: number): Threshold {
  const measure = MEASURES[measureKey];
  if (!measure) return { label: 'Unknown', min: 0, color: '#6b7280', bg: '#f3f4f6' };
  const sorted = [...measure.thresholds].sort((a, b) => b.min - a.min);
  return sorted.find((threshold) => score >= threshold.min) || sorted[sorted.length - 1];
}

function clampScore(score: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(score)));
}

function shiftNextSendDate(date: string, frequency: Schedule['frequency']) {
  const days = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 30;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().split('T')[0];
}

function measureLabel(score: number, measure: string) {
  if (measure === 'PHQ-9') return score >= 20 ? 'Severe' : score >= 15 ? 'Mod-Severe' : score >= 10 ? 'Moderate' : score >= 5 ? 'Mild' : 'Minimal';
  if (measure === 'GAD-7') return score >= 15 ? 'Severe' : score >= 10 ? 'Moderate' : score >= 5 ? 'Mild' : 'Minimal';
  if (measure === 'PCL-5') return score >= 33 ? 'Probable PTSD' : 'Sub-threshold';
  if (measure === 'AUDIT') return score >= 20 ? 'Dependent' : score >= 16 ? 'Harmful' : score >= 8 ? 'Hazardous' : 'Low Risk';
  if (measure === 'Columbia') return score >= 4 ? 'High' : score >= 2 ? 'Moderate' : 'Low';
  return 'Unknown';
}

/** Mini line chart for the Trend column (dots + polyline, severity-colored). */
function TrendSparkline({
  scores,
  color,
}: {
  scores: number[];
  color: string;
}) {
  const w = 128;
  const h = 40;
  const padX = 8;
  const padY = 8;

  if (scores.length < 2) {
    return <span className="text-xs text-slate-300">Not enough data</span>;
  }

  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const span = Math.max(hi - lo, 1);

  const points = scores.map((score, index) => {
    const x = padX + (index / (scores.length - 1)) * (w - padX * 2);
    const y = h - padY - ((score - lo) / span) * (h - padY * 2);
    return { x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="block"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={3.25}
          fill={color}
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

function deriveScore(client: Pick<Client, 'avgMood' | 'avgStress' | 'risk' | 'streak'>, measure: string, step = 0) {
  const mood = client.avgMood ?? 5;
  const stress = client.avgStress ?? 5;
  if (measure === 'PHQ-9') return clampScore(22 - mood * 1.7 - client.streak * 0.12 + step, 27);
  if (measure === 'GAD-7') return clampScore(17 - mood * 0.9 - stress * 0.8 + step, 21);
  if (measure === 'PCL-5') return clampScore(client.risk === 'high' ? 38 - step : client.risk === 'medium' ? 26 - step : 14 - step, 80);
  if (measure === 'AUDIT') return clampScore(client.risk === 'high' ? 15 + step : client.risk === 'medium' ? 8 + step : 4 + step, 40);
  if (measure === 'Columbia') return clampScore(client.risk === 'high' ? 2 + step : client.risk === 'medium' ? 1 + step : 0, 6);
  return clampScore(10 + step, 40);
}

function pickMeasures(client: Pick<Client, 'risk'>) {
  if (client.risk === 'high') return ['PHQ-9', 'GAD-7', 'Columbia'];
  if (client.risk === 'medium') return ['PHQ-9', 'GAD-7'];
  return ['GAD-7'];
}

function buildSchedulesFromClients(clients: Client[]): Schedule[] {
  const today = new Date().toISOString().split('T')[0];
  return clients
    .filter((client) => client.status !== 'DISCHARGED')
    .flatMap((client, index) => {
      const measures = pickMeasures(client);
      return measures.map((measure) => {
        const frequency = client.risk === 'low' ? 'monthly' : 'weekly';
        return {
          scheduleId: `outcome-${client.id}-${measure}`,
          patientId: client.id,
          patientName: client.name,
          measure,
          frequency,
          deliveryMethod: index % 2 === 0 ? 'sms' : 'email',
          nextSendDate: shiftNextSendDate(today, frequency),
          lastSentAt: null,
          active: true,
          completionRate: client.risk === 'high' ? 72 : client.risk === 'medium' ? 84 : 92,
        } satisfies Schedule;
      });
    });
}

function buildResponsesFromSchedules(schedules: Schedule[], clients: Client[]): Response[] {
  const lookup = new Map(clients.map((client) => [client.id, client]));
  const today = new Date();

  return schedules.flatMap((schedule, index) => {
    const client = lookup.get(schedule.patientId);
    if (!client) return [];
    const max = MEASURES[schedule.measure]?.maxScore ?? 40;
    const latest = deriveScore(client, schedule.measure, 0);
    const wobble =
      client.risk === 'high'
        ? [6, 5, 4, 3, 2, 0]
        : client.risk === 'medium'
          ? [4, 3, 2, 2, 1, 0]
          : [2, 2, 1, 1, 0, 0];
    const offset = 5 + index * 2;
    const stepDays = schedule.frequency === 'monthly' ? 28 : schedule.frequency === 'biweekly' ? 14 : 7;

    return wobble.map((bump, pointIndex) => {
      const fromEnd = wobble.length - 1 - pointIndex;
      return {
        responseId: `resp-${schedule.scheduleId}-${pointIndex + 1}`,
        scheduleId: schedule.scheduleId,
        patientId: schedule.patientId,
        measure: schedule.measure,
        score: clampScore(latest + bump, max),
        date: new Date(
          today.getTime() - (offset + fromEnd * stepDays) * 86400000
        )
          .toISOString()
          .split('T')[0],
      } satisfies Response;
    });
  });
}

function ScoreTrend({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) return <span className="text-xs text-slate-400">First reading</span>;
  const diff = current - previous;
  if (diff === 0) return <span className="flex items-center gap-0.5 text-xs text-slate-400"><Minus size={11} />No change</span>;
  if (diff < 0) return <span className="flex items-center gap-0.5 text-xs text-blue-600 font-medium"><TrendingDown size={11} /> {Math.abs(diff)} pts improved</span>;
  return <span className="flex items-center gap-0.5 text-xs text-red-500 font-medium"><TrendingUp size={11} /> {diff} pts worsened</span>;
}

function AddScheduleModal({
  clients,
  onClose,
  onAdd,
}: {
  clients: Client[];
  onClose: () => void;
  onAdd: (schedule: Schedule, responses: Response[]) => void;
}) {
  const firstClient = clients[0];
  const [clientId, setClientId] = useState(firstClient?.id ?? '');
  const [measure, setMeasure] = useState('PHQ-9');
  const [frequency, setFrequency] = useState<Schedule['frequency']>('weekly');
  const [deliveryMethod, setDeliveryMethod] = useState<Schedule['deliveryMethod']>('sms');

  const selectedClient = clients.find((client) => client.id === clientId) || firstClient;
  const maxScore = MEASURES[measure]?.maxScore ?? 40;
  const previewScore = selectedClient ? deriveScore(selectedClient, measure, 0) : 0;
  const previewLabel = measureLabel(previewScore, measure);

  function submit() {
    if (!selectedClient) return;
    const schedule: Schedule = {
      scheduleId: `outcome-${selectedClient.id}-${measure}-${Date.now()}`,
      patientId: selectedClient.id,
      patientName: selectedClient.name,
      measure,
      frequency,
      deliveryMethod,
      nextSendDate: shiftNextSendDate(new Date().toISOString().split('T')[0], frequency),
      lastSentAt: null,
      active: true,
      completionRate: selectedClient.risk === 'high' ? 72 : 88,
    };
    const seedResponses = buildResponsesFromSchedules([schedule], [selectedClient]);
    onAdd(schedule, seedResponses);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Schedule outcome measure</h2>
          <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} - {client.risk.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Measure</span>
            <select
              value={measure}
              onChange={(e) => setMeasure(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              {Object.entries(MEASURES).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.shortName} - {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Frequency</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Schedule['frequency'])}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery</span>
              <select
                value={deliveryMethod}
                onChange={(e) => setDeliveryMethod(e.target.value as Schedule['deliveryMethod'])}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </select>
            </label>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {selectedClient ? (
              <>
                <div className="font-semibold">{selectedClient.name}</div>
                <div className="mt-1 text-xs">
                  Real client metrics from the database are used to preview a {measure} score of {previewScore}/{maxScore} ({previewLabel}).
                </div>
              </>
            ) : (
              <div>No clients available.</div>
            )}
          </div>
        </div>
        <div className="flex gap-3 border-t px-5 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!selectedClient}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
          >
            Save schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  responses,
  onSendNow,
  onToggle,
}: {
  schedule: Schedule;
  responses: Response[];
  onSendNow: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sent, setSent] = useState(false);
  const measure = MEASURES[schedule.measure];
  const sorted = [...responses].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2];
  const threshold = latest ? getThreshold(schedule.measure, latest.score) : null;
  const delta = latest && prior ? latest.score - prior.score : null;
  const alert = latest && measure && (latest.score >= measure.alertAt || (delta !== null && delta >= 5));

  function handleSend() {
    setSent(true);
    onSendNow(schedule.scheduleId);
    window.setTimeout(() => setSent(false), 1200);
  }

  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${alert ? 'border-red-200' : 'border-slate-200/80'}`}>
      <div className="flex items-center gap-4 p-4">
        <div className={`h-2 w-2 rounded-full ${schedule.active ? 'bg-blue-400' : 'bg-slate-300'}`} />
        <div className="w-24 shrink-0">
          <div className="text-sm font-semibold text-slate-900">{schedule.measure}</div>
          <div className="text-xs text-slate-400">{schedule.frequency}</div>
        </div>
        <div className="w-32 shrink-0">
          {latest && threshold ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-semibold text-slate-900">{latest.score}</span>
                <span className="text-sm text-slate-400">/ {measure?.maxScore}</span>
                {delta !== null && (
                  <span className={`text-xs ${delta < 0 ? 'text-blue-600' : delta > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {delta < 0 ? <TrendingDown size={12} className="inline" /> : delta > 0 ? <TrendingUp size={12} className="inline" /> : <Minus size={12} className="inline" />}
                    {Math.abs(delta)}
                  </span>
                )}
              </div>
              <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ color: threshold.color, background: threshold.bg }}>
                {threshold.label}
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-400">No data</span>
          )}
        </div>
        <div className="hidden min-w-[8rem] flex-1 md:block">
          {sorted.length >= 2 && threshold ? (
            <TrendSparkline
              scores={sorted.slice(-6).map((item) => item.score)}
              color={threshold.color}
            />
          ) : (
            <span className="text-xs text-slate-300">Not enough data</span>
          )}
        </div>
        <div className="w-20 text-center text-sm font-semibold text-slate-800">
          {schedule.completionRate}%
          <div className="text-xs font-normal text-slate-400">completed</div>
        </div>
        <div className="hidden w-28 shrink-0 text-right text-xs text-slate-500 lg:block">
          <Calendar size={11} className="mr-1 inline" />
          {new Date(`${schedule.nextSendDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {schedule.lastSentAt && <div className="mt-1 text-[11px] text-blue-600">Sent {new Date(schedule.lastSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleSend}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${sent ? 'bg-blue-50 text-blue-700' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
          >
            {sent ? <><Check size={11} /> Sent</> : <><Send size={11} /> Send</>}
          </button>
          <button
            onClick={() => onToggle(schedule.scheduleId)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${schedule.active ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
          >
            {schedule.active ? 'Active' : 'Paused'}
          </button>
          <button onClick={() => setExpanded((value) => !value)} className="text-slate-300 hover:text-slate-500">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      {alert && latest && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle size={12} />
            {latest.score >= (measure?.alertAt || 99)
              ? `Score ${latest.score} meets alert threshold (>= ${measure?.alertAt})`
              : `Score increased by ${delta} points since last measurement`}
          </div>
        </div>
      )}
      {expanded && (
        <div className="border-t border-slate-200/80 px-4 pb-4 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Score history</div>
          <div className="flex flex-wrap gap-3">
            {sorted.map((item, index) => {
              const band = getThreshold(schedule.measure, item.score);
              return (
                <div key={item.responseId} className="text-center">
                  <div className="text-lg font-bold" style={{ color: band.color }}>
                    {item.score}
                  </div>
                  <div className="text-xs text-slate-400">{new Date(`${item.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OutcomesPage() {
  const { clients, loading: clientsLoading } = useClients();
  const [schedules, setSchedules] = useModuleList<Schedule>('outcome-schedules', []);
  const [responses, setResponses] = useModuleList<Response>('outcome-responses', []);
  const [showAdd, setShowAdd] = useState(false);
  const [filterPatient, setFilterPatient] = useState('all');
  const [scheduleStoreExists, setScheduleStoreExists] = useState<boolean | null>(null);
  const [responseStoreExists, setResponseStoreExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/modules/outcome-schedules').then((res) => res.json()),
      fetch('/api/modules/outcome-responses').then((res) => res.json()),
    ])
      .then(([scheduleData, responseData]) => {
        if (cancelled) return;
        setScheduleStoreExists(scheduleData.success ? scheduleData.data !== null : false);
        setResponseStoreExists(responseData.success ? responseData.data !== null : false);
      })
      .catch(() => {
        if (!cancelled) {
          setScheduleStoreExists(false);
          setResponseStoreExists(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (clientsLoading) return;
    if (scheduleStoreExists === null) return;
    if (schedules.length > 0 || clients.length === 0) return;
    setSchedules(buildSchedulesFromClients(clients));
  }, [clients, clientsLoading, scheduleStoreExists, schedules.length, setSchedules]);

  useEffect(() => {
    if (clientsLoading) return;
    if (responseStoreExists === null) return;
    if (responses.length > 0 || schedules.length === 0 || clients.length === 0) return;
    setResponses(buildResponsesFromSchedules(schedules, clients));
  }, [clients, clientsLoading, responseStoreExists, responses.length, schedules, setResponses]);

  const patientList = useMemo(() => {
    const seen = new Set<string>();
    return schedules
      .filter((schedule) => {
        if (seen.has(schedule.patientId)) return false;
        seen.add(schedule.patientId);
        return true;
      })
      .map((schedule) => ({ id: schedule.patientId, name: schedule.patientName }));
  }, [schedules]);

  const alerts = useMemo(() => {
    return schedules
      .map((schedule) => {
        const series = responses
          .filter((item) => item.scheduleId === schedule.scheduleId)
          .sort((a, b) => b.date.localeCompare(a.date));
        const latest = series[0];
        const prior = series[1];
        const measure = MEASURES[schedule.measure];
        if (!latest || !measure) return null;
        const change = prior ? latest.score - prior.score : 0;
        if (latest.score < measure.alertAt && change < 5) return null;
        return {
          schedule,
          latest,
          prior,
          threshold: getThreshold(schedule.measure, latest.score),
        };
      })
      .filter(Boolean) as {
      schedule: Schedule;
      latest: Response;
      prior?: Response;
      threshold: Threshold;
    }[];
  }, [responses, schedules]);

  const filteredSchedules = useMemo(
    () => schedules.filter((schedule) => filterPatient === 'all' || schedule.patientId === filterPatient),
    [filterPatient, schedules]
  );

  const avgCompletion = schedules.length
    ? Math.round(schedules.reduce((sum, schedule) => sum + schedule.completionRate, 0) / schedules.length)
    : 0;

  function handleSendNow(scheduleId: string) {
    const sentAt = new Date().toISOString();
    const today = new Date().toISOString().split('T')[0];
    setSchedules((prev) =>
      prev.map((schedule) =>
        schedule.scheduleId === scheduleId
          ? { ...schedule, lastSentAt: sentAt, nextSendDate: shiftNextSendDate(today, schedule.frequency) }
          : schedule
      )
    );
  }

  function toggleSchedule(scheduleId: string) {
    setSchedules((prev) => prev.map((schedule) => (schedule.scheduleId === scheduleId ? { ...schedule, active: !schedule.active } : schedule)));
  }

  function addSchedule(schedule: Schedule, seedResponses: Response[]) {
    setSchedules((prev) => [schedule, ...prev]);
    setResponses((prev) => [...seedResponses, ...prev]);
  }

  const selectedPatientName =
    filterPatient === 'all' ? 'all tracked clients' : patientList.find((patient) => patient.id === filterPatient)?.name || 'selected client';

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {showAdd && <AddScheduleModal clients={clients} onClose={() => setShowAdd(false)} onAdd={addSchedule} />}

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Activity size={20} style={{ color: '#6868D0' }} />
            <h1 className="text-2xl font-semibold text-slate-900">Outcome Measures</h1>
          </div>
          <p className="text-sm text-slate-500">
            Real clients from the database drive the schedule list. New measure activity is saved to clinic module storage.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
        >
          <Plus size={16} /> Schedule Measure
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Active schedules', value: schedules.filter((schedule) => schedule.active).length, color: 'text-blue-600' },
          { label: 'Clinical alerts', value: alerts.length, color: alerts.length > 0 ? 'text-red-600' : 'text-blue-600' },
          { label: 'Avg completion', value: `${avgCompletion}%`, color: avgCompletion >= 80 ? 'text-blue-600' : 'text-amber-600' },
          { label: 'Clients tracked', value: patientList.length, color: 'text-slate-700' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-1 text-xs text-slate-500">{card.label}</div>
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Bell size={16} className="text-red-600" />
            <span className="font-semibold text-red-900">
              Clinical alerts - {alerts.length} client{alerts.length !== 1 ? 's' : ''} need review
            </span>
          </div>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={`${alert.schedule.scheduleId}-${alert.latest.responseId}`}
                className="flex items-center justify-between rounded-xl border border-red-100 bg-white px-4 py-3"
              >
                <div>
                  <span className="text-sm font-semibold text-slate-900">{alert.schedule.patientName}</span>
                  <span className="mx-2 text-sm text-slate-400">-</span>
                  <span className="text-sm text-slate-600">{alert.schedule.measure}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-lg font-bold" style={{ color: alert.threshold.color }}>
                      {alert.latest.score}
                    </span>
                    <span className="ml-1 text-xs text-slate-400">/ {MEASURES[alert.schedule.measure]?.maxScore}</span>
                    {alert.prior && alert.latest.score > alert.prior.score && (
                      <div className="text-xs text-red-600">
                        <TrendingUp size={10} className="inline" /> +{alert.latest.score - alert.prior.score} pts
                      </div>
                    )}
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: alert.threshold.color, background: alert.threshold.bg }}>
                    {alert.threshold.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterPatient('all')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filterPatient === 'all' ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          style={filterPatient === 'all' ? { background: '#6868D0' } : {}}
        >
          All clients
        </button>
        {patientList.map((patient) => (
          <button
            key={patient.id}
            onClick={() => setFilterPatient(patient.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filterPatient === patient.id ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            style={filterPatient === patient.id ? { background: '#6868D0' } : {}}
          >
            {patient.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <div className="w-2" />
        <div className="w-20">Measure</div>
        <div className="w-28">Latest score</div>
        <div className="hidden flex-1 md:block">Trend</div>
        <div className="w-16 text-center">Completion</div>
        <div className="hidden w-24 text-right lg:block">Next send</div>
        <div className="w-20" />
      </div>

      <div className="space-y-2">
        {filteredSchedules.map((schedule) => (
          <ScheduleRow
            key={schedule.scheduleId}
            schedule={schedule}
            responses={responses.filter((item) => item.scheduleId === schedule.scheduleId)}
            onSendNow={handleSendNow}
            onToggle={toggleSchedule}
          />
        ))}
      </div>

      {filteredSchedules.length === 0 && (
        <div className="py-16 text-center text-slate-400">
          <Activity size={32} className="mx-auto mb-3 opacity-30" />
          <p>No schedules for {selectedPatientName}</p>
        </div>
      )}
    </div>
  );
}
