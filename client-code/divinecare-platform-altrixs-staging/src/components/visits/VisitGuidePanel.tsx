'use client';

/**
 * Visit Guide beside the note: briefing, the protocol checklist for this visit type (prepare /
 * during / wrap-up), what is due for this patient, the requirements behind each item, and a
 * suggested follow-up. Steps are prompts, never findings; nothing here blocks signing.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { DueItem, GuideStep, Requirement, StepStatus, VisitGuide } from '@/lib/visits/types';
import { formatWallClock, practiceToday, toPracticeWallTime } from '@/lib/time/practiceTime';
import { useVisitGuide, type VisitGuideController } from '@/components/visits/useVisitGuide';
import {
  PHASE_LABEL,
  WHEN_LABEL,
  bookFollowUpHref,
  followUpLabel,
  followUpTypeForKind,
  guideActionTarget,
  guideProgress,
  noteHasCssrsScreen,
  outstandingRequired,
  withLiveNoteSteps,
  type ActionTarget,
} from '@/components/visits/visitGuideHelpers';

export type VisitGuidePanelProps = {
  clientId: string;
  appointmentId?: string | null;
  kind?: string | null;
  noteId?: string | null;
  /** Current note text by section, so 'note' steps tick live */
  noteSections?: Record<string, string>;
  onNoteTypeResolved?: (noteType: string, cpt: string[]) => void;
  compact?: boolean;
  /** Share one loaded guide with the page (e.g. the sign-time warnings); otherwise the panel loads its own */
  controller?: VisitGuideController;
  /** 'note_section' actions: scroll to / focus that section of the open note */
  onFocusSection?: (section: string) => void;
  /** Base date for the follow-up suggestion (YYYY-MM-DD); defaults to today on the practice clock */
  visitDate?: string;
  /** Start as the slim rail */
  defaultCollapsed?: boolean;
  /** Hide the collapse-to-rail control (e.g. inside a mobile drawer) */
  collapsible?: boolean;
  className?: string;
  /** Visit linked to an appointment: "Change visit type" opens the editor's Visit type control */
  onChangeVisitType?: () => void;
};

type Tab = 'brief' | 'checklist' | 'due' | 'requirements';
const TABS: { id: Tab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'due', label: 'Due' },
  { id: 'requirements', label: 'Requirements' },
];

const LEVEL_CHIP: Record<GuideStep['level'], string> = {
  required: 'bg-violet-100 text-[#5C2D91]',
  recommended: 'bg-sky-50 text-sky-800',
  optional: 'bg-slate-100 text-slate-600',
};

const SEVERITY_CHIP: Record<DueItem['severity'], string> = {
  overdue: 'bg-rose-100 text-rose-800',
  due: 'bg-amber-100 text-amber-900',
  info: 'bg-slate-100 text-slate-700',
};

/**
 * Opens Rcopia in a new tab (opened synchronously on click so the pop-up blocker allows it).
 * The message in-basket (refills / change requests) opens without a patient: Rcopia shows it in
 * multi-patient mode, so the patient upload is skipped and cannot block it.
 */
export async function openDrFirst(clientId: string, screen: string): Promise<string | null> {
  const win = window.open('about:blank', '_blank');
  const withPatient = screen !== 'message' && screen !== 'report';
  try {
    const qs = new URLSearchParams({ screen });
    if (withPatient) qs.set('patient', clientId);
    const res = await fetch(`/api/drfirst/sso?${qs.toString()}`);
    const data = (await res.json().catch(() => ({}))) as { url?: string; demo?: boolean; error?: string; message?: string; fallbackUrl?: string };
    if (data.demo && data.fallbackUrl && win) {
      // DrFirst not configured on this server: the in-app Prescriptions page instead of a dead end
      win.location.href = data.fallbackUrl;
      return null;
    }
    if (!res.ok || !data.url || data.demo) {
      win?.close();
      return data.error || data.message || 'DrFirst could not be opened.';
    }
    if (win) win.location.href = data.url;
    else window.open(data.url, '_blank');
    return null;
  } catch {
    win?.close();
    return 'Could not reach DrFirst. Try again.';
  }
}

/** Records the prescriber's CRISP PDMP query (marylandPdmpAudit, audited); the guide then re-checks. */
async function recordPdmp(clientId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/prescribing/pdmp-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? null : data.error || 'The PDMP query could not be recorded.';
  } catch {
    return 'Could not reach the server. Try again.';
  }
}

