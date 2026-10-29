'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Lock,
  Save,
} from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  cx,
  FOCUS_RING,
  FormField,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
} from '@/components/ui';
import { CalendarLabelsSection } from './CalendarLabelsSection';
import {
  defaultSchedulingSettings,
  type DayHours,
  type SchedulingSettingsShape,
} from '@/lib/scheduling/types';

/** Default colour for the public embed widget (the practice's brand purple); a data value, not a UI class. */
const PURPLE = '#5C2D91';
/** Compact control for inline number/text fields inside a row. */
const COMPACT_INPUT =
  'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 shadow-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

const SECTIONS = [
  { id: 'link', title: 'Your Booking Link', blurb: 'Share or embed your public scheduling page' },
  { id: 'services', title: 'Bookable Services', blurb: 'Toggle services and visit modalities' },
  { id: 'hours', title: 'Availability Hours', blurb: 'Weekly hours, buffer, and book-ahead window' },
  { id: 'rules', title: 'Booking Rules', blurb: 'Insurance, new clients, and HIPAA notice' },
  { id: 'embed', title: 'Embed', blurb: 'Website widget snippet and brand color' },
  { id: 'reminders', title: 'Confirmation & Reminders', blurb: 'Email and SMS notifications' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const DAY_LABELS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const MIN_NOTICE = [0, 1, 2, 3, 5, 7];
const BUFFER = [0, 10, 15, 20, 30];
const BOOK_AHEAD = [14, 30, 60, 90];

function inputClass() {
  return inputClasses;
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the switch is not inside a <label>. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full transition',
        FOCUS_RING,
        checked ? 'bg-blue-600' : 'bg-slate-300',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      )}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

export default function SchedulingSettingsPage() {
  const [settings, setSettings] = useState<SchedulingSettingsShape>(defaultSchedulingSettings());
  const [slug, setSlug] = useState('');
  const [bookingUrl, setBookingUrl] = useState('/schedule');
  const [open, setOpen] = useState<SectionId | null>('services');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const absoluteBookingUrl = useMemo(() => {
    if (typeof window === 'undefined') return bookingUrl;
    if (bookingUrl.startsWith('http')) return bookingUrl;
    return `${window.location.origin}${bookingUrl.startsWith('/') ? '' : '/'}${bookingUrl}`;
  }, [bookingUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, orgRes] = await Promise.all([
        fetch('/api/scheduling/settings'),
        fetch('/api/org').catch(() => null),
      ]);
      const json = await settingsRes.json();
      if (!settingsRes.ok || !json.success) throw new Error(json.error || 'Could not load settings');

      let nextSlug = typeof json.slug === 'string' ? json.slug : '';
      if (!nextSlug && orgRes?.ok) {
        const orgJson = await orgRes.json().catch(() => null);
        const orgSlug = orgJson?.organization?.slug;
        if (typeof orgSlug === 'string' && orgSlug) nextSlug = orgSlug;
      }

      const nextBookingUrl =
        json.bookingUrl ||
        (nextSlug ? `/schedule?org=${encodeURIComponent(nextSlug)}` : '/schedule');

      setSettings(json.settings);
      setSlug(nextSlug);
      setBookingUrl(nextBookingUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = <K extends keyof SchedulingSettingsShape>(key: K, value: SchedulingSettingsShape[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  };

  const setService = (id: string, next: Partial<SchedulingSettingsShape['services'][number]>) => {
    patch(
      'services',
      settings.services.map((s) => (s.id === id ? { ...s, ...next } : s))
    );
  };

  const setDay = (key: string, next: Partial<DayHours>) => {
    const current = settings.hours[key] || { enabled: false, start: '09:00', end: '17:00' };
    patch('hours', { ...settings.hours, [key]: { ...current, ...next } });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save settings');
      setSettings(json.settings);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absoluteBookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy link');
    }
  };

  const embedColor = settings.embed.color || PURPLE;
  const snippet = useMemo(() => {
    const src = absoluteBookingUrl.includes('?')
      ? `${absoluteBookingUrl}&embed=true`
      : `${absoluteBookingUrl}?embed=true`;
    if (settings.embed.mode === 'button') {
      return `<a href="${absoluteBookingUrl}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${embedColor};color:#fff;font-weight:700;text-decoration:none;">Book Appointment</a>`;
    }
    if (settings.embed.mode === 'modal') {
      return `<!-- Altrixs booking button + modal -->\n<button onclick="document.getElementById('altrixs-book').showModal()" style="padding:12px 20px;border:0;border-radius:10px;background:${embedColor};color:#fff;font-weight:700;cursor:pointer;">Book Online</button>\n<dialog id="altrixs-book" style="border:0;border-radius:16px;padding:0;width:min(920px,96vw);height:min(820px,90vh);">\n  <iframe src="${src}" style="width:100%;height:100%;border:0;" title="Book appointment"></iframe>\n</dialog>`;
    }
    return `<iframe src="${src}" style="width:100%;min-height:720px;border:0;border-radius:12px;" title="Book appointment" allow="camera; microphone"></iframe>`;
  }, [absoluteBookingUrl, embedColor, settings.embed.mode]);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    } catch {
      setError('Could not copy snippet');
    }
  };

  if (loading) {
    return (
      <Page>
        <LoadingState label="Loading scheduling settings…" className="min-h-[40vh]" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Business · Online Scheduling"
        title="Scheduling Settings"
        description="Configure your public booking page, availability, embed widgets, and reminders."
        actions={
          <Button icon={<Save />} loading={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}
      {savedAt ? (
        <Alert tone="success">Settings saved at {savedAt}. Public /schedule now uses these values.</Alert>
      ) : null}

      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const isOpen = open === section.id;
          return (
            <Card key={section.id} className="overflow-hidden">
              <h2>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : section.id)}
                  aria-expanded={isOpen}
                  aria-controls={`section-${section.id}`}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:px-5"
                >
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
                  >
                    <CalendarPlus size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{section.title}</span>
                    <span className="block text-xs text-slate-500">{section.blurb}</span>
                  </span>
                  {isOpen ? <ChevronUp aria-hidden className="text-slate-500" size={18} /> : <ChevronDown aria-hidden className="text-slate-500" size={18} />}
                </button>
              </h2>

              {isOpen ? (
                <div id={`section-${section.id}`} className="space-y-4 border-t border-slate-200 px-4 pb-5 pt-4 sm:px-5">
                  {section.id === 'link' ? (
                    <>
                      <FormField label="Public booking URL">
                        <input className={inputClass()} readOnly value={absoluteBookingUrl} />
                      </FormField>
                      <p className="text-xs text-slate-500">
                        Org slug: <span className="font-semibold text-slate-700">{slug || '—'}</span>
                        {' · '}
                        Path: <code className="rounded bg-slate-100 px-1.5 py-0.5">/schedule?org={slug || 'SLUG'}</code>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          icon={copied ? <Check className="text-emerald-600" /> : <Copy />}
                          onClick={() => void copyLink()}
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                        <a
                          href={bookingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonClasses({ variant: 'secondary' })}
                        >
                          <ExternalLink size={16} aria-hidden />
                          Open Preview
                        </a>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField label="Practice name">
                          <input
                            className={inputClass()}
                            value={settings.practiceName || ''}
                            onChange={(e) => patch('practiceName', e.target.value || null)}
                          />
                        </FormField>
                        <FormField label="Practice city">
                          <input
                            className={inputClass()}
                            value={settings.practiceCity}
                            onChange={(e) => patch('practiceCity', e.target.value)}
                          />
                        </FormField>
                        <FormField label="Contact phone">
                          <input
                            className={inputClass()}
                            value={settings.contactPhone || ''}
                            onChange={(e) => patch('contactPhone', e.target.value || null)}
                          />
                        </FormField>
                        <FormField label="Contact email">
                          <input
                            className={inputClass()}
                            type="email"
                            value={settings.contactEmail || ''}
                            onChange={(e) => patch('contactEmail', e.target.value || null)}
                          />
                        </FormField>
                      </div>
                    </>
                  ) : null}

                  {section.id === 'services' ? (
                    <>
                      <div className="space-y-3">
                        {settings.services.map((svc) => (
                          <div
                            key={svc.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">{svc.title}</p>
                                <p className="text-xs text-slate-500">{svc.durationLabel}</p>
                              </div>
                              <Toggle checked={svc.enabled} label={`${svc.title} bookable`} onChange={(v) => setService(svc.id, { enabled: v })} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-4 text-sm">
                              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                  checked={svc.telehealth}
                                  onChange={(e) => setService(svc.id, { telehealth: e.target.checked })}
                                  disabled={!svc.enabled}
                                />
                                Telehealth
                              </label>
                              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                  checked={svc.inPerson}
                                  onChange={(e) => setService(svc.id, { inPerson: e.target.checked })}
                                  disabled={!svc.enabled}
                                />
                                In-Person
                              </label>
                              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                                Minutes
                                <input
                                  type="number"
                                  min={5}
                                  max={240}
                                  className={`w-20 ${COMPACT_INPUT}`}
                                  value={svc.durationMin}
                                  onChange={(e) => setService(svc.id, { durationMin: Math.max(5, Number(e.target.value) || 0) })}
                                  disabled={!svc.enabled}
                                />
                              </label>
                              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                                Default CPT
                                <input
                                  className={`w-24 uppercase ${COMPACT_INPUT}`}
                                  value={svc.defaultCpt ?? ''}
                                  maxLength={5}
                                  placeholder="90837"
                                  onChange={(e) => setService(svc.id, { defaultCpt: e.target.value.toUpperCase() || undefined })}
                                  disabled={!svc.enabled}
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                      <FormField label="Minimum notice (days)" className="max-w-xs">
                        <select
                          className={inputClass()}
                          value={settings.minNoticeDays}
                          onChange={(e) => patch('minNoticeDays', Number(e.target.value))}
                        >
                          {MIN_NOTICE.map((d) => (
                            <option key={d} value={d}>
                              {d === 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'}`}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </>
                  ) : null}

                  {section.id === 'hours' ? (
                    <>
                      <div className="space-y-2">
                        {DAY_LABELS.map(({ key, label }) => {
                          const day = settings.hours[key] || { enabled: false, start: '09:00', end: '17:00' };
                          return (
                            <div
                              key={key}
                              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5"
                            >
                              <Toggle checked={day.enabled} label={`${label} open`} onChange={(v) => setDay(key, { enabled: v })} />
                              <span className="w-24 text-sm font-semibold text-slate-800">{label}</span>
                              <input
                                type="time"
                                aria-label={`${label} start`}
                                className={`w-auto py-1.5 ${COMPACT_INPUT}`}
                                value={day.start}
                                disabled={!day.enabled}
                                onChange={(e) => setDay(key, { start: e.target.value })}
                              />
                              <span className="text-xs text-slate-500">to</span>
                              <input
                                type="time"
                                aria-label={`${label} end`}
                                className={`w-auto py-1.5 ${COMPACT_INPUT}`}
                                value={day.end}
                                disabled={!day.enabled}
                                onChange={(e) => setDay(key, { end: e.target.value })}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField label="Buffer between visits">
                          <select
                            className={inputClass()}
                            value={settings.bufferMinutes}
                            onChange={(e) => patch('bufferMinutes', Number(e.target.value))}
                          >
                            {BUFFER.map((m) => (
                              <option key={m} value={m}>
                                {m} minutes
                              </option>
                            ))}
                          </select>
                        </FormField>
                        <FormField label="Book-ahead window">
                          <select
                            className={inputClass()}
                            value={settings.bookAheadDays}
                            onChange={(e) => patch('bookAheadDays', Number(e.target.value))}
                          >
                            {BOOK_AHEAD.map((d) => (
                              <option key={d} value={d}>
                                {d} days
                              </option>
                            ))}
                          </select>
                        </FormField>
                      </div>
                    </>
                  ) : null}

                  {section.id === 'rules' ? (
                    <>
                      <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Require insurance at booking</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Patients must select a payer before confirming. Eligibility can be verified later via Availity.
                          </p>
                        </div>
                        <Toggle
                          checked={settings.rules.requireInsurance}
                          onChange={(v) => patch('rules', { ...settings.rules, requireInsurance: v })}
                        />
                      </label>
                      <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">New clients only</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Public booking is intended for new patient intake; existing clients should call the office.
                          </p>
                        </div>
                        <Toggle
                          checked={settings.rules.newClientsOnly}
                          onChange={(v) => patch('rules', { ...settings.rules, newClientsOnly: v })}
                        />
                      </label>
                      <Alert
                        tone="warning"
                        icon={<Lock />}
                        title="HIPAA notice (required)"
                        actions={<Toggle checked disabled label="HIPAA notice (required)" onChange={() => undefined} />}
                      >
                        Patients must acknowledge a HIPAA privacy notice before confirming. This checkbox cannot be
                        disabled.
                      </Alert>
                    </>
                  ) : null}

                  {section.id === 'embed' ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {(['iframe', 'button', 'modal'] as const).map((mode) => (
                          <Button
                            key={mode}
                            variant={settings.embed.mode === mode ? 'primary' : 'secondary'}
                            aria-pressed={settings.embed.mode === mode}
                            onClick={() => patch('embed', { ...settings.embed, mode })}
                            className="capitalize"
                          >
                            {mode}
                          </Button>
                        ))}
                      </div>
                      <FormField label="Brand color" className="max-w-xs">
                        {(control) => (
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              aria-label="Pick brand color"
                              value={settings.embed.color || PURPLE}
                              onChange={(e) => patch('embed', { ...settings.embed, color: e.target.value })}
                              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                            />
                            <input
                              {...control}
                              className={inputClass()}
                              value={settings.embed.color || PURPLE}
                              onChange={(e) => patch('embed', { ...settings.embed, color: e.target.value })}
                            />
                          </div>
                        )}
                      </FormField>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-700">Embed snippet</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={copiedSnippet ? <Check /> : <Copy />}
                            onClick={() => void copySnippet()}
                            className="text-blue-700"
                          >
                            {copiedSnippet ? 'Copied' : 'Copy snippet'}
                          </Button>
                        </div>
                        <pre className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                          {snippet}
                        </pre>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                        <p className="font-semibold text-slate-800">CMS tips</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          <li>
                            <strong>WordPress:</strong> Custom HTML block → paste iframe/button snippet.
                          </li>
                          <li>
                            <strong>Wix:</strong> Embed → HTML iframe → paste snippet; set height ≥ 720px.
                          </li>
                          <li>
                            <strong>Squarespace / Webflow:</strong> Code embed / Embed element with the same HTML.
                          </li>
                        </ul>
                      </div>
                    </>
                  ) : null}

                  {section.id === 'reminders' ? (
                    <>
                      {(
                        [
                          ['emailConfirm', 'Email confirmation after booking'],
                          ['smsConfirm', 'SMS confirmation after booking'],
                          ['emailReminder24h', 'Email reminder 24 hours before'],
                          ['smsReminder24h', 'SMS reminder 24 hours before'],
                          ['smsReminder2h', 'SMS reminder 2 hours before'],
                          ['smsShowPracticeName', 'Show the practice name in texts (off: texts say "Your care team")'],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3"
                        >
                          <span className="text-sm font-semibold text-slate-800">{label}</span>
                          <Toggle
                            label={label}
                            checked={settings.reminders[key]}
                            onChange={(v) => patch('reminders', { ...settings.reminders, [key]: v })}
                          />
                        </label>
                      ))}
                      <Alert tone="info" title="SMS & PHI">
                        Texts go only to clients who consented to text messages and have not replied STOP. They carry the
                        date and time only: never the clinician, visit type, diagnosis or balance. Turn off the practice
                        name if it reveals the kind of care (for example a counseling or recovery practice).
                      </Alert>
                    </>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button icon={<Save />} loading={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>

      {/* Calendar color labels save on their own (not part of Save Changes) */}
      <CalendarLabelsSection />
    </Page>
  );
}
