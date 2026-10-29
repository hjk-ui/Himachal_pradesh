'use client';

/**
 * Review an AI Scribe draft. Everything is labeled AI draft; the clinician edits, confirms plan
 * linkage, accepts follow-ups, then "Create draft note" files an UNSIGNED note in Notes (signing
 * is blocked there until every AI section is accepted). Clicking a sentence highlights the
 * transcript lines it came from; weakly supported sentences are highlighted; withheld sentences are
 * listed with the reason and never placed in the note. Also: the "Right client?" confirmation
 * (name + DOB) before the note is created, low-transcript-quality warning, stigmatizing-language
 * rewrites, minimum-necessary flags with "Move to psychotherapy notes", medication suggestions
 * (never inserted), verbal scores to save, and for prescriber formats the E/M choice, psychotherapy
 * minutes (add-on suggestion) and the MDM elements checklist (the level is never picked for you).
 */
import { useMemo, useState } from 'react';
import { suggestCptForSession } from '@/lib/scribe/coding';
import { MINIMUM_NECESSARY_LABEL, appendPsychotherapyNote, removeSentence } from '@/lib/scribe/minimumNecessary';
import { NOT_ON_MED_LIST } from '@/lib/scribe/medications';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, ListChecks, Loader2, Phone, Send, ShieldAlert, Sparkles, Target } from 'lucide-react';
import { NoteQualityPanel } from '@/components/ai/NoteQualityPanel';
import { WITHHOLD_LABEL } from '@/lib/scribe/grounding';
import { GOAL_PROGRESS } from '@/lib/ehr/therapy/widgets';
import { PLAN_PROGRESS } from '@/lib/ehr/therapy/planHierarchy';
import { SCRIBE_FORMAT_LABELS } from '@/lib/scribe/settings';
import type { ProvenanceItem } from '@/lib/scribe/draft';
import type { DraftView, ScribeContextResponse } from './types';
import { DraftSuggestions } from './DraftSuggestions';
import { applySuggestion } from '@/lib/scribe/suggestions';

type Tab = 'note' | 'plan' | 'coding' | 'followups' | 'summary';

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, { method: url.includes('follow-ups') && (body as { id?: string }).id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T & { error?: string } };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server.' } as T & { error?: string } };
  }
}

