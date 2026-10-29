/**
 * Deterministic note quality checks (run first, always; no model involved).
 * Pure: the caller loads the facts (note, signature, claim, plan, risk flags, practice settings)
 * and these functions only read them, so the panel, the server and the tests agree.
 *
 * Sources for each rule are listed in docs/ai-note-quality.md.
 */
import { NOTE_SECTIONS, normalizeNoteType, structuredNoteSections, type NoteType } from '@/lib/ehr/noteTemplates';
import { asStructuredNoteType, isTherapyTemplate, structuredSignBlockers } from '@/lib/ehr/structuredNotes';
import { missingFields, WIDGET_TEXT_CHECKS } from '@/lib/ehr/therapy/engine';
import { cptBaseCode, minutesBetween, noteRequiresTreatmentPlan, suggestTherapyCpt } from '@/lib/ehr/therapy/rules';
import { THERAPY_PROGRESS, TS } from '@/lib/ehr/therapy/sections';
import { THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { sessionTypeFromText } from '@/lib/ehr/therapy/widgets';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { countAiDraftMarkers } from '@/lib/ai/noteDraftFormats';
import { COSIGN_REQUIRED_ROLES } from '@/lib/notes/transitions';
import { fromPracticeWallTime } from '@/lib/time/practiceTime';
import { lintStigma } from '@/lib/scribe/stigma';
import { formatElementIssues, formatElementsGate, willBeRequiredText } from '@/lib/notes/formatElements';
import { sectionCloneWarnings } from '@/lib/notes/aiEvidence';
import type { QualityItem, QualityMode } from './types';

// ─── Facts ──────────────────────────────────────────────────────────────────

export type NoteQualityFacts = {
  mode: QualityMode;
  note: {
    id: string;
    /** Display body (legacy metadata comment removed) */
    body: string;
    noteType: string | null;
    /** YYYY-MM-DD */
    dateOfService: string | null;
    durationMinutes: number | null;
    cptCode: string | null;
    placeOfService: string | null;
    telehealth: boolean;
    part2: boolean;
    createdAt: string;
  };
  author: {
    id: string | null;
    role: string | null;
    onLicensureTrack: boolean;
    /** From HR setting / credential / supervision track (therapy planStore.loadLicenseLevel) */
    licenseLevel: { level: 'LICENSED' | 'PRE_LICENSED'; source: string } | null;
    credentials: { title: string; expiresAt: string }[];
  };
  workflow: {
    status: 'DRAFT' | 'SIGNED' | 'LOCKED';
    signedAt: string | null;
    attestedAt: string | null;
    signedByName: string | null;
    cosignRequired: boolean;
  } | null;
  /** Claims linked to this note (Claim.progressNoteId) */
  claims: { id: string; cptCode: string; icd10Codes: string[]; placeOfService: string | null; modifiers: string[] }[];
  /** Diagnosis codes on the chart / active plan (progress notes rarely restate them) */
  chartDiagnosisCodes: string[];
  /** Treatment plan gate result; null = could not be checked */
  plan: { required: boolean; ok: boolean; message: string } | null;
  /** Plain-language risk flags on the chart around the date of service (incl. AI Scribe transcript findings) */
  riskFlags: string[];
  /** AI Scribe captures linked to the note: transcript risk findings and whether the clinician attested */
  transcriptRisk?: { findings: number; attested: boolean } | null;
  /** The client's last signed notes (newest first, at most 3) for the cloned-section check */
  priorSignedNotes?: { date: string; noteType: string | null; body: string }[];
  settings: {
    noteSignDeadlineHours: number;
    /** 95 | GT | none */
    telehealthModifierDefault: string;
    timeZone: string;
    /** Notes policy: practice date from which missing format elements block signing (default 2026-11-16) */
    formatElementsEnforceFrom?: string | null;
  };
  now: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const PSYCHOTHERAPY_TIMED = ['90832', '90834', '90837'] as const;
const FAMILY = ['90846', '90847'] as const;
const EVAL = ['90791', '90792'] as const;
const ADDONS = ['90833', '90836', '90838'] as const;
const CRISIS = ['90839', '90840'] as const;
const EM_RE = /^99(20[2-5]|21[1-5])$/;
const TELEHEALTH_POS = ['02', '10'];
const ICD_RE = /\b([A-TV-Z]\d{2}(?:\.[0-9A-Z]{1,4})?)\b/g;
const PRESCRIBER_ROLES = ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'];

type Reader = (heading: string) => string;

function sectionReader(type: string, body: string): Reader {
  const sections = structuredNoteSections(type, body);
  return (title: string) =>
    sections
      .filter((s) => s.title === title)
      .map((s) => s.text)
      .join('\n');
}

const has = (list: readonly string[], v: string | null) => Boolean(v) && list.includes(v as string);

function lineAfter(body: string, label: string): string {
  const re = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`, 'mi');
  return (body.match(re)?.[1] || '').trim();
}

/** All CPT codes the note claims: the code column plus any "Psychotherapy add-on: +908xx" header line. */
export function noteCodes(cptCode: string | null, body: string): { base: string | null; addOn: string | null } {
  const raw = String(cptCode ?? '').toUpperCase();
  const base = cptBaseCode(raw);
  const inColumn = [...raw.matchAll(/(9083[368])/g)].map((m) => m[1]).find((c) => c !== base) ?? null;
  const inHeader = body.match(/^Psychotherapy add-on:\s*\+?\s*(9083[368])\b/m)?.[1] ?? null;
  // An add-on billed as the only code is reported as both (the add-on check then flags the missing E/M)
  const addOn = inColumn ?? inHeader ?? (base && has(ADDONS, base) ? base : null);
  return { base, addOn };
}

/** Psychotherapy minutes documented separately from the E/M (add-on codes). */
export function psychotherapyMinutes(body: string): number | null {
  const m =
    body.match(/psychotherapy time[^0-9\n]{0,24}(\d{1,3})\s*(?:min|minutes)\b/i) ||
    body.match(/(\d{1,3})\s*(?:min|minutes)\s+(?:of\s+)?(?:separate\s+|separately\s+identifiable\s+)?psychotherapy\b/i);
  return m ? Number(m[1]) : null;
}

/** 90833 16–37, 90836 38–52, 90838 53+ (CPT midpoint rule, same thresholds as 90832/34/37). */
export function addOnForMinutes(minutes: number): string | null {
  if (minutes < 16) return null;
  if (minutes <= 37) return '90833';
  if (minutes <= 52) return '90836';
  return '90838';
}

export function diagnosisCodesIn(text: string): string[] {
  return [...new Set([...text.matchAll(ICD_RE)].map((m) => m[1].toUpperCase()))].filter((c) => /^F|^Z|^R|^G|^E/.test(c));
}

const normIcd = (c: string) => c.toUpperCase().replace(/\./g, '').trim();

function item(i: QualityItem): QualityItem {
  return i.status === 'pass' || i.status === 'na' ? { ...i, fix: undefined } : i;
}

// ─── 1. Required fields per template ────────────────────────────────────────

export function requiredFieldChecks(f: NoteQualityFacts): QualityItem[] {
  const type = f.note.noteType ? normalizeNoteType(f.note.noteType) : '';
  const out: QualityItem[] = [];
  const structured = asStructuredNoteType(type);

  if (structured && isTherapyTemplate(structured)) {
    const tpl = THERAPY_TEMPLATES[structured];
    const read = sectionReader(structured, f.note.body);
    const missing = missingFields(tpl.sections, read, TS.session);
    // Reported under their own categories (telehealth, treatment plan) instead of twice
    const own = /Patient location during telehealth|Telehealth consent|Goal progress/;
    const required = missing.required.filter((r) => !own.test(r.message));
    const recommended = missing.recommended.filter((r) => !own.test(r.message));
    out.push(
      item({
        id: 'required.template',
        category: 'required',
        label: 'Template required items',
        status: required.length ? 'fail' : 'pass',
        detail: required.length ? required.map((r) => r.message).join(' ') : `All required items of the ${structured} template are documented.`,
        fix: required.length ? `Complete: ${required.map((r) => r.message.replace(/ is required\.$/, '')).join('; ')}.` : undefined,
        source: 'rule',
      })
    );
    if (recommended.length) {
      out.push({
        id: 'required.recommended',
        category: 'required',
        label: 'Recommended items',
        status: 'warn',
        detail: `${recommended.length} recommended item${recommended.length === 1 ? ' is' : 's are'} not documented: ${recommended.map((r) => r.message.replace(/ is not documented\.$/, '')).join('; ')}.`,
        fix: 'Document these if they were assessed; they support medical necessity on audit.',
        source: 'rule',
      });
    }
  } else if (structured) {
    // Psychiatry templates: their own sign rules (code chosen, risk rule, carry-forward review)
    const blockers = structuredSignBlockers({
      noteType: structured,
      body: f.note.body,
      cptCode: f.note.cptCode,
      durationMinutes: f.note.durationMinutes,
    }).filter((b) => !/AI DRAFT|\[___\]/.test(b.message));
    out.push(
      item({
        id: 'required.template',
        category: 'required',
        label: 'Template required items',
        status: blockers.length ? 'fail' : 'pass',
        detail: blockers.length ? blockers.map((b) => b.message).join(' ') : `The ${structured} template's sign rules are met.`,
        fix: blockers[0]?.message,
        source: 'rule',
      })
    );
  } else {
    const elements = formatElementIssues(type, f.note.body);
    if (elements.length) {
      // Warning until the Notes policy date, then a failure (signing is blocked from that date)
      const gate = formatElementsGate({ formatElementsEnforceFrom: f.settings.formatElementsEnforceFrom, timeZone: f.settings.timeZone }, new Date(f.now));
      out.push({
        id: 'required.format_elements',
        category: 'required',
        label: `${type} required elements`,
        status: gate.enforced ? 'fail' : 'warn',
        detail: elements.map((e) => e.message).join(' ') + (gate.enforced ? '' : ` ${willBeRequiredText(gate, new Date(f.now))}`),
        fix: elements[0].message,
        source: 'rule',
      });
    }
    const headings = NOTE_SECTIONS[type as NoteType];
    if (headings && headings.length) {
      const read = sectionReader(type, f.note.body);
      const empty = headings.filter((h) => !read(h).trim());
      out.push(
        item({
          id: 'required.sections',
          category: 'required',
          label: `${type} sections`,
          status: empty.length ? 'warn' : 'pass',
          detail: empty.length ? `Empty section${empty.length === 1 ? '' : 's'}: ${empty.join(', ')}.` : `All ${type} sections have content.`,
          fix: empty.length ? `Fill in ${empty.join(', ')}.` : undefined,
          source: 'rule',
        })
      );
    } else {
      out.push(
        item({
          id: 'required.sections',
          category: 'required',
          label: 'Note content',
          status: f.note.body.trim().length >= 80 ? 'pass' : 'warn',
          detail: f.note.body.trim().length >= 80 ? 'Free-text note has content.' : 'The note is very short for a billed service.',
          fix: 'Document the session content, interventions, response and plan.',
          source: 'rule',
        })
      );
    }
  }

  const blanks = findUnfilledBlanks(f.note.body);
  const markers = countAiDraftMarkers(f.note.body);
  if (blanks || markers) {
    out.push({
      id: 'required.placeholders',
      category: 'required',
      label: 'Placeholders left in the note',
      status: 'fail',
      detail: [blanks ? `${blanks} unfilled [___] blank${blanks === 1 ? '' : 's'}` : '', markers ? `${markers} AI DRAFT marker${markers === 1 ? '' : 's'}` : '']
        .filter(Boolean)
        .join(' and ') + ' remain.',
      fix: 'Fill the blanks and review each AI-drafted section, then remove the marker (by addendum if already signed).',
      source: 'rule',
    });
  }
  return out;
}

