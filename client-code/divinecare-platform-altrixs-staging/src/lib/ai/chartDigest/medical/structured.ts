/**
 * Structured primary-care records as digest facts, the behavioral health minimum-necessary rule,
 * and the medical-assistant subset. Pure (no I/O); store.ts loads the rows.
 *
 * Record facts are deterministic: the text is the record itself and each cites its own record
 * ("rec:<type>:<id>", quote = the record text), so nothing is generated or inferred. They are built
 * at view time from the live records, so the medication / allergy / problem lists are always current
 * (the stored AI part covers documents and signed visit notes only).
 *
 * 42 CFR Part 2: for a Part 2 client without a consent covering treatment, SUD diagnoses
 * (F10-F16, F18, F19) and SUD medications (buprenorphine, methadone, naltrexone...) are withheld.
 * Behavioral health for the medical audience: diagnoses, current psychiatric medication names and
 * the last risk flag (level and date) only — never therapy content, trauma or disclosures.
 */
import type { Citation, DigestItem, MedicationTrial } from '@/lib/ai/chartDigest/types';
import { drugKey, mergeItems, mergeMedicationTrials } from '@/lib/ai/chartDigest/merge';
import { isSudIcd10, isSudMedication } from '@/lib/fhir/mapping/privacy';
import type { CareGap } from '@/lib/medical/primaryCareWorkflow';
import {
  MEDICAL_ITEM_SECTIONS,
  emptyMedicalSections,
  type MedicalDigest,
  type MedicalItemSection,
  type MedicalSections,
  type PreventiveDue,
} from '@/lib/ai/chartDigest/medical/types';

export type ProblemRec = { id: string; name: string; icd10Code: string | null; status: string; isChronic: boolean; onsetDate: Date | null; resolvedDate: Date | null; createdAt: Date };
export type MedRec = {
  id: string;
  medicationName: string;
  drugName: string | null;
  dosage: string | null;
  dosageText: string | null;
  frequency: string | null;
  indication: string | null;
  startDate: Date | null;
  endDate: Date | null;
  stopDate: Date | null;
  stopReason: string | null;
  active: boolean;
  status: string | null;
  isAntipsychotic: boolean;
};
export type AllergyRec = { id: string; allergen: string; reaction: string | null; severity: string | null; status: string | null; allergenType: string | null; createdAt: Date };
export type VitalRec = { id: string; systolic: number | null; bpSystolic: number | null; diastolic: number | null; bpDiastolic: number | null; weightLbs: number | null; bmi: number | null; recordedAt: Date };
export type LabRec = { id: string; testName: string; testKey: string | null; panelName: string | null; value: string; unit: string | null; flag: string | null; collectedAt: Date | null; resultedAt: Date | null; createdAt: Date };
export type ReferralRec = { id: string; kind: string; target: string; facility: string | null; reason: string; status: string; sentAt: Date; scheduledFor: Date | null };
export type BhRec = {
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  secondaryDiagnoses: string | null;
  /** Latest risk alert: level and date only (the description is never read) */
  lastRisk: { id: string; severity: string; createdAt: Date } | null;
};

export type StructuredSet = {
  problems: ProblemRec[];
  meds: MedRec[];
  allergies: AllergyRec[];
  vitals: VitalRec[];
  labs: LabRec[];
  referrals: ReferralRec[];
  bh: BhRec | null;
  careGaps: CareGap[];
  part2Client: boolean;
  part2ConsentCovers: boolean;
};

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const cite = (source: string, date: string | null, quote: string): Citation => ({ source, page: null, date: date ?? '', quote: quote.slice(0, 200) });

const DEAD_STATUS = /^(entered[- ]in[- ]error|refuted|inactive|deleted|void(ed)?)$/i;
const RESOLVED_STATUS = /^(resolved|inactive|remission|historical)$/i;

/** Part 2 withhold rule for SUD codes / medications */
const withholdSud = (s: StructuredSet) => s.part2Client && !s.part2ConsentCovers;

// ─── Lab analytes worth trending ─────────────────────────────────────────────

