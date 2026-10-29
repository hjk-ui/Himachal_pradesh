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
import { PageHeader } from '@/components/clinic/ui';
import {
  defaultSchedulingSettings,
  type DayHours,
  type SchedulingSettingsShape,
} from '@/lib/scheduling/types';

const PURPLE = '#5C2D91';
const CTA = 'linear-gradient(135deg, #5C2D91, #7C3AED)';

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
  return 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#5C2D91] focus:ring-4 focus:ring-purple-100';
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? 'bg-[#5C2D91]' : 'bg-slate-300'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
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
      <div className="grid min-h-[40vh] place-items-center text-sm font-semibold text-slate-500">
        Loading scheduling settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Business · Online Scheduling"
        title="Scheduling Settings"
        description="Configure your public booking page, availability, embed widgets, and reminders."
        actions={
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
            style={{ background: CTA }}
          >
            <Save size={16} />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      {savedAt ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          Settings saved at {savedAt}. Public /schedule now uses these values.
        </div>
      ) : null}

      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const isOpen = open === section.id;
          return (
            <div key={section.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : section.id)}
                className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
              >
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                  style={{ background: CTA }}
                >
                  <CalendarPlus size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{section.title}</p>
                  <p className="text-xs text-slate-500">{section.blurb}</p>
                </div>
                {isOpen ? <ChevronUp className="text-slate-400" size={18} /> : <ChevronDown className="text-slate-400" size={18} />}
              </button>

              {isOpen ? (
                <div className="space-y-4 border-t border-slate-100 px-4 pb-5 pt-4 sm:px-5">
                  {section.id === 'link' ? (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Public booking URL</span>
                        <input className={inputClass()} readOnly value={absoluteBookingUrl} />
                      </label>
                      <p className="text-xs text-slate-500">
                        Org slug: <span className="font-semibold text-slate-700">{slug || '—'}</span>
                        {' · '}
                        Path: <code className="rounded bg-slate-100 px-1.5 py-0.5">/schedule?org={slug || 'SLUG'}</code>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void copyLink()}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <a
                          href={bookingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white"
                          style={{ background: CTA }}
                        >
                          <ExternalLink size={16} />
                          Open Preview
                        </a>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Practice name</span>
                          <input
                            className={inputClass()}
                            value={settings.practiceName || ''}
                            onChange={(e) => patch('practiceName', e.target.value || null)}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Practice city</span>
                          <input
                            className={inputClass()}
                            value={settings.practiceCity}
                            onChange={(e) => patch('practiceCity', e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Contact phone</span>
                          <input
                            className={inputClass()}
                            value={settings.contactPhone || ''}
                            onChange={(e) => patch('contactPhone', e.target.value || null)}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Contact email</span>
                          <input
                            className={inputClass()}
                            type="email"
                            value={settings.contactEmail || ''}
                            onChange={(e) => patch('contactEmail', e.target.value || null)}
                          />
                        </label>
                      </div>
                    </>
                  ) : null}

                  {section.id === 'services' ? (
                    <>
                      <div className="space-y-3">
                        {settings.services.map((svc) => (
                          <div
                            key={svc.id}
                            className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{svc.title}</p>
                                <p className="text-xs text-slate-500">{svc.durationLabel}</p>
                              </div>
                              <Toggle checked={svc.enabled} onChange={(v) => setService(svc.id, { enabled: v })} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-4 text-sm">
                              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded text-[#5C2D91]"
                                  checked={svc.telehealth}
                                  onChange={(e) => setService(svc.id, { telehealth: e.target.checked })}
                                  disabled={!svc.enabled}
                                />
                                Telehealth
                              </label>
                              <label className="inline-flex items-center gap-2 font-medium text-slate-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded text-[#5C2D91]"
                                  checked={svc.inPerson}
                                  onChange={(e) => setService(svc.id, { inPerson: e.target.checked })}
                                  disabled={!svc.enabled}
                                />
                                In-Person
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                      <label className="block max-w-xs">
                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Minimum notice (days)</span>
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
                      </label>
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
                              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                            >
                              <Toggle checked={day.enabled} onChange={(v) => setDay(key, { enabled: v })} />
                              <span className="w-24 text-sm font-semibold text-slate-800">{label}</span>
                              <input
                                type="time"
                                className={`${inputClass()} w-auto`}
                                value={day.start}
                                disabled={!day.enabled}
                                onChange={(e) => setDay(key, { start: e.target.value })}
                              />
                              <span className="text-xs text-slate-400">to</span>
                              <input
                                type="time"
                                className={`${inputClass()} w-auto`}
                                value={day.end}
                                disabled={!day.enabled}
                                onChange={(e) => setDay(key, { end: e.target.value })}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Buffer between visits</span>
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
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Book-ahead window</span>
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
                        </label>
                      </div>
                    </>
                  ) : null}

                  {section.id === 'rules' ? (
                    <>
                      <label className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
                        <div>
                          <p className="font-semibold text-slate-900">Require insurance at booking</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Patients must select a payer before confirming. Eligibility can be verified later via Availity.
                          </p>
                        </div>
                        <Toggle
                          checked={settings.rules.requireInsurance}
                          onChange={(v) => patch('rules', { ...settings.rules, requireInsurance: v })}
                        />
                      </label>
                      <label className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
                        <div>
                          <p className="font-semibold text-slate-900">New clients only</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Public booking is intended for new patient intake; existing clients should call the office.
                          </p>
                        </div>
                        <Toggle
                          checked={settings.rules.newClientsOnly}
                          onChange={(v) => patch('rules', { ...settings.rules, newClientsOnly: v })}
                        />
                      </label>
                      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        <Lock size={16} className="mt-0.5 shrink-0 text-amber-700" />
                        <div>
                          <p className="font-semibold">HIPAA notice (required)</p>
                          <p className="mt-1 text-xs text-amber-900/90">
                            Patients must acknowledge a HIPAA privacy notice before confirming. This checkbox cannot be
                            disabled.
                          </p>
                        </div>
                        <Toggle checked disabled onChange={() => undefined} />
                      </div>
                    </>
                  ) : null}

                  {section.id === 'embed' ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {(['iframe', 'button', 'modal'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => patch('embed', { ...settings.embed, mode })}
                            className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize ${
                              settings.embed.mode === mode
                                ? 'text-white'
                                : 'border border-slate-200 bg-white text-slate-700'
                            }`}
                            style={settings.embed.mode === mode ? { background: CTA } : undefined}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                      <label className="block max-w-xs">
                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Brand color</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={settings.embed.color || PURPLE}
                            onChange={(e) => patch('embed', { ...settings.embed, color: e.target.value })}
                            className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                          />
                          <input
                            className={inputClass()}
                            value={settings.embed.color || PURPLE}
                            onChange={(e) => patch('embed', { ...settings.embed, color: e.target.value })}
                          />
                        </div>
                      </label>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-700">Embed snippet</span>
                          <button
                            type="button"
                            onClick={() => void copySnippet()}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#5C2D91]"
                          >
                            {copiedSnippet ? <Check size={14} /> : <Copy size={14} />}
                            {copiedSnippet ? 'Copied' : 'Copy snippet'}
                          </button>
                        </div>
                        <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-100">
                          {snippet}
                        </pre>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
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
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3"
                        >
                          <span className="text-sm font-semibold text-slate-800">{label}</span>
                          <Toggle
                            checked={settings.reminders[key]}
                            onChange={(v) => patch('reminders', { ...settings.reminders, [key]: v })}
                          />
                        </label>
                      ))}
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        <p className="font-semibold">SMS & PHI</p>
                        <p className="mt-1 text-xs">
                          SMS reminders should avoid clinical details. Prefer appointment time + clinic contact only.
                          Confirm your SMS vendor BAA before enabling PHI-adjacent messages.
                        </p>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
          style={{ background: CTA }}
        >
          <Save size={16} />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