// ─── 2. CPT / time ──────────────────────────────────────────────────────────

export function cptTimeChecks(f: NoteQualityFacts): QualityItem[] {
  const out: QualityItem[] = [];
  const { base, addOn } = noteCodes(f.note.cptCode, f.note.body);
  const start = lineAfter(f.note.body, 'Start time').match(/^\d{1,2}:\d{2}/)?.[0] ?? null;
  const end = lineAfter(f.note.body, 'End time').match(/^\d{1,2}:\d{2}/)?.[0] ?? null;
  const span = minutesBetween(start, end);
  const minutes = f.note.durationMinutes ?? span;

  if (!base) {
    out.push({
      id: 'time.code',
      category: 'time',
      label: 'Service code',
      status: 'fail',
      detail: 'No CPT code on the note.',
      fix: 'Choose the CPT code for the service provided.',
      source: 'rule',
    });
    return out;
  }

  // Start / end vs recorded duration
  if (span != null && f.note.durationMinutes != null && Math.abs(span - f.note.durationMinutes) > 2) {
    out.push({
      id: 'time.consistency',
      category: 'time',
      label: 'Start / end time vs duration',
      status: 'fail',
      detail: `Start ${start} to end ${end} is ${span} min, but the note records ${f.note.durationMinutes} min.`,
      fix: 'Correct the start / end time or the duration so they agree.',
      source: 'rule',
    });
  } else if (span != null || f.note.durationMinutes != null) {
    out.push({
      id: 'time.consistency',
      category: 'time',
      label: 'Start / end time vs duration',
      status: span != null ? 'pass' : 'warn',
      detail: span != null ? `${start}–${end} (${span} min) matches the recorded time.` : `Duration ${f.note.durationMinutes} min is recorded without start and end times.`,
      fix: span != null ? undefined : 'Record the session start and end time (time-based codes are audited against them).',
      source: 'rule',
    });
  }

  const overrideReason = lineAfter(f.note.body, 'Code override reason');

  if (has(PSYCHOTHERAPY_TIMED, base)) {
    if (minutes == null) {
      out.push({ id: 'time.rule', category: 'time', label: `${base} time rule`, status: 'fail', detail: `${base} is time-based but no session time is documented.`, fix: 'Record start / end time or face-to-face minutes.', source: 'rule' });
    } else {
      const s = suggestTherapyCpt(minutes, 'individual');
      const ok = s.code === base;
      out.push(
        item({
          id: 'time.rule',
          category: 'time',
          label: `${base} time rule`,
          status: ok ? 'pass' : overrideReason.length >= 5 ? 'warn' : 'fail',
          detail: ok ? s.rule : `${s.rule}${overrideReason ? ` Override reason given: "${overrideReason}".` : ''}`,
          fix: ok ? undefined : s.code ? `Bill ${s.code} for ${minutes} min, or document why ${base} applies.` : 'Under 16 minutes is not billable as psychotherapy.',
          source: 'rule',
        })
      );
    }
  } else if (has(FAMILY, base)) {
    const sessionType = /^Session type:/m.test(f.note.body) ? sessionTypeFromText(f.note.body) : null;
    const issues: string[] = [];
    if (minutes == null) issues.push('no session time is documented');
    else if (minutes < 26) issues.push(`${minutes} min is under the 26 minutes needed for ${base}`);
    if (sessionType === 'individual') issues.push(`session type is individual psychotherapy, not family`);
    if (sessionType === 'family-with-patient' && base === '90846') issues.push('the patient was present (90847), but 90846 is billed');
    if (sessionType === 'family-without-patient' && base === '90847') issues.push('the patient was not present (90846), but 90847 is billed');
    out.push(
      item({
        id: 'time.rule',
        category: 'time',
        label: `${base} family psychotherapy`,
        status: issues.length ? 'fail' : 'pass',
        detail: issues.length ? `${base}: ${issues.join('; ')}.` : `${minutes} min family psychotherapy ${base === '90847' ? 'with' : 'without'} the patient.`,
        fix: issues.length ? 'Use 90847 with the patient present, 90846 without, and document at least 26 minutes.' : undefined,
        source: 'rule',
      })
    );
  } else if (has(EVAL, base)) {
    const prescriber = PRESCRIBER_ROLES.includes((f.author.role || '').toUpperCase());
    out.push(
      item({
        id: 'time.rule',
        category: 'time',
        label: `${base} evaluation`,
        status: base === '90792' && !prescriber ? 'fail' : 'pass',
        detail:
          base === '90792' && !prescriber
            ? '90792 includes medical services and is billed by a physician or nurse practitioner.'
            : `${base} is not time-based; no time rule applies.`,
        fix: base === '90792' && !prescriber ? 'Bill 90791 for a non-prescriber diagnostic evaluation.' : undefined,
        source: 'rule',
      })
    );
    if (addOn) {
      out.push({ id: 'time.addon', category: 'time', label: 'Add-on with evaluation', status: 'fail', detail: `Psychotherapy add-on +${addOn} is not reported with ${base}.`, fix: `Remove +${addOn}; psychotherapy add-ons attach to an E/M code.`, source: 'rule' });
    }
  } else if (has(CRISIS, base)) {
    out.push(
      item({
        id: 'time.rule',
        category: 'time',
        label: `${base} crisis psychotherapy`,
        status: minutes != null && minutes >= 30 ? 'pass' : 'fail',
        detail: minutes != null ? `${minutes} min of crisis psychotherapy.` : 'No crisis time documented.',
        fix: '90839 needs at least 30 minutes (first 30–74 min); document the time.',
        source: 'rule',
      })
    );
  }
  out.push(...crisisAddOnChecks(f, base, minutes));

  // E/M + psychotherapy add-on: separate psychotherapy time
  if (addOn && !has(EVAL, base)) {
    const pMin = psychotherapyMinutes(f.note.body);
    const issues: string[] = [];
    let fix = '';
    if (!EM_RE.test(base) || base === addOn) {
      issues.push(`+${addOn} is an add-on and needs an E/M code (99212–99215) as the primary service`);
      fix = 'Bill the E/M visit with the psychotherapy add-on.';
    }
    if (pMin == null) {
      issues.push(`no separate psychotherapy time is documented for +${addOn}`);
      fix = fix || 'Document psychotherapy minutes separately from the E/M (e.g. "Psychotherapy time: 20 min").';
    } else {
      const expect = addOnForMinutes(pMin);
      if (expect !== addOn) {
        issues.push(expect ? `${pMin} min of psychotherapy is +${expect}, not +${addOn}` : `${pMin} min of psychotherapy is under the 16 minutes needed for an add-on`);
        fix = fix || (expect ? `Bill +${expect} or correct the psychotherapy time.` : 'Remove the add-on or document at least 16 minutes of psychotherapy.');
      }
      if (f.note.durationMinutes != null && pMin >= f.note.durationMinutes) {
        issues.push(`psychotherapy time (${pMin} min) is not less than the total visit time (${f.note.durationMinutes} min); E/M time must be separate`);
        fix = fix || 'Psychotherapy time cannot include the time spent on the E/M service.';
      }
    }
    out.push(
      item({
        id: 'time.addon',
        category: 'time',
        label: `Psychotherapy add-on +${addOn}`,
        status: issues.length ? 'fail' : 'pass',
        detail: issues.length ? `${issues.join('; ')}.` : `${pMin} min of separately documented psychotherapy supports +${addOn}.`,
        fix: issues.length ? fix : undefined,
        source: 'rule',
      })
    );
  }
  return out;
}

