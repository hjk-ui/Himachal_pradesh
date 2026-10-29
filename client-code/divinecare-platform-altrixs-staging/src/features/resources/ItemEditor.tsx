'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { ClinicalModal } from '@/components/clinic/ClinicalModal';
import { FormField } from '@/components/ui';
import {
  AUDIENCES,
  AUDIENCE_LABEL,
  LANGUAGES,
  READING_LEVELS,
  RESOURCE_KINDS,
  RESOURCE_KIND_LABEL,
  STAFF_CATEGORIES,
  STAFF_CATEGORY_LABEL,
  TOPICS,
  TOPIC_LABEL,
  type ResourceItemDto,
} from '@/lib/resources/types';
import { saveItem, uploadItemFile } from './api';

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';

/** Roles a staff resource can be limited to (empty = everyone) */
const STAFF_ROLE_OPTIONS = [
  ['THERAPIST', 'Therapists'], ['PSYCHIATRIST', 'Psychiatrists'], ['NP', 'Nurse practitioners'], ['PRP_SPECIALIST', 'PRP specialists'],
  ['CASE_MANAGER', 'Case managers'], ['PEER_SUPPORT', 'Peer support'], ['PHYSICIAN', 'Physicians'], ['MEDICAL_NP', 'Medical NPs'],
  ['MEDICAL_ASSISTANT', 'Medical assistants'], ['FRONT_DESK', 'Front desk'], ['BILLING', 'Billing'], ['OFFICE_MANAGER', 'Office manager'], ['HR', 'HR'],
] as const;

type Draft = {
  kind: string;
  title: string;
  summary: string;
  body: string;
  url: string;
  contactPhone: string;
  contactText: string;
  topics: string[];
  audiences: string[];
  language: string;
  readingLevel: string;
  publisher: string;
  licenseNote: string;
  staffCategory: string;
  visibleRoles: string[];
};

function toDraft(item: ResourceItemDto | null, audience: 'patient' | 'staff'): Draft {
  return {
    kind: item?.kind ?? (audience === 'staff' ? 'link' : 'handout'),
    title: item?.title ?? '',
    summary: item?.summary ?? '',
    body: item?.body ?? '',
    url: item?.url ?? '',
    contactPhone: item?.contactPhone ?? '',
    contactText: item?.contactText ?? '',
    topics: item?.topics ?? [],
    audiences: item?.audiences ?? [],
    language: item?.language ?? 'en',
    readingLevel: item?.readingLevel ?? '',
    publisher: item?.publisher ?? '',
    licenseNote: item?.licenseNote ?? '',
    staffCategory: item?.staffCategory ?? (audience === 'staff' ? 'policy' : ''),
    visibleRoles: item?.visibleRoles ?? [],
  };
}

