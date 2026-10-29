'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSignature,
  Loader2,
  Lock,
  Save,
  ShieldAlert,
  Users,
  Video,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { ConfirmDialog, Alert } from '@/components/ui';
import type { AttendeeView } from '@/lib/groups/store';
import type { PrivacyWarning } from '@/lib/groups/rules';
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_STATUSES,
  GROUP_KIND_META,
  INDIVIDUAL_FIELDS,
  SHARED_FIELDS,
  isAttended,
  type AttendanceStatus,
  type GroupKind,
  type NoteField,
  type NoteValues,
  type PlanGoalOption,
} from '@/lib/groups/types';
import { ErrorNote, KindHeader, Part2Banner, Pill, apiBase, formatDate, formatTime, primaryBtn, secondaryBtn } from './shared';
import { GroupScribePanel } from '@/components/scribe/GroupScribePanel';
import { acceptGroupValues, groupValuesHaveMarker, mergeAiValues } from '@/lib/scribe/group';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prefillAttendanceFromVideo, type VideoAttendance } from '@/lib/groups/video';
import { GroupVideoPanel } from './GroupVideoPanel';

type SessionResponse = {
  timeZone: string;
  session: {
    id: string;
    groupId: string;
    groupName: string;
    kind: GroupKind;
    groupTypeLabel: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    status: string;
    telehealth: boolean;
    room: string | null;
    topic: string | null;
    shared: NoteValues | null;
    sharedMissing: string[];
    groupSize: number;
    part2: boolean;
    billingCode: string | null;
    billingMode: string;
    minBillableMinutes: number | null;
    maxBillableGroupSize: number | null;
    facilitatorName: string | null;
    coFacilitatorName: string | null;
    signerTitle: string;
  };
  attendees: AttendeeView[];
  privacyWarnings: PrivacyWarning[];
  canDocument: boolean;
  cosignRequiredForMe: boolean;
  consentCheckAvailable: boolean;
  part2Notice: string | null;
};

type Step = 'attendance' | 'shared' | 'individual' | 'sign';
const STEPS: { id: Step; label: string }[] = [
  { id: 'attendance', label: '1. Attendance' },
  { id: 'shared', label: '2. Group section' },
  { id: 'individual', label: '3. Each member' },
  { id: 'sign', label: '4. Review and sign' },
];

const ATT_STYLE: Record<string, string> = {
  present: 'border-emerald-600 bg-emerald-600 text-white',
  late: 'border-amber-500 bg-amber-500 text-white',
  left_early: 'border-amber-600 bg-amber-600 text-white',
  absent: 'border-rose-600 bg-rose-600 text-white',
  excused: 'border-blue-600 bg-blue-600 text-white',
};

type Mark = { status: AttendanceStatus; minutesAttended: number | null; patientLocationType: 'home' | 'other' | null };