/** +90840 units the time supports: each additional 30 min beyond the first 74 (75–104 → 1, 105–134 → 2). */
export function crisisAddOnUnitsFor(minutes: number): number {
  return minutes >= 75 ? Math.floor((minutes - 75) / 30) + 1 : 0;
}

/** 90840 is an add-on to 90839, from 75 minutes; 90839 at 75+ minutes without it is a missed unit. */
export function crisisAddOnChecks(f: NoteQualityFacts, base: string | null, minutes: number | null): QualityItem[] {
  const codes = [String(f.note.cptCode ?? ''), ...f.claims.map((c) => c.cptCode)].join(' ');
  const has90840 = /90840/.test(codes) || /^Crisis add-on:\s*\+?\s*90840\b/m.test(f.note.body);
  const has90839 = base === '90839' || /90839/.test(codes);
  if (!has90840 && !(has90839 && minutes != null && minutes >= 75)) return [];
  const units = minutes != null ? crisisAddOnUnitsFor(minutes) : 0;
  if (!has90840) {
    return [{ id: 'time.crisis_addon', category: 'time', label: '+90840 crisis add-on', status: 'warn', detail: `${minutes} min of crisis psychotherapy supports +90840 × ${units}.`, fix: `Add +90840 × ${units} (each additional 30 min beyond 74).`, source: 'rule' }];
  }
  const issues: string[] = [];
  if (!has90839) issues.push('+90840 is reported without 90839 (it is an add-on to the first 30–74 min)');
  if (minutes == null) issues.push('no crisis time is documented');
  else if (minutes < 75) issues.push(`${minutes} min is under the 75 minutes needed for +90840`);
  return [
    item({
      id: 'time.crisis_addon',
      category: 'time',
      label: '+90840 crisis add-on',
      status: issues.length ? 'fail' : 'pass',
      detail: issues.length ? `${issues.join('; ')}.` : `${minutes} min supports 90839 + 90840 × ${units}.`,
      fix: issues.length ? 'Bill 90839 for the first 30–74 min and +90840 per additional 30 min (from 75 min); document the total crisis time.' : undefined,
      source: 'rule',
    }),
  ];
}

