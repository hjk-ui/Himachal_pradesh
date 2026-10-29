'use client';

/**
 * Practice switches for the therapist workflow (GET / PUT /api/ehr/therapy-workflow). Everyone
 * who writes notes sees the current rules; leadership (Practice Setup access) can change them.
 */
import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { pillBtn } from '@/components/notes/structuredNoteUi';

type Settings = {
  requirePlanForProgressNotes: boolean;
  requirePatientSignature: boolean;
  goLiveDate: string;
  /** Explicit end of the go-live transition; null = go-live + 30 days */
  transitionUntil: string | null;
  transitionUntilEffective: string | null;
  transitionActive: boolean;
  libraryEditBeforeActive: boolean;
  libraryEditAfterActive: boolean;
  reviewReminderDays: number;
  supervisorReminderDays: number | null;
};
type Toggle = 'requirePlanForProgressNotes' | 'requirePatientSignature' | 'libraryEditBeforeActive' | 'libraryEditAfterActive';

export function TherapyWorkflowSettingsCard() {
  const { user } = useAuth();
  const canEdit = canAccessPath(String(user?.role || ''), '/dashboard/practice-setup');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiJson<{ success: true; settings: Settings }>('/api/ehr/therapy-workflow')
      .then((res) => setSettings(res.settings))
      .catch(() => setSettings(null));
  }, []);
  if (!settings) return null;
  const update = async (patch: Partial<Pick<Settings, Toggle | 'goLiveDate' | 'transitionUntil' | 'reviewReminderDays' | 'supervisorReminderDays'>>) => {
    setError(null);
    try {
      const res = await apiJson<{ success: true; settings: Settings }>('/api/ehr/therapy-workflow', { method: 'PUT', body: JSON.stringify(patch) });
      setSettings(res.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };
  const toggle = (key: Toggle, label: string, help: string) => (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs text-slate-700">
        <strong className="text-slate-900">{label}</strong> — {help}
      </span>
      {canEdit ? (
        <button type="button" aria-pressed={settings[key]} className={pillBtn(settings[key], settings[key] ? 'good' : 'brand')} onClick={() => void update({ [key]: !settings[key] })}>
          {settings[key] ? 'On' : 'Off'}
        </button>
      ) : (
        <span className="text-xs font-semibold text-slate-600">{settings[key] ? 'On' : 'Off'}</span>
      )}
    </div>
  );
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
        <Settings2 size={15} className="text-[#5C2D91]" /> Therapy workflow rules
      </summary>
      <div className="mt-3 space-y-2">
        {toggle('requirePlanForProgressNotes', 'Treatment plan required', 'therapy progress notes and psychotherapy, group (90853) and case management (T1016 / T1017) notes cannot be signed without an active, signed plan. Drafts, intakes and crisis notes are never blocked.')}
        {toggle('requirePatientSignature', 'Patient signature makes the plan active', 'when off, the plan is active once the clinician (and supervisor, if pre-licensed) signs; the patient’s portal signature is tracked.')}
        {toggle('libraryEditBeforeActive', 'Edit library items before the plan is active', 'providers can change the text of a Practice / Personal Library problem, goal, objective or intervention they add to a draft plan. Off: the library wording is kept (add a custom item instead).')}
        {toggle('libraryEditAfterActive', 'Edit library items after the plan is active', 'in a plan review, providers can change the text of library items copied from the active plan. Signed plans themselves never change: they are reopened (signatures cleared) or reviewed.')}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3 text-xs">
          <span className="w-full text-slate-700">
            <strong className="text-slate-900">Review reminders</strong> — review dates are set per plan (no fixed cycle). The plan owner gets an Inbox reminder before the review is due; a supervisor reminder is optional (blank = none).
          </span>
          <label className="flex flex-col gap-0.5 text-slate-700">
            Owner: days before due
            {canEdit ? (
              <input
                type="number"
                min={0}
                max={90}
                className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1"
                value={settings.reviewReminderDays}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (e.target.value !== '' && Number.isInteger(n) && n >= 0 && n <= 90) void update({ reviewReminderDays: n });
                }}
              />
            ) : (
              <span className="font-semibold text-slate-900">{settings.reviewReminderDays}</span>
            )}
          </label>
          <label className="flex flex-col gap-0.5 text-slate-700">
            Supervisor: days before due
            {canEdit ? (
              <input
                type="number"
                min={0}
                max={90}
                placeholder="None"
                className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1"
                value={settings.supervisorReminderDays ?? ''}
                onChange={(e) => {
                  if (e.target.value === '') return void update({ supervisorReminderDays: null });
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 0 && n <= 90) void update({ supervisorReminderDays: n });
                }}
              />
            ) : (
              <span className="font-semibold text-slate-900">{settings.supervisorReminderDays ?? 'None'}</span>
            )}
          </label>
        </div>
        <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            <strong>Go-live transition</strong> — Valant exported plans for only some clients. Until the transition ends, a therapy progress note for a
            client whose care started in Valant can be signed without an active plan; the note is marked “Treatment plan pending”, the override is
            audited, the client is listed under Before go-live and in the author’s Inbox, and the claim gets a warning. Clients created in Altrixs
            follow the rule now. After the date the rule applies to everyone.
          </p>
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="flex flex-col gap-0.5 text-slate-700">
              Go-live date
              {canEdit ? (
                <input
                  type="date"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  value={settings.goLiveDate}
                  onChange={(e) => e.target.value && void update({ goLiveDate: e.target.value })}
                />
              ) : (
                <span className="font-semibold text-slate-900">{settings.goLiveDate}</span>
              )}
            </label>
            <label className="flex flex-col gap-0.5 text-slate-700">
              Transition ends (last day)
              {canEdit ? (
                <input
                  type="date"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  min={settings.goLiveDate}
                  value={settings.transitionUntil ?? settings.transitionUntilEffective ?? ''}
                  onChange={(e) => void update({ transitionUntil: e.target.value || null })}
                />
              ) : (
                <span className="font-semibold text-slate-900">{settings.transitionUntilEffective ?? '—'}</span>
              )}
            </label>
            {canEdit && settings.transitionUntil ? (
              <button type="button" className="text-xs font-semibold text-[#5C2D91] underline" onClick={() => void update({ transitionUntil: null })}>
                Use default (go-live + 30 days)
              </button>
            ) : null}
            <span className="text-xs font-semibold text-amber-900">
              {settings.transitionActive ? `In effect through ${settings.transitionUntilEffective}` : 'Not in effect: the plan rule applies to every client'}
              {settings.transitionUntil ? '' : ' (default)'}
            </span>
          </div>
        </div>
        {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      </div>
    </details>
  );
}