function FieldInput({ field, value, onChange, goals, disabled }: { field: NoteField; value: NoteValues[string]; onChange: (v: NoteValues[string]) => void; goals: PlanGoalOption[]; disabled?: boolean }) {
  const id = `f-${field.key}`;
  const label = (
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
      {field.label}
      {field.required ? <span className="text-rose-600"> *</span> : null}
    </label>
  );
  const help = field.help ? <p className="mt-1 text-xs text-slate-500">{field.help}</p> : null;
  if (field.kind === 'goals') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">{field.label}</legend>
        {goals.length === 0 ? <p className="text-sm text-slate-500">No active treatment plan goals on file for this client.</p> : null}
        <div className="space-y-1.5">
          {goals.map((g) => (
            <label key={g.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5"
                disabled={disabled}
                checked={selected.includes(g.id)}
                onChange={(e) => onChange(e.target.checked ? [...selected, g.id] : selected.filter((x) => x !== g.id))}
              />
              <span>{g.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (field.kind === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">{field.label}</legend>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4" disabled={disabled} checked={selected.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (field.kind === 'select') {
    return (
      <div>
        {label}
        <select id={id} className="clinic-input" disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  }
  if (field.kind === 'number') {
    return (
      <div>
        {label}
        <input id={id} type="number" min={field.min} max={field.max} className="clinic-input" disabled={disabled} value={typeof value === 'number' ? value : value ? Number(value) : ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
        {help}
      </div>
    );
  }
  return (
    <div>
      {label}
      {field.kind === 'textarea' ? (
        <textarea id={id} rows={3} className="clinic-input" disabled={disabled} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="clinic-input" disabled={disabled} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {help}
    </div>
  );
}

function missing(fields: NoteField[], values: NoteValues | undefined) {
  return fields.filter((f) => f.required).filter((f) => {
    const v = values?.[f.key];
    return v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
  });
}

function LegacyText({ values }: { values: NoteValues | null | undefined }) {
  const t = values?.legacyText;
  if (typeof t !== 'string' || !t) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="text-xs font-semibold uppercase text-slate-500">Imported from the old group page (unsigned draft text)</p>
      <p className="mt-1 whitespace-pre-wrap text-slate-700">{t}</p>
    </div>
  );
}

export function SessionRunner({ kind }: { kind: GroupKind }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const scribeParam = useSearchParams().get('scribe') === '1';
  const { user } = useAuth();
  const canScribe = canAccessPath(String(user?.role || ''), '/dashboard/scribe');
  const [data, setData] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('attendance');
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [shared, setShared] = useState<NoteValues>({});
  const [individual, setIndividual] = useState<Record<string, NoteValues>>({});
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [attested, setAttested] = useState(false);
  // Late entry (signed after the practice deadline): reason sent with the signature; the server requires it only when late
  const [lateReason, setLateReason] = useState('');
  const [confirmSign, setConfirmSign] = useState<string[] | 'all' | null>(null);
  // Group telehealth: video joins / leaves prefill attendance (never saved or signed automatically)
  const [videoAtt, setVideoAtt] = useState<{ hasRoom: boolean; roomEnded: boolean; rows: VideoAttendance[] } | null>(null);
  const [prefilledIds, setPrefilledIds] = useState<Set<string>>(new Set());
  const [autoPrefilled, setAutoPrefilled] = useState(false);
  const [signResults, setSignResults] = useState<{ clientId: string; ok: boolean; error?: string; cosignRequired?: boolean; claim?: { created: boolean; blocked?: string } | null }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<SessionResponse>(`${apiBase()}/sessions/${sessionId}`);
      setData(r);
      const m: Record<string, Mark> = {};
      const ind: Record<string, NoteValues> = {};
      for (const a of r.attendees) {
        if (!a.clientId) continue;
        m[a.clientId] = { status: a.status, minutesAttended: a.minutesAttended, patientLocationType: (a.patientLocationType as Mark['patientLocationType']) ?? null };
        const vals: NoteValues = { ...(a.individual ?? {}) };
        // UDS from the Labs module prefills the SUD note (source marked "lab"); staff can change it
        if (r.session.kind === 'sud' && a.uds && !vals.udsSource) {
          vals.udsSource = 'lab';
          vals.udsResult = `${a.uds.testName}: ${a.uds.value}${a.uds.flag && a.uds.flag !== 'N' ? ` (flag ${a.uds.flag})` : ''}`;
          vals.udsDate = a.uds.collectedOn;
        }
        ind[a.clientId] = vals;
      }
      setMarks(m);
      setIndividual(ind);
      setShared(r.session.shared ?? {});
      setDirty(false);
      if (r.attendees.some((a) => a.status !== 'unmarked')) setStep((s) => (s === 'attendance' && r.session.shared ? 'individual' : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the session');
    }
  }, [sessionId]);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => (data?.attendees ?? []).filter((a) => a.visible && a.clientId), [data]);
  const hidden = useMemo(() => (data?.attendees ?? []).filter((a) => !a.visible), [data]);
  const attending = visible.filter((a) => isAttended(marks[a.clientId!]?.status));
  const signedIds = new Set(visible.filter((a) => a.note && ['SIGNED', 'LOCKED'].includes(a.note.status)).map((a) => a.clientId!));
  const locked = (clientId: string) => signedIds.has(clientId);
  const canEdit = Boolean(data?.canDocument) && data?.session.status !== 'cancelled';

  const setMark = (clientId: string, patch: Partial<Mark>) => {
    setPrefilledIds((cur) => {
      if (!cur.has(clientId)) return cur;
      const next = new Set(cur);
      next.delete(clientId);
      return next;
    });
    setMarks((m) => ({ ...m, [clientId]: { ...(m[clientId] ?? { status: 'unmarked', minutesAttended: null, patientLocationType: null }), ...patch } }));
    setDirty(true);
  };

  const onVideoData = useCallback((a: { hasRoom: boolean; roomEnded: boolean; rows: VideoAttendance[] } | null) => setVideoAtt(a), []);

  /** Fill attendance from the video room. Facilitator reviews and saves; nothing is signed. */
  const applyVideoPrefill = useCallback(
    (auto: boolean) => {
      if (!data || !videoAtt?.hasRoom) return;
      const lockedIds = (data.attendees ?? []).filter((a) => a.clientId && a.note && ['SIGNED', 'LOCKED'].includes(a.note.status)).map((a) => a.clientId!);
      const r = prefillAttendanceFromVideo({ marks, video: videoAtt.rows, roomEnded: videoAtt.roomEnded, durationMinutes: data.session.durationMinutes, lockedClientIds: lockedIds, refreshClientIds: prefilledIds });
      if (!r.changed.length) {
        if (!auto) setInfo('Nothing to fill from the video: every member is already marked or has not joined yet.');
        return;
      }
      setMarks(r.marks as Record<string, Mark>);
      setPrefilledIds((cur) => new Set([...cur, ...r.changed]));
      setDirty(true);
      setInfo(`Attendance filled from the video for ${r.changed.length} member${r.changed.length === 1 ? '' : 's'}. Review, change anything that is wrong, then Save attendance.`);
    },
    [data, videoAtt, marks, prefilledIds]
  );

  // After the room ends, prefill once (unmarked members only)
  useEffect(() => {
    if (autoPrefilled || !videoAtt?.roomEnded || !data?.canDocument || !Object.keys(marks).length) return;
    setAutoPrefilled(true);
    applyVideoPrefill(true);
  }, [autoPrefilled, videoAtt, data, marks, applyVideoPrefill]);

  const saveAttendance = async () => {
    if (!data) return true;
    const list = Object.entries(marks).map(([clientId, m]) => ({ clientId, ...m }));
    if (!list.length) return true;
    setBusy('attendance');
    setError(null);
    try {
      const r = await apiJson<{ saved: number; problems: string[] }>(`${apiBase()}/sessions/${data.session.id}/attendance`, { method: 'PUT', body: JSON.stringify({ marks: list }) });
      setInfo(`Attendance saved for ${r.saved} member${r.saved === 1 ? '' : 's'}.${r.problems.length ? ` ${r.problems.join(' ')}` : ''}`);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save attendance');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveNotes = async () => {
    if (!data) return true;
    setBusy('notes');
    setError(null);
    try {
      const individuals = attending.filter((a) => !locked(a.clientId!)).map((a) => ({ clientId: a.clientId!, values: individual[a.clientId!] ?? {} }));
      await apiJson(`${apiBase()}/sessions/${data.session.id}/notes`, { method: 'PUT', body: JSON.stringify({ shared, individuals }) });
      setInfo('Draft saved. Each attending member has a draft note in their own chart.');
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save notes');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const goto = async (next: Step) => {
    if (dirty && canEdit) {
      const ok = step === 'attendance' ? await saveAttendance() : await saveNotes();
      if (!ok) return;
    }
    setInfo(null);
    setStep(next);
  };

  const sign = async (clientIds: string[] | 'all') => {
    if (!data) return;
    setBusy('sign');
    setError(null);
    try {
      if (dirty) await saveNotes();
      const r = await apiJson<{ results: NonNullable<typeof signResults> }>(`${apiBase()}/sessions/${data.session.id}/sign`, {
        method: 'POST',
        body: JSON.stringify({ attested: true, clientIds: clientIds === 'all' ? null : clientIds, ...(lateReason.trim() ? { lateEntryReason: lateReason.trim() } : {}) }),
      });
      setSignResults(r.results);
      setConfirmSign(null);
      setLateReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign');
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-4">
        <ErrorNote message={error} />
        {!error ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading session
          </p>
        ) : null}
      </div>
    );
  }

  const s = data.session;
  const sharedFields = SHARED_FIELDS[kind];
  const indFields = INDIVIDUAL_FIELDS[kind];
  const sharedWarning = data.privacyWarnings.find((w) => w.section === 'shared');
  const cur = attending[Math.min(current, Math.max(0, attending.length - 1))];
  const curWarning = cur ? data.privacyWarnings.find((w) => w.section === 'individual' && w.clientId === cur.clientId) : null;
  const nameOf = (clientId: string) => visible.find((a) => a.clientId === clientId)?.displayName ?? 'Member';
  const readyToSign = attending.filter((a) => !locked(a.clientId!) && missing(indFields, individual[a.clientId!]).length === 0);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <KindHeader
        kind={kind}
        title={s.groupName}
        subtitle={`${formatDate(s.date)} at ${formatTime(s.startTime)} · ${s.durationMinutes} min · ${s.telehealth ? 'Telehealth' : s.room ?? 'In person'}${s.facilitatorName ? ` · ${s.facilitatorName}` : ''}`}
        back={
          <Link href={`${GROUP_KIND_META[kind].href}/${s.groupId}?tab=sessions`} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
            <ArrowLeft size={14} aria-hidden /> {s.groupName}
          </Link>
        }
      />
      <Part2Banner kind={kind} />
      {s.telehealth && data.canDocument && s.status !== 'cancelled' ? <GroupVideoPanel sessionId={s.id} onVideoData={onVideoData} /> : null}
      {!data.canDocument ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          View only: attendance and notes are taken by this session&apos;s facilitators.
        </p>
      ) : null}

      {canEdit && canScribe && !s.telehealth ? (
        <details open={scribeParam} className="rounded-xl border border-[#DDD6FE] bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#4A2475]">AI Scribe: record this group and draft the notes</summary>
          <div className="px-4 pb-4">
            <GroupScribePanel
              sessionId={s.id}
              present={visible.filter((a) => !['absent', 'excused'].includes(marks[a.clientId!]?.status ?? 'unmarked')).map((a) => ({ clientId: a.clientId!, displayName: a.displayName }))}
              hiddenCount={hidden.filter((a) => a.status === 'unmarked' || isAttended(a.status)).length}
              onApply={(aiShared, aiIndividuals) => {
                setShared((cur) => mergeAiValues(cur, aiShared));
                setIndividual((cur) => {
                  const next = { ...cur };
                  // Only each member's own AI text, only into that member's empty fields; signed notes are never touched
                  for (const [clientId, values] of Object.entries(aiIndividuals)) if (!locked(clientId)) next[clientId] = mergeAiValues(cur[clientId], values);
                  return next;
                });
                setDirty(true);
              }}
            />
          </div>
        </details>
      ) : null}

      <nav aria-label="Session steps" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 sm:grid-cols-4">
        {STEPS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={step === t.id ? 'step' : undefined}
            onClick={() => goto(t.id)}
            disabled={Boolean(busy)}
            className={`min-h-12 rounded-lg px-3 text-sm font-semibold ${step === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <ErrorNote message={error} />
      {info ? (
        <Alert tone="success">
          {info}
        </Alert>
      ) : null}

      {step === 'attendance' ? (
        <section aria-labelledby="att-h" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="att-h" className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Users size={18} aria-hidden /> Attendance ({attending.length} attending of {visible.length})
            </h2>
            {canEdit && videoAtt?.hasRoom ? (
              <button type="button" className={secondaryBtn} onClick={() => applyVideoPrefill(false)}>
                <Video size={16} aria-hidden /> Fill from video
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => visible.forEach((a) => !locked(a.clientId!) && marks[a.clientId!]?.status === 'unmarked' && setMark(a.clientId!, { status: 'present', minutesAttended: null }))}
              >
                <CheckCheck size={16} aria-hidden /> Mark all unmarked present
              </button>
            ) : null}
          </div>
          {s.maxBillableGroupSize != null && attending.length > s.maxBillableGroupSize ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={16} aria-hidden /> {attending.length} attending is over the group size cap of {s.maxBillableGroupSize} recorded by billing; claims will be held.
            </p>
          ) : null}
          <ul className="mt-4 space-y-3">
            {visible.length === 0 ? <li className="text-sm text-slate-500">No members on this session&apos;s roster. Add members to the group first.</li> : null}
            {visible.map((a) => {
              const m = marks[a.clientId!] ?? { status: 'unmarked' as AttendanceStatus, minutesAttended: null, patientLocationType: null };
              const isLocked = locked(a.clientId!);
              return (
                <li key={a.clientId} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words text-base font-semibold text-slate-900">{a.displayName}</span>
                      {a.confidentialityOnFile === false ? (
                        <Pill tone="amber">
                          <AlertTriangle size={12} aria-hidden /> Confidentiality agreement not on file
                        </Pill>
                      ) : null}
                      {isLocked ? (
                        <Pill tone="green">
                          <Lock size={12} aria-hidden /> Note signed
                        </Pill>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-500">{ATTENDANCE_LABEL[m.status]}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={`Attendance for ${a.displayName}`}>
                    {ATTENDANCE_STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        role="radio"
                        aria-checked={m.status === st}
                        disabled={!canEdit || (isLocked && !isAttended(st))}
                        onClick={() => setMark(a.clientId!, { status: st, minutesAttended: st === 'present' ? null : m.minutesAttended })}
                        className={`min-h-14 rounded-xl border-2 px-2 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-40 ${m.status === st ? ATT_STYLE[st] : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
                      >
                        {ATTENDANCE_LABEL[st]}
                      </button>
                    ))}
                  </div>
                  {isAttended(m.status) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        Minutes attended
                        <input
                          type="number"
                          min={0}
                          max={480}
                          className="clinic-input w-24 py-1.5"
                          disabled={!canEdit}
                          placeholder={m.status === 'present' ? String(s.durationMinutes) : 'required'}
                          value={m.minutesAttended ?? ''}
                          onChange={(e) => setMark(a.clientId!, { minutesAttended: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </label>
                      {s.telehealth ? (
                        <label className="flex items-center gap-2">
                          Member was
                          <select className="clinic-input w-auto py-1.5" disabled={!canEdit} value={m.patientLocationType ?? ''} onChange={(e) => setMark(a.clientId!, { patientLocationType: (e.target.value || null) as Mark['patientLocationType'] })}>
                            <option value="">Location not asked</option>
                            <option value="home">At home (POS 10)</option>
                            <option value="other">Not at home (POS 02)</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {hidden.length ? <p className="mt-3 text-sm text-slate-500">{hidden.length} other member{hidden.length === 1 ? '' : 's'} not shown (not on your caseload or a protected record).</p> : null}
          {canEdit ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={saveAttendance} disabled={Boolean(busy)}>
                {busy === 'attendance' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />} Save attendance
              </button>
              <button type="button" className={primaryBtn} onClick={() => goto('shared')} disabled={Boolean(busy)}>
                Next: group section <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 'shared' ? (
        <section aria-labelledby="shared-h" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
          <h2 id="shared-h" className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ClipboardList size={18} aria-hidden /> Group section (written once, copied into every attending member&apos;s note)
          </h2>
          <p className="mt-1 text-sm text-slate-600">Describe the group as a whole. Never name or describe other members: each member&apos;s chart receives this text.</p>
          {canEdit && groupValuesHaveMarker(shared) ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#DDD6FE] bg-[#F5F3FF] px-3 py-2 text-sm text-[#4A2475]">
              AI-drafted text is marked until you accept it; signing is blocked until then.
              <button
                type="button"
                className="min-h-8 rounded bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white"
                onClick={() => {
                  setShared((x) => acceptGroupValues(x));
                  setDirty(true);
                }}
              >
                Accept
              </button>
            </p>
          ) : null}
          {sharedWarning ? (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              This section appears to name group members ({sharedWarning.names.join(', ')}). Remove names before signing: it is copied into every member&apos;s chart.
            </p>
          ) : null}
          <div className="mt-4 space-y-4">
            <LegacyText values={shared} />
            {sharedFields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={shared[f.key]}
                goals={[]}
                disabled={!canEdit}
                onChange={(v) => {
                  setShared((x) => ({ ...x, [f.key]: v }));
                  setDirty(true);
                }}
              />
            ))}
          </div>
          {canEdit ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={secondaryBtn} onClick={saveNotes} disabled={Boolean(busy)}>
                {busy === 'notes' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />} Save draft
              </button>
              <button type="button" className={primaryBtn} onClick={() => goto('individual')} disabled={Boolean(busy)}>
                Next: each member <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 'individual' ? (
        <section aria-labelledby="ind-h" className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
            <h2 id="ind-h" className="px-2 text-sm font-semibold text-slate-900">
              Attending members ({attending.length})
            </h2>
            <ul className="mt-2 space-y-1">
              {attending.map((a, i) => {
                const miss = missing(indFields, individual[a.clientId!]).length;
                return (
                  <li key={a.clientId}>
                    <button
                      type="button"
                      onClick={() => setCurrent(i)}
                      aria-current={cur?.clientId === a.clientId ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left text-sm ${cur?.clientId === a.clientId ? 'bg-blue-50 font-semibold text-blue-600' : 'hover:bg-slate-50'}`}
                    >
                      <span className="truncate">{a.displayName}</span>
                      {locked(a.clientId!) ? <Lock size={14} aria-label="Signed" /> : miss ? <Pill tone="amber">{miss} to do</Pill> : <CheckCircle2 size={14} className="text-emerald-700" aria-label="Ready" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {attending.length === 0 ? <p className="px-2 text-sm text-slate-500">Mark attendance first. Absent and excused members get no note.</p> : null}
          </aside>
          {cur ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-900">{cur.displayName}</h3>
                <div className="flex flex-wrap gap-2">
                  <Pill>{ATTENDANCE_LABEL[marks[cur.clientId!]?.status ?? 'unmarked']}</Pill>
                  {cur.part2 ? <Pill tone="teal">Part 2</Pill> : null}
                  {cur.note ? <Pill tone={['SIGNED', 'LOCKED'].includes(cur.note.status) ? 'green' : 'slate'}>{['SIGNED', 'LOCKED'].includes(cur.note.status) ? 'Signed' : 'Draft in chart'}</Pill> : null}
                </div>
              </div>
              <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-slate-700">Group section (included in this note)</summary>
                <dl className="mt-2 space-y-1">
                  {sharedFields.map((f) =>
                    shared[f.key] ? (
                      <div key={f.key}>
                        <dt className="inline font-medium">{f.label}: </dt>
                        <dd className="inline text-slate-700">{Array.isArray(shared[f.key]) ? (shared[f.key] as string[]).join(', ') : f.options?.find((o) => o.value === shared[f.key])?.label ?? String(shared[f.key])}</dd>
                      </div>
                    ) : null
                  )}
                </dl>
              </details>
              {curWarning ? (
                <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                  This member&apos;s note appears to name other members ({curWarning.names.join(', ')}). A client&apos;s note must not contain other members&apos; names or information.
                </p>
              ) : null}
              {canEdit && !locked(cur.clientId!) && groupValuesHaveMarker(individual[cur.clientId!]) ? (
                <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#DDD6FE] bg-[#F5F3FF] px-3 py-2 text-sm text-[#4A2475]">
                  AI-drafted from this member&apos;s own words only. Review, then accept.
                  <button
                    type="button"
                    className="min-h-8 rounded bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white"
                    onClick={() => {
                      setIndividual((x) => ({ ...x, [cur.clientId!]: acceptGroupValues(x[cur.clientId!]) }));
                      setDirty(true);
                    }}
                  >
                    Accept
                  </button>
                </p>
              ) : null}
              <div className="mt-4 space-y-4">
                <LegacyText values={individual[cur.clientId!]} />
                {indFields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={individual[cur.clientId!]?.[f.key]}
                    goals={cur.goals}
                    disabled={!canEdit || locked(cur.clientId!)}
                    onChange={(v) => {
                      setIndividual((x) => ({ ...x, [cur.clientId!]: { ...(x[cur.clientId!] ?? {}), [f.key]: v } }));
                      setDirty(true);
                    }}
                  />
                ))}
                {kind === 'sud' && cur.uds ? <p className="text-xs text-slate-500">UDS prefilled from the Labs module ({cur.uds.collectedOn ?? 'date not recorded'}).</p> : null}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <button type="button" className={secondaryBtn} disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
                  <ChevronLeft size={16} aria-hidden /> Previous
                </button>
                {canEdit ? (
                  <button type="button" className={secondaryBtn} onClick={saveNotes} disabled={Boolean(busy)}>
                    {busy === 'notes' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />} Save draft
                  </button>
                ) : null}
                {current < attending.length - 1 ? (
                  <button type="button" className={primaryBtn} onClick={() => setCurrent((c) => c + 1)}>
                    Next member <ChevronRight size={16} aria-hidden />
                  </button>
                ) : (
                  <button type="button" className={primaryBtn} onClick={() => goto('sign')} disabled={Boolean(busy)}>
                    Review and sign <ChevronRight size={16} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 'sign' ? (
        <section aria-labelledby="sign-h" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
          <h2 id="sign-h" className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileSignature size={18} aria-hidden /> Review and sign
          </h2>
          {data.session.sharedMissing.length ? (
            <Alert tone="warning" className="mt-2">Group section is missing: {data.session.sharedMissing.join(', ')}.</Alert>
          ) : null}
          {data.cosignRequiredForMe ? (
            <Alert tone="info" className="mt-2">Your notes need a supervisor co-signature after you sign (pre-licensed or supervised). Claims wait for the co-signature.</Alert>
          ) : null}
          {data.privacyWarnings.length ? (
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <ShieldAlert size={16} aria-hidden /> {data.privacyWarnings.length} section{data.privacyWarnings.length === 1 ? '' : 's'} may name other members. Review before signing.
            </p>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Notes to sign</caption>
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="py-2">Member</th>
                  <th scope="col" className="py-2">Note</th>
                  <th scope="col" className="py-2">Billing</th>
                  <th scope="col" className="py-2 text-right">
                    <span className="sr-only">Sign</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attending.map((a) => {
                  const miss = missing(indFields, individual[a.clientId!]);
                  const isLocked = locked(a.clientId!);
                  const result = signResults?.find((r) => r.clientId === a.clientId);
                  return (
                    <tr key={a.clientId}>
                      <td className="py-2.5 font-medium text-slate-900">{a.displayName}</td>
                      <td className="py-2.5">
                        {isLocked ? (
                          <Pill tone="green">
                            <Lock size={12} aria-hidden /> Signed{a.note?.cosignRequired && !a.note.cosignedAt ? ', awaiting co-sign' : ''}
                          </Pill>
                        ) : miss.length ? (
                          <span className="text-amber-800">Missing: {miss.map((f) => f.label).join(', ')}</span>
                        ) : (
                          <span className="text-emerald-700">Ready</span>
                        )}
                        {result && !result.ok ? <p className="text-xs text-rose-700">{result.error}</p> : null}
                        {result?.claim?.blocked ? <p className="text-xs text-amber-800">Claim held: {result.claim.blocked}</p> : null}
                      </td>
                      <td className="py-2.5 text-xs">
                        {a.billing.billable ? <Pill tone="blue">{a.billing.code} claim line</Pill> : <span className="text-slate-600">{a.billing.reasons[0] ?? 'No claim line'}</span>}
                      </td>
                      <td className="py-2.5 text-right">
                        {canEdit && !isLocked && !miss.length ? (
                          <button type="button" className={`${secondaryBtn} py-1.5`} onClick={() => setConfirmSign([a.clientId!])} disabled={Boolean(busy)}>
                            Sign
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={primaryBtn} disabled={Boolean(busy) || readyToSign.length === 0 || data.session.sharedMissing.length > 0} onClick={() => setConfirmSign('all')}>
                <FileSignature size={16} aria-hidden /> Sign all ready notes ({readyToSign.length})
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {confirmSign ? (
        <ConfirmDialog
          title={confirmSign === 'all' ? `Sign ${readyToSign.length} group note${readyToSign.length === 1 ? '' : 's'}?` : `Sign the note for ${nameOf(confirmSign[0])}?`}
          confirmLabel="Sign"
          busy={busy === 'sign'}
          onCancel={() => {
            setConfirmSign(null);
            setAttested(false);
          }}
          onConfirm={() => {
            if (!attested) return;
            void sign(confirmSign === 'all' ? readyToSign.map((a) => a.clientId!) : confirmSign);
            setAttested(false);
          }}
        >
          <p className="mb-3">Each note is signed in that member&apos;s own chart. Signed notes cannot be edited; corrections are addenda.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>
              I attest that I provided this group service as {data.session.signerTitle.toLowerCase()} and that each note accurately documents the member&apos;s attendance and participation.
            </span>
          </label>
          {!attested ? <p className="mt-2 text-xs text-slate-500">Tick the attestation to sign.</p> : null}
          <label className="mt-3 block text-xs text-slate-700">
            <span className="font-semibold">Late-entry reason</span> (required only when signing after the practice sign deadline; at least 10 characters)
            <textarea
              value={lateReason}
              onChange={(e) => setLateReason(e.target.value)}
              maxLength={500}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
            />
          </label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