// ─── 3. Telehealth ──────────────────────────────────────────────────────────

export function isTelehealthNote(f: NoteQualityFacts): boolean {
  return f.note.telehealth || /^Visit type:\s*Telehealth/m.test(f.note.body) || has(TELEHEALTH_POS, f.note.placeOfService);
}

export function telehealthChecks(f: NoteQualityFacts): QualityItem[] {
  const body = f.note.body;
  const flagged = f.note.telehealth || /^Visit type:\s*Telehealth/m.test(body);
  const pos = (f.note.placeOfService || '').trim();
  const out: QualityItem[] = [];
  const claimMods = f.claims.flatMap((c) => c.modifiers.map((m) => m.toUpperCase()));
  const codeMods = (String(f.note.cptCode ?? '').toUpperCase().match(/[-\s](95|GT|93|FQ)\b/g) || []).map((m) => m.replace(/[-\s]/, ''));
  const headerMod = body.match(/^Visit type:\s*Telehealth[^\n]*modifier\s+(95|GT|93)\b/im)?.[1]?.toUpperCase();
  const mods = new Set([...claimMods, ...codeMods, ...(headerMod ? [headerMod] : [])]);

  if (!flagged) {
    if (has(TELEHEALTH_POS, pos) || mods.has('95') || mods.has('GT')) {
      out.push({
        id: 'telehealth.mismatch',
        category: 'telehealth',
        label: 'Visit type',
        status: 'warn',
        detail: `The note is not marked telehealth, but ${has(TELEHEALTH_POS, pos) ? `POS ${pos}` : 'a telehealth modifier'} is set.`,
        fix: 'Mark the visit as telehealth and document location / consent, or set POS 11 and remove the modifier.',
        source: 'rule',
      });
    } else {
      out.push({ id: 'telehealth.na', category: 'telehealth', label: 'Telehealth', status: 'na', detail: 'In-person visit.', source: 'rule' });
    }
    return out;
  }

  out.push(
    item({
      id: 'telehealth.pos',
      category: 'telehealth',
      label: 'Place of service',
      status: has(TELEHEALTH_POS, pos) ? 'pass' : 'fail',
      detail: has(TELEHEALTH_POS, pos) ? `POS ${pos} (${pos === '10' ? 'patient home' : 'other than patient home'}).` : `Telehealth visit with POS ${pos || 'not set'}.`,
      fix: 'Use POS 10 when the patient is at home, POS 02 when elsewhere.',
      source: 'rule',
    })
  );

  const expected = (f.settings.telehealthModifierDefault || '95').toUpperCase();
  if (expected !== 'NONE') {
    const ok = mods.has(expected);
    out.push(
      item({
        id: 'telehealth.modifier',
        category: 'telehealth',
        label: `Modifier ${expected}`,
        status: ok ? 'pass' : f.claims.length ? 'fail' : 'warn',
        detail: ok ? `Modifier ${expected} is on the ${claimMods.includes(expected) ? 'claim' : 'note'}.` : `No modifier ${expected} found on the ${f.claims.length ? 'claim' : 'note (no claim yet)'}.`,
        fix: `Add modifier ${expected} to the telehealth service line (practice default; payer overrides live on the Waystar payer mapping).`,
        source: 'rule',
      })
    );
  }

  const location = lineAfter(body, 'Patient location during telehealth') || (/\bpatient (?:is |was )?(?:located|at home|in (?:their|his|her) (?:home|car|office))|patient location|location of (?:the )?(?:patient|client)|client (?:is |was )?located/i.test(body) ? 'documented' : '');
  out.push(
    item({
      id: 'telehealth.location',
      category: 'telehealth',
      label: 'Patient location',
      status: location ? 'pass' : 'fail',
      detail: location ? `Patient location: ${location === 'documented' ? 'documented in the narrative' : location}.` : 'The patient’s location during the telehealth visit is not documented.',
      fix: 'Document where the patient was during the visit (address or city / state).',
      source: 'rule',
    })
  );

  const consent = lineAfter(body, 'Telehealth consent') || (/telehealth consent|consent(?:ed)? (?:to|for) (?:telehealth|video|telemedicine)|verbal consent/i.test(body) ? 'documented' : '');
  out.push(
    item({
      id: 'telehealth.consent',
      category: 'telehealth',
      label: 'Telehealth consent',
      status: consent ? 'pass' : 'fail',
      detail: consent ? `Consent: ${consent === 'documented' ? 'documented in the narrative' : consent}.` : 'Telehealth consent is not documented.',
      fix: 'Record verbal consent obtained or written consent on file.',
      source: 'rule',
    })
  );
  return out;
}

