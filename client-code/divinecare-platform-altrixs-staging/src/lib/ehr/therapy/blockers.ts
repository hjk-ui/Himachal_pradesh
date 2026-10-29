/**
 * Sign rules for the therapist templates, read from the saved note text (and the note's CPT /
 * duration columns) so the editor, the note view and the server agree. Only billing and
 * compliance items block signing; everything else is a "check before signing" warning.
 */
import { structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { SI_POSITIVE_LINE } from '@/lib/ehr/psychMedMgmt';
import { missingFields, WIDGET_TEXT_CHECKS, type TextIssue } from '@/lib/ehr/therapy/engine';
import { cptBaseCode, suggestTherapyCpt } from '@/lib/ehr/therapy/rules';
import { TS, type TherapyNoteType } from '@/lib/ehr/therapy/sections';
import { THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { sessionTypeFromText } from '@/lib/ehr/therapy/widgets';

export type TherapyIssue = TextIssue;

function sectionReader(type: TherapyNoteType, body: string) {
  const sections = structuredNoteSections(type, body);
  return (title: string) =>
    sections
      .filter((s) => s.title === title)
      .map((s) => s.text)
      .join('\n');
}

/** High overall risk or a positive C-SSRS screen needs a documented safety plan. */
export function riskBlockers(riskText: string, heading: string): TherapyIssue[] {
  const positive = riskText.split('\n').some((l) => l.trim().startsWith(SI_POSITIVE_LINE));
  const high = /^Overall risk level: High\b/m.test(riskText);
  if (!positive && !high) return [];
  if (WIDGET_TEXT_CHECKS.safetyPlan(riskText)) return [];
  return [
    {
      message: `${heading}: ${positive ? 'the C-SSRS screen is positive' : 'overall risk is High'} — document a safety plan (or pull the saved plan) before signing.`,
      heading,
    },
  ];
}

/** Service code / session-time rules. */
export function codeBlockers(input: {
  type: TherapyNoteType;
  cptCode: string | null | undefined;
  durationMinutes: number | null | undefined;
  sessionText: string;
}): TherapyIssue[] {
  const tpl = THERAPY_TEMPLATES[input.type];
  const out: TherapyIssue[] = [];
  const base = cptBaseCode(input.cptCode);
  if (base && !tpl.codes.includes(base)) {
    out.push({ message: `Service code ${base} is not used with this template (use ${tpl.codes.join(' / ')}).`, heading: TS.session });
  }
  if (!tpl.timeBased) return out;
  if (!/^Start time: \d{1,2}:\d{2}/m.test(input.sessionText) || !/^End time: \d{1,2}:\d{2}/m.test(input.sessionText)) {
    out.push({ message: 'Enter the session start and end time (psychotherapy codes are time-based).', heading: TS.session });
  }
  if (base) {
    const suggested = suggestTherapyCpt(input.durationMinutes ?? null, sessionTypeFromText(input.sessionText));
    const reason = (input.sessionText.match(/^Code override reason: (.+)$/m)?.[1] || '').trim();
    if (suggested.code !== base && reason.length < 5) {
      out.push({
        message: suggested.code
          ? `Service code ${base} does not match the time rule (${suggested.rule}). Use ${suggested.code} or enter a code override reason.`
          : `${suggested.rule} Enter a code override reason to bill ${base}.`,
        heading: TS.session,
      });
    }
  }
  return out;
}

/** Everything that blocks signing (template part; carry-forward / blanks / AI markers are added by structuredSignBlockers). */
export function therapySignBlockers(input: {
  type: TherapyNoteType;
  body: string;
  cptCode: string | null | undefined;
  durationMinutes?: number | null;
}): TherapyIssue[] {
  const tpl = THERAPY_TEMPLATES[input.type];
  const text = sectionReader(input.type, input.body);
  const sessionText = text(TS.session);
  const out: TherapyIssue[] = [];
  out.push(...codeBlockers({ type: input.type, cptCode: input.cptCode, durationMinutes: input.durationMinutes, sessionText }));
  out.push(...missingFields(tpl.sections, text, TS.session).required);
  const riskHeading = input.type === 'Therapy Progress' ? TS.riskCheck : TS.risk;
  out.push(...riskBlockers(text(riskHeading), riskHeading));
  return out;
}

/** "Check before signing" items for the editor. */
export function therapySignWarnings(input: { type: TherapyNoteType; body: string }): TherapyIssue[] {
  const tpl = THERAPY_TEMPLATES[input.type];
  const text = sectionReader(input.type, input.body);
  const out = [...missingFields(tpl.sections, text, TS.session).recommended];
  if (input.type === 'Substance Abuse Intake' && WIDGET_TEXT_CHECKS.diagnoses(text(TS.diagnoses)) && !/^\d+\.\s+F1\d/m.test(text(TS.diagnoses))) {
    out.push({ message: 'No substance use disorder diagnosis (F10–F19) is listed.', heading: TS.diagnoses });
  }
  return out;
}