function ActionButton({
  target,
  clientId,
  onFocusSection,
  onRecorded,
}: {
  target: ActionTarget | null;
  clientId: string;
  onFocusSection?: (section: string) => void;
  /** After a PDMP query is recorded: reload the guide so the step shows done */
  onRecorded?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (!target) return null;
  const cls =
    'inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#5C2D91] hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40 disabled:opacity-60';
  if (target.kind === 'section') {
    if (!onFocusSection) return null;
    return (
      <button type="button" className={cls} onClick={() => onFocusSection(target.section)}>
        {target.label}
      </button>
    );
  }
  if (target.kind === 'pdmp') {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        {confirming ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={cls}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const err = await recordPdmp(clientId);
                setBusy(false);
                setError(err);
                if (!err) {
                  setConfirming(false);
                  onRecorded?.();
                }
              }}
            >
              {busy ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Check size={11} aria-hidden />}
              I queried CRISP for this patient today
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className={cls} onClick={() => setConfirming(true)}>
            <ShieldCheck size={11} aria-hidden />
            {target.label}
          </button>
        )}
        {error ? (
          <span role="alert" className="text-[11px] font-semibold text-rose-700">
            {error}
          </span>
        ) : null}
      </span>
    );
  }
  if (target.kind === 'drfirst') {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button
          type="button"
          className={cls}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await openDrFirst(clientId, target.screen));
            setBusy(false);
          }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <ExternalLink size={11} aria-hidden />}
          {target.label}
        </button>
        {error ? (
          <span role="alert" className="text-[11px] font-semibold text-rose-700">
            {error}
          </span>
        ) : null}
      </span>
    );
  }
  // New tab: the note being written stays open
  return (
    <Link href={target.href} target="_blank" rel="noopener noreferrer" className={cls}>
      <ExternalLink size={11} aria-hidden />
      {target.label}
    </Link>
  );
}