// ─── 4. Diagnosis present and on the claim ─────────────────────────────────

export function diagnosisChecks(f: NoteQualityFacts): QualityItem[] {
  const inNote = diagnosisCodesIn(f.note.body);
  const documented = new Set([...inNote, ...f.chartDiagnosisCodes].map(normIcd));
  const out: QualityItem[] = [];
  out.push(
    item({
      id: 'diagnosis.present',
      category: 'diagnosis',
      label: 'Diagnosis documented',
      status: documented.size ? 'pass' : 'fail',
      detail: inNote.length
        ? `In the note: ${inNote.join(', ')}.`
        : f.chartDiagnosisCodes.length
          ? `Not restated in the note; chart / treatment plan: ${f.chartDiagnosisCodes.join(', ')}.`
          : 'No ICD-10 diagnosis in the note, the chart or the active treatment plan.',
      fix: 'Record the diagnosis being treated (ICD-10-CM).',
      source: 'rule',
    })
  );

  if (!f.claims.length) {
    out.push({ id: 'diagnosis.claim', category: 'diagnosis', label: 'Diagnosis on the claim', status: 'na', detail: 'No claim is linked to this note yet.', source: 'rule' });
    return out;
  }
  const claimCodes = [...new Set(f.claims.flatMap((c) => c.icd10Codes))];
  if (!claimCodes.length) {
    out.push({ id: 'diagnosis.claim', category: 'diagnosis', label: 'Diagnosis on the claim', status: 'fail', detail: 'The linked claim has no ICD-10 code.', fix: 'Add the documented diagnosis to the claim before it is submitted.', source: 'rule' });
    return out;
  }
  const unsupported = documented.size ? claimCodes.filter((c) => !documented.has(normIcd(c))) : [];
  out.push(
    item({
      id: 'diagnosis.claim',
      category: 'diagnosis',
      label: 'Diagnosis on the claim',
      status: unsupported.length ? 'warn' : 'pass',
      detail: unsupported.length ? `Claim diagnosis ${unsupported.join(', ')} is not documented in the note or chart.` : `Claim diagnosis ${claimCodes.join(', ')} matches the documentation.`,
      fix: 'Make the claim diagnosis match the diagnosis treated in this note.',
      source: 'rule',
    })
  );
  return out;
}

