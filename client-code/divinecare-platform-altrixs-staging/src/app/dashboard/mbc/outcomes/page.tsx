'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useClients, type Client } from '@/features/clients';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Minus,
  Plus,
  Send,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  FormField,
  IconButton,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  RowActionsMenu,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';
import { WORSENING_POINTS } from '@/lib/measures/instruments';
import {
  SOURCE_LABEL,
  SendStatusBadge,
  TrendSparkline,
  bandFor,
  giveInSessionHref,
  scheduleLabel,
  sendMeasuresNow,
  type ScoreBand,
} from '@/components/measures/shared';

/**
 * MBC outcome schedules. Rows are measure_assignments (one per client + measure); scores are the
 * client's ClinicalAssessmentRecords (session, paper or patient link); the Status column is the
 * last send (Not sent / Sent / Opened / Started / Completed / Expired / Locked). Patients get due
 * measures by email / text 3 days and 1 day before a visit when leadership turns on "Send measures
 * to patients before visits" (Practice settings > Clinical policy > Measurement-based care).
 */

type ScorePoint = { id: string; score: number | null; severity: string | null; date: string; source: string | null; safetyFlagged: boolean };
type LastRequest = { id: string; status: string; sentAt: string | null; completedAt: string | null; notSentReason: string | null; deliveryResults: { channel: string; ok: boolean; reason: string | null }[] };
type Row = {
  id: string;
  clientId: string;
  clientName: string;
  instrumentId: string;
  measure: string;
  maxScore: number | null;
  scoreRanges: ScoreBand[];
  higherIsBetter?: boolean;
  schedule: string;
  everyDays: number | null;
  startDate: string;
  source: string;
  status: 'active' | 'paused' | 'ended';
  sendable: boolean;
  notSendableReason: string | null;
  scores: ScorePoint[];
  completionRate: number | null;
  nextDue: string | null;
  lastRequest: LastRequest | null;
};
type SendableInstrument = { id: string; name: string; fullName: string; maxScore: number | null };

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-slate-700',
  brand: 'text-blue-700',
  info: 'text-sky-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Top score band, a safety item, or a clinically meaningful rise (PHQ-9 +5, GAD-7 +4, PCL-5 +10; others +5) */
function alertFor(row: Row) {
  const pts = row.scores.filter((s) => s.score != null);
  const latest = pts[pts.length - 1];
  const prior = pts[pts.length - 2];
  if (!latest || latest.score == null) return null;
  const band = bandFor(latest.score, row.scoreRanges, row.higherIsBetter);
  const delta = prior?.score != null ? latest.score - prior.score : null;
  const rise = WORSENING_POINTS[row.instrumentId] ?? 5;
  const top = band?.tone === 'danger';
  // WHO-5 / SWLS: a fall is the worsening
  const worse = delta !== null && (row.higherIsBetter ? -delta : delta) >= rise;
  if (!top && !worse && !latest.safetyFlagged) return null;
  return { latest, prior, band, delta, top, worse };
}

function failText(r: LastRequest | null): string | undefined {
  if (!r) return undefined;
  const failed = r.deliveryResults.filter((d) => !d.ok).map((d) => `${d.channel}: ${d.reason ?? 'not sent'}`);
  return [r.notSentReason ? `Reason: ${r.notSentReason.replace(/_/g, ' ')}` : null, ...failed].filter(Boolean).join(' · ') || undefined;
}