function Chips({ label, options, value, onChange }: { label: string; options: readonly (readonly [string, string])[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => {
          const on = value.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
              className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-[#5C2D91] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ItemEditor({
  item,
  audience,
  canReview,
  onClose,
  onSaved,
}: {
  item: ResourceItemDto | null;
  audience: 'patient' | 'staff';
  canReview: boolean;
  onClose: () => void;
  onSaved: (item: ResourceItemDto) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(item, audience));
  const [current, setCurrent] = useState<ResourceItemDto | null>(item);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const kinds = audience === 'staff' ? (['handout', 'link', 'video', 'article'] as const) : RESOURCE_KINDS;
  const needsUrl = ['link', 'video', 'crisis', 'community'].includes(d.kind);

  async function run(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        ...(current ? {} : { audience }),
        kind: d.kind,
        title: d.title,
        summary: d.summary || null,
        body: d.kind === 'article' ? d.body || null : null,
        url: d.url || null,
        contactPhone: d.contactPhone || null,
        contactText: d.contactText || null,
        topics: d.topics,
        audiences: d.audiences,
        language: d.language,
        readingLevel: d.readingLevel || null,
        publisher: d.publisher || null,
        licenseNote: d.licenseNote || null,
        ...(audience === 'staff' ? { staffCategory: d.staffCategory || null, visibleRoles: d.visibleRoles } : {}),
        ...extra,
      };
      let saved = (await saveItem(current?.id ?? null, body)).item;
      if (file) saved = (await uploadItemFile(saved.id, file)).item;
      setFile(null);
      setCurrent(saved);
      onSaved(saved);
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const status = current?.status ?? 'draft';
  return (
    <ClinicalModal
      title={current ? 'Edit resource' : audience === 'staff' ? 'Add staff resource' : 'Add resource'}
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Status: <span className="font-semibold text-slate-800">{status}</span></p>
          <div className="flex flex-wrap gap-2">
            {canReview && audience === 'patient' && current && (
              <button type="button" disabled={busy} onClick={() => run({ markReviewed: true })} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                <CheckCircle2 size={15} aria-hidden /> Record clinical review
              </button>
            )}
            {current && status !== 'retired' && (
              <button type="button" disabled={busy} onClick={() => run({ status: 'retired' })} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Retire
              </button>
            )}
            <button type="button" disabled={busy || d.title.trim().length < 2} onClick={() => run()} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Save {status === 'active' ? '' : 'draft'}
            </button>
            {status !== 'active' && (
              <button type="button" disabled={busy || d.title.trim().length < 2} onClick={() => run({ status: 'active' })} className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4a2475] disabled:opacity-50">
                {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Save and activate
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Type" required>
          <select value={d.kind} onChange={(e) => set('kind', e.target.value)} disabled={Boolean(current)} className={inputCls}>
            {kinds.map((k) => <option key={k} value={k}>{RESOURCE_KIND_LABEL[k]}</option>)}
          </select>
        </FormField>
        <FormField label="Title" required>
          <input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={300} className={inputCls} />
        </FormField>
        <FormField label="Summary" className="sm:col-span-2" hint="One or two plain-language sentences in your own words.">
          <textarea value={d.summary} onChange={(e) => set('summary', e.target.value)} rows={2} maxLength={2000} className={inputCls} />
        </FormField>
        {d.kind === 'article' && (
          <FormField label="Article text" className="sm:col-span-2" hint="Write your own content. Do not paste copyrighted material.">
            <textarea value={d.body} onChange={(e) => set('body', e.target.value)} rows={8} className={inputCls} />
          </FormField>
        )}
        {(needsUrl || d.kind === 'handout') && (
          <FormField label={d.kind === 'handout' ? 'Link (optional)' : 'Link'} required={d.kind === 'link' || d.kind === 'video'} className="sm:col-span-2" hint="Link to the publisher's page; do not upload copies of copyrighted worksheets.">
            <input value={d.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" className={inputCls} />
          </FormField>
        )}
        {(d.kind === 'crisis' || d.kind === 'community') && (
          <>
            <FormField label="Phone (as published)">
              <input value={d.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} className={inputCls} />
            </FormField>
            <FormField label="Text line (as published)">
              <input value={d.contactText} onChange={(e) => set('contactText', e.target.value)} className={inputCls} />
            </FormField>
          </>
        )}
        {d.kind === 'handout' && (
          <FormField label="File (PDF, PNG or JPEG, 10 MB)" className="sm:col-span-2" hint={current?.hasFile ? `Current file: ${current.fileName}. Uploading a new file requires a new clinical review.` : 'Stored privately; every download is audited.'}>
            {(control) => (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:bg-slate-50">
                <Upload size={16} aria-hidden />
                <span>{file ? file.name : 'Choose a file'}</span>
                <input {...control} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </FormField>
        )}
        <FormField label="Publisher / source">
          <input value={d.publisher} onChange={(e) => set('publisher', e.target.value)} placeholder="e.g. NIMH, or your practice" className={inputCls} />
        </FormField>
        <FormField label="Language">
          <select value={d.language} onChange={(e) => set('language', e.target.value)} className={inputCls}>
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </FormField>
        {audience === 'patient' ? (
          <>
            <FormField label="Reading level">
              <select value={d.readingLevel} onChange={(e) => set('readingLevel', e.target.value)} className={inputCls}>
                <option value="">Not assessed</option>
                {READING_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </FormField>
            <FormField label="License / permission note">
              <input value={d.licenseNote} onChange={(e) => set('licenseNote', e.target.value)} placeholder="e.g. Practice-authored; or public domain, linked" className={inputCls} />
            </FormField>
            <div className="sm:col-span-2">
              <Chips label="Topics" options={TOPICS.map((t) => [t, TOPIC_LABEL[t]] as const)} value={d.topics} onChange={(v) => set('topics', v)} />
            </div>
            <div className="sm:col-span-2">
              <Chips label="Audience" options={AUDIENCES.map((a) => [a, AUDIENCE_LABEL[a]] as const)} value={d.audiences} onChange={(v) => set('audiences', v)} />
            </div>
          </>
        ) : (
          <>
            <FormField label="Category">
              <select value={d.staffCategory} onChange={(e) => set('staffCategory', e.target.value)} className={inputCls}>
                {STAFF_CATEGORIES.map((c) => <option key={c} value={c}>{STAFF_CATEGORY_LABEL[c]}</option>)}
              </select>
            </FormField>
            <div className="sm:col-span-2">
              <Chips label="Visible to (none selected = all staff)" options={STAFF_ROLE_OPTIONS} value={d.visibleRoles} onChange={(v) => set('visibleRoles', v)} />
            </div>
          </>
        )}
      </div>
      {current?.lastReviewedAt && (
        <p className="mt-4 text-xs text-slate-500">Clinically reviewed {new Date(current.lastReviewedAt).toLocaleDateString()} by {current.reviewerName ?? 'a clinician'}.</p>
      )}
      {error && <p role="alert" className="mt-4 text-sm font-medium text-rose-700">{error}</p>}
    </ClinicalModal>
  );
}