// ─── 5. Treatment plan link + goal addressed ───────────────────────────────

export function planChecks(f: NoteQualityFacts): QualityItem[] {
  const type = f.note.noteType ? normalizeNoteType(f.note.noteType) : null;
  const { base } = noteCodes(f.note.cptCode, f.note.body);
  const required = noteRequiresTreatmentPlan({ noteType: type, cptCode: base });
  if (!required) {
    return [{ id: 'plan.active', category: 'plan', label: 'Treatment plan', status: 'na', detail: 'This service does not need a treatment plan (intake, crisis or medication management).', source: 'rule' }];
  }
  const out: QualityItem[] = [];
  if (!f.plan) {
    out.push({ id: 'plan.active', category: 'plan', label: 'Active treatment plan', status: 'warn', detail: 'The client’s treatment plan could not be checked.', fix: 'Open Treatment Plans and confirm an active, signed plan covers the date of service.', source: 'rule' });
  } else {
    out.push(
      item({
        id: 'plan.active',
        category: 'plan',
        label: 'Active treatment plan',
        status: f.plan.ok ? 'pass' : 'fail',
        detail: f.plan.message,
        fix: 'Sign or renew the treatment plan; therapy progress notes need an active plan.',
        source: 'rule',
      })
    );
  }

  const goalsText = type === THERAPY_PROGRESS ? sectionReader(THERAPY_PROGRESS, f.note.body)(TS.planGoals) : '';
  const widgetGoal = type === THERAPY_PROGRESS && WIDGET_TEXT_CHECKS.planGoals(goalsText);
  const narrativeGoal = !widgetGoal && /\b(goal|objective)s?\b[^\n]{0,120}\b(progress|improv|no change|regress|met|partially met|working toward|addressed)/i.test(f.note.body);
  out.push(
    item({
      id: 'plan.goal',
      category: 'plan',
      label: 'Plan goal addressed',
      status: widgetGoal ? 'pass' : narrativeGoal ? 'warn' : 'fail',
      detail: widgetGoal
        ? 'Progress is marked on at least one treatment plan goal.'
        : narrativeGoal
          ? 'Goal progress is mentioned in the narrative but no plan goal is marked.'
          : 'No treatment plan goal is addressed in this note.',
      fix: 'Mark progress on the plan goal(s) worked on in this session.',
      source: 'rule',
    })
  );
  return out;
}