const LAB_GROUPS: Array<{ kind: string; re: RegExp; flaggedOnly?: boolean }> = [
  { kind: 'a1c', re: /\b(hba1c|a1c|hemoglobin a1c|glycated)\b/i },
  { kind: 'lipids', re: /\b(ldl|hdl|cholesterol|triglycerides?|non-hdl|lipid)\b/i },
  { kind: 'renal', re: /\b(creatinine|egfr|gfr|bun|urea nitrogen|uacr|albumin\/creatinine|microalbumin|potassium)\b/i },
  { kind: 'liver', re: /\b(alt|ast|sgpt|sgot|alkaline phosphatase|alk phos|bilirubin|albumin)\b/i },
  { kind: 'tsh', re: /\b(tsh|thyroid stimulating|free t4|ft4)\b/i },
  { kind: 'cbc', re: /\b(wbc|white blood|hemoglobin|hgb|hematocrit|hct|platelets?|plt|mcv|rbc)\b/i, flaggedOnly: true },
];
const MAX_PER_ANALYTE = 4;

export function labKind(r: Pick<LabRec, 'testName' | 'testKey' | 'panelName'>): { kind: string; flaggedOnly: boolean } | null {
  const text = `${r.testKey ?? ''} ${r.testName}`;
  for (const g of LAB_GROUPS) if (g.re.test(text)) return { kind: g.kind, flaggedOnly: Boolean(g.flaggedOnly) };
  return null;
}

// ─── Psychiatric medications (minimum-necessary BH summary) ──────────────────

const PSYCH_MED_RE =
  /\b(sertraline|zoloft|fluoxetine|prozac|escitalopram|lexapro|citalopram|celexa|paroxetine|paxil|fluvoxamine|venlafaxine|effexor|desvenlafaxine|pristiq|duloxetine|cymbalta|bupropion|wellbutrin|mirtazapine|remeron|trazodone|vortioxetine|trintellix|vilazodone|aripiprazole|abilify|quetiapine|seroquel|olanzapine|zyprexa|risperidone|risperdal|ziprasidone|geodon|lurasidone|latuda|paliperidone|invega|clozapine|haloperidol|cariprazine|vraylar|brexpiprazole|rexulti|lumateperone|lithium|lamotrigine|lamictal|valproate|divalproex|depakote|carbamazepine|oxcarbazepine|methylphenidate|ritalin|concerta|amphetamine|adderall|lisdexamfetamine|vyvanse|atomoxetine|strattera|guanfacine|clonidine|lorazepam|ativan|clonazepam|klonopin|alprazolam|xanax|diazepam|valium|buspirone|hydroxyzine|prazosin|zolpidem|ambien|amitriptyline|nortriptyline|doxepin)\b/i;
const PSYCH_INDICATION_RE = /\b(depress|anxiety|panic|bipolar|schizo|psychos|adhd|ptsd|ocd|insomnia|mood)\w*/i;

export function isPsychMedication(m: Pick<MedRec, 'medicationName' | 'drugName' | 'indication' | 'isAntipsychotic'>): boolean {
  return m.isAntipsychotic || PSYCH_MED_RE.test(`${m.drugName ?? ''} ${m.medicationName}`) || PSYCH_INDICATION_RE.test(m.indication ?? '');
}

/** Behavioral-health detail the medical audience never sees (minimum necessary) */
const BH_DETAIL_RE =
  /\b(trauma\w*|abuse\w*|abused|assault\w*|rape\w*|molest\w*|neglect\w*|incest|domestic violence|dv|violence|therap\w*|session\w*|counsel\w*|cbt|dbt|emdr|homework|disclos\w*|reported that|stated that|childhood|divorce\w*|custody|grief|bereave\w*|affair|sexual\w*|relationship\w*|family conflict|nightmares?|flashbacks?|self-harm|cutting|legal|arrest\w*|probation|incarcerat\w*|court)\b/i;
const BH_KINDS = new Set(['diagnosis', 'psych_med', 'risk_flag']);

/** A model-extracted behavioral health item allowed for the medical audience */
export function isMinimumNecessaryBhItem(it: Pick<DigestItem, 'text' | 'kind'>): boolean {
  return BH_KINDS.has(String(it.kind ?? '').toLowerCase()) && it.text.length <= 120 && !BH_DETAIL_RE.test(it.text);
}

