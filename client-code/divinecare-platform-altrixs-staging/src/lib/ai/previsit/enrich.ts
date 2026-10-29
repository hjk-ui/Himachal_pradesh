/**
 * Pre-visit brief: the enriched facts (diagnoses, current medications, visits by type, labs,
 * recent signed notes, care team, open items). Pure (no prisma, no AWS) so it is unit-tested.
 *
 * Everything here is copied or computed from structured chart rows; free text (note sections,
 * diagnosis names) is clipped and redacted, never paraphrased. Staff names and links are kept for
 * the clinician's view (fact lines) and removed again by modelFacts() before anything reaches AI.
 */
import { appointmentServiceType, serviceTypeForCpt } from '@/lib/clinical/sessionFrequency';
import { isPsychotherapyNoteType } from '@/lib/ai/chartDigest/classify';
import { structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { LAB_ORDER_SETS, suggestedOrderSets } from '@/lib/labs/orderSets';
import { addInterval } from '@/lib/labs/standing';

const DAY_MS = 86_400_000;
/** Medication changes look back this far (shown as a number in the facts so it is citable) */
export const MED_CHANGE_WINDOW_DAYS = 90;
export const NEXT_VISIT_SOON_DAYS = 7;
export const NOTES_PER_KIND = 3;
export const NOTE_SECTION_MAX = 160;
export const NOTE_SECTIONS_PER_NOTE = 5;
export const LAB_HISTORY = 3;
const MAX_DX = 8;
const MAX_MEDS = 12;

export type PreVisitAudienceKind = 'therapist' | 'prescriber' | 'primary_care';

// ─── Raw inputs ──────────────────────────────────────────────────────────────

export type RawDiagnosis = {
  id: string;
  code: string | null;
  description: string;
  dsmName?: string | null;
  rank: number;
  isPrimary: boolean;
  status: string;
  createdAt: Date;
  source?: string | null;
};
export type RawMedicalVisit = { id: string; visitDate: Date; visitType: string; providerName?: string | null; signedAt: Date | null; assessment?: string | null; plan?: string | null };
export type RawLabResult = {
  id: string;
  testName: string;
  testKey: string | null;
  value: string;
  unit: string | null;
  refRange: string | null;
  flag: string | null;
  collectedAt: Date | null;
  createdAt: Date;
};
export type RawLabOrder = {
  id: string;
  status: string;
  orderedAt: Date;
  collectedAt: Date | null;
  resultedAt: Date | null;
  panels: string[];
  results: RawLabResult[];
};
/** Imported (Valant) progress-note documents, newest first; href only when the viewer may open it */
export type RawNoteDocument = { id: string; date: Date; label: string; href: string | null };
/** Chart documents filed recently (type label only, never the title) */
export type RawFiledDocument = { id: string; label: string; filedAt: Date };
export type RawCareTeam = { primary: { name: string; label: string } | null; members: { name: string; label: string }[] } | null;
export type RawMeasureAssignment = { instrumentId: string; schedule: string; everyDays: number | null; startDate: Date; endDate: Date | null; status: string };
export type RawReferral = { kind: string; status: string; sentAt: Date };
/** Lab facts the chart history digest cited from documents (used only when no structured results exist) */
export type RawDocumentLab = { text: string; date: string | null; source: string };

// ─── Visit classification ────────────────────────────────────────────────────

export type VisitKind = 'therapy' | 'med_management' | 'primary_care' | 'other';
const PRIMARY_CARE_ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']);
const PRIMARY_CARE_TYPE = /primary care|family practice|annual (?:physical|exam)|physical exam|wellness|sick visit|medical visit|well visit/i;

export function visitKindOf(a: { type: string; notes?: string | null; clinicianRole?: string | null }): VisitKind {
  if (PRIMARY_CARE_TYPE.test(a.type || '') || PRIMARY_CARE_ROLES.has(String(a.clinicianRole ?? '').toUpperCase())) return 'primary_care';
  const st = appointmentServiceType({ type: a.type, notes: a.notes ?? null });
  if (st === 'therapy') return 'therapy';
  if (st === 'med_management') return 'med_management';
  if (/psychiatric eval|initial evaluation|medication/i.test(a.type || '')) return 'med_management';
  if (/therapy|psychotherapy|counsel/i.test(a.type || '')) return 'therapy';
  return 'other';
}

export const VISIT_KIND_LABEL: Record<VisitKind, string> = {
  therapy: 'therapy session',
  med_management: 'med management',
  primary_care: 'primary care',
  other: 'other visit',
};

// ─── Small helpers ───────────────────────────────────────────────────────────

export function clipText(s: string, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const roleLabel = (r: string | null | undefined) => (r ? String(r).toLowerCase().replace(/_/g, ' ') : null);

// ─── Diagnoses ───────────────────────────────────────────────────────────────

export type DiagnosisFact = { code: string | null; name: string; primary: boolean; status: string; since: string };

export function diagnosisFacts(rows: RawDiagnosis[], day: (d: Date) => string, redact: (t: string) => string, opts: { hideSud: boolean }): DiagnosisFact[] {
  return rows
    .filter((d) => /^(active|provisional)$/i.test(d.status))
    // Primary care roles never see SUD (F10–F19) codes here: 42 CFR Part 2 / minimum necessary
    .filter((d) => !(opts.hideSud && /^F1\d/i.test(d.code ?? '')))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.rank - b.rank || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, MAX_DX)
    .map((d) => ({
      code: d.code,
      name: clipText(redact(d.dsmName || d.description), 90),
      primary: d.isPrimary,
      status: d.status.toLowerCase(),
      since: day(d.createdAt),
    }));
}

// ─── Medications ─────────────────────────────────────────────────────────────

export type MedLike = {
  medicationName: string;
  drugName?: string | null;
  dosage?: string | null;
  dosageText?: string | null;
  route?: string | null;
  frequency?: string | null;
  instructions?: string | null;
  asNeeded?: boolean | null;
  startDate: Date | null;
  createdAt: Date;
  stopDate?: Date | null;
  endDate?: Date | null;
  active: boolean;
  status?: string | null;
  rcopiaMedId?: string | null;
};

export type CurrentMedFact = { name: string; dose: string | null; sig: string | null; since: string; fromDrFirst: boolean };
export type MedChangeFact = { change: 'started' | 'stopped'; name: string; dose: string | null; date: string; fromDrFirst: boolean };

export const medIsStopped = (m: MedLike) => !m.active || /stop|discontinu|inactive|cancel/i.test(m.status || '');
const medName = (m: MedLike) => clipText(m.medicationName || m.drugName || 'Medication', 60);
const medDose = (m: MedLike) => (m.dosage || m.dosageText ? clipText(String(m.dosage || m.dosageText), 40) : null);

export function currentMedFacts(meds: MedLike[], day: (d: Date) => string): CurrentMedFact[] {
  return meds
    .filter((m) => !medIsStopped(m))
    .sort((a, b) => medName(a).localeCompare(medName(b)))
    .slice(0, MAX_MEDS)
    .map((m) => {
      const sig = [m.route, m.frequency].filter(Boolean).join(' ') || m.instructions || '';
      return {
        name: medName(m),
        dose: medDose(m),
        sig: sig ? clipText(`${sig}${m.asNeeded && !/prn|as needed/i.test(sig) ? ' as needed' : ''}`, 60) : null,
        since: day(m.startDate ?? m.createdAt),
        fromDrFirst: Boolean(m.rcopiaMedId),
      };
    });
}

export function medChangeFacts(meds: MedLike[], now: Date, day: (d: Date) => string): MedChangeFact[] {
  const from = now.getTime() - MED_CHANGE_WINDOW_DAYS * DAY_MS;
  const inWin = (d: Date | null | undefined) => Boolean(d) && d!.getTime() >= from && d!.getTime() <= now.getTime();
  const out: (MedChangeFact & { at: number })[] = [];
  for (const m of meds) {
    const start = m.startDate ?? m.createdAt;
    if (inWin(start)) out.push({ change: 'started', name: medName(m), dose: medDose(m), date: day(start), fromDrFirst: Boolean(m.rcopiaMedId), at: start.getTime() });
    const stop = m.stopDate ?? m.endDate ?? null;
    if (medIsStopped(m) && stop && inWin(stop)) out.push({ change: 'stopped', name: medName(m), dose: medDose(m), date: day(stop), fromDrFirst: Boolean(m.rcopiaMedId), at: stop.getTime() });
  }
  return out
    .sort((a, b) => b.at - a.at)
    .slice(0, 8)
    .map((m): MedChangeFact => ({ change: m.change, name: m.name, dose: m.dose, date: m.date, fromDrFirst: m.fromDrFirst }));
}

// ─── Visits ──────────────────────────────────────────────────────────────────

export type VisitRef = { date: string; type: string; imported: boolean };
export type VisitsFact = {
  last: { therapy: VisitRef | null; medManagement: VisitRef | null; primaryCare: VisitRef | null; other: VisitRef | null };
  next: { date: string; time: string; type: string; kind: VisitKind; clinician: string | null; clinicianRole: string | null } | null;
  nextWithin7Days: boolean;
};

export type VisitAppointment = { startsAt: Date; type: string; status: string; notes?: string | null; source?: string | null; clinicianName?: string | null; clinicianRole?: string | null };
const ATTENDED = new Set(['COMPLETED', 'CHECKED_IN', 'IN_SESSION']);
const UPCOMING = new Set(['SCHEDULED', 'CHECKED_IN']);

export function visitFacts(input: {
  past: VisitAppointment[];
  upcoming: VisitAppointment[];
  medicalVisits: RawMedicalVisit[];
  /** Last attended dates from the session-frequency evidence (claims / signed notes / Valant charges) */
  therapyLastAttended?: string | null;
  medLastAttended?: string | null;
  now: Date;
  day: (d: Date) => string;
  wall: (d: Date) => { date: string; time: string };
}): VisitsFact {
  const { now, day } = input;
  const best: Record<VisitKind, { at: number; ref: VisitRef } | null> = { therapy: null, med_management: null, primary_care: null, other: null };
  const offer = (kind: VisitKind, at: number, ref: VisitRef) => {
    const cur = best[kind];
    if (!cur || at > cur.at) best[kind] = { at, ref };
  };
  for (const a of input.past) {
    if (!ATTENDED.has(a.status) || a.startsAt.getTime() > now.getTime()) continue;
    offer(visitKindOf(a), a.startsAt.getTime(), { date: day(a.startsAt), type: clipText(a.type, 50), imported: a.source === 'valant_history' });
  }
  for (const v of input.medicalVisits) {
    if (!v.signedAt || v.visitDate.getTime() > now.getTime()) continue;
    offer('primary_care', v.visitDate.getTime(), { date: day(v.visitDate), type: clipText(v.visitType || 'Medical visit', 50), imported: false });
  }
  // Billing / note evidence the schedule may not show (e.g. Valant charges)
  const evidence = (kind: VisitKind, ymd: string | null | undefined, label: string) => {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    const cur = best[kind];
    if (!cur || ymd > cur.ref.date) best[kind] = { at: Date.parse(`${ymd}T12:00:00Z`), ref: { date: ymd, type: label, imported: false } };
  };
  evidence('therapy', input.therapyLastAttended, 'Therapy (claim / signed note)');
  evidence('med_management', input.medLastAttended, 'Medication management (claim / signed note)');

  const next = input.upcoming
    .filter((a) => UPCOMING.has(a.status) && a.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const soon = now.getTime() + NEXT_VISIT_SOON_DAYS * DAY_MS;
  return {
    last: { therapy: best.therapy?.ref ?? null, medManagement: best.med_management?.ref ?? null, primaryCare: best.primary_care?.ref ?? null, other: best.other?.ref ?? null },
    next: next
      ? {
          date: input.wall(next.startsAt).date,
          time: input.wall(next.startsAt).time,
          type: clipText(next.type, 50),
          kind: visitKindOf(next),
          clinician: next.clinicianName ? clipText(next.clinicianName, 60) : null,
          clinicianRole: roleLabel(next.clinicianRole),
        }
      : null,
    nextWithin7Days: Boolean(next && next.startsAt.getTime() <= soon),
  };
}

/** "No attended therapy session on record…" → what the brief says (never "no sessions" when med visits exist) */
export const NO_THERAPY_TEXT = 'No therapy sessions on record (medication management visits are tracked separately)';

export function sessionFrequencyDetail(detail: string, therapyLast: VisitRef | null): string {
  if (/^No attended (?:therapy )?session on record/i.test(detail) || (!therapyLast && /no attended/i.test(detail))) {
    const next = /next scheduled (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1];
    return `${NO_THERAPY_TEXT}${next ? `; next therapy session scheduled ${next}` : '; no therapy session scheduled'}`;
  }
  return detail;
}

const CADENCE_STATUS_TEXT: Record<string, string> = {
  on_track: 'on track',
  due_soon: 'due soon',
  scheduled: 'scheduled',
  overdue: 'overdue',
  no_sessions: 'no therapy sessions',
  not_tracked: 'not tracked',
};
export const cadenceStatusText = (s: string) => CADENCE_STATUS_TEXT[s] ?? s.replace(/_/g, ' ');

// ─── Notes ───────────────────────────────────────────────────────────────────

export type NoteKind = 'therapy' | 'med_management' | 'primary_care';
export type NoteFact = {
  /** note id (links in the UI); removed before AI */
  ref: string;
  date: string;
  type: string;
  authorRole: string | null;
  sections: { label: string; text: string }[];
};
export type NotesFact = {
  /** audience-first order */
  order: NoteKind[];
  therapy: NoteFact[];
  medManagement: NoteFact[];
  primaryCare: NoteFact[];
  /** Imported (Valant) note documents not summarized by the chart history yet */
  documents: { date: string; label: string; href: string | null }[];
  documentsSummarized: boolean;
};

export type NoteLike = { id: string; noteType: string | null; body: string; dateOfService: Date | null; createdAt: Date; part2: boolean; cptCode?: string | null; authorRole?: string | null };

const SECTION_RULES: Array<[string, RegExp]> = [
  ['Risk', /risk|safety|suicid|c-?ssrs|lethality/i],
  ['Medications', /medication|med change|meds &|prescri|pharmaco|titrat/i],
  ['Assessment / progress', /assessment|progress|response|impression|formulation/i],
  ['Interventions', /intervention|technique|modalit/i],
  ['Measures', /measure|screen|score|instrument/i],
  ['Homework', /homework/i],
  ['Plan / follow-up', /plan|follow|next|aftercare|recommend|disposition/i],
];

export function noteKindOf(n: { noteType: string | null; cptCode?: string | null }): Exclude<NoteKind, 'primary_care'> {
  const st = serviceTypeForCpt(n.cptCode ?? null);
  if (st === 'med_management') return 'med_management';
  if (st === 'therapy') return 'therapy';
  return /psych(?:iatric)?\b(?!o)|medication|med ?mgmt|med management|e\/m|psychiatric eval/i.test(n.noteType || '') ? 'med_management' : 'therapy';
}

/** Key sections of one signed note, copied (clipped, redacted) from its structured headings */
export function noteSectionExtracts(noteType: string | null, body: string, redact: (t: string) => string, planFallback: (body: string) => string): { label: string; text: string }[] {
  const clean = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const sections = structuredNoteSections(noteType || '', clean);
  const out: { label: string; text: string }[] = [];
  const used = new Set<string>();
  for (const [label, re] of SECTION_RULES) {
    const s = sections.find((x) => x.title !== 'Clinical Documentation' && re.test(x.title) && x.text.trim() && !used.has(x.title));
    if (!s) continue;
    used.add(s.title);
    out.push({ label, text: clipText(redact(s.text), NOTE_SECTION_MAX) });
    if (out.length >= NOTE_SECTIONS_PER_NOTE) break;
  }
  if (!out.length) {
    const plan = planFallback(clean);
    if (plan) out.push({ label: 'Plan / follow-up', text: clipText(redact(plan), NOTE_SECTION_MAX) });
  }
  return out;
}

export function notesFacts(input: {
  audience: PreVisitAudienceKind;
  bhChartNotes: boolean;
  notes: NoteLike[];
  medicalVisits: RawMedicalVisit[];
  documents: RawNoteDocument[];
  digestAvailable: boolean;
  day: (d: Date) => string;
  redact: (t: string) => string;
  planFallback: (body: string) => string;
}): NotesFact {
  const { day, redact } = input;
  const therapy: NoteFact[] = [];
  const med: NoteFact[] = [];
  if (input.bhChartNotes) {
    const sorted = [...input.notes].sort((a, b) => (b.dateOfService ?? b.createdAt).getTime() - (a.dateOfService ?? a.createdAt).getTime());
    for (const n of sorted) {
      // Psychotherapy notes (separate table, and any note typed as one) and Part 2 notes never feed the brief
      if (n.part2 || isPsychotherapyNoteType(n.noteType)) continue;
      const kind = noteKindOf(n);
      const list = kind === 'med_management' ? med : therapy;
      if (list.length >= NOTES_PER_KIND) continue;
      list.push({
        ref: n.id,
        date: day(n.dateOfService ?? n.createdAt),
        type: clipText(n.noteType || 'Progress note', 50),
        authorRole: roleLabel(n.authorRole),
        sections: noteSectionExtracts(n.noteType, n.body || '', redact, input.planFallback),
      });
    }
  }
  const primaryCare: NoteFact[] = [];
  if (input.audience !== 'therapist') {
    for (const v of [...input.medicalVisits].filter((x) => x.signedAt).sort((a, b) => b.visitDate.getTime() - a.visitDate.getTime()).slice(0, NOTES_PER_KIND)) {
      const sections: { label: string; text: string }[] = [];
      if (v.assessment?.trim()) sections.push({ label: 'Assessment / progress', text: clipText(redact(v.assessment), NOTE_SECTION_MAX) });
      if (v.plan?.trim()) sections.push({ label: 'Plan / follow-up', text: clipText(redact(v.plan), NOTE_SECTION_MAX) });
      primaryCare.push({ ref: v.id, date: day(v.visitDate), type: clipText(v.visitType || 'Medical visit', 50), authorRole: 'primary care provider', sections });
    }
  }
  const order: NoteKind[] =
    input.audience === 'prescriber' ? ['med_management', 'therapy', 'primary_care'] : input.audience === 'primary_care' ? ['primary_care', 'med_management', 'therapy'] : ['therapy', 'med_management', 'primary_care'];
  return {
    order,
    therapy,
    medManagement: med,
    primaryCare,
    // With a chart history digest, its cited facts stand in for the imported notes
    documents: input.bhChartNotes && !input.digestAvailable ? input.documents.slice(0, NOTES_PER_KIND).map((d) => ({ date: day(d.date), label: clipText(d.label, 50), href: d.href })) : [],
    documentsSummarized: input.digestAvailable,
  };
}

// ─── Labs ────────────────────────────────────────────────────────────────────

/** Psychiatry-relevant tests (shown first to prescribers) */
const PSYCH_LAB_RE =
  /lithium|valpro|depakote|carbamazepine|tegretol|clozapine|\bcbc\b|anc\b|neutrophil|\bwbc\b|\bcmp\b|\bbmp\b|metabolic panel|creatinine|egfr|\bbun\b|sodium|\balt\b|\bast\b|hepatic|liver|\blft|tsh|thyroid|\bt4\b|a1c|hemoglobin a1c|glucose|lipid|cholesterol|\bldl\b|\bhdl\b|triglycer|prolactin|ecg|ekg|qtc|drug screen|drug test|\buds\b|urine drug|toxicolog|bup-mat/i;

/** Order-set test key → names that count as that test */
const TEST_KEY_PATTERNS: Record<string, RegExp> = {
  lithium: /lithium/i,
  cbc: /\bcbc\b|complete blood count|\banc\b|neutrophil/i,
  bmp: /\bbmp\b|basic metabolic|\bcmp\b|comprehensive metabolic|creatinine/i,
  tsh: /\btsh\b|thyroid stimulating/i,
  valproic: /valpro|depakote/i,
  lft: /\blft|hepatic|liver function|\bcmp\b|comprehensive metabolic|\balt\b/i,
  carbamazepine: /carbamazepine|tegretol/i,
  sodium: /sodium|\bbmp\b|\bcmp\b|metabolic panel/i,
  'glucose-fasting': /glucose|a1c/i,
  lipid: /lipid|cholesterol/i,
  'bup-mat': /drug (?:screen|test)|urine drug|\buds\b|buprenorphine/i,
};

export type LabResultFact = {
  test: string;
  psychRelevant: boolean;
  latest: { value: string; unit: string | null; flag: string | null; refRange: string | null; date: string };
  history: { value: string; flag: string | null; date: string }[];
  trend: 'up' | 'down' | 'same' | 'single' | null;
};
export type LabMonitoringFact = { test: string; medication: string; rule: string; lastDate: string | null; state: 'overdue' | 'none_on_file' };
export type LabsExtra = {
  results: LabResultFact[];
  pending: { tests: string; orderedDate: string; status: string }[];
  monitoring: LabMonitoringFact[];
  fromDocuments: { text: string; date: string | null; source: string }[];
};

const flagOf = (f: string | null | undefined) => (f && f !== 'N' ? f : null);
const resultAt = (r: RawLabResult, o: RawLabOrder) => r.collectedAt ?? o.collectedAt ?? o.resultedAt ?? r.createdAt;

export function labsExtra(input: {
  audience: PreVisitAudienceKind;
  orders: RawLabOrder[];
  activeMeds: { name: string; isAntipsychotic?: boolean }[];
  documentLabs: RawDocumentLab[];
  now: Date;
  day: (d: Date) => string;
  redact: (t: string) => string;
}): LabsExtra {
  const { day } = input;
  type Pt = { at: Date; r: RawLabResult };
  const byTest = new Map<string, { name: string; pts: Pt[] }>();
  for (const o of input.orders) {
    if (o.status === 'cancelled') continue;
    for (const r of o.results) {
      const k = (r.testKey || r.testName).trim().toLowerCase();
      if (!k) continue;
      const g = byTest.get(k) ?? { name: clipText(r.testName || r.testKey || 'Lab', 50), pts: [] };
      g.pts.push({ at: resultAt(r, o), r });
      byTest.set(k, g);
    }
  }
  const all: LabResultFact[] = [];
  for (const g of byTest.values()) {
    const pts = g.pts.sort((a, b) => b.at.getTime() - a.at.getTime());
    const top = pts.slice(0, LAB_HISTORY);
    const [a, b] = top;
    const na = a && Number.parseFloat(a.r.value);
    const nb = b && Number.parseFloat(b.r.value);
    const trend = !b ? 'single' : Number.isFinite(na) && Number.isFinite(nb) ? (na > nb ? 'up' : na < nb ? 'down' : 'same') : null;
    all.push({
      test: g.name,
      psychRelevant: PSYCH_LAB_RE.test(`${g.name} ${a.r.testKey ?? ''}`),
      latest: { value: clipText(a.r.value, 30), unit: a.r.unit ? clipText(a.r.unit, 20) : null, flag: flagOf(a.r.flag), refRange: a.r.refRange ? clipText(a.r.refRange, 30) : null, date: day(a.at) },
      history: top.map((p) => ({ value: clipText(p.r.value, 30), flag: flagOf(p.r.flag), date: day(p.at) })),
      trend,
    });
  }
  const abnormalFirst = (x: LabResultFact, y: LabResultFact) => Number(Boolean(y.latest.flag)) - Number(Boolean(x.latest.flag)) || (y.latest.date < x.latest.date ? -1 : y.latest.date > x.latest.date ? 1 : 0);
  // Prescribers: psychiatry-relevant results first; primary care: the full set, abnormal first
  const results =
    input.audience === 'prescriber'
      ? [...all.filter((x) => x.psychRelevant).sort(abnormalFirst), ...all.filter((x) => !x.psychRelevant && x.latest.flag).sort(abnormalFirst)].slice(0, 10)
      : [...all].sort(abnormalFirst).slice(0, 14);

  const pending = input.orders
    .filter((o) => ['ordered', 'collected', 'pending'].includes(o.status))
    .sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime())
    .slice(0, 6)
    .map((o) => ({ tests: clipText(o.panels.join(', ') || 'Lab order', 80), orderedDate: day(o.orderedAt), status: o.status }));

  // Monitoring due from the cited order-set schedules (src/lib/labs/orderSets.ts), never invented
  const monitoring: LabMonitoringFact[] = [];
  for (const key of suggestedOrderSets(input.activeMeds)) {
    const set = LAB_ORDER_SETS.find((s) => s.key === key);
    if (!set) continue;
    const seen = new Set<string>();
    for (const st of set.standing) {
      for (const tk of st.testKeys) {
        if (seen.has(tk)) continue;
        // The SHORTEST interval the set lists for this test (the strictest schedule, e.g. clozapine ANC
        // weekly in the first 6 months): a safety reminder must not stay silent early in treatment, when
        // monitoring matters most. The start date isn't reliably on file to pick a later, longer interval.
        const rule = set.standing.filter((x) => x.testKeys.includes(tk)).sort((p, q) => addInterval(new Date(0), p.unit, p.count).getTime() - addInterval(new Date(0), q.unit, q.count).getTime())[0];
        seen.add(tk);
        const re = TEST_KEY_PATTERNS[tk];
        let last: Date | null = null;
        for (const [k, g] of byTest) {
          if (k === tk || (re && re.test(`${g.name} ${k}`))) for (const p of g.pts) if (!last || p.at > last) last = p.at;
        }
        const label = rule.label;
        if (!last) monitoring.push({ test: tk, medication: set.medication, rule: label, lastDate: null, state: 'none_on_file' });
        else if (addInterval(last, rule.unit, rule.count).getTime() < input.now.getTime()) monitoring.push({ test: tk, medication: set.medication, rule: label, lastDate: day(last), state: 'overdue' });
      }
    }
  }
  return {
    results,
    pending,
    monitoring: monitoring.slice(0, 8),
    fromDocuments: results.length ? [] : input.documentLabs.slice(0, 6).map((d) => ({ text: clipText(input.redact(d.text), 140), date: d.date, source: clipText(d.source, 60) })),
  };
}

// ─── Care team, open items ───────────────────────────────────────────────────

export type CareTeamFact = { primary: { role: string; name: string } | null; others: { role: string; name: string }[] } | null;

export function careTeamFacts(t: RawCareTeam): CareTeamFact {
  if (!t) return null;
  return {
    primary: t.primary ? { role: t.primary.label, name: clipText(t.primary.name, 60) } : null,
    others: t.members.slice(0, 6).map((m) => ({ role: m.label, name: clipText(m.name, 60) })),
  };
}

export type OverdueMeasureFact = { instrument: string; lastDate: string | null; everyDays: number };

export function overdueMeasures(assignments: RawMeasureAssignment[], latestByInstrument: (instrumentId: string) => string | null, asOf: string, day: (d: Date) => string): OverdueMeasureFact[] {
  const out: OverdueMeasureFact[] = [];
  for (const a of assignments) {
    if (a.status !== 'active' || a.schedule !== 'interval') continue;
    const start = day(a.startDate);
    if (start > asOf || (a.endDate && day(a.endDate) < asOf)) continue;
    const every = Math.max(1, a.everyDays ?? 30);
    const last = latestByInstrument(a.instrumentId);
    const ref = last ?? start;
    const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${ref}T00:00:00Z`)) / DAY_MS);
    // Same tolerance as the measure scheduler (src/lib/measures/schedule.ts intervalTolerance)
    if (days > every + Math.min(7, Math.floor(every / 4))) out.push({ instrument: a.instrumentId.toUpperCase(), lastDate: last, everyDays: every });
  }
  return out.slice(0, 6);
}

export type ReferralFact = { kind: string; status: string; since: string };
const CLOSED_REFERRAL = /^(seen|report_received|cancelled|closed|completed|declined)$/i;
export function openReferrals(rows: RawReferral[], day: (d: Date) => string): ReferralFact[] {
  return rows
    .filter((r) => !CLOSED_REFERRAL.test(r.status))
    .slice(0, 6)
    .map((r) => ({ kind: r.kind.replace(/_/g, ' '), status: r.status.replace(/_/g, ' '), since: day(r.sentAt) }));
}