export function DraftReview({
  captureId,
  draft,
  settings,
  initialNoteId,
  initialSummary,
  onCite,
  onNoteCreated,
  client,
  clientId,
}: {
  captureId: string;
  /** Client of the capture: lets the clinician queue a transcript ICD-10 suggestion for chart review */
  clientId?: string | null;
  draft: DraftView;
  /** Review header: name + date of birth for the "Right client?" confirmation */
  client?: { name: string; dateOfBirth: string | null } | null;
  settings: ScribeContextResponse['settings'] | null;
  initialNoteId: string | null;
  initialSummary: { text: string; status: string | null } | null;
  onCite: (cites: string[]) => void;
  /** A draft note now exists (the capture can no longer be dismissed) */
  onNoteCreated?: (noteId: string) => void;
}) {
  const c = draft.content;
  const [tab, setTab] = useState<Tab>('note');
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...c.texts }));
  const [links, setLinks] = useState(() => c.planLinks.map((l) => ({ ...l, confirmed: false })));
  const [minutes, setMinutes] = useState<string>(c.coding.minutes ? String(c.coding.minutes) : '');
  const [noteId, setNoteId] = useState<string | null>(initialNoteId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [dxQueued, setDxQueued] = useState<Record<string, string>>({});
  // A transcript suggestion goes to the chart's diagnosis list as a pending suggestion; a clinician
  // accepts or dismisses it there (nothing is added to the list from here)
  const queueDx = async (d: { code: string; description: string; note: string }) => {
    if (!clientId) return;
    const res = await post(`/api/clients/${encodeURIComponent(clientId)}/diagnoses/suggestions`, {
      code: d.code,
      description: d.description,
      origin: 'ai_scribe',
      originRef: captureId,
      rationale: d.note,
    });
    setDxQueued((q) => ({ ...q, [d.code]: res.ok ? 'Sent to the chart for review' : res.data?.error || 'Could not send' }));
  };
  const [summary, setSummary] = useState(initialSummary?.text ?? '');
  const [summaryStatus, setSummaryStatus] = useState<string | null>(initialSummary?.status ?? null);
  const [summaryInfo, setSummaryInfo] = useState<string | null>(null);
  const [rightClient, setRightClient] = useState(false);
  const [emCode, setEmCode] = useState('');
  const [psychMinutes, setPsychMinutes] = useState('');
  /** Sentences taken out of the progress note, filed to psychotherapy notes once the note exists */
  const [pendingMoves, setPendingMoves] = useState<string[]>([]);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [savedScores, setSavedScores] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const byHeading = useMemo(() => {
    const m = new Map<string, ProvenanceItem[]>();
    for (const p of c.provenance) {
      const h = p.heading ?? 'Other';
      m.set(h, [...(m.get(h) ?? []), p]);
    }
    return m;
  }, [c.provenance]);
  const headings = Object.keys(texts);

  const cite = (cites: string[]) => {
    onCite(cites);
    void post(`/api/scribe/captures/${encodeURIComponent(captureId)}/citations`, { draftId: draft.id, cites: cites.length });
  };

  /** Append to the author's psychotherapy notes for this note (author-only store; audited by its route) */
  const fileToPsychotherapyNotes = async (id: string, sentences: string[]): Promise<boolean> => {
    try {
      const url = `/api/notes/${encodeURIComponent(id)}/psychotherapy-notes`;
      const cur = await fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      if (!cur) return false;
      const text = appendPsychotherapyNote(String(cur.text || ''), sentences, new Date().toLocaleDateString('en-US'));
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      return res.ok;
    } catch {
      return false;
    }
  };

  const createNote = async () => {
    if (client && !rightClient) {
      setError('Confirm this is the right client (name and date of birth) first.');
      return;
    }
    setBusy('note');
    setError(null);
    const res = await post<{ noteId?: string; href?: string }>(`/api/scribe/captures/${encodeURIComponent(captureId)}/note`, {
      draftId: draft.id,
      format: draft.format,
      texts,
      planLinks: links.filter((l) => l.confirmed).map((l) => ({ goalIndex: l.goalIndex, goalText: l.goalText, status: l.status, level: l.level })),
      durationMinutes: Number(minutes) || null,
      clientConfirmed: true,
      ...(prescriber && emCode ? { emCode } : {}),
      ...(prescriber && Number(psychMinutes) ? { psychotherapyMinutes: Number(psychMinutes) } : {}),
    });
    setBusy(null);
    if (res.ok && res.data.noteId) {
      setNoteId(res.data.noteId);
      onNoteCreated?.(res.data.noteId);
      if (pendingMoves.length) {
        const ok = await fileToPsychotherapyNotes(res.data.noteId, pendingMoves);
        setNotice(ok ? `${pendingMoves.length} sentence(s) filed to your psychotherapy notes (private; not part of the record).` : 'The note was created, but moving text to psychotherapy notes failed: add it there from Notes.');
        if (ok) setPendingMoves([]);
      }
    } else setError(res.data.error || 'Could not create the draft note.');
  };

  /** "Move to psychotherapy notes": out of the progress note now; filed when the note exists */
  const moveToPsychotherapy = async (heading: string, sentence: string) => {
    if (noteId) {
      const ok = await fileToPsychotherapyNotes(noteId, [sentence]);
      if (ok) {
        setMoved((p) => new Set(p).add(sentence));
        setNotice('Filed to your psychotherapy notes. Remove the sentence from the progress note in Notes (the note was already created).');
      } else setError('Could not file it to psychotherapy notes.');
      return;
    }
    setTexts((prev) => ({ ...prev, [heading]: removeSentence(prev[heading] || '', sentence) }));
    setPendingMoves((p) => [...p, sentence]);
    setMoved((p) => new Set(p).add(sentence));
  };

  const applyRewrite = (heading: string, from: string, to: string) => {
    setTexts((prev) => ({ ...prev, [heading]: (prev[heading] || '').replace(from.trim().replace(/([^.!?])$/, '$1'), to.trim().replace(/([^.!?])$/, '$1')) }));
  };

  const saveScore = async (s: { instrument: string; score: number }) => {
    const res = await post(`/api/scribe/captures/${encodeURIComponent(captureId)}/scores`, { instrument: s.instrument, score: s.score, confirmed: true });
    if (res.ok) setSavedScores((p) => new Set(p).add(s.instrument));
    else setError(res.data.error || 'Could not save the score.');
  };

  const summaryAction = async (action: 'generate' | 'approve' | 'share') => {
    setBusy(`summary-${action}`);
    setError(null);
    const res = await post<{ summary?: { text: string; status: string; grade?: number | null; removedForPart2?: number } }>(
      `/api/scribe/captures/${encodeURIComponent(captureId)}/summary`,
      action === 'approve' ? { action, text: summary } : { action }
    );
    setBusy(null);
    if (!res.ok || !res.data.summary) {
      setError(res.data.error || 'Summary action failed.');
      return;
    }
    setSummary(res.data.summary.text);
    setSummaryStatus(res.data.summary.status);
    if (action === 'generate') {
      const s = res.data.summary;
      setSummaryInfo(
        `Reading level about grade ${s.grade ?? '?'} (target 6-8).${s.removedForPart2 ? ` ${s.removedForPart2} substance-use sentence(s) removed: no Part 2 consent covers the portal.` : ''}`
      );
    }
  };

  const acceptFollowUp = async (i: number) => {
    const f = c.followUps[i];
    const res = await post(`/api/scribe/follow-ups`, { captureId, kind: f.kind, title: f.title });
    if (res.ok) setAccepted((prev) => new Set(prev).add(i));
    else setError(res.data.error || 'Could not add the follow-up.');
  };

  const isPlan = draft.format === 'TREATMENT_PLAN_REVIEW';
  const prescriber = Boolean(c.coding.prescriber);
  const emSuggestion = prescriber ? suggestCptForSession({ format: draft.format, minutes: Number(minutes) || null, isPrescriberVisit: true, emCode: emCode || null, psychotherapyMinutes: Number(psychMinutes) || null }) : null;
  const clock = c.coding.sessionClock ?? null;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#DDD6FE] bg-[#F5F3FF] px-4 py-3 text-sm text-[#4A2475]">
        <p className="flex items-center gap-2 font-semibold">
          <Sparkles size={15} /> {c.label}
        </p>
        <p className="mt-1 text-xs">
          {SCRIBE_FORMAT_LABELS[draft.format]} · {c.provenance.length} grounded item(s) · {c.provenance.filter((p) => p.status === 'weak').length} to check (highlighted) ·{' '}
          {c.withheld.length} withheld. In Notes, Accept each AI section after you review it (editing it also accepts it); signing is blocked until every AI section is accepted.
        </p>
        {c.part2Notice && <p className="mt-2 rounded bg-white/70 px-2 py-1 text-xs font-semibold text-rose-800">{c.part2Notice}</p>}
      </div>

      {client ? (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2 text-sm ${rightClient ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          <span>
            <strong>{client.name}</strong> · DOB {client.dateOfBirth ?? 'not on file'}
          </span>
          {!noteId ? (
            <label className="flex items-center gap-1.5 font-semibold">
              <input type="checkbox" checked={rightClient} onChange={(e) => setRightClient(e.target.checked)} /> Right client?
            </label>
          ) : null}
        </div>
      ) : null}

      {c.qualityWarning ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {c.qualityWarning}
        </p>
      ) : null}
      {notice ? <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">{notice}</p> : null}

      {(c.risk.findings.length > 0 || c.risk.prompts.length > 0) && (
        <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-rose-800">
            <ShieldAlert size={16} /> Risk language in the transcript
          </p>
          <ul className="space-y-1 text-sm text-rose-900">
            {c.risk.findings.map((f, i) => (
              <li key={i}>
                <button type="button" className="font-mono text-xs underline" onClick={() => cite([f.lineId])}>
                  {f.at}
                </button>{' '}
                {f.label} ({f.severity}): “{f.quote}”
              </li>
            ))}
          </ul>
          {c.risk.prompts.map((p) => (
            <p key={p.kind} className="text-sm text-rose-900">
              <strong>{p.title}.</strong> {p.detail}
            </p>
          ))}
          {c.risk.reminder988 && (
            <p className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
              <Phone size={13} className="mt-0.5 shrink-0" /> {c.risk.reminder988}
            </p>
          )}
          <p className="text-[11px] text-rose-700">The C-SSRS and risk level are not filled by AI: complete them in the note.</p>
        </div>
      )}

      <div className="flex w-fit flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ['note', isPlan ? 'Progress summary' : 'Note', FileText],
            ['plan', `Plan goals (${c.planLinks.length})`, Target],
            ['coding', 'Coding', ClipboardList],
            ['followups', `Follow-ups (${c.followUps.length})`, ListChecks],
            ['summary', 'Client summary', Send],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'note' && (
        <div className="space-y-4">
          {headings.map((h) => (
            <div key={h} className="rounded-xl border border-slate-200 bg-white p-4">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#5C2D91]">{h}</label>
              <textarea
                value={texts[h]}
                readOnly={Boolean(noteId)}
                onChange={(e) => setTexts((prev) => ({ ...prev, [h]: e.target.value }))}
                rows={Math.min(14, Math.max(3, (texts[h] || '').split('\n').length + 1))}
                className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed"
              />
              {(byHeading.get(h) ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(byHeading.get(h) ?? []).map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      title={
                        p.flags?.length
                          ? p.flags.join(' · ')
                          : p.status === 'weak'
                            ? 'Weak support in the cited lines: check against the transcript'
                            : 'Show the transcript lines this came from'
                      }
                      onClick={() => cite(p.cites)}
                      className={`max-w-full truncate rounded-md border px-2 py-0.5 text-left text-[11px] ${
                        p.status === 'weak' || p.flags?.length ? 'border-yellow-300 bg-yellow-50 text-yellow-900' : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      {p.status === 'weak' || p.flags?.length ? '⚠ ' : ''}
                      {p.flags?.some((f) => f.includes(NOT_ON_MED_LIST)) ? '[not on medication list — verify] ' : ''}
                      {p.text.slice(0, 90)} <span className="font-mono text-slate-400">[{p.cites.join(', ')}]</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {c.withheld.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">{c.withheld.length} AI sentence(s) withheld (not in the note)</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {c.withheld.map((w, i) => (
                  <li key={i}>
                    <span className="font-semibold text-rose-700">{w.reason ? WITHHOLD_LABEL[w.reason] : 'Withheld'}:</span> {w.text}
                    {w.detail ? <span className="text-slate-400"> ({w.detail})</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <DraftSuggestions
            content={c}
            clientId={clientId ?? null}
            readOnly={Boolean(noteId)}
            onCite={cite}
            onInsert={(s) => setTexts((prev) => ({ ...prev, [s.heading]: applySuggestion(prev[s.heading] || '', s) }))}
          />
          {(c.stigma ?? []).length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Wording to review (stigmatizing language)</p>
              {(c.stigma ?? []).map((s, i) => (
                <div key={i} className="rounded-lg bg-white p-2 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold">{s.heading}:</span> {s.text}
                  </p>
                  <p className="mt-1 text-slate-500">{s.findings.map((f) => `"${f.match}" → ${f.suggestion ?? `flag only: ${f.why}`}`).join('; ')}</p>
                  {!noteId && s.rewrite !== s.text ? (
                    <button type="button" onClick={() => applyRewrite(s.heading, s.text, s.rewrite)} className="mt-1 rounded bg-[#5C2D91] px-2 py-0.5 font-semibold text-white">
                      Use: {s.rewrite.slice(0, 120)}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {(c.minimumNecessary ?? []).length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <p className="font-semibold">Minimum necessary: check before it goes in the record</p>
              {(c.minimumNecessary ?? []).map((m, i) => (
                <div key={i} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 p-2 text-xs">
                  <span className="flex-1">
                    <span className="font-semibold">{m.kinds.map((k) => MINIMUM_NECESSARY_LABEL[k]).join(' · ')}</span> ({m.detail.join('; ')}) — {m.text}
                  </span>
                  {moved.has(m.text) ? (
                    <span className="font-semibold text-emerald-700">{noteId ? 'Filed' : 'Moved (filed when the note is created)'}</span>
                  ) : (
                    <button type="button" onClick={() => void moveToPsychotherapy(m.heading, m.text)} className="rounded border border-slate-300 px-2 py-0.5 font-semibold">
                      Move to psychotherapy notes
                    </button>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-slate-500">Psychotherapy notes are private to you (45 CFR 164.501): never part of the note, print, release or claims.</p>
            </div>
          )}
          {((c.medSuggestions ?? []).length > 0 || (c.misheardMeds ?? []).length > 0 || (c.medications ?? []).length > 0) && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <p className="font-semibold">Medications (you write medication changes; nothing below is inserted)</p>
              {(c.medications ?? []).length > 0 ? (
                <p className="text-xs text-slate-500">
                  On the medication list: {(c.medications ?? []).map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.drFirst ? ' (DrFirst)' : ''}`).join(', ')}
                </p>
              ) : null}
              {(c.medSuggestions ?? []).map((m, i) => (
                <button key={i} type="button" onClick={() => cite(m.cites)} className="block text-left text-xs underline decoration-dotted">
                  Discussed: {m.text} <span className="font-mono text-slate-400">[{m.cites.join(', ')}]</span>
                  {m.flags?.length ? <span className="text-amber-700"> — {m.flags.join('; ')}</span> : null}
                </button>
              ))}
              {(c.misheardMeds ?? []).map((m, i) => (
                <p key={i} className="text-xs text-amber-800">
                  Heard “{m.heard}” ({m.lineId}): did you mean <strong>{m.likely}</strong>
                  {m.onMedList ? ' (on the medication list)' : ''}? Suggestion only — check the transcript.
                </p>
              ))}
            </div>
          )}
          {(c.scores ?? []).length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <p className="font-semibold">Scores stated in session</p>
              {(c.scores ?? []).map((s) => (
                <div key={s.instrument} className="flex items-center gap-2 text-xs">
                  <button type="button" className="font-mono underline" onClick={() => cite(s.cites)}>
                    {s.cites.join(', ')}
                  </button>
                  {savedScores.has(s.instrument) ? (
                    <span className="font-semibold text-emerald-700">
                      Saved {s.instrument} = {s.score} (verbal)
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Save ${s.instrument} = ${s.score} as a verbal, in-session score on the chart? Confirm the score was stated in this session.`)) void saveScore(s);
                      }}
                      className="rounded bg-[#5C2D91] px-2 py-0.5 font-semibold text-white"
                    >
                      Save as {s.instrument} = {s.score} (verbal)
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!isPlan && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              {clock ? (
                <p className="text-xs text-slate-500">
                  Session clock from the capture: {clock.startTime}–{clock.endTime} ({clock.minutes} min{clock.pausedMinutes ? `, ${clock.pausedMinutes} min paused not counted` : ''}). Carried into the note&apos;s start / end time; correct it to the face-to-face time.
                </p>
              ) : null}
              {prescriber ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    E/M level (your choice)
                    <select value={emCode} onChange={(e) => setEmCode(e.target.value)} disabled={Boolean(noteId)} className="rounded-lg border border-slate-200 px-2 py-1">
                      <option value="">Choose from your documentation</option>
                      {['99212', '99213', '99214', '99215'].map((code) => (
                        <option key={code}>{code}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    Psychotherapy minutes
                    <input value={psychMinutes} disabled={Boolean(noteId)} onChange={(e) => setPsychMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))} className="w-16 rounded-lg border border-slate-200 px-2 py-1" />
                  </label>
                  {emSuggestion ? <span className="text-xs text-slate-500">{emSuggestion.addOn ? `Add-on +${emSuggestion.addOn}: ${emSuggestion.addOnRule}` : emSuggestion.addOnRule}</span> : null}
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                Face-to-face minutes
                <input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))} className="w-20 rounded-lg border border-slate-200 px-2 py-1" />
                <span className="text-xs text-slate-500">({c.coding.minutesSource === 'clinician' ? 'entered' : `from the ${c.coding.minutesSource}; confirm`})</span>
              </label>
              {noteId ? (
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 size={16} /> Draft note created (unsigned).
                    <Link className="text-[#5C2D91] underline" href={`/dashboard/ehr/notes?openNote=${encodeURIComponent(noteId)}`}>
                      Open in Notes to review, code and sign
                    </Link>
                  </p>
                  <NoteQualityPanel noteId={noteId} mode="presign" />
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy === 'note' || (Boolean(client) && !rightClient)}
                  title={client && !rightClient ? 'Confirm the client (name and date of birth) first' : undefined}
                  onClick={() => void createNote()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy === 'note' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Create draft note
                </button>
              )}
            </div>
          )}
          {isPlan && (
            <p className="text-sm text-slate-600">
              Apply confirmed progress on the treatment plan:{' '}
              <Link href="/dashboard/ehr/treatment-plans" className="font-semibold text-[#5C2D91] underline">
                Treatment Plans
              </Link>
              .
            </p>
          )}
        </div>
      )}

      {tab === 'plan' && (
        <div className="space-y-3">
          {links.length === 0 && <p className="text-sm text-slate-500">No treatment plan goal was clearly addressed in the transcript.</p>}
          {links.map((l, i) => (
            <div key={l.goalId} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">
                Goal {l.goalIndex + 1}: {l.goalText}
              </p>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {l.evidence.map((e, j) => (
                  <li key={j}>
                    <button type="button" onClick={() => cite(e.cites)} className={`text-left underline decoration-dotted ${e.status === 'weak' ? 'bg-yellow-50' : ''}`}>
                      {e.text}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <select value={l.status} disabled={Boolean(noteId)} onChange={(e) => setLinks((p) => p.map((x, k) => (k === i ? { ...x, status: e.target.value } : x)))} className="rounded-lg border border-slate-200 px-2 py-1">
                  {GOAL_PROGRESS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <select value={l.level} disabled={Boolean(noteId)} onChange={(e) => setLinks((p) => p.map((x, k) => (k === i ? { ...x, level: e.target.value } : x)))} className="rounded-lg border border-slate-200 px-2 py-1">
                  <option value="">Level (optional)</option>
                  {PLAN_PROGRESS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <input type="checkbox" disabled={Boolean(noteId)} checked={l.confirmed} onChange={(e) => setLinks((p) => p.map((x, k) => (k === i ? { ...x, confirmed: e.target.checked } : x)))} />
                  Confirm (adds to the note)
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'coding' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p className="text-xs text-slate-500">{c.coding.disclaimer}</p>
          <p>
            <strong>CPT:</strong> {c.coding.cpt.code ?? 'none suggested'} — {c.coding.cpt.rule}
            {c.coding.cpt.addOn && (
              <>
                {' '}
                + {c.coding.cpt.addOn} ({c.coding.cpt.addOnRule})
              </>
            )}
          </p>
          <div>
            <strong>90785 interactive complexity:</strong> {c.coding.interactiveComplexity.suggested ? 'consider (evidence below)' : 'not suggested (no evidence in the transcript)'}
            <ul className="ml-4 list-disc text-xs">
              {c.coding.interactiveComplexity.evidence.map((e, i) => (
                <li key={i}>
                  {e.lineId !== 'consent' ? (
                    <button type="button" className="underline" onClick={() => cite([e.lineId])}>
                      {e.lineId}
                    </button>
                  ) : (
                    'consent'
                  )}{' '}
                  {e.quote}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">{c.coding.interactiveComplexity.rule}</p>
          </div>
          {c.coding.crisisRule ? <p className="text-xs text-slate-600">{c.coding.crisisRule}</p> : null}
          {c.mdm ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="font-semibold">MDM elements discussed (supports your E/M choice)</p>
              <p className="text-xs text-slate-500">{c.mdm.note}</p>
              {(
                [
                  ['Problems addressed', c.mdm.problems],
                  ['Data reviewed', c.mdm.data],
                  ['Rx management / risk', c.mdm.rx],
                ] as const
              ).map(([label, items]) => (
                <div key={label} className="mt-1 text-xs">
                  <p className="font-semibold">
                    {items.length ? '☑' : '☐'} {label}
                  </p>
                  <ul className="ml-4 list-disc">
                    {items.map((it, i) => (
                      <li key={i}>
                        <button type="button" className={`text-left underline decoration-dotted ${it.status === 'weak' ? 'bg-yellow-50' : ''}`} onClick={() => cite(it.cites)}>
                          {it.text}
                          {'problemStatus' in it ? ` (${(it as { problemStatus: string }).problemStatus})` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          <p>
            <strong>POS / modifier:</strong> {c.coding.pos.note}
          </p>
          <div>
            <strong>ICD-10 (FY2027) to consider:</strong>
            {c.coding.icd10.length === 0 && <span> none</span>}
            <ul className="mt-1 space-y-1">
              {c.coding.icd10.map((d) => (
                <li key={d.code} className="text-xs">
                  <span className="font-mono font-semibold">{d.code}</span> {d.description} <span className="text-slate-500">({d.source}) {d.note}</span>
                  {clientId && d.source === 'transcript' ? (
                    dxQueued[d.code] ? (
                      <span className="ml-1 text-emerald-700">{dxQueued[d.code]}</span>
                    ) : (
                      <button type="button" className="ml-1 rounded border border-slate-300 px-1 text-[11px] font-semibold text-[#5C2D91] hover:bg-slate-50" onClick={() => void queueDx(d)}>
                        Send for diagnosis review
                      </button>
                    )
                  ) : null}
                  {d.evidence.map((e) => (
                    <button key={e.lineId} type="button" className="ml-1 font-mono underline" onClick={() => cite([e.lineId])}>
                      {e.lineId}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'followups' && (
        <div className="space-y-2">
          {c.followUps.length === 0 && <p className="text-sm text-slate-500">No follow-ups were discussed.</p>}
          {c.followUps.map((f, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-xl border bg-white p-3 ${f.status === 'weak' ? 'border-yellow-300' : 'border-slate-200'}`}>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-600">{f.kind.replace('_', ' ')}</span>
              <button type="button" className="flex-1 text-left text-sm text-slate-800" onClick={() => cite(f.cites)}>
                {f.title}
              </button>
              {accepted.has(i) ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 size={13} /> Added to My To-Do
                </span>
              ) : (
                <button type="button" onClick={() => void acceptFollowUp(i)} className="rounded-lg bg-[#5C2D91] px-3 py-1 text-xs font-semibold text-white">
                  Accept
                </button>
              )}
            </div>
          ))}
          <p className="text-xs text-slate-500">Accepted follow-ups appear in My To-Do with a link to Appointments, Labs or the client chart to complete them.</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">
            Plain-language recap for the client (target grade 6-8), drafted only from cited transcript lines. You edit and approve it.{' '}
            {settings?.clientSummarySharing ? 'Approved summaries can be sent to the client portal.' : 'Portal sharing is turned off in practice settings.'}
          </p>
          {!summary && (
            <button type="button" disabled={busy !== null} onClick={() => void summaryAction('generate')} className="rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Draft client summary
            </button>
          )}
          {summary && (
            <>
              <textarea value={summary} onChange={(e) => { setSummary(e.target.value); setSummaryStatus('draft'); }} rows={8} readOnly={summaryStatus === 'shared'} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              {summaryInfo && <p className="text-xs text-slate-500">{summaryInfo}</p>}
              <div className="flex flex-wrap gap-2">
                {summaryStatus !== 'shared' && (
                  <button type="button" disabled={busy !== null} onClick={() => void summaryAction('approve')} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                    {summaryStatus === 'approved' ? 'Approved' : 'Approve'}
                  </button>
                )}
                {settings?.clientSummarySharing && summaryStatus === 'approved' && (
                  <button type="button" disabled={busy !== null} onClick={() => void summaryAction('share')} className="rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white">
                    Send to client portal
                  </button>
                )}
                {summaryStatus === 'shared' && <span className="text-sm font-semibold text-emerald-700">Shared to the portal.</span>}
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-700">
          <AlertTriangle size={14} /> {error}
        </p>
      )}
    </div>
  );
}