/** Social / functional items: no trauma, legal or therapy detail for the medical audience */
export function isMedicalSocialItem(it: Pick<DigestItem, 'text'>): boolean {
  return !BH_DETAIL_RE.test(it.text);
}

/** Minimum-necessary filter applied to model-extracted medical sections (generation and view) */
export function applyMedicalMinimumNecessary<T extends MedicalSections>(d: T): T {
  return { ...d, bhSummary: d.bhSummary.filter(isMinimumNecessaryBhItem), socialFunctional: d.socialFunctional.filter(isMedicalSocialItem) };
}

// ─── Record facts ────────────────────────────────────────────────────────────

export type RecordSourceMeta = Record<string, { date: string; label: string; part2: boolean; pageCount: number }>;

export function structuredMedicalFacts(s: StructuredSet): { sections: MedicalSections; sources: RecordSourceMeta } {
  const out = emptyMedicalSections();
  const sources: RecordSourceMeta = {};
  const src = (key: string, date: string | null, label: string) => (sources[key] = { date: date ?? '', label, part2: false, pageCount: 1 });
  const hideSud = withholdSud(s);

  for (const p of s.problems) {
    if (DEAD_STATUS.test(p.status ?? '')) continue;
    if (hideSud && isSudIcd10(p.icd10Code)) continue;
    const resolved = RESOLVED_STATUS.test(p.status ?? '') || Boolean(p.resolvedDate);
    const label = `${p.name}${p.icd10Code ? ` (${p.icd10Code})` : ''}`;
    const date = ymd(p.onsetDate ?? p.createdAt);
    const key = `rec:problem:${p.id}`;
    src(key, date, 'Problem list');
    out.problems.push({ text: `${label}${resolved ? ' — resolved' : p.isChronic ? ' — chronic' : ''}`, date, kind: resolved ? 'resolved' : p.isChronic ? 'chronic' : 'active', cites: [cite(key, date, label)] });
  }

  for (const m of s.meds) {
    const drug = (m.drugName || m.medicationName || '').trim();
    if (!drug) continue;
    if (hideSud && isSudMedication([m.drugName, m.medicationName])) continue;
    const dose = (m.dosageText || m.dosage || '').trim();
    const current = m.active && !/^(stopped|discontinued|inactive|completed|cancelled)$/i.test(m.status ?? '') && !m.stopDate;
    const start = ymd(m.startDate);
    const end = current ? null : ymd(m.stopDate ?? m.endDate);
    const key = `rec:med:${m.id}`;
    src(key, start, 'Medication list');
    const quote = [drug, dose, m.frequency].filter(Boolean).join(' ');
    const t: MedicationTrial = { drug, doses: dose ? [dose] : [], start, end, response: current ? 'current' : null, reasonStopped: current ? null : m.stopReason?.trim() || null, sideEffects: [], cites: [cite(key, start, quote)] };
    out.medicationTrials.push(t);
  }

  for (const a of s.allergies) {
    if (DEAD_STATUS.test(a.status ?? '')) continue;
    const text = `${a.allergen}${a.reaction ? ` — ${a.reaction}` : ''}${a.severity ? ` (${a.severity})` : ''}`;
    const date = ymd(a.createdAt);
    const key = `rec:allergy:${a.id}`;
    src(key, date, 'Allergy list');
    out.allergies.push({ text, date, kind: (a.allergenType || 'drug').toLowerCase().slice(0, 20), cites: [cite(key, date, text)] });
  }

  // Vitals: last 6 readings (newest first in, ascending out)
  const vitals = [...s.vitals].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()).slice(0, 6);
  for (const v of vitals) {
    const date = ymd(v.recordedAt);
    const key = `rec:vital:${v.id}`;
    const sys = v.bpSystolic ?? v.systolic;
    const dia = v.bpDiastolic ?? v.diastolic;
    let used = false;
    if (sys != null && dia != null) {
      const text = `BP ${sys}/${dia}`;
      out.vitals.push({ text, date, kind: 'bp', cites: [cite(key, date, text)] });
      used = true;
    }
    if (v.weightLbs != null || v.bmi != null) {
      const text = [v.weightLbs != null ? `Weight ${Math.round(v.weightLbs * 10) / 10} lb` : null, v.bmi != null ? `BMI ${Math.round(v.bmi * 10) / 10}` : null].filter(Boolean).join(', ');
      out.vitals.push({ text, date, kind: v.bmi != null ? 'bmi' : 'weight', cites: [cite(key, date, text)] });
      used = true;
    }
    if (used) src(key, date, 'Vitals');
  }

  // Labs: key analytes, newest MAX_PER_ANALYTE per test; CBC only when flagged
  const perTest = new Map<string, number>();
  const labs = [...s.labs].sort((a, b) => (b.collectedAt ?? b.resultedAt ?? b.createdAt).getTime() - (a.collectedAt ?? a.resultedAt ?? a.createdAt).getTime());
  for (const l of labs) {
    const k = labKind(l);
    if (!k) continue;
    const flag = String(l.flag ?? 'N').toUpperCase();
    if (k.flaggedOnly && (flag === 'N' || !flag)) continue;
    const test = (l.testKey || l.testName).toLowerCase();
    const n = perTest.get(test) ?? 0;
    if (n >= MAX_PER_ANALYTE) continue;
    perTest.set(test, n + 1);
    const date = ymd(l.collectedAt ?? l.resultedAt ?? l.createdAt);
    const text = `${l.testName} ${l.value}${l.unit ? ` ${l.unit}` : ''}${flag && flag !== 'N' ? ` (${flag})` : ''}`;
    const key = `rec:lab:${l.id}`;
    src(key, date, 'Lab result');
    out.labs.push({ text, date, kind: k.kind, cites: [cite(key, date, text)] });
  }

  for (const r of s.referrals) {
    if (r.status === 'cancelled') continue;
    const open = r.status !== 'report_received' && r.status !== 'seen';
    const date = ymd(r.sentAt);
    // BH handoff: kind and status only (the reason can carry BH detail)
    const text = r.kind === 'internal_bh' ? `Behavioral health referral (${r.status.replace(/_/g, ' ')})` : `${r.target}${r.facility ? `, ${r.facility}` : ''}: ${r.reason} (${r.status.replace(/_/g, ' ')})`;
    const key = `rec:referral:${r.id}`;
    src(key, date, 'Referral');
    out.referrals.push({ text: text.slice(0, 240), date, kind: open ? 'referral_open' : 'referral_done', cites: [cite(key, date, text)] });
  }

  // Behavioral health, minimum necessary: diagnoses, current psych meds, last risk flag
  if (s.bh) {
    const dx: string[] = [];
    if (s.bh.primaryDiagnosis || s.bh.primaryDiagnosisCode) dx.push(`${s.bh.primaryDiagnosis ?? ''}${s.bh.primaryDiagnosisCode ? ` (${s.bh.primaryDiagnosisCode})` : ''}`.trim());
    for (const part of String(s.bh.secondaryDiagnoses ?? '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 6)) dx.push(part);
    for (const d of dx) {
      const code = /\b([A-Z]\d{2}(?:\.\d{1,4})?)\b/.exec(d)?.[1] ?? null;
      if (hideSud && (isSudIcd10(code) || /\b(alcohol|opioid|cannabis|cocaine|stimulant|substance)\b.*\b(use|dependence|abuse)\b/i.test(d))) continue;
      if (BH_DETAIL_RE.test(d)) continue;
      src('rec:bhdx:client', null, 'Chart diagnosis');
      out.bhSummary.push({ text: `Diagnosis: ${d}`.slice(0, 120), date: null, kind: 'diagnosis', cites: [cite('rec:bhdx:client', null, d)] });
    }
    if (s.bh.lastRisk) {
      const date = ymd(s.bh.lastRisk.createdAt);
      const key = `rec:risk:${s.bh.lastRisk.id}`;
      const text = `Last risk flag: ${String(s.bh.lastRisk.severity).toLowerCase()}`;
      src(key, date, 'Risk flag');
      out.bhSummary.push({ text, date, kind: 'risk_flag', cites: [cite(key, date, text)] });
    }
  }
  for (const m of s.meds) {
    const drug = (m.drugName || m.medicationName || '').trim();
    const current = m.active && !m.stopDate && !/^(stopped|discontinued|inactive|completed|cancelled)$/i.test(m.status ?? '');
    if (!drug || !current || !isPsychMedication(m)) continue;
    if (hideSud && isSudMedication([m.drugName, m.medicationName])) continue;
    const key = `rec:med:${m.id}`;
    const date = ymd(m.startDate);
    out.bhSummary.push({ text: `Current psychiatric medication: ${drug}`, date, kind: 'psych_med', cites: [cite(key, date, drug)] });
  }
  return { sections: out, sources };
}

/** Structured preventive-care status (due / overdue / met); "not applicable" gaps are left out */
export function preventiveDueFrom(gaps: CareGap[]): PreventiveDue[] {
  return gaps
    .filter((g) => g.status === 'due' || g.status === 'overdue' || g.status === 'met')
    .map((g) => ({ key: g.key, label: g.label, status: g.status as PreventiveDue['status'], lastDate: g.lastDate, nextDue: g.nextDue }));
}

/** Stored AI facts (documents / visits) + live record facts → the digest the viewer sees */
export function combineMedicalDigest(stored: MedicalDigest | null, records: { sections: MedicalSections; sources: RecordSourceMeta }, preventiveDue: PreventiveDue[]): MedicalDigest {
  const base = stored ? applyMedicalMinimumNecessary(stored) : null;
  const out = emptyMedicalSections();
  for (const s of MEDICAL_ITEM_SECTIONS) out[s as MedicalItemSection] = mergeItems([records.sections[s], base?.[s] ?? []]);
  // The live medication list is authoritative for what is current: a documented past stop date does not end it
  const current = new Set(records.sections.medicationTrials.filter((t) => t.response === 'current').map((t) => drugKey(t.drug)));
  out.medicationTrials = mergeMedicationTrials([base?.medicationTrials ?? [], records.sections.medicationTrials]).map((t) =>
    current.has(drugKey(t.drug)) ? { ...t, end: null, response: 'current' } : t
  );
  return {
    ...out,
    kind: 'medical',
    sources: { ...(base?.sources ?? {}), ...records.sources },
    hasPart2: Boolean(base?.hasPart2),
    preventiveDue,
  };
}

/** Sections a medical assistant sees (rooming / med reconciliation): never the full history */
export const MA_SECTIONS: readonly (MedicalItemSection | 'medicationTrials' | 'preventiveDue')[] = ['allergies', 'medicationTrials', 'vitals', 'preventiveDue'];

/** Minimum-necessary subset for the medical assistant: allergies, current medications, vitals, preventive due */
export function restrictForMedicalAssistant(d: MedicalDigest): MedicalDigest {
  const out = emptyMedicalSections();
  out.allergies = d.allergies;
  out.vitals = d.vitals;
  out.medicationTrials = d.medicationTrials.filter((t) => t.response === 'current' || (!t.end && !t.reasonStopped));
  const cited = new Set([...out.allergies, ...out.vitals, ...out.medicationTrials].flatMap((i) => i.cites.map((c) => c.source)));
  const sources = Object.fromEntries(Object.entries(d.sources).filter(([k]) => cited.has(k)));
  return { ...out, kind: 'medical', sources, hasPart2: [...out.allergies, ...out.vitals, ...out.medicationTrials].some((i) => i.part2), preventiveDue: d.preventiveDue ?? [] };
}

/** Drop Part 2 facts (consent revoked since generation) */
export function medicalWithoutPart2(d: MedicalDigest): MedicalDigest {
  const out = { ...d } as MedicalDigest;
  for (const s of MEDICAL_ITEM_SECTIONS) out[s] = d[s].filter((i) => !i.part2);
  out.medicationTrials = d.medicationTrials.filter((t) => !t.part2);
  out.sources = Object.fromEntries(Object.entries(d.sources).filter(([, v]) => !v.part2));
  out.hasPart2 = false;
  return out;
}
