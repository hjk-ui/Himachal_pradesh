/**
 * PRP progress note: the structured contact fields of one PRP service contact (COMAR 10.63 PRP),
 * stored beside the note in progress_note_prp_details (20261027_prp_note_detail.sql). Pure and
 * client-safe: the note editor, the sign path (notes/standard + workflow-store) and the print use it.
 *
 * Every contact is its own note (several contacts on one day = several notes). Date, start / end
 * time and telehealth modality are the note's existing fields (ProgressNote + Service details);
 * this module adds location, participants, IRP objectives, interventions, progress, collaboration
 * and the participant's signature.
 *
 * Sign rules reuse the existing PRP encounter documentation rule (src/lib/prp/standard.ts
 * encounterDocIssues: date, minutes, service type, location, staff, IRP goal, intervention,
 * response). No new payer rule is introduced: the PRP unit rule is still unconfirmed
 * (src/lib/prp/billingRule.ts PRP_UNIT_RULE_CONFIRMED = false).
 */
import { encounterDocIssues } from '@/lib/prp/standard';
import { PRP_UNIT_RULE_CONFIRMED, PRP_UNIT_RULE_LABEL } from '@/lib/prp/billingRule';

// ─── Picklists ───────────────────────────────────────────────────────────────

/** Contact type. The paper form's "E-visit" is telehealth. Stored on the note (telehealth + modality). */
export const PRP_CONTACT_TYPES = [
  { value: 'in_person', label: 'Face-to-face (in person)' },
  { value: 'telehealth_video', label: 'Telehealth (video)' },
  { value: 'audio_only', label: 'Telehealth (audio-only)' },
] as const;
export type PrpContactType = (typeof PRP_CONTACT_TYPES)[number]['value'];

export const PRP_NOTE_LOCATIONS = [
  { value: 'onsite', label: 'On-site' },
  { value: 'offsite', label: 'Off-site (community)' },
] as const;
export type PrpNoteLocation = (typeof PRP_NOTE_LOCATIONS)[number]['value'];

/** Who took part. The participant is always included. */
export const PRP_PARTICIPANTS = [
  { value: 'patient', label: 'Participant' },
  { value: 'family', label: 'Family member' },
  { value: 'guardian', label: 'Guardian / legal representative' },
  { value: 'collateral', label: 'Collateral contact' },
  { value: 'other_staff', label: 'Other PRP staff' },
  { value: 'other', label: 'Other' },
] as const;
export type PrpParticipant = (typeof PRP_PARTICIPANTS)[number]['value'];

/** Standard PRP rehabilitation interventions (there was no list in src/lib/prp before this). */
export const PRP_INTERVENTIONS = [
  { value: 'skills_independent_living', label: 'Skills training: independent living' },
  { value: 'skills_social', label: 'Skills training: social / interpersonal' },
  { value: 'skills_vocational', label: 'Skills training: vocational / educational' },
  { value: 'skills_health_wellness', label: 'Skills training: health and wellness' },
  { value: 'psychoeducation', label: 'Psychoeducation' },
  { value: 'symptom_management', label: 'Symptom management' },
  { value: 'crisis_safety_planning', label: 'Crisis / safety planning' },
  { value: 'community_integration', label: 'Community integration' },
  { value: 'linkage_referral', label: 'Linkage / referral' },
  { value: 'medication_adherence', label: 'Medication adherence support' },
] as const;
export type PrpIntervention = (typeof PRP_INTERVENTIONS)[number]['value'];

/** Progress toward the objective(s) addressed. */
export const PRP_PROGRESS = [
  { value: 'progressing', label: 'Progressing' },
  { value: 'achieved', label: 'Objective achieved' },
  { value: 'no_change', label: 'No change' },
  { value: 'regressed', label: 'Regressed' },
  { value: 'not_assessed', label: 'Not assessed this contact' },
] as const;
export type PrpProgress = (typeof PRP_PROGRESS)[number]['value'];

/** Communication or collaboration with the treatment team. */
export const PRP_COLLABORATORS = [
  { value: 'rehab_specialist', label: 'Rehabilitation specialist' },
  { value: 'therapist', label: 'Therapist' },
  { value: 'crnp', label: 'CRNP' },
  { value: 'psychiatrist', label: 'Psychiatrist' },
  { value: 'other', label: 'Other' },
] as const;
export type PrpCollaborator = (typeof PRP_COLLABORATORS)[number]['value'];

