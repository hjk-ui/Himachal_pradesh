/**
 * Consent library catalog (pure): every template version, lookups, the default packet order and
 * rendering of template variables. See types.ts for the design.
 */
import type { ConsentTemplateVersion, RenderedTemplate, TemplateBlock, TemplateVariables } from './types';
import { PRACTICE_PACKET_V1 } from './practicePacket';
import { PROPOSED_TEMPLATES } from './proposed';
import { TYPO_FIX_TEMPLATES } from './typoFixes';

export const ALL_TEMPLATE_VERSIONS: readonly ConsentTemplateVersion[] = Object.freeze([...PRACTICE_PACKET_V1, ...TYPO_FIX_TEMPLATES, ...PROPOSED_TEMPLATES]);

/** ConsentForm.formKey for library rows: "lib:<template key>" (Carelon rows use their own key). */
export const LIBRARY_FORM_PREFIX = 'lib:';
export const formKeyFor = (key: string) => `${LIBRARY_FORM_PREFIX}${key}`;
export function templateKeyOf(formKey: string | null | undefined): string | null {
  return formKey && formKey.startsWith(LIBRARY_FORM_PREFIX) ? formKey.slice(LIBRARY_FORM_PREFIX.length) : null;
}

/** Default packet order (the practice can reorder / deselect in Library settings). */
export const DEFAULT_PACKET_ORDER: readonly string[] = [
  'program-orientation',
  'confidentiality-part2-notice',
  'release-of-information-explanation',
  'duty-to-warn',
  'rehabilitation-assessment-irp',
  'course-of-treatment',
  'transition-discharge',
  'legal-requirement-expectations',
  'after-hours-emergency',
  'weapons-drugs',
  'advance-directives-education',
  'abuse-neglect-reporting',
  'program-rules',
  'reinstatement',
  'facility-orientation',
  'grievance-procedure',
  'informed-consent-treatment',
  'minor-consent-treatment',
  'primary-care-consent',
  'participant-responsibilities',
  'controlled-substance-agreement',
  'hipaa-acknowledgment',
  'npp-acknowledgment',
  'telehealth-consent',
  'recording-transcription-consent',
  'ai-note-drafting-consent',
  'communication-consent',
  'group-therapy-confidentiality',
  'advance-directive-status',
  'financial-responsibility',
  'part2-consent',
  'roi-authorization',
];

/** Every template key, in packet order, then any others. */
export const TEMPLATE_KEYS: readonly string[] = [
  ...DEFAULT_PACKET_ORDER,
  ...[...new Set(ALL_TEMPLATE_VERSIONS.map((t) => t.key))].filter((k) => !DEFAULT_PACKET_ORDER.includes(k)),
];

export function versionsOf(key: string): ConsentTemplateVersion[] {
  return ALL_TEMPLATE_VERSIONS.filter((t) => t.key === key).sort((a, b) => a.version - b.version);
}

export function templateVersion(key: string, version: number): ConsentTemplateVersion | null {
  return ALL_TEMPLATE_VERSIONS.find((t) => t.key === key && t.version === version) ?? null;
}

export function latestTitle(key: string): string {
  const v = versionsOf(key);
  return v[v.length - 1]?.title ?? key;
}

/** Legacy simple consent types (ConsentForm.formKey null) that count for a library template. */
export const LEGACY_TYPE_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  'Consent to Treat': 'informed-consent-treatment',
  'HIPAA Notice': 'npp-acknowledgment',
  'Telehealth Consent': 'telehealth-consent',
  'AI Note Drafting': 'ai-note-drafting-consent',
  'Release of Information': 'roi-authorization',
});

/** ConsentForm.type written for a library row (existing gates read some of these types). */
export function consentTypeFor(t: ConsentTemplateVersion): string {
  return t.consentType ?? t.title;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const VAR_RE = /\{\{(\w+)\}\}/g;

export function variablesIn(t: ConsentTemplateVersion): string[] {
  const found = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(VAR_RE)) found.add(m[1]);
  };
  for (const b of t.blocks) {
    if (b.kind === 'ul' || b.kind === 'ol') b.items.forEach(scan);
    else if (b.kind === 'lead') {
      scan(b.label);
      scan(b.text);
    } else scan(b.text);
  }
  scan(t.acknowledgment);
  t.checkboxes?.forEach((c) => scan(c.label));
  t.choices?.forEach((c) => {
    scan(c.label);
    c.options.forEach((o) => scan(o.label));
  });
  t.fields?.forEach((f) => scan(f.label));
  return [...found];
}

function sub(text: string, vals: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string) => (vals[name] ? vals[name] : whole));
}

/** Resolve {{variables}} from practice settings. Unset variables stay as {{name}} and are listed. */
export function renderTemplate(t: ConsentTemplateVersion, vars: TemplateVariables): RenderedTemplate {
  const used = variablesIn(t);
  const vals: Record<string, string> = {};
  for (const name of used) {
    const v = (vars as Record<string, string | null | undefined>)[name];
    vals[name] = typeof v === 'string' ? v.trim() : '';
  }
  const blocks: TemplateBlock[] = t.blocks.map((b) => {
    if (b.kind === 'ul' || b.kind === 'ol') return { ...b, items: b.items.map((i) => sub(i, vals)) };
    if (b.kind === 'lead') return { ...b, label: sub(b.label, vals), text: sub(b.text, vals) };
    return { ...b, text: sub(b.text, vals) };
  });
  return {
    key: t.key,
    version: t.version,
    title: sub(t.title, vals),
    blocks,
    acknowledgment: sub(t.acknowledgment, vals),
    checkboxes: (t.checkboxes ?? []).map((c) => ({ ...c, label: sub(c.label, vals) })),
    choices: (t.choices ?? []).map((c) => ({ ...c, label: sub(c.label, vals), options: c.options.map((o) => ({ ...o, label: sub(o.label, vals) })) })),
    fields: (t.fields ?? []).map((f) => ({ ...f, label: sub(f.label, vals) })),
    variables: vals,
    missingVariables: used.filter((n) => !vals[n]),
  };
}

/** Plain text of a rendered template (search, PDF, tests). */
export function renderedText(r: Pick<RenderedTemplate, 'blocks'>): string {
  return r.blocks
    .map((b) => (b.kind === 'ul' || b.kind === 'ol' ? b.items.join('\n') : b.kind === 'lead' ? `${b.label} ${b.text}` : b.text))
    .join('\n');
}
