'use client';

/**
 * AI Scribe for a group session (SessionRunner). Records the group once, then a quick mapping step
 * (each speaker → clinician, one member, or not attributed), then drafts the shared group section
 * and each member's individual response from that member's own words only (src/lib/scribe/group.ts).
 * AI text fills only empty fields and is marked until the facilitator accepts it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Mic, Users } from 'lucide-react';
import { RecordingBar } from './RecordingBar';
import { useTranscribeStream, controlCapture } from './useTranscribeStream';
import { RECORDING_CONSENT_SCRIPT } from '@/lib/scribe/consent';
import { GROUP_CLINICIAN, GROUP_UNATTRIBUTED, memberSpeakerValue, type GroupDraft, type GroupMember } from '@/lib/scribe/group';
import { SCRIBE_LANGUAGES, SCRIBE_LANGUAGE_LABELS, type ScribeLanguage } from '@/lib/scribe/language';
import type { DismissReason } from '@/lib/scribe/dismiss';
import type { NoteValues } from '@/lib/groups/types';

const API = '/api/scribe/group-captures';

type GroupCaptureView = {
  id: string;
  status: string;
  engine: string;
  language: string;
  members: GroupMember[];
  speakerMap: Record<string, string>;
  draft: GroupDraft | null;
  purged: boolean;
};

export function GroupScribePanel({
  sessionId,
  present,
  hiddenCount,
  onApply,
}: {
  sessionId: string;
  /** Visible members present (not absent / excused) */
  present: { clientId: string; displayName: string }[];
  /** Members present whom this clinician cannot see (they must still agree to the recording) */
  hiddenCount: number;
  onApply: (shared: NoteValues, individuals: Record<string, NoteValues>) => void;
}) {
  const [capture, setCapture] = useState<GroupCaptureView | null>(null);
  const [configured, setConfigured] = useState(true);
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [hiddenAgreed, setHiddenAgreed] = useState<boolean[]>([]);
  const [language, setLanguage] = useState<ScribeLanguage>('en-US');
  const [speakers, setSpeakers] = useState<{ label: string; turns: number; sample: string }[] | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const stream = useTranscribeStream({ captureId: capture?.id ?? null, kind: 'conversation', persist: true, apiBase: API });

  const loadSpeakers = useCallback(async (id: string) => {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not load the capture');
    setCapture(d.capture);
    setSpeakers(d.speakers);
    setMap(d.capture.speakerMap ?? {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.success) return;
        setConfigured(Boolean(d.configured?.streaming));
        if (d.capture && !d.capture.purged) {
          setCapture(d.capture);
          if (d.capture.status !== 'ready' && d.capture.status !== 'capturing') void loadSpeakers(d.capture.id).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadSpeakers]);
  useEffect(() => setHiddenAgreed(Array.from({ length: hiddenCount }, () => false)), [hiddenCount]);

  const everyone = present.length > 0 && present.every((p) => agreed[p.clientId]) && hiddenAgreed.every(Boolean);

  const start = async () => {
    setBusy('start');
    setError(null);
    try {
      const rows = [...present.map((p) => ({ clientId: p.clientId, agreed: Boolean(agreed[p.clientId]) })), ...hiddenAgreed.map((a) => ({ clientId: null, agreed: a }))];
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, language, consent: { rows, scriptRead: true } }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'The group capture could not start');
      setCapture(d.capture);
      await stream.start(d.capture.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The group capture could not start');
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!capture) return;
    await stream.stop();
    await stream.flush();
    await loadSpeakers(capture.id).catch((e) => setError(e instanceof Error ? e.message : 'Could not load speakers'));
  };

  const dismiss = async (reason?: DismissReason, withdraw = false) => {
    if (!capture) return;
    const unreported = stream.discard();
    const res = await controlCapture(capture.id, withdraw ? 'withdraw' : 'dismiss', unreported, { reason, apiBase: API });
    if (!res.success) {
      setError(res.error || 'Could not stop the capture');
      return;
    }
    setCapture(null);
    setSpeakers(null);
    setInfo(withdraw ? 'Consent withdrawn: the group recording stopped and everything captured was deleted.' : 'AI Scribe dismissed: nothing from the recording was kept.');
  };

  const draft = async () => {
    if (!capture) return;
    setBusy('draft');
    setError(null);
    try {
      const m = await fetch(`${API}/${encodeURIComponent(capture.id)}/speakers`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map }) });
      if (!m.ok) throw new Error(((await m.json().catch(() => ({}))) as { error?: string }).error || 'Could not save the speaker mapping');
      const res = await fetch(`${API}/${encodeURIComponent(capture.id)}/draft`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'AI drafting failed. Nothing was generated.');
      setCapture(d.capture);
      onApply(d.draft.shared, d.draft.individuals);
      setInfo(
        `Draft placed in empty fields: group section and ${d.draft.counts.members} member note${d.draft.counts.members === 1 ? '' : 's'}${d.draft.counts.withheld ? `; ${d.draft.counts.withheld} sentence(s) withheld` : ''}. Unattributed speech and members without AI consent were not used. Accept each AI field after review.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI drafting failed. Nothing was generated.');
    } finally {
      setBusy(null);
    }
  };

  const members = capture?.members ?? [];
  const nameOf = (clientId: string) => present.find((p) => p.clientId === clientId)?.displayName ?? 'Member';
  const live = stream.state === 'live' || stream.state === 'paused' || stream.state === 'connecting' || stream.state === 'reconnecting';

  return (
    <section aria-label="Group AI Scribe" className="rounded-xl border border-[#DDD6FE] bg-[#FBFAFF] p-4 shadow-xs">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[#4A2475]">
        <Bot size={18} aria-hidden /> AI Scribe for this group
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Records the group once. You map each voice to a member; each member&apos;s note uses only their own words. Members without AI consent are left out. The transcript is deleted when the notes are signed.
      </p>
      {error ? <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
      {info ? <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{info}</p> : null}

      {!capture ? (
        <div className="mt-3 space-y-2">
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer font-semibold">Consent script (read it to the group)</summary>
            <p className="mt-1">{RECORDING_CONSENT_SCRIPT}</p>
          </details>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold text-slate-700">Everyone present agreed to the recording</legend>
            {present.map((p) => (
              <label key={p.clientId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={Boolean(agreed[p.clientId])} onChange={(e) => setAgreed((a) => ({ ...a, [p.clientId]: e.target.checked }))} />
                {p.displayName}
              </label>
            ))}
            {hiddenAgreed.map((v, i) => (
              <label key={`h${i}`} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={v} onChange={(e) => setHiddenAgreed((l) => l.map((x, j) => (j === i ? e.target.checked : x)))} />
                Member not shown to you ({i + 1})
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value as ScribeLanguage)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                {SCRIBE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {SCRIBE_LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!everyone || !configured || Boolean(busy)} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              {busy === 'start' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Mic size={15} aria-hidden />} Record group
            </button>
            {!configured ? <span className="text-xs text-amber-800">AWS Transcribe is not configured on this server.</span> : null}
          </div>
        </div>
      ) : capture.status === 'ready' && !live ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void stream.start(capture.id)} className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white">
            <Mic size={15} aria-hidden /> Start recording
          </button>
          <button type="button" onClick={() => void dismiss()} className="text-sm font-semibold text-slate-600 underline">
            Cancel
          </button>
          {stream.error ? <p className="w-full text-sm text-amber-800">{stream.error}</p> : null}
        </div>
      ) : live || capture.status === 'capturing' ? (
        <div className="mt-3 space-y-2">
          <RecordingBar
            state={stream.state}
            level={stream.level}
            elapsedSeconds={stream.elapsed}
            engineLabel={`Group · ${SCRIBE_LANGUAGE_LABELS[(capture.language as ScribeLanguage) ?? 'en-US'] ?? 'English'}`}
            onPause={() => void stream.pause()}
            onResume={() => void stream.resume()}
            onStop={() => void stop()}
            onWithdraw={() => {
              if (window.confirm('Someone withdrew consent. Stop and delete everything captured?')) void dismiss(undefined, true);
            }}
            onDismiss={(reason) => dismiss(reason)}
          />
          {stream.state === 'idle' || stream.state === 'stopped' ? (
            <button type="button" onClick={() => void stream.resume()} className="text-sm font-semibold text-[#5C2D91] underline">
              Resume recording
            </button>
          ) : null}
          {stream.error ? <p className="text-sm text-amber-800">{stream.error}</p> : null}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Users size={15} aria-hidden /> Who is speaking? (unmapped voices are not used)
          </h3>
          {!speakers ? <p className="text-sm text-slate-500">Loading speakers…</p> : null}
          {speakers?.map((sp) => (
            <div key={sp.label} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  Speaker {sp.label.replace(/^spk_/, '')} · {sp.turns} turn{sp.turns === 1 ? '' : 's'}
                </span>
                <select
                  aria-label={`Speaker ${sp.label}`}
                  value={map[sp.label] ?? GROUP_UNATTRIBUTED}
                  onChange={(e) => setMap((m) => ({ ...m, [sp.label]: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                >
                  <option value={GROUP_UNATTRIBUTED}>Not attributed (not used)</option>
                  <option value={GROUP_CLINICIAN}>Clinician</option>
                  {members.map((m) => (
                    <option key={m.clientId} value={memberSpeakerValue(m.clientId)} disabled={!m.included}>
                      {nameOf(m.clientId)}
                      {m.included ? '' : ' (no AI consent: not used)'}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-slate-500">&ldquo;{sp.sample}&rdquo;</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy) || !speakers?.length} onClick={() => void draft()} className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              {busy === 'draft' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Bot size={15} aria-hidden />} Draft group notes
            </button>
            {capture.draft ? (
              <button type="button" onClick={() => capture.draft && onApply(capture.draft.shared, capture.draft.individuals)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                Fill empty fields from the last draft
              </button>
            ) : null}
            <button type="button" onClick={() => void stream.resume()} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
              Resume recording
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