function AddScheduleModal({
  clients,
  instruments,
  onClose,
  onSaved,
}: {
  clients: Client[];
  instruments: SendableInstrument[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [instrumentId, setInstrumentId] = useState(instruments.find((i) => i.id === 'phq-9')?.id ?? instruments[0]?.id ?? '');
  const [schedule, setSchedule] = useState<'once' | 'interval' | 'before_visit'>('interval');
  const [everyDays, setEveryDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedClient = clients.find((c) => c.id === clientId);
  const inst = instruments.find((i) => i.id === instrumentId);

  async function submit() {
    if (!selectedClient || !inst) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/clinical/measure-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, instrumentId, schedule, everyDays: schedule === 'interval' ? everyDays : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || `Could not save (${res.status})`);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError('Could not save (network error)');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Schedule outcome measure"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!selectedClient || !inst || busy}>
            {busy ? 'Saving…' : 'Save schedule'}
          </Button>
        </>
      }
    >
      <FormField label="Client">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClasses}>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} - {client.risk.toUpperCase()}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Measure">
        <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className={inputClasses}>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} - {i.fullName}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Schedule">
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as typeof schedule)} className={inputClasses}>
            <option value="interval">Every N days</option>
            <option value="before_visit">Before each visit</option>
            <option value="once">Once</option>
          </select>
        </FormField>
        {schedule === 'interval' ? (
          <FormField label="Every (days)">
            <input
              type="number"
              min={1}
              max={365}
              value={everyDays}
              onChange={(e) => setEveryDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
              className={inputClasses}
            />
          </FormField>
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Alert tone="brand" icon={false}>
        {selectedClient && inst ? (
          <>
            <div className="font-semibold">{selectedClient.name}</div>
            <div className="mt-1 text-xs">
              {inst.name} {scheduleLabel(schedule, everyDays)}. When the practice turns on automatic sending, it goes by email / text (with consent) 3 days and 1 day
              before visits it is due for. Scores appear here as soon as the client completes it.
            </div>
          </>
        ) : (
          <div>No clients available.</div>
        )}
      </Alert>
    </Modal>
  );
}

const COLUMN_COUNT = 7;

/** Local calendar day (YYYY-MM-DD) */
const todayDay = () => new Date().toLocaleDateString('en-CA');

/**
 * Due to send: active, patient-completable, due today or overdue (or never sent), and no link
 * already waiting on the patient. Grouped one request per client (one link for all their measures).
 */
function dueForBulkSend(rows: Row[], today = todayDay()): { clientId: string; clientName: string; rows: Row[] }[] {
  const by = new Map<string, { clientId: string; clientName: string; rows: Row[] }>();
  for (const r of rows) {
    if (r.status !== 'active' || !r.sendable) continue;
    if (r.lastRequest && ['Sent', 'Opened', 'Started'].includes(r.lastRequest.status)) continue;
    if (r.nextDue && r.nextDue.slice(0, 10) > today) continue;
    const g = by.get(r.clientId) ?? { clientId: r.clientId, clientName: r.clientName, rows: [] };
    g.rows.push(r);
    by.set(r.clientId, g);
  }
  return [...by.values()];
}

function BulkSendModal({ rows, onClose, onDone }: { rows: Row[]; onClose: () => void; onDone: () => void }) {
  const groups = useMemo(() => dueForBulkSend(rows), [rows]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(groups.map((g) => g.clientId)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function sendAll() {
    setBusy(true);
    for (const g of groups.filter((x) => picked.has(x.clientId))) {
      const r = await sendMeasuresNow(g.clientId, g.rows.map((x) => x.instrumentId), g.rows.map((x) => x.id));
      setResults((m) => ({ ...m, [g.clientId]: { ok: r.sent, text: r.message } }));
    }
    setBusy(false);
    onDone();
  }

  const done = Object.keys(results).length > 0 && !busy;
  return (
    <Modal
      title="Send due measures"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {!done ? (
            <Button icon={<Send />} onClick={() => void sendAll()} disabled={busy || !picked.size}>
              {busy ? 'Sending…' : `Send to ${picked.size} client${picked.size === 1 ? '' : 's'}`}
            </Button>
          ) : null}
        </>
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing is due: every active, patient-completable measure is either not due yet or already waiting on the patient.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            One secure link per client for all their due measures, by email / text with consent. Date of birth on the chart and 42 CFR Part 2 are checked for each. The message only says
            they have a short questionnaire.
          </p>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {groups.map((g) => (
              <li key={g.clientId} className="px-3 py-2 text-sm">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={busy || done}
                    checked={picked.has(g.clientId)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(g.clientId)) n.delete(g.clientId);
                        else n.add(g.clientId);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-900">{g.clientName}</span>
                    <span className="block text-xs text-slate-500">{g.rows.map((r) => r.measure).join(', ')}</span>
                    {results[g.clientId] ? (
                      <span className={cx('block text-xs', results[g.clientId].ok ? 'text-emerald-700' : 'text-rose-700')}>{results[g.clientId].text}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function ScheduleRow({ row, onToggle, onSent }: { row: Row; onToggle: (row: Row) => void; onSent: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pts = row.scores.filter((s) => s.score != null);
  const latest = pts[pts.length - 1];
  const prior = pts[pts.length - 2];
  const band = latest ? bandFor(latest.score, row.scoreRanges, row.higherIsBetter) : null;
  const delta = latest && prior && latest.score != null && prior.score != null ? latest.score - prior.score : null;
  const alert = alertFor(row);

  async function sendNow() {
    setSending(true);
    const r = await sendMeasuresNow(row.clientId, [row.instrumentId], [row.id]);
    setSendMsg({ ok: r.sent, text: r.message });
    setSending(false);
    onSent();
  }

  return (
    <Fragment>
      <tr className={cx('align-middle transition-colors hover:bg-slate-50', alert ? 'bg-rose-50/40' : '')}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={cx('h-2 w-2 shrink-0 rounded-full', row.status === 'active' ? 'bg-blue-600' : 'bg-slate-300')} aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">{row.measure}</div>
              <div className="text-xs text-slate-500">
                {scheduleLabel(row.schedule, row.everyDays)} · {SOURCE_LABEL[row.source] ?? row.source}
              </div>
              <div className="text-xs text-slate-500">{row.clientName}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          {latest && latest.score != null ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-semibold tabular-nums text-slate-900">{latest.score}</span>
                {row.maxScore != null ? <span className="text-sm text-slate-500">/ {row.maxScore}</span> : null}
                {delta !== null && (
                  <span className={cx('text-xs tabular-nums', delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-rose-700' : 'text-slate-500')}>
                    {delta < 0 ? (
                      <TrendingDown className="inline h-3 w-3" aria-hidden />
                    ) : delta > 0 ? (
                      <TrendingUp className="inline h-3 w-3" aria-hidden />
                    ) : (
                      <Minus className="inline h-3 w-3" aria-hidden />
                    )}
                    {Math.abs(delta)}
                  </span>
                )}
              </div>
              {band ? (
                <StatusBadge size="sm" tone={band.tone}>
                  {band.label}
                </StatusBadge>
              ) : latest.severity ? (
                <span className="text-xs text-slate-600">{latest.severity}</span>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-slate-500">No data</span>
          )}
        </td>
        <td className="hidden px-4 py-3 md:table-cell">
          {pts.length >= 2 ? (
            <TrendSparkline scores={pts.slice(-6).map((s) => s.score as number)} tone={band?.tone ?? 'neutral'} />
          ) : (
            <span className="text-xs text-slate-500">Not enough data</span>
          )}
        </td>
        <td className="px-4 py-3 text-center text-sm font-semibold tabular-nums text-slate-800">
          {row.completionRate == null ? '—' : `${row.completionRate}%`}
          <div className="text-xs font-normal text-slate-500">{row.completionRate == null ? 'nothing sent' : 'of sends completed'}</div>
        </td>
        <td className="px-4 py-3">
          {!row.sendable ? (
            <span className="text-xs text-slate-500" title={row.notSendableReason ?? undefined}>
              In session only
            </span>
          ) : row.lastRequest ? (
            <div className="space-y-0.5">
              <SendStatusBadge status={row.lastRequest.status} title={failText(row.lastRequest)} />
              <div className="text-xs text-slate-500">
                {row.lastRequest.completedAt ? fmtDay(row.lastRequest.completedAt) : row.lastRequest.sentAt ? `sent ${fmtDay(row.lastRequest.sentAt)}` : ''}
              </div>
            </div>
          ) : (
            <span className="text-xs text-slate-500">Not sent yet</span>
          )}
        </td>
        <td className="hidden whitespace-nowrap px-4 py-3 text-right text-xs text-slate-500 lg:table-cell">
          <Calendar className="mr-1 inline h-3 w-3 text-slate-400" aria-hidden />
          {row.status !== 'active' ? 'Paused' : row.schedule === 'before_visit' ? 'Each visit' : row.nextDue ? fmtDay(row.nextDue) : 'Done'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            {/* Phones: one compact menu so the row never needs a wide actions column. */}
            <RowActionsMenu
              className="md:hidden"
              label={`Actions for ${row.measure}`}
              actions={[
                ...(row.sendable && row.status === 'active'
                  ? [{ key: 'send', label: sending ? 'Sendingâ€¦' : 'Send now', icon: <Send className="h-4 w-4" />, disabled: sending, onSelect: () => void sendNow() }]
                  : []),
                { key: 'give', label: 'Give in session', icon: <ClipboardList className="h-4 w-4" />, href: giveInSessionHref(row.clientId, row.measure) },
                { key: 'toggle', label: row.status === 'active' ? 'Pause schedule' : 'Resume schedule', onSelect: () => onToggle(row) },
              ]}
            />
            <div className="hidden items-center gap-2 md:flex">
            {row.sendable && row.status === 'active' ? (
              <button
                type="button"
                onClick={() => void sendNow()}
                disabled={sending}
                className={cx(
                  'inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50',
                  FOCUS_RING
                )}
                title="Email / text a questionnaire link now (consent, date of birth on the chart and Part 2 are checked)"
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                {sending ? 'Sending…' : 'Send now'}
              </button>
            ) : null}
            <Link
              href={giveInSessionHref(row.clientId, row.measure)}
              className={cx('inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50', FOCUS_RING)}
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden />
              Give in session
            </Link>
            <button
              type="button"
              onClick={() => onToggle(row)}
              aria-pressed={row.status === 'active'}
              className={cx(
                'h-8 rounded-lg border px-2.5 text-xs font-medium transition',
                FOCUS_RING,
                row.status === 'active' ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              )}
            >
              {row.status === 'active' ? 'Active' : 'Paused'}
            </button>
            </div>
            <IconButton
              label={expanded ? 'Hide score history' : 'Show score history'}
              aria-expanded={expanded}
              icon={expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              onClick={() => setExpanded((v) => !v)}
              className="h-10 w-10 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:h-8 md:w-8"
            />
          </div>
          {sendMsg ? <div className={cx('mt-1 text-right text-xs', sendMsg.ok ? 'text-emerald-700' : 'text-rose-700')}>{sendMsg.text}</div> : null}
        </td>
      </tr>
      {alert && (
        <tr className="bg-rose-50/40">
          <td colSpan={COLUMN_COUNT} className="px-4 pb-3 pt-0">
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {alert.latest.safetyFlagged
                ? 'Safety item endorsed: see Alerts'
                : alert.top
                  ? `Score ${alert.latest.score} is in the most severe band${alert.band ? ` (${alert.band.label})` : ''}`
                  : `Score ${(alert.delta ?? 0) < 0 ? 'fell' : 'increased'} by ${Math.abs(alert.delta ?? 0)} points since last measurement`}
            </div>
          </td>
        </tr>
      )}
      {expanded && (
        <tr>
          <td colSpan={COLUMN_COUNT} className="bg-slate-50 px-4 pb-4 pt-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">Score history</div>
            {pts.length ? (
              <div className="flex flex-wrap gap-4">
                {pts.map((item) => {
                  const b = bandFor(item.score, row.scoreRanges, row.higherIsBetter);
                  return (
                    <div key={item.id} className="text-center">
                      <div className={cx('text-lg font-semibold tabular-nums', TONE_TEXT[b?.tone ?? 'neutral'])}>{item.score}</div>
                      <div className="text-xs text-slate-500">{fmtDay(item.date)}</div>
                      <div className="text-[10px] text-slate-500">{item.source === 'patient_portal' ? 'patient link' : 'in clinic'}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500">No scores yet.</div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default function OutcomesPage() {
  const { clients } = useClients();
  const [rows, setRows] = useState<Row[]>([]);
  const [instruments, setInstruments] = useState<SendableInstrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [filterPatient, setFilterPatient] = useState('all');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/clinical/measure-assignments', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `Could not load (${res.status})`);
      setRows(data.data);
      setInstruments(data.sendable);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load outcome schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patientList = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.clientId)) seen.set(r.clientId, r.clientName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const alerts = useMemo(
    () => rows.flatMap((row) => {
      const a = alertFor(row);
      return a ? [{ row, a }] : [];
    }),
    [rows]
  );
  const filtered = useMemo(() => rows.filter((r) => filterPatient === 'all' || r.clientId === filterPatient), [filterPatient, rows]);
  const withSends = rows.filter((r) => r.completionRate != null);
  const avgCompletion = withSends.length ? Math.round(withSends.reduce((s, r) => s + (r.completionRate ?? 0), 0) / withSends.length) : null;
  const waiting = rows.filter((r) => r.lastRequest && ['Sent', 'Opened', 'Started'].includes(r.lastRequest.status)).length;

  async function toggle(row: Row) {
    const next = row.status === 'active' ? 'paused' : 'active';
    const res = await fetch('/api/clinical/measure-assignments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, status: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) setLoadError(data.error || 'Could not update the schedule');
    void load();
  }

  const selectedPatientName = filterPatient === 'all' ? 'all tracked clients' : patientList.find((p) => p.id === filterPatient)?.name || 'selected client';

  return (
    <Page>
      {showAdd && <AddScheduleModal clients={clients} instruments={instruments} onClose={() => setShowAdd(false)} onSaved={() => void load()} />}
      {showBulk && <BulkSendModal rows={filtered} onClose={() => setShowBulk(false)} onDone={() => void load()} />}

      <PageHeader
        title="Outcome schedules"
        description={
          <>
            Measures scheduled per client. Patients complete them from an email / text link (with consent) before visits once the practice turns on automatic sending
            (Practice settings &gt; Clinical policy &gt; Measurement-based care). Use Send now or Give in session any time.
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/mbc/guide" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <BookOpen className="h-4 w-4" aria-hidden /> Measure guide
            </Link>
            <Button variant="secondary" icon={<Send />} onClick={() => setShowBulk(true)}>
              Send due measures
            </Button>
            <Button icon={<Plus />} onClick={() => setShowAdd(true)}>
              Schedule Measure
            </Button>
          </div>
        }
      />

      <StatGrid columns={4}>
        <StatCard label="Active schedules" value={rows.filter((r) => r.status === 'active').length} icon={<Activity />} tone="brand" />
        <StatCard label="Clinical alerts" value={alerts.length} icon={<Bell />} tone={alerts.length > 0 ? 'danger' : 'neutral'} />
        <StatCard
          label="Avg completion"
          value={avgCompletion == null ? '—' : `${avgCompletion}%`}
          icon={<CheckCircle2 />}
          tone={avgCompletion == null ? 'neutral' : avgCompletion >= 80 ? 'success' : 'warning'}
        />
        <StatCard label={`Clients tracked · ${waiting} waiting on patient`} value={patientList.length} icon={<Users />} />
      </StatGrid>

      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

      {alerts.length > 0 && (
        <Card>
          <CardHeader icon={<Bell className="text-rose-700" />} title={`Clinical alerts - ${alerts.length} measure${alerts.length !== 1 ? 's need' : ' needs'} review`} />
          <ul className="divide-y divide-slate-100">
            {alerts.map(({ row, a }) => (
              <li key={row.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/dashboard/clients/${encodeURIComponent(row.clientId)}?tab=assessments`} className="text-sm font-semibold text-slate-900 hover:underline">
                    {row.clientName}
                  </Link>
                  <span className="mx-2 text-sm text-slate-500">-</span>
                  <span className="text-sm text-slate-600">{row.measure}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className={cx('text-lg font-semibold tabular-nums', TONE_TEXT[a.band?.tone ?? 'neutral'])}>{a.latest.score}</span>
                    {row.maxScore != null ? <span className="ml-1 text-xs text-slate-500">/ {row.maxScore}</span> : null}
                    {a.delta != null && a.delta > 0 && (
                      <div className="text-xs text-rose-700">
                        <TrendingUp className="inline h-3 w-3" aria-hidden /> +{a.delta} pts
                      </div>
                    )}
                  </div>
                  {a.band ? <StatusBadge tone={a.band.tone}>{a.band.label}</StatusBadge> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs
        variant="pill"
        label="Filter by client"
        controlsPanels={false}
        value={filterPatient}
        onChange={setFilterPatient}
        items={[{ key: 'all', label: 'All clients' }, ...patientList.map((p) => ({ key: p.id, label: p.name }))]}
      />

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <LoadingState label="Loading outcome schedules…" rows={4} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Activity />} title={`No schedules for ${selectedPatientName}`} description="Schedule a measure to start tracking scores over time." />
        ) : (
          <div className="clinic-scroll-x">
            <table className="w-full min-w-full border-collapse text-sm">
              <caption className="sr-only">Outcome measure schedules</caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Measure</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Latest score</th>
                  <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600 md:table-cell">Trend</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-center text-xs font-semibold text-slate-600">Completion</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Status</th>
                  <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600 lg:table-cell">Next due</th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => (
                  <ScheduleRow key={row.id} row={row} onToggle={(r) => void toggle(r)} onSent={() => void load()} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