// ─── 6. Risk assessment when risk flags exist ──────────────────────────────

export function riskAssessmentDocumented(body: string): boolean {
  const si = /^Suicidal ideation:\s*\S/m.test(body);
  const level = /^Overall risk level:\s*\S/m.test(body);
  if (si && level) return true;
  return /\b(risk assessment|C-SSRS|Columbia|suicidal ideation|denies (?:SI|HI|suicidal)|SI\/HI|safety plan|risk level)\b/i.test(body);
}

export function riskChecks(f: NoteQualityFacts): QualityItem[] {
  if (!f.riskFlags.length) {
    const documented = riskAssessmentDocumented(f.note.body);
    return [
      {
        id: 'risk.assessment',
        category: 'risk',
        label: 'Risk assessment',
        status: documented ? 'pass' : 'na',
        detail: documented ? 'Risk is addressed in the note.' : 'No risk flags on the chart for this period.',
        source: 'rule',
      },
    ];
  }
  const documented = riskAssessmentDocumented(f.note.body);
  // Only the AI Scribe transcript flagged risk and the clinician attested why no further assessment is indicated
  const onlyTranscript = f.riskFlags.every((x) => x.startsWith('AI Scribe transcript'));
  const attested = Boolean(f.transcriptRisk?.attested) && onlyTranscript;
  return [
    item({
      id: 'risk.assessment',
      category: 'risk',
      label: 'Risk assessment',
      status: documented ? 'pass' : attested ? 'warn' : 'fail',
      detail: `${documented ? 'Risk is addressed.' : attested ? 'No risk assessment in the note; the clinician attested no further assessment was indicated.' : 'No risk assessment in the note.'} Flags: ${f.riskFlags.join('; ')}.`,
      fix: 'Document SI / HI screening, the risk level and the safety plan given the chart risk flags.',
      source: 'rule',
    }),
  ];
}

// ─── 7. Signature / credentials ─────────────────────────────────────────────

export function signatureChecks(f: NoteQualityFacts): QualityItem[] {
  const out: QualityItem[] = [];
  const w = f.workflow;
  const signed = Boolean(w && w.status !== 'DRAFT');
  if (f.mode === 'presign' && !signed) {
    out.push({ id: 'signature.signed', category: 'signature', label: 'Signature', status: 'na', detail: 'Not signed yet: signing applies your electronic signature and attestation.', source: 'rule' });
  } else {
    const ok = Boolean(w && w.status !== 'DRAFT' && w.signedAt && w.attestedAt);
    out.push(
      item({
        id: 'signature.signed',
        category: 'signature',
        label: 'Author signature',
        status: ok ? 'pass' : 'fail',
        detail: ok ? `Signed by ${w?.signedByName || 'the author'} with attestation.` : 'The author’s signature or attestation is missing.',
        fix: 'The author must sign the note with the attestation.',
        source: 'rule',
      })
    );
  }
  const dos = f.note.dateOfService || f.note.createdAt.slice(0, 10);
  const current = f.author.credentials.filter((c) => c.expiresAt.slice(0, 10) >= dos);
  const expired = f.author.credentials.filter((c) => c.expiresAt.slice(0, 10) < dos);
  out.push(
    item({
      id: 'signature.credentials',
      category: 'signature',
      label: 'Author credentials',
      status: current.length ? 'pass' : expired.length ? 'fail' : 'warn',
      detail: current.length
        ? `On file: ${current.map((c) => c.title).join(', ')}.`
        : expired.length
          ? `Credential expired before the date of service: ${expired.map((c) => `${c.title} (${c.expiresAt.slice(0, 10)})`).join(', ')}.`
          : 'No license or credential on file in HR for the author.',
      fix: expired.length ? 'Confirm the license was renewed and upload it in HR > Credentialing before billing.' : 'Add the author’s license in HR > Credentialing so the signature carries credentials.',
      source: 'rule',
    })
  );
  return out;
}

// ─── 8. Late signing vs practice deadline ───────────────────────────────────

/** When the service ended: date of service + end time on the practice clock, else end of that day. */
export function serviceEndedAt(f: NoteQualityFacts): Date | null {
  const dos = f.note.dateOfService;
  if (!dos) return null;
  const end = lineAfter(f.note.body, 'End time').match(/^\d{1,2}:\d{2}/)?.[0];
  const padded = end ? end.padStart(5, '0') : '23:59';
  return fromPracticeWallTime(dos, padded, f.settings.timeZone);
}

