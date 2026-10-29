/**
 * Clinical note types + section field sets for Progress Notes.
 * Subtitle order is source of truth for New Note dropdown.
 */

export const NOTE_TYPES = [
  'SOAP',
  'DAP',
  'BIRP',
  'GIRP',
  'PIE',
  'CBT',
  'DBT',
  'MFT',
  'EMDR',
  'Psych Eval',
  'Med Mgmt',
  'SUD',
  'Group',
  'Telephone',
  'Discharge',
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_LABELS: Record<NoteType, string> = {
  SOAP: 'SOAP Note',
  DAP: 'DAP Note',
  BIRP: 'BIRP Note',
  GIRP: 'GIRP Note',
  PIE: 'PIE Note',
  CBT: 'CBT Session Note',
  DBT: 'DBT Session Note',
  MFT: 'Marriage & Family Therapy',
  EMDR: 'EMDR Note',
  'Psych Eval': 'Psychiatric Evaluation',
  'Med Mgmt': 'Medication Management',
  SUD: 'SUD / Substance Use Note',
  Group: 'Group Therapy Note',
  Telephone: 'Telephone Encounter',
  Discharge: 'Discharge Summary',
};

/** EMDR protocol phases (source New Note select). */
export const EMDR_PHASES = [
  '1 — History Taking',
  '2 — Preparation',
  '3 — Assessment',
  '4 — Desensitization',
  '5 — Installation',
  '6 — Body Scan',
  '7 — Closure',
  '8 — Reevaluation',
] as const;

export function normalizeNoteType(value: string): string {
  const v = value.trim();
  if (v === 'Group' || v === 'Group Note' || v === 'Group Therapy') return 'Group';
  if (v === 'Intake Assessment' || v === 'Intake') return 'Psych Eval';
  if (v === 'Psychiatric Evaluation') return 'Psych Eval';
  if (v === 'Medication Management') return 'Med Mgmt';
  if (v === 'Discharge Summary') return 'Discharge';
  if (v === 'Telehealth Progress' || v === 'Telephone Encounter') return 'Telephone';
  if (v === 'Family Therapy') return 'MFT';
  if (v === 'Crisis Note') return 'SOAP';
  if (v === 'PRP Rehabilitation' || v === 'Peer Support Contact') return 'SUD';
  if (v === 'Care Coordination' || v === 'Consultation Note') return 'Telephone';
  if (v === 'Supervision Note' || v === 'Administrative Note') return 'SOAP';
  return v.replace(/^(SOAP|DAP|BIRP|GIRP|PIE|CBT|DBT|MFT|EMDR) Note$/, '$1');
}

export const NOTE_SECTIONS: Record<NoteType, readonly string[]> = {
  SOAP: ['Subjective', 'Objective', 'Assessment', 'Plan'],
  DAP: ['Data', 'Assessment', 'Plan'],
  BIRP: ['Behavior', 'Intervention', 'Response', 'Plan'],
  GIRP: ['Goals', 'Intervention', 'Response', 'Plan'],
  PIE: ['Problem', 'Intervention', 'Evaluation'],
  CBT: [
    'Session Focus',
    'Automatic Thoughts / Cognitions',
    'Cognitive Interventions',
    'Behavioral Experiments',
    'Homework',
    'Plan',
  ],
  DBT: [
    'Target Behaviors',
    'Skills Used',
    'Diary Card Review',
    'Chain Analysis / Contingencies',
    'Plan',
  ],
  MFT: ['Participants', 'Systemic Assessment', 'Intervention', 'Response', 'Plan'],
  EMDR: [
    'Phase',
    'Target Memory / Image',
    'Negative / Positive Cognition',
    'SUDS / VoC',
    'Processing Notes',
    'Installation / Body Scan',
    'Closure',
    'Plan',
  ],
  'Psych Eval': [
    'Chief Complaint',
    'History of Present Illness',
    'Psychiatric History',
    'Medical / Substance History',
    'Mental Status Exam',
    'Risk Assessment',
    'Diagnosis',
    'Plan',
  ],
  'Med Mgmt': [
    'Interval History',
    'Current Medications',
    'Side Effects / Tolerability',
    'Mental Status',
    'Assessment',
    'Plan',
  ],
  SUD: [
    'Substance Use History',
    'Current Use / Amount',
    'Cravings & Triggers',
    'Interventions',
    'Relapse Prevention',
    'Plan',
  ],
  Group: ['Group Topic / Focus', 'Interventions', 'Participation', 'Individual Response', 'Plan'],
  Telephone: ['Reason for Call', 'Discussion', 'Clinical Decision', 'Follow-up'],
  Discharge: [
    'Reason for Discharge',
    'Treatment Summary',
    'Progress Toward Goals',
    'Medications at Discharge',
    'Aftercare Plan',
  ],
};

/** Per-field placeholders matching source clinical note UX. */
export const NOTE_PLACEHOLDERS: Record<NoteType, Record<string, string>> = {
  SOAP: {
    Subjective: 'Client reports… mood, sleep, appetite, stressors, SI/HI screen…',
    Objective: 'Appearance, MSE, affect, speech, insight/judgment…',
    Assessment: 'Clinical formulation, diagnosis justification, risk level…',
    Plan: 'Interventions this session, homework, follow-up, referrals…',
  },
  DAP: {
    Data: 'Observable data and client statements from session…',
    Assessment: 'Clinical interpretation of data and progress…',
    Plan: 'Next steps, homework, coordination…',
  },
  BIRP: {
    Behavior: 'Observed / reported behaviors relevant to treatment goals…',
    Intervention: 'Modalities and techniques used in session…',
    Response: 'Client response to interventions…',
    Plan: 'Plan for next contact and between-session work…',
  },
  GIRP: {
    Goals: 'Treatment goals addressed this encounter…',
    Intervention: 'Interventions applied toward goals…',
    Response: 'Client response and measurable progress…',
    Plan: 'Plan to advance goals next session…',
  },
  PIE: {
    Problem: 'Presenting problem / focus of care…',
    Intervention: 'Actions taken to address the problem…',
    Evaluation: 'Outcome / status after intervention…',
  },
  CBT: {
    'Session Focus': 'Agenda and primary cognitive-behavioral targets…',
    'Automatic Thoughts / Cognitions': 'Identified automatic thoughts, core beliefs, distortions…',
    'Cognitive Interventions': 'Restructuring, thought records, evidence examination…',
    'Behavioral Experiments': 'Exposure, BA tasks, experiments planned or completed…',
    Homework: 'Assigned practice and tracking…',
    Plan: 'Focus for next CBT session…',
  },
  DBT: {
    'Target Behaviors': 'Life-threatening, therapy-interfering, quality-of-life targets…',
    'Skills Used': 'Mindfulness, distress tolerance, emotion regulation, interpersonal…',
    'Diary Card Review': 'Urges, emotions, skills practice since last session…',
    'Chain Analysis / Contingencies': 'Vulnerability factors, prompting events, links, consequences…',
    Plan: 'Skill practice commitments and next targets…',
  },
  MFT: {
    Participants: 'Who attended (client, partner, family members)…',
    'Systemic Assessment': 'Interaction patterns, alliances, systemic hypotheses…',
    Intervention: 'Relational interventions used…',
    Response: 'System / member responses…',
    Plan: 'Homework for the system and next session focus…',
  },
  EMDR: {
    Phase: 'Select EMDR phase (or describe phase work completed)…',
    'Target Memory / Image': 'Target memory, worst image, emotions, body location…',
    'Negative / Positive Cognition': 'NC / PC statements…',
    'SUDS / VoC': 'Pre/post SUDS (0–10) and VoC (1–7)…',
    'Processing Notes': 'Sets, channels, cognitive interweaves, blocked processing…',
    'Installation / Body Scan': 'Installation of PC; residual body sensation…',
    Closure: 'Stabilization, safe place, end-of-session state…',
    Plan: 'Next target / reevaluation plan…',
  },
  'Psych Eval': {
    'Chief Complaint': 'Reason for evaluation in client’s words…',
    'History of Present Illness': 'Onset, course, severity, precipitants…',
    'Psychiatric History': 'Prior diagnoses, hospitalizations, treatments…',
    'Medical / Substance History': 'Medical conditions, meds, substance use…',
    'Mental Status Exam': 'Appearance, mood/affect, thought, cognition, insight…',
    'Risk Assessment': 'SI/HI, self-harm, protective factors, disposition…',
    Diagnosis: 'DSM diagnoses / ICD-10 with clinical rationale…',
    Plan: 'Level of care, referrals, meds, follow-up…',
  },
  'Med Mgmt': {
    'Interval History': 'Interval symptoms, adherence, functional status…',
    'Current Medications': 'Name, dose, frequency, indication…',
    'Side Effects / Tolerability': 'Reported AEs, labs, vitals as indicated…',
    'Mental Status': 'Focused MSE for med visit…',
    Assessment: 'Response to treatment, diagnosis stability…',
    Plan: 'Continue / adjust / taper; labs; return interval…',
  },
  SUD: {
    'Substance Use History': 'Primary substances, pattern, prior treatment…',
    'Current Use / Amount': 'Recent use, amount, route, last use…',
    'Cravings & Triggers': 'Craving intensity, triggers, coping used…',
    Interventions: 'MI, CBT-SUD, contingency, psychoeducation…',
    'Relapse Prevention': 'High-risk situations and plan…',
    Plan: 'Next session, supports, toxicology as indicated…',
  },
  Group: {
    'Group Topic / Focus': 'Theme / curriculum for today’s group…',
    Interventions: 'Facilitation techniques and skills taught…',
    Participation: 'Level and quality of participation…',
    'Individual Response': 'Client-specific response and peer interactions…',
    Plan: 'Practice assignments and next group focus…',
  },
  Telephone: {
    'Reason for Call': 'Who initiated and reason for contact…',
    Discussion: 'Clinical content reviewed (no unnecessary PHI in SMS)…',
    'Clinical Decision': 'Assessment and decisions made…',
    'Follow-up': 'Return call, appointment, crisis resources…',
  },
  Discharge: {
    'Reason for Discharge': 'Goals met, relocation, against advice, transfer…',
    'Treatment Summary': 'Course of care and modalities used…',
    'Progress Toward Goals': 'Outcome vs. treatment plan goals…',
    'Medications at Discharge': 'Current psychotropic regimen…',
    'Aftercare Plan': 'Referrals, appointments, crisis plan, resources…',
  },
};

export function noteTemplate(type: NoteType) {
  return NOTE_SECTIONS[type].map((heading) => `${heading}\n`).join('\n');
}

export function sectionPlaceholder(type: NoteType, heading: string): string {
  return NOTE_PLACEHOLDERS[type]?.[heading] || `Document ${heading.toLowerCase()}…`;
}

export function structuredNoteSections(
  type: string,
  body: string,
): { title: string; text: string }[] {
  const normalized = normalizeNoteType(type) as NoteType;
  const headings = NOTE_SECTIONS[normalized];
  if (!headings) return [{ title: 'Clinical Documentation', text: body }];
  const sections: { title: string; text: string }[] = [];
  let current: { title: string; text: string } | undefined;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const headingLine = line
      .trim()
      .replace(/^#{1,3}\s*/, '')
      .replace(/^[A-Z]\s*[-–:]\s*/, '')
      .replace(/:$/, '');
    const heading = headings.find((item) => item.toLowerCase() === headingLine.toLowerCase());
    if (heading) {
      current = { title: heading, text: '' };
      sections.push(current);
    } else if (current) current.text += `${line}\n`;
    else if (line.trim()) {
      current = { title: 'Clinical Documentation', text: `${line}\n` };
      sections.push(current);
    }
  }
  return sections.map((section) => ({ ...section, text: section.text.trim() }));
}

export function isSudNote(type: string, flagged = false) {
  const n = normalizeNoteType(type);
  return flagged || n === 'SUD' || /\bsud\b|substance use|chemical dependency/i.test(type);
}

export function hasNoteContent(type: string, body: string) {
  return structuredNoteSections(type, body).some((section) => section.text.trim().length > 0);
}

export type NoteMetadata = {
  noteType: string | null;
  durationMinutes: number | null;
  billingCode?: string | null;
  telehealth?: boolean;
  placeOfService?: string | null;
  sudConfidential?: boolean;
};

export function encodeNoteBody(body: string, meta: NoteMetadata): string {
  const safe = (value: string) => value.replace(/["<>]/g, '');
  return `<!--ehr type="${safe(meta.noteType || 'SOAP')}" duration="${meta.durationMinutes ?? 50}" cpt="${safe(meta.billingCode || '')}" telehealth="${meta.telehealth === true}" pos="${safe(meta.placeOfService || '11')}" part2="${meta.sudConfidential === true}"-->\n${body}`;
}

export function parseNoteMeta(body: string): NoteMetadata & { displayBody: string } {
  const match = body.match(/<!--ehr\s+([^>]*?)-->/);
  if (!match) return { noteType: null, durationMinutes: null, displayBody: body };
  const attrs = Object.fromEntries(
    [...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  return {
    noteType: attrs.type || null,
    durationMinutes: /^\d+$/.test(attrs.duration || '') ? Number(attrs.duration) : null,
    billingCode: attrs.cpt || null,
    telehealth: attrs.telehealth === 'true',
    placeOfService: attrs.pos || null,
    sudConfidential: attrs.part2 === 'true',
    displayBody: body.replace(match[0], '').trimStart(),
  };
}