/** Why the participant did not sign (replaces the paper's "Unable to obtain signature / Covid 19"). */
export const PRP_SIGNATURE_REASONS = [
  { value: 'telehealth', label: 'Telehealth contact (signature not obtainable remotely)' },
  { value: 'declined', label: 'Participant declined to sign' },
  { value: 'unable_symptoms', label: 'Unable to sign due to symptoms' },
  { value: 'other', label: 'Other (explain)' },
] as const;
export type PrpSignatureReason = (typeof PRP_SIGNATURE_REASONS)[number]['value'];

/** Attestation the participant accepts when signing on the device (typed signature, as elsewhere in Altrixs). */
export const PRP_PARTICIPANT_ATTESTATION = 'I took part in this PRP contact on the date and time shown.';

const values = <T extends readonly { value: string }[]>(list: T) => list.map((x) => x.value) as T[number]['value'][];
const labelOf = (list: readonly { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? null;

export const PRP_CONTACT_TYPE_VALUES = values(PRP_CONTACT_TYPES);
export const PRP_LOCATION_VALUES = values(PRP_NOTE_LOCATIONS);
export const PRP_PARTICIPANT_VALUES = values(PRP_PARTICIPANTS);
export const PRP_INTERVENTION_VALUES = values(PRP_INTERVENTIONS);
export const PRP_PROGRESS_VALUES = values(PRP_PROGRESS);
export const PRP_COLLABORATOR_VALUES = values(PRP_COLLABORATORS);
export const PRP_SIGNATURE_REASON_VALUES = values(PRP_SIGNATURE_REASONS);

// ─── Detail shape ────────────────────────────────────────────────────────────

/** One IRP objective addressed (label snapshot so the signed note reads the same after the IRP changes). */
export type PrpObjectiveRef = { key: string; label: string };

export type PrpNoteDetail = {
  location: PrpNoteLocation | null;
  communityLocation: string | null;
  participants: PrpParticipant[];
  participantsOther: string | null;
  objectives: PrpObjectiveRef[];
  objectiveOther: string | null;
  interventions: PrpIntervention[];
  progress: PrpProgress | null;
  collaboration: PrpCollaborator[];
  collaborationNote: string | null;
  /** signed | not_obtained | null (not recorded yet) */
  patientSignatureStatus: 'signed' | 'not_obtained' | null;
  patientSignatureName: string | null;
  patientSignedAt: string | null;
  patientSignatureReason: PrpSignatureReason | null;
  patientSignatureReasonOther: string | null;
};

export const EMPTY_PRP_DETAIL: PrpNoteDetail = {
  location: null,
  communityLocation: null,
  participants: ['patient'],
  participantsOther: null,
  objectives: [],
  objectiveOther: null,
  interventions: [],
  progress: null,
  collaboration: [],
  collaborationNote: null,
  patientSignatureStatus: null,
  patientSignatureName: null,
  patientSignedAt: null,
  patientSignatureReason: null,
  patientSignatureReasonOther: null,
};

/** Participants always include the participant, deduplicated, known values only. */
export function normalizeParticipants(list: readonly string[] | null | undefined): PrpParticipant[] {
  const known = new Set<string>(PRP_PARTICIPANT_VALUES);
  const out = new Set<PrpParticipant>(['patient']);
  for (const v of list ?? []) if (known.has(v)) out.add(v as PrpParticipant);
  return [...out];
}

// ─── Contact type <-> note fields ────────────────────────────────────────────

/** Contact type from the note's telehealth flag and the Service details modality. */
export function contactTypeFromNote(telehealth: boolean, modality: string | null | undefined): PrpContactType {
  if (!telehealth) return 'in_person';
  return modality === 'audio_only' ? 'audio_only' : 'telehealth_video';
}

/** The note fields a contact type sets (one source of truth: the note's telehealth + modality). */
export function noteFieldsForContactType(t: PrpContactType): { telehealth: boolean; telehealthModality: 'audio_video' | 'audio_only' | null } {
  if (t === 'in_person') return { telehealth: false, telehealthModality: null };
  return { telehealth: true, telehealthModality: t === 'audio_only' ? 'audio_only' : 'audio_video' };
}

/** Location default from the visit: an in-person visit at a practice location is on-site; otherwise not guessed. */
export function defaultPrpLocation(appt: { telehealth: boolean; locationId?: string | null } | null | undefined): PrpNoteLocation | null {
  if (!appt || appt.telehealth) return null;
  return appt.locationId ? 'onsite' : null;
}

// ─── IRP objectives ──────────────────────────────────────────────────────────

export type IrpObjectiveOption = { key: string; number: number; need: string; text: string; label: string };

/**
 * Objectives from the IRP builder's goals (PrpWorkflow.irpData.goals): one per goal row with a
 * need area or goal text. Objective # follows the IRP's row order (as on the IRP form).
 */
export function irpObjectiveOptions(irpData: unknown): IrpObjectiveOption[] {
  const data = irpData && typeof irpData === 'object' ? (irpData as Record<string, unknown>) : {};
  const goals = Array.isArray(data.goals) ? data.goals : [];
  const out: IrpObjectiveOption[] = [];
  goals.forEach((g, i) => {
    if (!g || typeof g !== 'object') return;
    const r = g as Record<string, unknown>;
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
    const need = s('need');
    const text = s('shortTermGoal') || s('longTermGoal');
    if (!need && !text) return;
    const number = out.length + 1;
    const key = s('id') || `goal-${i + 1}`;
    out.push({ key, number, need: need || 'Need area not selected', text, label: `Objective #${number}: ${need || 'Need area'}${text ? ` — ${text}` : ''}`.slice(0, 300) });
  });
  return out;
}

export type IrpState = {
  /** final | draft | none */
  status: 'final' | 'draft' | 'none';
  reviewDueDate: string | null;
  overdue: boolean;
};

/** Warnings (never blocks): no finalized IRP, or the IRP review is overdue. */
export function irpWarnings(irp: IrpState): string[] {
  const out: string[] = [];
  if (irp.status === 'none') out.push('No IRP on file for this participant. PRP services are provided under a current IRP: complete the IRP.');
  else if (irp.status === 'draft') out.push('The IRP is still a draft (not finalized and signed). Finalize the IRP.');
  if (irp.overdue) out.push(`The IRP review was due ${irp.reviewDueDate ?? 'earlier'} and is overdue. Update the IRP.`);
  return out;
}

export function irpOverdue(reviewDue: Date | string | null | undefined, today: string): boolean {
  if (!reviewDue) return false;
  const d = typeof reviewDue === 'string' ? reviewDue.slice(0, 10) : reviewDue.toISOString().slice(0, 10);
  return d < today;
}

/**
 * Carry-forward suggestion: the objectives of the participant's previous PRP note that are still
 * on the current IRP (by key). A suggestion only; the counselor confirms.
 */
export function carryForwardObjectives(previous: readonly PrpObjectiveRef[] | null | undefined, options: readonly IrpObjectiveOption[]): PrpObjectiveRef[] {
  const byKey = new Map(options.map((o) => [o.key, o]));
  return (previous ?? []).filter((p) => byKey.has(p.key)).map((p) => ({ key: p.key, label: byKey.get(p.key)!.label }));
}

// ─── Sign rules ──────────────────────────────────────────────────────────────

export type PrpIssue = { id: string; message: string; severity: 'block' | 'warn' };

export type PrpNoteCheckInput = {
  detail: PrpNoteDetail | null;
  dateOfService: string | null;
  /** HH:MM from Service details */
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  /** Narrative sections of the note body */
  interventionText?: string | null;
  responseText?: string | null;
  /** The signer (staff) is always known at sign time */
  staffId?: string | null;
};

export function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const re = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const a = start ? re.exec(start) : null;
  const b = end ? re.exec(end) : null;
  if (!a || !b) return null;
  const m = Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
  return m > 0 ? m : null;
}

/**
 * Missing PRP contact elements. The encounter rule (encounterDocIssues) supplies the required
 * elements; the participant signature (or the reason it was not obtained) is the clinic form's
 * element. Severity is applied by the caller (format-elements date gate).
 */
export function prpNoteIssues(input: PrpNoteCheckInput): PrpIssue[] {
  const d = input.detail ?? EMPTY_PRP_DETAIL;
  const minutes = minutesBetween(input.startTime, input.endTime) ?? (input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : null);
  const goal = d.objectives.length ? d.objectives.map((o) => o.label).join('; ') : d.objectiveOther?.trim() || null;
  const intervention = d.interventions.length ? d.interventions.join(',') : input.interventionText?.trim() || null;
  const missing = encounterDocIssues({
    serviceDate: input.dateOfService,
    minutes,
    serviceType: 'individual',
    location: d.location,
    recordedById: input.staffId ?? 'signer',
    irpGoal: goal,
    intervention,
    response: input.responseText?.trim() || null,
  });
  const out: PrpIssue[] = [];
  const msg: Record<string, string> = {
    date: 'PRP note: record the date of service.',
    minutes: 'PRP note: record the start and end time (or the minutes) of the contact.',
    'location (onsite / offsite)': 'PRP note: record the location (on-site or off-site).',
    'IRP goal addressed': 'PRP note: select the IRP objective(s) addressed (or describe the other issue addressed).',
    intervention: 'PRP note: select or describe the intervention(s) used.',
    'participant response': 'PRP note: document the participant’s response (Participant Response section).',
  };
  for (const m of missing) if (msg[m]) out.push({ id: `prp.${m.split(' ')[0]}`, message: msg[m], severity: 'block' });
  if (d.location === 'offsite' && !d.communityLocation?.trim()) {
    out.push({ id: 'prp.community', message: 'PRP note: off-site contact: record the community location.', severity: 'block' });
  }
  if (d.participants.includes('other') && !d.participantsOther?.trim()) {
    out.push({ id: 'prp.participants', message: 'PRP note: name the other individual(s) involved.', severity: 'block' });
  }
  if (d.collaboration.includes('other') && !d.collaborationNote?.trim()) {
    out.push({ id: 'prp.collaboration', message: 'PRP note: describe the other collaboration.', severity: 'block' });
  }
  if (d.patientSignatureStatus === 'signed') {
    if (!d.patientSignatureName?.trim() || d.patientSignatureName.trim().length < 2) {
      out.push({ id: 'prp.signature', message: 'PRP note: the participant’s signature (typed full name) is missing.', severity: 'block' });
    }
  } else if (d.patientSignatureStatus === 'not_obtained') {
    if (!d.patientSignatureReason) out.push({ id: 'prp.signature', message: 'PRP note: choose why the participant’s signature was not obtained.', severity: 'block' });
    else if (d.patientSignatureReason === 'other' && !d.patientSignatureReasonOther?.trim()) {
      out.push({ id: 'prp.signature', message: 'PRP note: explain why the participant’s signature was not obtained.', severity: 'block' });
    }
  } else {
    out.push({ id: 'prp.signature', message: 'PRP note: obtain the participant’s signature, or record why it could not be obtained.', severity: 'block' });
  }
  if (!PRP_UNIT_RULE_CONFIRMED) {
    out.push({ id: 'prp.billing_rule', message: `${PRP_UNIT_RULE_LABEL}: the note documents the contact; units are not calculated.`, severity: 'warn' });
  }
  return out;
}

// ─── Print ───────────────────────────────────────────────────────────────────

/** Sections printed ahead of the narrative (signed record / release copy). */
export function prpDetailPrintSections(d: PrpNoteDetail | null, contact: { telehealth: boolean; modality: string | null }): { title: string; text: string }[] {
  if (!d) return [];
  const lines: string[] = [];
  lines.push(`Contact type: ${labelOf(PRP_CONTACT_TYPES, contactTypeFromNote(contact.telehealth, contact.modality))}`);
  if (d.location) lines.push(`Location: ${labelOf(PRP_NOTE_LOCATIONS, d.location)}${d.location === 'offsite' && d.communityLocation ? ` — ${d.communityLocation}` : ''}`);
  const who = d.participants.map((p) => (p === 'other' && d.participantsOther ? d.participantsOther : labelOf(PRP_PARTICIPANTS, p))).filter(Boolean);
  lines.push(`Individuals involved: PRP staff, ${who.join(', ')}`);
  const objectives = [...d.objectives.map((o) => o.label), ...(d.objectiveOther?.trim() ? [`Other: ${d.objectiveOther.trim()}`] : [])];
  if (objectives.length) lines.push(`Objective(s) addressed: ${objectives.join('; ')}`);
  if (d.interventions.length) lines.push(`Interventions: ${d.interventions.map((i) => labelOf(PRP_INTERVENTIONS, i)).join('; ')}`);
  if (d.progress) lines.push(`Progress toward objective(s): ${labelOf(PRP_PROGRESS, d.progress)}`);
  if (d.collaboration.length) {
    lines.push(`Communication / collaboration with: ${d.collaboration.map((c) => labelOf(PRP_COLLABORATORS, c)).join(', ')}${d.collaborationNote ? ` — ${d.collaborationNote}` : ''}`);
  }
  if (d.patientSignatureStatus === 'signed') {
    lines.push(`Participant signature: ${d.patientSignatureName} (signed electronically${d.patientSignedAt ? ` ${d.patientSignedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}). ${PRP_PARTICIPANT_ATTESTATION}`);
  } else if (d.patientSignatureStatus === 'not_obtained') {
    const why = d.patientSignatureReason === 'other' ? d.patientSignatureReasonOther : labelOf(PRP_SIGNATURE_REASONS, d.patientSignatureReason);
    lines.push(`Participant signature not obtained: ${why ?? '—'}`);
  }
  return [{ title: 'PRP Contact', text: lines.join('\n') }];
}