export function timelinessChecks(f: NoteQualityFacts): QualityItem[] {
  const ended = serviceEndedAt(f);
  const hours = f.settings.noteSignDeadlineHours > 0 ? f.settings.noteSignDeadlineHours : 72;
  if (!ended) {
    return [{ id: 'timeliness.sign', category: 'timeliness', label: 'Signed on time', status: 'warn', detail: 'No date of service on the note.', fix: 'Record the date of service.', source: 'rule' }];
  }
  const isSigned = Boolean(f.workflow && f.workflow.status !== 'DRAFT');
  // Signed notes: the real signature time. Unsigned drafts (author's pre-sign view): now.
  const signedAt = isSigned ? (f.workflow?.signedAt ? new Date(f.workflow.signedAt) : null) : f.mode === 'presign' ? new Date(f.now) : null;
  if (!signedAt) return [{ id: 'timeliness.sign', category: 'timeliness', label: 'Signed on time', status: 'na', detail: 'Not signed.', source: 'rule' }];
  const lateHours = (signedAt.getTime() - ended.getTime()) / 3_600_000;
  const late = lateHours > hours;
  const when = isSigned ? 'Signed' : 'Signing now would be';
  return [
    item({
      id: 'timeliness.sign',
      category: 'timeliness',
      label: 'Signed on time',
      status: late ? 'warn' : 'pass',
      detail: late
        ? `${when} ${Math.round(lateHours)} h after the service; the practice deadline is ${hours} h.`
        : `${when} within the practice's ${hours} h deadline.`,
      fix: late ? 'Late documentation: note the reason in an addendum; repeated late notes go to the clinical director.' : undefined,
      source: 'rule',
    }),
  ];
}

// ─── 9. Co-sign required reason ─────────────────────────────────────────────

export function cosignReason(f: NoteQualityFacts): string | null {
  const role = (f.author.role || '').toUpperCase();
  if (f.author.licenseLevel?.level === 'PRE_LICENSED') return `the author is pre-licensed (${f.author.licenseLevel.source.replace(/-/g, ' ')})`;
  if (f.author.onLicensureTrack) return 'the author is on a licensure supervision track';
  if (COSIGN_REQUIRED_ROLES.includes(role)) return `the author's role (${role.replace(/_/g, ' ').toLowerCase()}) requires supervision`;
  return null;
}

export function cosignChecks(f: NoteQualityFacts): QualityItem[] {
  const reason = cosignReason(f);
  const required = Boolean(f.workflow?.cosignRequired) || Boolean(reason);
  return [
    {
      id: 'cosign.reason',
      category: 'cosign',
      label: 'Co-signature',
      status: required ? 'pass' : 'na',
      detail: required
        ? `Co-signature required${reason ? `: ${reason}` : ' (recorded when the note was signed)'}.`
        : 'No co-signature required for this author.',
      source: 'rule',
    },
  ];
}

// ─── 10. Stigmatizing language ──────────────────────────────────────────────

export function languageChecks(f: NoteQualityFacts): QualityItem[] {
  const findings = lintStigma(f.note.body);
  if (!findings.length) return [{ id: 'narrative.language', category: 'narrative', label: 'Person-first language', status: 'pass', detail: 'No stigmatizing terms found.', source: 'rule' }];
  const list = [...new Map(findings.map((x) => [x.match.toLowerCase(), x])).values()].slice(0, 6);
  return [
    {
      id: 'narrative.language',
      category: 'narrative',
      label: 'Person-first language',
      status: 'warn',
      detail: list.map((x) => `"${x.match}" → ${x.suggestion ?? `describe the behavior (${x.why})`}`).join('; ') + '.',
      fix: 'Use neutral, person-first wording (e.g. "declined", "not taking as prescribed", "person with alcohol use disorder").',
      source: 'rule',
    },
  ];
}

// ─── 11. Cloned sections ────────────────────────────────────────────────────

export function cloneChecks(f: NoteQualityFacts): QualityItem[] {
  if (!f.priorSignedNotes?.length || !f.note.noteType) return [];
  const warnings = sectionCloneWarnings({ noteType: f.note.noteType, body: f.note.body, prior: f.priorSignedNotes });
  return warnings.map((w) => ({
    id: `narrative.clone.${w.heading}`,
    category: 'narrative' as const,
    label: `${w.heading}: similar to an earlier note`,
    status: 'warn' as const,
    detail: `This section is very similar to the note on ${w.priorDate} (${Math.round(w.similarity * 100)}% overlap).`,
    fix: 'Document what was different in this session; copied text does not support medical necessity.',
    source: 'rule' as const,
  }));
}

// ─── All rule checks ────────────────────────────────────────────────────────

export function runRuleChecks(f: NoteQualityFacts): QualityItem[] {
  return [
    ...requiredFieldChecks(f),
    ...cptTimeChecks(f),
    ...telehealthChecks(f),
    ...diagnosisChecks(f),
    ...planChecks(f),
    ...riskChecks(f),
    ...signatureChecks(f),
    ...timelinessChecks(f),
    ...cosignChecks(f),
    ...languageChecks(f),
    ...cloneChecks(f),
  ];
}