function WhyDisclosure({ basis, requirements }: { basis?: string[]; requirements: Map<string, Requirement> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reqs = (basis || []).map((b) => requirements.get(b)).filter(Boolean) as Requirement[];
  if (!reqs.length) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40"
      >
        <Info size={11} aria-hidden /> Why
      </button>
      {open ? (
        <ul id={id} className="mt-1 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {reqs.map((r) => (
            <RequirementItem key={r.id} r={r} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RequirementItem({ r }: { r: Requirement }) {
  return (
    <li className="text-[11px] leading-snug text-slate-700">
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-900">{r.title}</span>
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">{r.authority}</span>
        {r.confirmedOn ? (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            Confirmed by practice {r.confirmedOn}
          </span>
        ) : r.confirm ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">Confirm with compliance</span>
        ) : null}
      </p>
      <p className="mt-0.5">{r.rule}</p>
      {r.citation ? <p className="mt-0.5 text-[10px] text-slate-500">{r.citation}</p> : null}
    </li>
  );
}

function ReasonForm({
  status,
  busy,
  onSubmit,
  onCancel,
}: {
  status: 'not_applicable' | 'deferred';
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <form
      className="mt-1.5 flex flex-wrap items-end gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onSubmit(reason.trim());
      }}
    >
      <label htmlFor={id} className="w-full text-[11px] font-semibold text-slate-600">
        {status === 'deferred' ? 'Why defer? (required)' : 'Why not applicable? (required)'}
      </label>
      <input
        id={id}
        ref={inputRef}
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-[#5C2D91] focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/20"
      />
      <button
        type="submit"
        disabled={!reason.trim() || busy}
        className="rounded-lg bg-[#5C2D91] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">
        Cancel
      </button>
    </form>
  );
}

function StepRow({
  step,
  guide,
  ctrl,
  requirements,
  clientId,
  onFocusSection,
  followUpDays,
  today,
}: {
  step: GuideStep;
  guide: VisitGuide;
  ctrl: VisitGuideController;
  requirements: Map<string, Requirement>;
  clientId: string;
  onFocusSection?: (section: string) => void;
  followUpDays: number | null;
  today: string;
}) {
  const [reasonFor, setReasonFor] = useState<'not_applicable' | 'deferred' | null>(null);
  const busy = Boolean(ctrl.pending[step.id]);
  const checkboxId = useId();
  const done = step.status === 'done';
  const skipped = step.status === 'not_applicable' || step.status === 'deferred';
  const when = (step as GuideStep & { when?: string }).when;
  const target = guideActionTarget(step.action, {
    clientId,
    appointmentId: guide.appointmentId,
    today,
    followUpDays,
    kind: guide.kind,
  });
  const sourceNote =
    step.source === 'auto' ? 'Checked from the chart' : step.source === 'note' ? `Ticks when "${step.noteSection}" has text` : null;

  return (
    <li className={`rounded-lg border px-2.5 py-2 ${done ? 'border-emerald-200 bg-emerald-50/50' : skipped ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={done}
          disabled={step.source !== 'manual' || busy || skipped}
          onChange={() => void (done ? ctrl.unmark(step.id) : ctrl.mark(step.id, 'done'))}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#5C2D91]"
          aria-describedby={sourceNote ? `${checkboxId}-src` : undefined}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={checkboxId} className={`block text-xs font-semibold ${done || skipped ? 'text-slate-500' : 'text-slate-900'} ${skipped ? 'line-through' : ''}`}>
            {step.label}
          </label>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${LEVEL_CHIP[step.level]}`}>{step.level}</span>
            {when ? <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">{WHEN_LABEL[when] || when}</span> : null}
            {busy ? <Loader2 size={11} className="animate-spin text-slate-400" aria-label="Saving" /> : null}
          </div>
          {step.help ? <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{step.help}</p> : null}
          {sourceNote ? (
            <p id={`${checkboxId}-src`} className="mt-0.5 text-[10px] text-slate-400">
              {sourceNote}
            </p>
          ) : null}
          {step.detail ? (
            <p className={`mt-0.5 text-[11px] ${skipped ? 'text-slate-600' : 'text-emerald-800'}`}>
              {step.status === 'not_applicable' ? 'N/A: ' : step.status === 'deferred' ? 'Deferred: ' : ''}
              {step.detail}
            </p>
          ) : skipped ? (
            <p className="mt-0.5 text-[11px] text-slate-600">{step.status === 'deferred' ? 'Deferred' : 'Not applicable'}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {!done && !skipped ? <ActionButton target={target} clientId={clientId} onFocusSection={onFocusSection} onRecorded={ctrl.reload} /> : null}
            {!done && !skipped && !reasonFor ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReasonFor('not_applicable')}
                  className="rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  N/A
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReasonFor('deferred')}
                  className="rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  Defer
                </button>
              </>
            ) : null}
            {skipped ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void ctrl.unmark(step.id)}
                className="rounded-lg px-1.5 py-1 text-[11px] font-semibold text-[#5C2D91] hover:bg-violet-50"
              >
                Undo
              </button>
            ) : null}
            <WhyDisclosure basis={step.basis} requirements={requirements} />
          </div>
          {reasonFor ? (
            <ReasonForm
              status={reasonFor}
              busy={busy}
              onCancel={() => setReasonFor(null)}
              onSubmit={async (reason) => {
                const ok = await ctrl.mark(step.id, reasonFor, reason);
                if (ok) setReasonFor(null);
              }}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#5C2D91]">{title}</h4>
      {children}
    </section>
  );
}

function BriefView({ guide }: { guide: VisitGuide }) {
  const b = guide.brief;
  const none = <p className="text-[11px] text-slate-400">None on file</p>;
  return (
    <div className="space-y-3 text-xs text-slate-700">
      <Section title="Last visit">
        {b.lastVisit ? (
          <p>
            {b.lastVisit.date} · {b.lastVisit.type}
          </p>
        ) : (
          <p className="text-[11px] text-slate-400">No earlier visit</p>
        )}
      </Section>
      <Section title="Last plan">
        {b.lastPlan ? (
          <p className="whitespace-pre-wrap">
            <span className="text-[11px] text-slate-500">{b.lastPlan.date}: </span>
            {b.lastPlan.text}
          </p>
        ) : (
          none
        )}
      </Section>
      <Section title="Open follow-ups / homework">
        {b.openFollowUps.length ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {b.openFollowUps.map((f) => (
              <li key={f.id}>
                {f.text} <span className="text-[11px] text-slate-500">({f.kind}, {f.from})</span>
              </li>
            ))}
          </ul>
        ) : (
          none
        )}
      </Section>
      <Section title="Scores">
        {b.scores.length ? (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="font-semibold">Measure</th>
                <th className="font-semibold">Latest</th>
                <th className="font-semibold">Prior</th>
                <th className="font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {b.scores.map((s) => {
                const trend =
                  s.latest != null && s.previous != null ? (s.latest > s.previous ? 'up' : s.latest < s.previous ? 'down' : 'same') : null;
                return (
                  <tr key={s.instrument}>
                    <td className="font-semibold text-slate-800">{s.instrument}</td>
                    <td>
                      {s.latest ?? '-'}
                      {trend ? <span className="ml-1 text-slate-500">({trend === 'same' ? 'no change' : trend})</span> : null}
                    </td>
                    <td>{s.previous ?? '-'}</td>
                    <td>{s.date ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          none
        )}
      </Section>
      <Section title="Risk">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold">Level: {b.risk.level || 'not set'}</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${b.risk.openAlerts ? 'bg-rose-100 text-rose-800' : 'bg-slate-100'}`}>
            {b.risk.openAlerts} open alert{b.risk.openAlerts === 1 ? '' : 's'}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${b.risk.safetyPlanOnFile ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
            {b.risk.safetyPlanOnFile ? 'Safety plan on file' : 'No safety plan on file'}
          </span>
        </p>
      </Section>
      <Section title="Medications">
        {b.meds.length ? (
          <ul className="space-y-0.5">
            {b.meds.map((m) => (
              <li key={m.name} className="flex flex-wrap items-center gap-1">
                <span>{m.name}</span>
                {m.controlled ? <span className="rounded bg-rose-50 px-1 text-[10px] font-semibold text-rose-800">controlled</span> : null}
                {m.startedRecently ? <span className="rounded bg-sky-50 px-1 text-[10px] font-semibold text-sky-800">new</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          none
        )}
      </Section>
      {b.changesSinceLastVisit.length ? (
        <Section title="Since the last visit">
          <ul className="list-disc space-y-0.5 pl-4">
            {b.changesSinceLastVisit.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {b.careTeam.length ? (
        <Section title="Care team">
          <ul className="list-disc space-y-0.5 pl-4">
            {b.careTeam.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <p className="text-[10px] text-slate-400">Chart facts only. Verify before relying on them.</p>
    </div>
  );
}

/** "2026-10-28 2:00 PM" on the practice clock (the API sends an ISO instant) */
function nextBookedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const w = toPracticeWallTime(d);
  return `${w.date} ${formatWallClock(w.time)}`;
}

function FollowUpCard({ guide, clientId, today }: { guide: VisitGuide; clientId: string; today: string }) {
  const f = guide.followUp;
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-[#5C2D91]">
        <CalendarPlus size={13} aria-hidden /> Follow-up
      </p>
      <p className="mt-1 text-[11px] text-slate-700">
        {f.suggestedDays != null ? `Suggested in ${followUpLabel(f.suggestedDays)}.` : 'Interval per clinician.'} {f.reason}
      </p>
      {f.nextBooked ? <p className="mt-1 text-[11px] font-semibold text-emerald-800">Next visit booked: {nextBookedLabel(f.nextBooked)}</p> : null}
      <Link
        href={bookFollowUpHref({ clientId, days: f.suggestedDays, from: today, type: followUpTypeForKind(guide.kind) })}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
      >
        <CalendarPlus size={12} aria-hidden />
        {f.suggestedDays != null ? `Book follow-up in ${followUpLabel(f.suggestedDays)}` : 'Book follow-up'}
      </Link>
    </div>
  );
}

export function VisitGuidePanel(props: VisitGuidePanelProps) {
  const {
    clientId,
    appointmentId,
    kind,
    noteId,
    noteSections,
    onNoteTypeResolved,
    compact,
    controller,
    onFocusSection,
    visitDate,
    defaultCollapsed,
    collapsible = true,
    className = '',
    onChangeVisitType,
  } = props;
  const own = useVisitGuide(controller ? null : clientId ? { clientId, appointmentId, kind, noteId } : null);
  const ctrl = controller ?? own;
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed));
  const [tab, setTab] = useState<Tab>('checklist');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = useId();
  const today = visitDate || practiceToday();
  const raw = ctrl.guide;

  const resolvedKey = raw ? `${raw.clientId}|${raw.appointmentId}|${raw.noteType}` : '';
  const resolvedRef = useRef('');
  useEffect(() => {
    if (!raw || !onNoteTypeResolved || resolvedRef.current === resolvedKey) return;
    resolvedRef.current = resolvedKey;
    onNoteTypeResolved(raw.noteType, raw.cpt);
  }, [raw, resolvedKey, onNoteTypeResolved]);

  const steps = useMemo(() => (raw ? withLiveNoteSteps(raw.steps, noteSections) : []), [raw, noteSections]);
  const progress = useMemo(() => guideProgress(steps), [steps]);
  const requirements = useMemo(() => new Map((raw?.requirements || []).map((r) => [r.id, r])), [raw]);
  const cssrsInNote = useMemo(() => noteHasCssrsScreen(noteSections), [noteSections]);
  const guide = raw ? { ...raw, steps, due: cssrsInNote ? raw.due.filter((d) => d.id !== 'cssrs') : raw.due } : null;
  const dueCount = guide ? guide.due.length : 0;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = TABS.findIndex((t) => t.id === tab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  if (collapsed && collapsible) {
    return (
      <div className="flex w-11 flex-col items-center gap-2 rounded-xl border border-violet-200 bg-white py-3">
        <button
          type="button"
          aria-expanded={false}
          aria-label={`Show visit guide${raw ? ` (${progress.remaining} required left)` : ''}`}
          onClick={() => setCollapsed(false)}
          className="rounded-lg p-1.5 text-[#5C2D91] hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <ClipboardList size={16} className="text-[#5C2D91]" aria-hidden />
        {raw ? (
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-[#5C2D91]" title="Required steps left">
            {progress.remaining}
          </span>
        ) : null}
        <span className="text-[10px] font-semibold text-slate-500 [writing-mode:vertical-rl]">Visit guide</span>
      </div>
    );
  }

  const phases: GuideStep['phase'][] = ['prepare', 'during', 'wrap_up'];

  return (
    <section
      aria-label="Visit guide"
      className={`flex min-w-0 flex-col rounded-xl border border-violet-200 bg-white ${compact ? 'text-xs' : ''} ${className}`}
    >
      <header className="border-b border-violet-100 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <ClipboardList size={16} className="mt-0.5 shrink-0 text-[#5C2D91]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5C2D91]">Visit guide</p>
            <p className="flex items-center gap-1 text-sm font-bold text-slate-900">
              <span className="truncate">{raw ? raw.label : ctrl.loading ? 'Loading…' : 'Visit guide'}</span>
              {raw?.resolvedFrom ? (
                <span title={`Resolved from ${raw.resolvedFrom}`} aria-label={`Resolved from ${raw.resolvedFrom}`} className="shrink-0 text-slate-400">
                  <Info size={12} aria-hidden />
                </span>
              ) : null}
            </p>
            {onChangeVisitType && appointmentId ? (
              <button
                type="button"
                onClick={onChangeVisitType}
                className="text-[11px] font-semibold text-[#5C2D91] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40"
              >
                Visit type changed? Change it
              </button>
            ) : null}
          </div>
          {raw || ctrl.error ? (
            <button
              type="button"
              onClick={ctrl.reload}
              aria-label="Refresh visit guide"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <RefreshCw size={13} className={ctrl.loading ? 'animate-spin' : ''} aria-hidden />
            </button>
          ) : null}
          {collapsible ? (
            <button
              type="button"
              aria-expanded
              aria-label="Collapse visit guide"
              onClick={() => setCollapsed(true)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          ) : null}
        </div>
        {raw ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${progress.remaining === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-[#5C2D91]'}`}
              title="Required steps done, N/A or deferred"
            >
              {progress.requiredResolved}/{progress.required} required
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${dueCount ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
              {dueCount} due
            </span>
          </div>
        ) : null}
      </header>

      {ctrl.loading && !raw ? (
        <p className="flex items-center gap-2 px-3 py-6 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" aria-hidden /> Building the guide…
        </p>
      ) : ctrl.error && !raw ? (
        <div className="px-3 py-4 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-slate-700">
            <AlertTriangle size={13} className="text-amber-600" aria-hidden /> {ctrl.error}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">You can still write and sign the note. Try again in a moment.</p>
          <button type="button" onClick={ctrl.reload} className="mt-2 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            Try again
          </button>
        </div>
      ) : guide ? (
        <>
          <div role="tablist" aria-label="Visit guide sections" className="flex gap-0.5 overflow-x-auto border-b border-slate-100 px-2 pt-1.5">
            {TABS.map((t) => {
              const selected = tab === t.id;
              const count = t.id === 'checklist' ? progress.remaining : t.id === 'due' ? dueCount : null;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 rounded-t-lg border-b-2 px-2 py-1.5 text-[11px] font-semibold ${
                    selected ? 'border-[#5C2D91] text-[#5C2D91]' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                  {count ? <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{count}</span> : null}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`${baseId}-panel-${tab}`}
            aria-labelledby={`${baseId}-tab-${tab}`}
            className={`overflow-y-auto px-3 py-3 ${compact ? 'max-h-[28rem]' : ''}`}
          >
            {ctrl.actionError ? (
              <p role="alert" className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-700">
                {ctrl.actionError}
              </p>
            ) : null}
            {tab === 'brief' ? <BriefView guide={guide} /> : null}
            {tab === 'checklist' ? (
              <div className="space-y-3">
                {phases.map((phase) => {
                  const items = guide.steps.filter((s) => s.phase === phase);
                  if (!items.length) return null;
                  return (
                    <div key={phase}>
                      <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{PHASE_LABEL[phase]}</h4>
                      <ul className="space-y-1.5">
                        {items.map((s) => (
                          <StepRow
                            key={s.id}
                            step={s}
                            guide={guide}
                            ctrl={ctrl}
                            requirements={requirements}
                            clientId={clientId}
                            onFocusSection={onFocusSection}
                            followUpDays={guide.followUp.suggestedDays}
                            today={today}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {!guide.steps.length ? <p className="text-[11px] text-slate-500">No protocol steps for this visit type.</p> : null}
              </div>
            ) : null}
            {tab === 'due' ? (
              guide.due.length ? (
                <ul className="space-y-1.5">
                  {guide.due.map((d) => (
                    <li key={d.id} className="rounded-lg border border-slate-200 px-2.5 py-2">
                      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-900">
                        {d.label}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_CHIP[d.severity]}`}>{d.severity}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-600">{d.reason}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <ActionButton
                          target={guideActionTarget(d.action, {
                            clientId,
                            appointmentId: guide.appointmentId,
                            today,
                            followUpDays: guide.followUp.suggestedDays,
                            kind: guide.kind,
                          })}
                          clientId={clientId}
                          onFocusSection={onFocusSection}
                          onRecorded={ctrl.reload}
                        />
                        <WhyDisclosure basis={d.basis} requirements={requirements} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Check size={12} className="text-emerald-600" aria-hidden /> Nothing due for this patient.
                </p>
              )
            ) : null}
            {tab === 'requirements' ? (
              guide.requirements.length ? (
                <ul className="space-y-2">
                  {guide.requirements.map((r) => (
                    <RequirementItem key={r.id} r={r} />
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">No requirements listed.</p>
              )
            ) : null}
          </div>
          <div className="border-t border-slate-100 p-3">
            <FollowUpCard guide={guide} clientId={clientId} today={today} />
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * Sign-time reminder: required guide steps still open. Warnings only (never blocks signing), with a
 * "Mark N/A" shortcut that asks for the reason.
 */
export function VisitGuideSignWarnings({ controller, noteSections }: { controller: VisitGuideController; noteSections?: Record<string, string> }) {
  const [naFor, setNaFor] = useState<string | null>(null);
  const raw = controller.guide;
  const open = useMemo(() => (raw ? outstandingRequired(withLiveNoteSteps(raw.steps, noteSections)) : []), [raw, noteSections]);
  if (!raw || !open.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="status">
      <p className="flex items-center gap-1.5 font-semibold">
        <ShieldCheck size={14} aria-hidden /> Visit guide: {open.length} required step{open.length === 1 ? '' : 's'} not done
      </p>
      <p className="mt-0.5 text-[11px] text-amber-800">You can still sign. Complete them, or mark them N/A with a reason.</p>
      <ul className="mt-2 space-y-1.5">
        {open.map((s) => (
          <li key={s.id} className="rounded-lg bg-white/70 px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{s.label}</span>
              {naFor !== s.id ? (
                <button
                  type="button"
                  disabled={Boolean(controller.pending[s.id])}
                  onClick={() => setNaFor(s.id)}
                  className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Mark N/A
                </button>
              ) : null}
            </div>
            {naFor === s.id ? (
              <ReasonForm
                status="not_applicable"
                busy={Boolean(controller.pending[s.id])}
                onCancel={() => setNaFor(null)}
                onSubmit={async (reason) => {
                  const ok = await controller.mark(s.id, 'not_applicable' as Exclude<StepStatus, 'not_done'>, reason);
                  if (ok) setNaFor(null);
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {controller.actionError ? <p className="mt-1 text-[11px] font-semibold text-rose-700">{controller.actionError}</p> : null}
    </div>
  );
}
