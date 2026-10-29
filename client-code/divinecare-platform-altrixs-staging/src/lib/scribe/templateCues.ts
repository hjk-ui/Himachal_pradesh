/**
 * Template cues beside the live transcript: the selected scribe format's sections, each with a
 * short prompt of what to cover, plus the Visit Guide's in-session steps when an appointment is
 * linked (C-SSRS, PDMP, medication reconciliation, AIMS on an antipsychotic …). Pure, browser-safe.
 *
 * Display only: built from the template definitions and the already-loaded Visit Guide. Nothing
 * here is sent to the AI or stored, and it does not change what the draft contains. There is no
 * per-section "heard" signal in the scribe today (the model decides at draft time), so sections are
 * a checklist; Visit Guide steps show the guide's own done state.
 */
import { NOTE_PLACEHOLDERS, type NoteType } from '@/lib/ehr/noteTemplates';
import { THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { TS } from '@/lib/ehr/therapy/sections';
import type { GuideStep } from '@/lib/visits/types';
import { aiFieldCatalog, formatSpec } from './templateFields';
import type { ScribeFormat } from './settings';

export type SectionCue = {
  heading: string;
  /** What to cover, from the template's own section help (placeholder) or field labels */
  cue: string;
  /** The AI draft may fill this section; false = the clinician completes it in Notes */
  aiFills: boolean;
  /** Visit Guide 'note' steps that name this section (labels) */
  guide: string[];
};

export type GuideCue = { id: string; label: string; help: string | null; level: GuideStep['level']; done: boolean };

const trimCue = (s: string) => s.replace(/…$/, '').trim();

/** Sections of the selected format with their cues. */
export function templateCues(format: ScribeFormat): SectionCue[] {
  const spec = formatSpec(format);
  if (spec.kind === 'plan') {
    return [{ heading: 'Progress summary', cue: 'Progress on each treatment plan goal discussed, with the client’s own words', aiFills: true, guide: [] }];
  }
  if (spec.kind === 'template') {
    const aiHeadings = new Set(aiFieldCatalog(spec.noteType).map((f) => f.heading));
    return THERAPY_TEMPLATES[spec.noteType].sections.map((s) => {
      const labels = s.fields.filter((f) => f.kind !== 'widget').map((f) => f.label);
      const widget = s.fields.find((f) => f.kind === 'widget');
      const fallback = widget && widget.kind === 'widget' ? widget.label : '';
      const help = NOTE_PLACEHOLDERS[spec.noteType]?.[s.heading];
      const cue = labels.length ? labels.slice(0, 6).join(', ') + (labels.length > 6 ? ', …' : '') : fallback || (help ? trimCue(help) : '');
      const mse = s.fields.some((f) => f.kind === 'widget' && f.widget === 'mse');
      return {
        heading: s.heading,
        cue,
        aiFills: s.heading !== TS.session && s.heading !== TS.review && (aiHeadings.has(s.heading) || mse),
        guide: [],
      };
    });
  }
  const help = NOTE_PLACEHOLDERS[spec.noteType as NoteType] ?? {};
  return spec.headings.map((h) => ({
    heading: h,
    cue: help[h] ? trimCue(help[h]) : '',
    aiFills: h === spec.mseHeading || spec.aiHeadings.includes(h),
    guide: [],
  }));
}

/** In-session Visit Guide steps worth a cue: required ones, and conditional ones that apply to this patient. */
export function guideCues(steps: readonly GuideStep[]): GuideCue[] {
  return steps
    .filter((s) => s.phase === 'during' && s.source !== 'note' && s.status !== 'not_applicable' && (s.level === 'required' || Boolean(s.when)))
    .map((s) => ({ id: s.id, label: s.label, help: s.help ?? null, level: s.level, done: s.status === 'done' }));
}

/** Attach the guide's 'note' steps (e.g. "Prescribing decision" → Plan - Med Changes) to their sections. */
export function withGuideNoteSteps(cues: SectionCue[], steps: readonly GuideStep[]): SectionCue[] {
  const by = new Map<string, string[]>();
  for (const s of steps) {
    if (s.source !== 'note' || !s.noteSection || s.status === 'not_applicable') continue;
    by.set(s.noteSection, [...(by.get(s.noteSection) ?? []), s.label]);
  }
  return cues.map((c) => (by.has(c.heading) ? { ...c, guide: by.get(c.heading)! } : c));
}
