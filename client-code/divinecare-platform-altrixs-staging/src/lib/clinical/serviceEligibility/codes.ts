/**
 * Code sets for the Service Eligibility Scanner. Pure module.
 * Every match is against a code or medication name that is already charted — nothing is inferred.
 */
import { PRP_DX_CODES } from '@/lib/prp/dxCodes';

const ICD_RE = /\b([A-TV-Z][0-9][0-9AB])(?:\.?([0-9A-TV-Z]{1,4}))?\b/gi;

/** "f33.1" / "F331" → "F33.1"; null when not an ICD-10-CM shaped code. */
export function normalizeIcd(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = v.match(/^([A-TV-Z][0-9][0-9AB])\.?([0-9A-TV-Z]{0,4})$/);
  if (!m) return null;
  return m[2] ? `${m[1]}.${m[2]}` : m[1];
}

/** Every ICD-10 code in a free-text diagnosis field. */
export function extractIcdCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(ICD_RE)) {
    const code = normalizeIcd(m[0]);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

// ─── Depression ──────────────────────────────────────────────────────────────

/**
 * Major depressive disorder: F32.0–F32.5, F32.9; F33.x. Excluded: F32.8x (other specified /
 * PMDD) and F32.A ("Depression, unspecified" — ICD-10-CM FY2022+; not an MDD diagnosis, so it
 * cannot support the TMS / Spravato MDD criterion).
 */
export function isMdd(code: string): boolean {
  if (code.startsWith('F33')) return true;
  if (!code.startsWith('F32')) return false;
  return !code.startsWith('F32.8') && code !== 'F32.A';
}

export type MddSeverity = 'severe' | 'severe-psychotic' | 'moderate' | 'mild' | 'remission' | 'unspecified';

export function mddSeverity(code: string): MddSeverity {
  const c = code.replace('.', '');
  if (c === 'F323' || c === 'F333') return 'severe-psychotic';
  if (c === 'F322' || c === 'F332') return 'severe';
  if (c === 'F321' || c === 'F331') return 'moderate';
  if (c === 'F320' || c === 'F330') return 'mild';
  if (c.startsWith('F324') || c.startsWith('F325') || c.startsWith('F334')) return 'remission';
  return 'unspecified';
}

// ─── PRP priority-population diagnoses ───────────────────────────────────────
//
// Source: Optum Maryland (PBHS ASO) "Psychiatric Rehabilitation Program (Adult) — medical necessity
// criteria" provider training guide, MDH criteria rev. July 1, 2020
// (https://marylandbh.optum.com/content/dam/ops-maryland/documents/provider/training/BH_MD_Provider_PRPAdult_PG.pdf),
// and COMAR 10.09.59. Adult PRP requires a diagnosis on the PRP specialty mental health diagnosis
// list: Category A = the serious mental illness priority population (schizophrenia spectrum,
// bipolar / major mood disorders: major depression recurrent or severe); Category B diagnoses
// qualify only with impaired role functioning (Category D) documented.
// Clinic rules on top of that list (owner / denial history, lib/prp/dxCodes.ts "use sparingly"):
//  - F41.9 (anxiety disorder, unspecified) never qualifies on its own (high denial risk, not specific);
//  - other Category B codes (GAD F41.1, panic F41.0, social anxiety F40.10, adjustment F43.22)
//    qualify only when functional impairment is documented — never on the diagnosis alone.
// The exact PBHS code list was not re-verified line by line against the current Optum list; the
// owner confirms (listed as an open question).

const CLINIC_PRP = new Map(PRP_DX_CODES.map((d) => [d.code, d]));

/** Category B codes that never qualify on their own, even with impairment documented */
export const PRP_NEVER_ALONE = new Set(['F41.9']);

export type PrpDxMatch = {
  code: string;
  /** A = SMI priority population; B = anxiety-type codes (Category D impairment required) */
  category: 'A' | 'B';
  /** On the clinic's configured PRP list (lib/prp/dxCodes.ts) */
  onClinicList: boolean;
  highDenialRisk: boolean;
};

/**
 * PRP diagnosis match. Category A: the clinic's configured schizophrenia / mood codes plus other
 * SMI codes — schizophrenia spectrum F20–F29, manic episode F30 (not F30.4 remission), bipolar F31
 * (not F31.7x remission), MDD single episode severe F32.2 / F32.3, MDD recurrent F33.x (not F33.4x
 * remission). Category B: the clinic's anxiety-type codes. Everything else: null.
 */
export function prpDiagnosis(code: string): PrpDxMatch | null {
  const listed = CLINIC_PRP.get(code);
  if (listed) {
    return {
      code,
      category: listed.category === 'Anxiety' ? 'B' : 'A',
      onClinicList: true,
      highDenialRisk: Boolean(listed.highDenialRisk),
    };
  }
  const smi =
    /^F2[0-9]/.test(code) ||
    (code.startsWith('F30') && !code.startsWith('F30.4')) ||
    (code.startsWith('F31') && !code.startsWith('F31.7')) ||
    code === 'F32.2' ||
    code === 'F32.3' ||
    (code.startsWith('F33') && !code.startsWith('F33.4'));
  return smi ? { code, category: 'A', onClinicList: false, highDenialRisk: false } : null;
}

/** SMI for AOT chart context: schizophrenia spectrum, bipolar, MDD with psychotic features / severe recurrent. */
export function isAotSmi(code: string): boolean {
  if (/^F2[0-9]/.test(code)) return true;
  if (code.startsWith('F31')) return true;
  return code === 'F32.3' || code === 'F33.3' || code === 'F33.2';
}

// ─── Contraindication / screening code sets (problem list) ───────────────────

export type CodeFlag = { code: string; label: string };

/** SPRAVATO PI contraindications. */
export function spravatoContraindication(code: string): string | null {
  if (code.startsWith('I71')) return 'Aortic aneurysm (aneurysmal vascular disease)';
  if (code.startsWith('I72')) return 'Arterial aneurysm (aneurysmal vascular disease)';
  if (code === 'I67.1') return 'Cerebral aneurysm, nonruptured';
  if (code.startsWith('Q28.2') || code.startsWith('Q28.3')) return 'Cerebral arteriovenous malformation';
  if (code.startsWith('Q27.3')) return 'Peripheral arteriovenous malformation';
  if (code.startsWith('I61')) return 'Intracerebral hemorrhage';
  if (code.startsWith('I60')) return 'Subarachnoid hemorrhage (review for aneurysm)';
  return null;
}

/** TMS absolute (device / metal near the coil) — LCD L34998. */
export function tmsAbsolute(code: string): string | null {
  if (code.startsWith('Z95.0')) return 'Cardiac pacemaker';
  if (code.startsWith('Z95.81')) return 'Implanted cardiac device (ICD / other)';
  if (code.startsWith('Z96.2')) return 'Cochlear / otological implant';
  if (code === 'Z96.82') return 'Implanted neurostimulator (e.g., VNS / DBS)';
  if (code.startsWith('Z98.2')) return 'CSF drainage device (shunt)';
  return null;
}

/** TMS relative — LCD L34998 (seizure history, neurologic conditions). */
export function tmsRelative(code: string): string | null {
  if (code.startsWith('G40')) return 'Epilepsy / seizure disorder';
  if (code.startsWith('R56')) return 'Seizure history';
  if (code.startsWith('I6')) return 'Cerebrovascular disease';
  if (/^(F0[0-3]|G30|G31)/.test(code)) return 'Dementia / neurocognitive disorder';
  if (code.startsWith('G93.2')) return 'Raised intracranial pressure';
  if (/^(C71|D33|D43)/.test(code)) return 'CNS tumor';
  if (code.startsWith('S06')) return 'Intracranial injury (head trauma)';
  return null;
}

// ─── Antidepressants ─────────────────────────────────────────────────────────

/** Generic name keyed by lower-case generic or brand. */
const ANTIDEPRESSANTS: Record<string, string> = {};
const AD_LIST: [string, string[]][] = [
  ['fluoxetine', ['prozac', 'sarafem']],
  ['sertraline', ['zoloft']],
  ['paroxetine', ['paxil', 'pexeva']],
  ['citalopram', ['celexa']],
  ['escitalopram', ['lexapro']],
  ['fluvoxamine', ['luvox']],
  ['venlafaxine', ['effexor']],
  ['desvenlafaxine', ['pristiq', 'khedezla']],
  ['duloxetine', ['cymbalta', 'drizalma']],
  ['levomilnacipran', ['fetzima']],
  ['bupropion', ['wellbutrin', 'aplenzin', 'forfivo']],
  ['mirtazapine', ['remeron']],
  ['trazodone', ['desyrel', 'oleptro']],
  ['nefazodone', []],
  ['vilazodone', ['viibryd']],
  ['vortioxetine', ['trintellix', 'brintellix']],
  ['amitriptyline', ['elavil']],
  ['nortriptyline', ['pamelor', 'aventyl']],
  ['imipramine', ['tofranil']],
  ['desipramine', ['norpramin']],
  ['clomipramine', ['anafranil']],
  ['doxepin', ['sinequan']],
  ['protriptyline', ['vivactil']],
  ['trimipramine', ['surmontil']],
  ['amoxapine', []],
  ['maprotiline', []],
  ['phenelzine', ['nardil']],
  ['tranylcypromine', ['parnate']],
  ['isocarboxazid', ['marplan']],
  ['selegiline transdermal', ['emsam']],
  ['dextromethorphan-bupropion', ['auvelity']],
  ['gepirone', ['exxua']],
];
for (const [generic, brands] of AD_LIST) {
  ANTIDEPRESSANTS[generic] = generic;
  for (const b of brands) ANTIDEPRESSANTS[b] = generic;
}

/**
 * Generic antidepressant name for a charted medication name, or null. Bupropion-naltrexone
 * (Contrave) and low-dose doxepin for sleep (Silenor) are not counted.
 */
export function antidepressantGeneric(...names: (string | null | undefined)[]): string | null {
  const text = names.filter(Boolean).join(' ').toLowerCase();
  if (!text.trim()) return null;
  if (/contrave|naltrexone/.test(text) || /silenor/.test(text)) return null;
  if (/auvelity|dextromethorphan/.test(text) && /bupropion|auvelity/.test(text)) return 'dextromethorphan-bupropion';
  if (/emsam|selegiline.*transdermal|transdermal.*selegiline/.test(text)) return 'selegiline transdermal';
  for (const key of Object.keys(ANTIDEPRESSANTS).sort((a, b) => b.length - a.length)) {
    if (key === 'selegiline transdermal' || key === 'dextromethorphan-bupropion') continue;
    if (new RegExp(`\\b${key}\\b`).test(text)) return ANTIDEPRESSANTS[key];
  }
  return null;
}

/**
 * Antidepressants often charted at a sub-antidepressant dose for another indication (trazodone
 * for sleep). A trial of one of these counts only when the charted dose reaches the floor (mg/day
 * read from the dose text); otherwise it is listed but not counted.
 */
export const LOW_DOSE_FLOOR_MG: Record<string, number> = { trazodone: 150 };

/** Largest "<n> mg" in the dose text; null when no mg dose is charted. */
export function doseMg(...texts: (string | null | undefined)[]): number | null {
  let best: number | null = null;
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(/(\d+(?:\.\d+)?)\s*mg\b/gi)) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// ─── Program service codes (billing history evidence) ────────────────────────

/**
 * HCPCS / CPT codes whose recent billing shows the client is already receiving the service.
 * Matched on the base code (Valant "99215-Spravato" → 99215 + suffix SPRAVATO is matched by suffix).
 */
export const PROGRAM_SERVICE_CODES = {
  prp: ['H2016', 'H2017', 'H2018'],
  tms: ['90867', '90868', '90869'],
  spravato: ['G2082', 'G2083', 'S0013'],
  // Short-term residential per diem (ASAM 3.5 / 3.1 in this clinic's residential module)
  residential: ['H0018', 'H0019'],
  // H0015 SUD IOP; S9480 MH IOP; H0035 / S0201 partial hospitalization (any of these = IOP/PHP in care)
  iop: ['H0015', 'S9480', 'H0035', 'S0201'],
} as const;
export type BilledProgram = keyof typeof PROGRAM_SERVICE_CODES;

/** Which program a billed code belongs to (null when none). */
export function billedProgram(codeBase: string | null | undefined, suffix?: string | null): BilledProgram | null {
  const c = String(codeBase ?? '').trim().toUpperCase();
  if (/SPRAVATO|ESKET/i.test(suffix ?? '')) return 'spravato';
  if (/^H2017HK$/.test(c)) return 'prp';
  for (const [p, codes] of Object.entries(PROGRAM_SERVICE_CODES) as [BilledProgram, readonly string[]][]) {
    if (codes.includes(c)) return p;
  }
  return null;
}

// ─── Acute psychiatric care events (AOT history prong) ──────────────────────

export type AcuteKind = 'inpatient' | 'ed' | 'crisis';

/** Place of service on a billed line: 21 inpatient hospital, 51 inpatient psychiatric facility, 23 ED */
const ACUTE_POS: Record<string, AcuteKind> = { '21': 'inpatient', '51': 'inpatient', '23': 'ed' };
const INPATIENT_CPT = new Set(['99221', '99222', '99223', '99231', '99232', '99233', '99238', '99239']);
const ED_CPT = new Set(['99281', '99282', '99283', '99284', '99285']);
/** 90839 / 90840 psychotherapy for crisis; H2011 crisis intervention; S9484 / S9485 crisis intervention */
const CRISIS_CPT = new Set(['90839', '90840', 'H2011', 'S9484', 'S9485']);

/** For set-based queries: every POS / code that marks an acute event */
export const ACUTE_QUERY = {
  pos: Object.keys(ACUTE_POS),
  codes: [...INPATIENT_CPT, ...ED_CPT, ...CRISIS_CPT],
} as const;

/** Acute-care kind of a billed line (POS first, then code), or null. */
export function acuteEventKind(codeBase: string | null | undefined, pos?: string | null): AcuteKind | null {
  const p = String(pos ?? '').trim().padStart(2, '0');
  if (ACUTE_POS[p]) return ACUTE_POS[p];
  const c = String(codeBase ?? '').trim().toUpperCase();
  if (INPATIENT_CPT.has(c)) return 'inpatient';
  if (ED_CPT.has(c)) return 'ed';
  if (CRISIS_CPT.has(c)) return 'crisis';
  return null;
}

/** Esketamine / ketamine allergy (Spravato contraindication). */
export function isKetamineAllergy(allergen: string): boolean {
  return /\b(es)?ketamine\b|spravato|ketalar/i.test(allergen);
}

// ─── ASAM (Substance Abuse Intake note text) ─────────────────────────────────

export type AsamReading = {
  ratings: Record<number, number>;
  levelOfCare: string | null;
};

/**
 * Reads what the Substance Abuse Intake writes (lib/ehr/therapy/widgets renderAsam and the
 * "Recommended level of care" field): "Dimension 3 — Emotional…: 2 (moderate)".
 */
export function parseAsamFromNote(body: string): AsamReading {
  const ratings: Record<number, number> = {};
  for (const m of body.matchAll(/^\s*Dimension\s+([1-6])\s*[—–-][^:\n]*:\s*([0-4])\b/gim)) {
    ratings[Number(m[1])] = Number(m[2]);
  }
  const loc = body.match(/^\s*Recommended level of care:\s*(.+)$/im);
  return { ratings, levelOfCare: loc ? loc[1].trim() : null };
}

/** "ASAM 3.5 High-intensity residential" → 3.5; null if no level. */
export function asamLevelNumber(levelOfCare: string | null): number | null {
  if (!levelOfCare) return null;
  if (/OTP|MOUD/i.test(levelOfCare) && !/\d/.test(levelOfCare)) return null;
  const m = levelOfCare.match(/(?:ASAM\s*)?(\d(?:\.\d)?)/i);
  return m ? Number(m[1]) : null;
}
