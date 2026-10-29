'use client';

/** Practice AI Scribe settings (leadership edits) and the clinician's own drafting preferences. */
import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import {
  CLIENT_TERMS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  PRONOUN_STYLES,
  SCRIBE_FORMATS,
  SCRIBE_FORMAT_LABELS,
  TRANSCRIPTION_ENGINES,
  TRANSCRIPTION_ENGINE_LABELS,
  TRANSCRIPTION_ENGINE_NOTES,
  VERBOSITY,
  type ScribePreferences,
  type ScribeSettingsValue,
} from '@/lib/scribe/settings';

export function ScribeSettingsCard({ onChanged }: { onChanged?: () => void }) {
  const [settings, setSettings] = useState<ScribeSettingsValue | null>(null);
  const [prefs, setPrefs] = useState<ScribePreferences | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/scribe/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSettings(d.settings);
          setCanEdit(Boolean(d.canEdit));
          setNote(d.recordingConsentNote || '');
        }
      })
      .catch(() => undefined);
    void fetch('/api/scribe/preferences', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => d.success && setPrefs(d.preferences))
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const calls: Promise<Response>[] = [];
      if (canEdit && settings) {
        const { requireRecordingConsent: _r, ...patch } = settings;
        void _r;
        calls.push(fetch('/api/scribe/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
      }
      if (prefs) calls.push(fetch('/api/scribe/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) }));
      const res = await Promise.all(calls);
      const bad = res.find((r) => !r.ok);
      setMsg(bad ? ((await bad.json().catch(() => ({}))) as { error?: string }).error || 'Not saved' : 'Saved');
      if (!bad) onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  if (!settings || !prefs) return <p className="text-sm text-slate-500">Loading settings…</p>;
  const sel = 'rounded-lg border border-slate-200 px-2 py-1.5 text-sm';
  return (
    <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
      <section className="space-y-3">
        <p className="text-sm font-semibold text-slate-900">Practice settings {canEdit ? '' : '(view only: practice leadership edits)'}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} /> AI Scribe enabled
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            disabled={!canEdit}
            checked={settings.deleteTranscriptOnSign}
            onChange={(e) => setSettings({ ...settings, deleteTranscriptOnSign: e.target.checked })}
          />
          <span>
            Delete transcript when the note is signed (default)
            <span className="block text-xs text-slate-500">The transcript and AI drafts are deleted as soon as the note made from the capture is signed. The signed note is the record.</span>
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {settings.deleteTranscriptOnSign ? 'Otherwise delete transcripts' : 'Delete transcripts'}
          <input
            type="number"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            disabled={!canEdit}
            value={settings.transcriptRetentionDays}
            onChange={(e) => setSettings({ ...settings, transcriptRetentionDays: Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Number(e.target.value) || 30)) })}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1"
          />
          {settings.deleteTranscriptOnSign
            ? 'days after capture stopped when no note was signed from it (audio is never kept)'
            : 'days after the note is signed, or after capture stopped when no note was signed (audio is never kept)'}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Default format
          <select disabled={!canEdit} value={settings.defaultFormat} onChange={(e) => setSettings({ ...settings, defaultFormat: e.target.value as ScribeSettingsValue['defaultFormat'] })} className={sel}>
            {SCRIBE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {SCRIBE_FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-1.5 text-sm">
          <legend className="mb-1">Transcription engine</legend>
          {TRANSCRIPTION_ENGINES.map((e) => (
            <label key={e} className="flex items-start gap-2">
              <input
                type="radio"
                name="transcriptionEngine"
                className="mt-1"
                disabled={!canEdit}
                checked={settings.transcriptionEngine === e}
                onChange={() => setSettings({ ...settings, transcriptionEngine: e })}
              />
              <span>
                {TRANSCRIPTION_ENGINE_LABELS[e]}
                {e === 'standard' ? ' (default)' : ''}
                <span className="block text-xs text-slate-500">{TRANSCRIPTION_ENGINE_NOTES[e]}</span>
              </span>
            </label>
          ))}
          <span className="block text-xs text-slate-500">Applies to new captures; a capture already started keeps its engine.</span>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={settings.clientSummarySharing} onChange={(e) => setSettings({ ...settings, clientSummarySharing: e.target.checked })} /> Allow sharing approved client summaries to the portal
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={settings.liveCuesDefault} onChange={(e) => setSettings({ ...settings, liveCuesDefault: e.target.checked })} /> In-session cues on by default
        </label>
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Lock size={13} /> {note}
        </p>
      </section>
      <section className="space-y-3 border-t border-slate-100 pt-4">
        <p className="text-sm font-semibold text-slate-900">My drafting preferences</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            Format
            <select value={prefs.defaultFormat ?? ''} onChange={(e) => setPrefs({ ...prefs, defaultFormat: (e.target.value || null) as ScribePreferences['defaultFormat'] })} className={sel}>
              <option value="">Practice default</option>
              {SCRIBE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {SCRIBE_FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Length
            <select value={prefs.verbosity} onChange={(e) => setPrefs({ ...prefs, verbosity: e.target.value as ScribePreferences['verbosity'] })} className={sel}>
              {VERBOSITY.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Term
            <select value={prefs.clientTerm} onChange={(e) => setPrefs({ ...prefs, clientTerm: e.target.value as ScribePreferences['clientTerm'] })} className={sel}>
              {CLIENT_TERMS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Pronouns
            <select value={prefs.pronouns} onChange={(e) => setPrefs({ ...prefs, pronouns: e.target.value as ScribePreferences['pronouns'] })} className={sel}>
              {PRONOUN_STYLES.map((v) => (
                <option key={v} value={v}>
                  {v === 'none' ? 'none (repeat the term)' : v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.liveCues ?? settings.liveCuesDefault} onChange={(e) => setPrefs({ ...prefs, liveCues: e.target.checked })} /> In-session cues
          </label>
        </div>
        <label className="block text-sm">
          My phrases (smart-phrase keys, comma separated; they expand in the draft editor as usual)
          <input
            value={prefs.phraseKeys.join(', ')}
            onChange={(e) => setPrefs({ ...prefs, phraseKeys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30) })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5"
            placeholder=".mse-normal, .cbt-thought-record"
          />
        </label>
      </section>
      <div className="flex items-center gap-3">
        <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 size={14} className="animate-spin" />} Save
        </button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
