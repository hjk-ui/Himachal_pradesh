'use strict';
/**
 * DrFirst Rcopia v2.54 — generic command surface.
 *
 * Catalog from the Integration Suggester (Oct 2026):
 *   Required: send_patient, update_patient, send_allergy, update_allergy,
 *     send_problem (coded dx required — ICD-10 for Altrixs), update_problem,
 *     search_problem, send_medication, update_medication, search_drug_detail,
 *     send_prescription, update_prescription, patient_search_get_data,
 *     get_notification_count
 *   Optional: update_prescription_events, update_notification,
 *     update_rxchange, update_rxfill
 *
 * Upload (send_*) commands go to the Engine servlet; download/search commands
 * go to the Update servlet. bodyXml is the inner <Request> content excluding
 * the <Command> element.
 */

import { callEngine, callUpdate, type RcopiaCallResult } from './drfirstRcopiaService';

const PRACTICE_USER = process.env.DRFIRST_PRACTICE_USERNAME || process.env.DRFIRST_PRACTICE_USER_NAME;
const DEMO_MODE = !process.env.DRFIRST_VENDOR_USERNAME || !process.env.DRFIRST_VENDOR_PASSWORD || !PRACTICE_USER;

export type RcopiaCommand =
  | 'send_patient' | 'update_patient'
  | 'send_allergy' | 'update_allergy'
  | 'send_problem' | 'update_problem' | 'search_problem'
  | 'send_medication' | 'update_medication' | 'search_drug_detail'
  | 'send_prescription' | 'update_prescription'
  | 'patient_search_get_data' | 'get_notification_count'
  | 'update_prescription_events' | 'update_notification'
  | 'update_rxchange' | 'update_rxfill'
  | 'send_patient_office_visits' | 'update_patient_office_visits'
  | 'get_review_status' | 'get_pdmp_events';

const DOWNLOAD_COMMANDS: RcopiaCommand[] = [
  'update_patient', 'update_allergy', 'update_problem', 'update_medication',
  'update_prescription', 'update_prescription_events', 'update_notification',
  'update_rxchange', 'update_rxfill', 'get_notification_count',
  'patient_search_get_data', 'search_problem', 'search_drug_detail',
  'update_patient_office_visits', 'get_review_status', 'get_pdmp_events',
];

function esc(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Run any catalog command against the correct servlet. */
export async function rcopiaCommand(
  command: RcopiaCommand,
  bodyXml: string,
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  if (DEMO_MODE) {
    return {
      ok: true,
      status: 'demo',
      raw: `<RCExtResponse><Status>demo</Status><Command>${command}</Command></RCExtResponse>`,
      demo: true,
    };
  }
  const inner = [`    <Command>${command}</Command>`, bodyXml].filter(Boolean).join('\n');
  const result = DOWNLOAD_COMMANDS.includes(command)
    ? await callUpdate(inner, rcopiaUserName)
    : await callEngine(inner, rcopiaUserName);
  return { ...result, demo: false };
}

function patientIdXml(patient: { rcopiaId?: string; externalId?: string }): string {
  return patient.rcopiaId
    ? `      <RcopiaID>${esc(patient.rcopiaId)}</RcopiaID>`
    : `      <ExternalID>${esc(patient.externalId || '')}</ExternalID>`;
}

/** send_problem — DrFirst rejects free-text diagnoses; ICD-10 code required. */
export async function sendProblem(
  patient: { rcopiaId?: string; externalId?: string },
  icd10Code: string,
  description: string,
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  if (!/^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(icd10Code)) {
    return {
      ok: false, status: 'error', raw: '', demo: DEMO_MODE,
      error: { code: 'invalid_icd10', text: `'${icd10Code}' is not a valid ICD-10-CM code — DrFirst rejects free-text diagnoses` },
    };
  }
  const body = [
    '    <Patient>', patientIdXml(patient), '    </Patient>',
    '    <Problem>',
    `      <ICD10>${esc(icd10Code)}</ICD10>`,
    `      <Description>${esc(description)}</Description>`,
    '    </Problem>',
  ].join('\n');
  return rcopiaCommand('send_problem', body, rcopiaUserName);
}

export interface RcopiaSendMedication {
  externalId?: string;        // unique per practice; never reuse
  // Drug — MUM2: coded drugs need NDC / RxNorm SCD-SBD-GPCK-BPCK / FDB MedID /
  // RcopiaID. Free-text (uncoded) drugs REQUIRE schedule + supply + compound
  // flags. MUM4: coded drugs must also carry name, form, and strength.
  brandName?: string;         // at least one of brand/generic is mandatory
  genericName?: string;
  ndcId?: string;             // single NDC or comma list of up to 10 (MUR1)
  rxnormId?: string;          // SCD | SBD | GPCK | BPCK CUI
  fdbMedId?: string;
  form?: string;              // e.g. 'tablet' — mandatory with a drug code
  strength?: string;          // e.g. '50 mg' — mandatory with a drug code
  schedule?: '2' | '3' | '4' | '5' | 'scheduled' | 'nonscheduled' | 'unknown';
  isSupply?: boolean;
  isCompound?: boolean;
  // Sig — MUR2: discrete fields preferred; MUM5: no latin abbreviations
  action?: string;            // e.g. 'Take'
  dose?: string;              // e.g. '1'
  doseUnit?: string;          // e.g. 'tablet'
  route?: string;             // e.g. 'by mouth'
  doseTiming?: string;        // e.g. 'twice a day'
  asNeeded?: boolean;         // PRN — doseOther required when true
  doseOther?: string;         // e.g. 'for pain'
  patientNotes?: string;      // only sig content that doesn't map to discrete fields
  quantity?: string;
  quantityUnit?: string;
  refills?: string;           // '99' means PRN
  substitutionPermitted?: boolean;
  // Dates — inactive meds MUST carry a past StopDate or Rcopia shows them active
  startDate?: string;         // YYYY-MM-DD
  stopDate?: string;          // YYYY-MM-DD
  stopReason?: string;
  historySource?: string;     // e.g. 'patient', 'family' — reported-med provenance
  // Up to two associated ICD-10 diagnoses
  diagnoses?: { icd10: string; description: string }[];
  providerUsername?: string;  // Rcopia provider responsible for the medication
}

function usDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * send_medication (v2.50+ schema) — upload a medication for reconciliation.
 * Free-text (uncoded) entries — like reported outside meds from the chart's
 * Add Medication form — automatically carry the mandatory HasScheduledDrug /
 * Schedule / Supply / Compound flags, defaulting to a non-scheduled drug.
 */
export async function sendMedication(
  patient: { rcopiaId?: string; externalId?: string },
  med: RcopiaSendMedication,
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  if (!med.brandName && !med.genericName) {
    return {
      ok: false, status: 'error', raw: '', demo: DEMO_MODE,
      error: { code: 'missing_name', text: 'At least one of brandName or genericName is mandatory (MUM4)' },
    };
  }
  const isCoded = Boolean(med.ndcId || med.rxnormId || med.fdbMedId);
  const schedule = med.schedule || (isCoded ? undefined : 'nonscheduled');

  const drug = [
    '          <Drug>',
    med.ndcId ? `            <NDCID>${esc(med.ndcId)}</NDCID>` : '',
    !med.ndcId && med.fdbMedId ? `            <FirstDataBankMedID>${esc(med.fdbMedId)}</FirstDataBankMedID>` : '',
    !med.ndcId && !med.fdbMedId && med.rxnormId ? `            <RxnormID>${esc(med.rxnormId)}</RxnormID>` : '',
    med.brandName ? `            <BrandName>${esc(med.brandName)}</BrandName>` : '',
    med.genericName ? `            <GenericName>${esc(med.genericName)}</GenericName>` : '',
    med.form ? `            <Form>${esc(med.form)}</Form>` : '',
    med.strength ? `            <Strength>${esc(med.strength)}</Strength>` : '',
    schedule ? `            <Schedule>${schedule}</Schedule>` : '',
    !isCoded ? `            <Supply>${med.isSupply ? 'y' : 'n'}</Supply>` : '',
    !isCoded ? `            <Compound>${med.isCompound ? 'y' : 'n'}</Compound>` : '',
    '          </Drug>',
  ].filter(Boolean).join('\n');

  const hasInstruction = med.action || med.dose || med.doseUnit || med.route || med.doseTiming || med.asNeeded || med.doseOther;
  const dosage = (hasInstruction || med.patientNotes) ? [
    '          <Dosage>',
    hasInstruction ? [
      '            <InstructionList>',
      '              <Instruction>',
      '                <Sequence>1</Sequence>',
      med.action ? `                <Action>${esc(med.action)}</Action>` : '',
      med.dose ? `                <Dose>${esc(med.dose)}</Dose>` : '',
      med.doseUnit ? `                <DoseUnit>${esc(med.doseUnit)}</DoseUnit>` : '',
      med.route ? `                <Route>${esc(med.route)}</Route>` : '',
      med.doseTiming ? `                <DoseTiming>${esc(med.doseTiming)}</DoseTiming>` : '',
      med.asNeeded ? '                <AsNeeded>y</AsNeeded>' : '',
      med.doseOther ? `                <DoseOther>${esc(med.doseOther)}</DoseOther>` : '',
      '              </Instruction>',
      '            </InstructionList>',
    ].filter(Boolean).join('\n') : '',
    med.patientNotes ? `            <PatientNotes>${esc(med.patientNotes)}</PatientNotes>` : '',
    '          </Dosage>',
  ].filter(Boolean).join('\n') : '';

  const problems = (med.diagnoses || []).slice(0, 2).map((dx, i, arr) => [
    '          <Problem>',
    arr.length > 1 ? `            <Order>${i + 1}</Order>` : '',
    '            <ICD10>',
    `              <Code>${esc(dx.icd10)}</Code>`,
    `              <Description>${esc(dx.description)}</Description>`,
    '            </ICD10>',
    '          </Problem>',
  ].filter(Boolean).join('\n'));

  const body = [
    '    <MedicationList>',
    '      <Medication>',
    med.externalId ? `        <ExternalID>${esc(med.externalId)}</ExternalID>` : '',
    '        <Patient>',
    patientIdXml(patient).replace(/^ {6}/, '          '),
    '        </Patient>',
    med.providerUsername ? `        <Provider>\n          <Username>${esc(med.providerUsername)}</Username>\n        </Provider>` : '',
    !isCoded ? `        <HasScheduledDrug>${schedule && schedule !== 'nonscheduled' && schedule !== 'unknown' ? 'y' : 'n'}</HasScheduledDrug>` : '',
    med.historySource ? `        <HistorySource>${esc(med.historySource)}</HistorySource>` : '',
    '        <Sig>',
    drug,
    dosage,
    med.quantity ? `          <Quantity>${esc(med.quantity)}</Quantity>` : '',
    med.quantityUnit ? `          <QuantityUnit>${esc(med.quantityUnit)}</QuantityUnit>` : '',
    med.refills ? `          <Refills>${esc(med.refills)}</Refills>` : '',
    med.substitutionPermitted === false ? '          <SubstitutionPermitted>n</SubstitutionPermitted>' : '',
    '        </Sig>',
    med.startDate ? `        <StartDate>${usDate(med.startDate)}</StartDate>` : '',
    med.stopDate ? `        <StopDate>${usDate(med.stopDate)}</StopDate>` : '',
    med.stopDate && med.stopReason ? `        <StopReason>${esc(med.stopReason)}</StopReason>` : '',
    problems.length ? ['        <ProblemList>', ...problems, '        </ProblemList>'].join('\n') : '',
    '      </Medication>',
    '    </MedicationList>',
  ].filter(Boolean).join('\n');

  return rcopiaCommand('send_medication', body, rcopiaUserName);
}

// Severity descriptions → SNOMED-CT concept IDs (send_allergy spec table)
const SEVERITY_SNOMED: Record<string, string> = {
  'mild': '255604002',
  'mild to moderate': '371923003',
  'moderate': '6736007',
  'moderate to severe': '371924009',
  'severe': '24484000',
  'life threatening': '442452003',
  'fatal': '399166001',
  'unknown': '261665006',
};

/**
 * send_allergy — upload a patient allergy (v2.54 schema, verified against the
 * integration portal spec):
 * - AllergyList/Allergy wrapper; Patient by RcopiaID or ExternalID (M)
 * - Allergen requires Name; drug allergies must also carry a coded identifier
 *   (AUM2: NDC, RxNorm CUI, FDB MedID, or drug RcopiaID) — non-drug allergies
 *   (food etc.) are stored free-text
 * - ReactionList form (API ≥ 2.46); Severity maps to SNOMED CIDs
 * - externalId must be unique per practice and never reused
 */
export async function sendAllergy(
  patient: { rcopiaId?: string; externalId?: string },
  allergy: {
    externalId?: string;
    name: string;                 // allergen name — "NKDA" for no known drug allergies
    rxnormId?: string;            // RxNorm CUI (AUM2)
    ndcId?: string;               // single NDC or comma list of up to 10 (AUR1)
    fdbMedId?: string;            // FirstDataBank MedID (AUM2)
    reaction?: string;
    severity?: string;            // e.g. 'Mild' | 'Moderate' | 'Severe' | 'Life threatening'
    onsetDate?: string;           // YYYY-MM-DD
  },
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  const onsetUs = allergy.onsetDate
    ? (() => { const [y, m, d] = allergy.onsetDate!.split('-'); return `${m}/${d}/${y}`; })()
    : '';
  const severityCid = allergy.severity ? SEVERITY_SNOMED[allergy.severity.toLowerCase()] : undefined;
  const drugIds = [
    allergy.ndcId ? `          <NDCID>${esc(allergy.ndcId)}</NDCID>` : '',
    allergy.fdbMedId ? `          <FirstDataBankMedID>${esc(allergy.fdbMedId)}</FirstDataBankMedID>` : '',
  ].filter(Boolean);

  const body = [
    '    <AllergyList>',
    '      <Allergy>',
    allergy.externalId ? `        <ExternalID>${esc(allergy.externalId)}</ExternalID>` : '',
    '        <Patient>',
    patientIdXml(patient).replace(/^ {6}/, '          '),
    '        </Patient>',
    '        <Allergen>',
    `          <Name>${esc(allergy.name)}</Name>`,
    allergy.rxnormId ? `          <Ingredient>\n            <RxnormID>${esc(allergy.rxnormId)}</RxnormID>\n          </Ingredient>` : '',
    drugIds.length ? `          <Drug>\n  ${drugIds.join('\n  ')}\n          </Drug>` : '',
    '        </Allergen>',
    allergy.severity ? [
      '        <Severity>',
      `          <Description>${esc(allergy.severity)}</Description>`,
      severityCid ? `          <SNOMED-CTConceptID>${severityCid}</SNOMED-CTConceptID>` : '',
      '        </Severity>',
    ].filter(Boolean).join('\n') : '',
    allergy.reaction ? [
      '        <ReactionList>',
      '          <Reaction>',
      `            <Description>${esc(allergy.reaction)}</Description>`,
      '          </Reaction>',
      '        </ReactionList>',
    ].join('\n') : '',
    onsetUs ? `        <OnsetDate>${onsetUs}</OnsetDate>` : '',
    '      </Allergy>',
    '    </AllergyList>',
  ].filter(Boolean).join('\n');
  return rcopiaCommand('send_allergy', body, rcopiaUserName);
}

/** Convenience: mark a patient as having No Known Drug Allergies (reserved word). */
export async function sendNoKnownAllergies(
  patient: { rcopiaId?: string; externalId?: string },
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  return sendAllergy(patient, { name: 'NKDA' }, rcopiaUserName);
}

/**
 * Generic download poll — the pattern shared by all update_* APIs (confirmed
 * by the update_patient_office_visits request format):
 *   <Command>update_*</Command>
 *   <LastUpdateDate>   — cursor from the previous poll's response
 *   <MaximumLastUpdateDate> — optional upper bound
 *   <PatientList>      — optional patient-level filter
 * The response carries a new <LastUpdateDate> to persist for the next cycle.
 */
export async function pollDownload(
  command: RcopiaCommand,
  opts: {
    lastUpdateDate?: string;        // cursor exactly as returned by the prior poll
    maximumLastUpdateDate?: string;
    patients?: { rcopiaId?: string; externalId?: string }[];
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string }> {
  const patientList = (opts.patients || []).map(p => [
    '      <Patient>',
    patientIdXml(p).replace(/^ {6}/, '        '),
    '      </Patient>',
  ].join('\n'));
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    patientList.length ? ['    <PatientList>', ...patientList, '    </PatientList>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand(command, body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor };
}

export interface DownloadedAllergy {
  rcopiaId: string;
  externalId?: string;
  patientRcopiaId?: string;
  patientExternalId?: string;
  allergenName: string;
  ndcId?: string;
  rxnormId?: string;
  fdbMedId?: string;
  reactions: string[];
  severity?: string;
  onsetDate?: string;
  status?: string;
  deleted: boolean;
  lastModifiedDate?: string;
}

/**
 * update_allergy — download new/updated allergies. Unlike office visits, the
 * patient filter here is a SINGULAR <Patient> block (per the spec's request
 * format), with optional ReturnAllNDCIDs.
 */
export async function updateAllergies(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    patient?: { rcopiaId?: string; externalId?: string };
    returnAllNdcIds?: boolean;
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; allergies: DownloadedAllergy[] }> {
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    opts.returnAllNdcIds ? '    <ReturnAllNDCIDs>y</ReturnAllNDCIDs>' : '',
    opts.patient ? ['    <Patient>', patientIdXml(opts.patient).replace(/^ {6}/, '      '), '    </Patient>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('update_allergy', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, allergies: parseAllergyDownload(result.raw) };
}

/** Parse the update_allergy response into chart-ready allergy records. */
export function parseAllergyDownload(raw: string): DownloadedAllergy[] {
  const out: DownloadedAllergy[] = [];
  for (const block of raw.match(/<Allergy>[\s\S]*?<\/Allergy>/g) || []) {
    const g = (tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const patient = section('Patient');
    const allergen = section('Allergen');
    const drug = (allergen.match(/<Drug>[\s\S]*?<\/Drug>/) || [''])[0];
    const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const reactions = (block.match(/<Reaction>[\s\S]*?<\/Reaction>|<Reaction>[^<]*<\/Reaction>/g) || [])
      .map(r => inTag(r, 'Description') || r.replace(/<\/?Reaction>/g, '').trim())
      .filter(r => r && !r.startsWith('<'));
    out.push({
      rcopiaId: g('RcopiaID'),
      externalId: g('ExternalID') || undefined,
      patientRcopiaId: inTag(patient, 'RcopiaID') || undefined,
      patientExternalId: inTag(patient, 'ExternalID') || undefined,
      allergenName: inTag(allergen, 'Name'),
      ndcId: inTag(drug, 'NDCID') || undefined,
      rxnormId: inTag(drug, 'RxnormID') || undefined,
      fdbMedId: inTag(drug, 'FirstDataBankMedID') || undefined,
      reactions: [...new Set(reactions)],
      severity: inTag(section('Severity'), 'Description') || undefined,
      onsetDate: g('OnsetDate') || undefined,
      status: g('Status') || undefined,
      deleted: g('Deleted').toLowerCase() === 'y',
      lastModifiedDate: g('LastModifiedDate') || undefined,
    });
  }
  return out;
}

export interface DownloadedPrescription {
  rcopiaId: string;
  externalId?: string;
  patientRcopiaId?: string;
  patientExternalId?: string;
  providerName?: string;
  providerNpi?: string;
  providerDea?: string;
  supervisorName?: string;
  drugName: string;
  schedule?: string;
  sig?: string;
  quantity?: string;
  quantityUnit?: string;
  refills?: string;
  pharmacyName?: string;
  pharmacyNcpdpId?: string;
  diagnoses: { code: string; description: string }[];
  createdDate?: string;
  signedDate?: string;
  completedDate?: string;
  stopDate?: string;
  sendMethod?: string;
  status: 'pending' | 'needs_review' | 'signed' | 'completed' | 'voided' | 'denied' | 'deleted' | 'undeliverable';
}

/**
 * update_prescription — download prescriptions written/signed in Rcopia.
 * This is how scripts the provider signs inside Rcopia flow back into the
 * Altrixs chart. Request: cursor + singular Patient and/or a
 * PrescriptionList of specific scripts, plus optional Status filter.
 */
export async function updatePrescriptions(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    patient?: { rcopiaId?: string; externalId?: string };
    prescriptionRcopiaIds?: string[];
    returnAllNdcIds?: boolean;
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; prescriptions: DownloadedPrescription[] }> {
  const rxList = (opts.prescriptionRcopiaIds || []).map(id => [
    '      <Prescription>',
    `        <RcopiaID>${esc(id)}</RcopiaID>`,
    '      </Prescription>',
  ].join('\n'));
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    opts.returnAllNdcIds ? '    <ReturnAllNDCIDs>y</ReturnAllNDCIDs>' : '',
    opts.patient ? ['    <Patient>', patientIdXml(opts.patient).replace(/^ {6}/, '      '), '    </Patient>'].join('\n') : '',
    rxList.length ? ['    <PrescriptionList>', ...rxList, '    </PrescriptionList>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('update_prescription', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, prescriptions: parsePrescriptionDownload(result.raw) };
}

/** Parse the update_prescription response into chart-ready records. */
export function parsePrescriptionDownload(raw: string): DownloadedPrescription[] {
  const out: DownloadedPrescription[] = [];
  for (const block of raw.match(/<Prescription>[\s\S]*?<\/Prescription>/g) || []) {
    const g = (tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    // The PrescriptionList request filter also uses <Prescription> blocks that
    // contain only an ID — skip anything without a drug section.
    const drug = section('Drug');
    if (!drug) continue;
    const provider = section('Provider');
    const pharmacy = section('Pharmacy');
    const supervisor = section('Supervisor');
    const yes = (tag: string) => g(tag).toLowerCase() === 'y';
    const status: DownloadedPrescription['status'] =
      yes('Deleted') ? 'deleted'
      : yes('Voided') ? 'voided'
      : yes('Denied') ? 'denied'
      : g('UndeliverableDate') ? 'undeliverable'
      : g('CompletedDate') ? 'completed'
      : g('SignedDate') ? 'signed'
      : yes('NeedsReview') ? 'needs_review'
      : 'pending';
    const diagnoses = (section('ProblemList').match(/<(?:ICD9|ICD10)>[\s\S]*?<\/(?:ICD9|ICD10)>/g) || [])
      .map(p => ({ code: inTag(p, 'Code'), description: inTag(p, 'Description') }))
      .filter(d => d.code);
    out.push({
      rcopiaId: g('RcopiaID'),
      externalId: g('ExternalID') || undefined,
      patientRcopiaId: inTag(section('Patient'), 'RcopiaID') || undefined,
      patientExternalId: inTag(section('Patient'), 'ExternalID') || undefined,
      providerName: [inTag(provider, 'FirstName'), inTag(provider, 'LastName')].filter(Boolean).join(' ') || undefined,
      providerNpi: inTag(provider, 'NPI') || undefined,
      providerDea: inTag(provider, 'DEA') || undefined,
      supervisorName: [inTag(supervisor, 'FirstName'), inTag(supervisor, 'LastName')].filter(Boolean).join(' ') || undefined,
      drugName: [inTag(drug, 'BrandName') || inTag(drug, 'GenericName'), inTag(drug, 'Strength')].filter(Boolean).join(' '),
      schedule: inTag(drug, 'Schedule') || undefined,
      sig: inTag(section('Dosage'), 'DosageText') || inTag(section('Dosage'), 'PatientNotes') || undefined,
      quantity: inTag(section('Sig'), 'Quantity') || undefined,
      quantityUnit: inTag(section('Sig'), 'QuantityUnit') || undefined,
      refills: inTag(section('Sig'), 'Refills') || undefined,
      pharmacyName: inTag(pharmacy, 'Name') || undefined,
      pharmacyNcpdpId: inTag(pharmacy, 'NCPDPID') || undefined,
      diagnoses,
      createdDate: g('CreatedDate') || undefined,
      signedDate: g('SignedDate') || undefined,
      completedDate: g('CompletedDate') || undefined,
      stopDate: g('StopDate') || undefined,
      sendMethod: g('SendMethod') || undefined,
      status,
    });
  }
  return out;
}

export interface PrescriptionEvent {
  rcopiaId: string;
  externalId?: string;
  prescriberOrderNumber?: string;
  status?: string;
  needsSigningBy?: { username?: string; npi?: string };
  error?: string;
  sendMethod?: string;
  sendDate?: string;
  transmissionEvents: { code: string; date: string }[];
  cancellation?: {
    dateRequested?: string;
    reason?: string;
    status?: string;
    responseStatus?: string;
    responseNotes?: string;
    fillsCancelled?: string;
  };
  rxChange?: { status?: string; originalRcopiaId?: string; changedRcopiaId?: string };
  pdmpReports: { code: string; message?: string; reportDateTime?: string; error?: string }[];
}

/**
 * update_prescription_events — transmission + lifecycle telemetry for scripts:
 * failed transmissions (Error/SendMethod/TransmissionHistory), pending
 * signatures (NeedsSigning with the provider who must sign), pharmacy
 * cancellation round-trips, RxChange linkage, and PDMP report statuses —
 * the audit evidence for Maryland's mandatory PDMP review.
 */
export async function updatePrescriptionEvents(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    prescriptions?: { rcopiaId?: string; externalId?: string; prescriberOrderNumber?: string }[];
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; events: PrescriptionEvent[] }> {
  const rxList = (opts.prescriptions || []).map(p => [
    '      <Prescription>',
    p.rcopiaId ? `        <RcopiaID>${esc(p.rcopiaId)}</RcopiaID>` : '',
    p.externalId ? `        <ExternalID>${esc(p.externalId)}</ExternalID>` : '',
    p.prescriberOrderNumber ? `        <PrescriberOrderNumber>${esc(p.prescriberOrderNumber)}</PrescriberOrderNumber>` : '',
    '      </Prescription>',
  ].filter(Boolean).join('\n'));
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    rxList.length ? ['    <PrescriptionList>', ...rxList, '    </PrescriptionList>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('update_prescription_events', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, events: parsePrescriptionEvents(result.raw) };
}

/** Parse the update_prescription_events response. */
export function parsePrescriptionEvents(raw: string): PrescriptionEvent[] {
  const out: PrescriptionEvent[] = [];
  for (const block of raw.match(/<Prescription>[\s\S]*?<\/Prescription>/g) || []) {
    const g = (tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    if (!g('RcopiaID') && !g('ExternalID')) continue;
    const needsSigning = section('NeedsSigning');
    const cancel = section('Cancellation');
    const cancelResponse = (cancel.match(/<CancelResponse>[\s\S]*?<\/CancelResponse>/) || [''])[0];
    const rxChange = section('RxChange');
    const transmissionEvents = (section('TransmissionHistory').match(/<TransmissionEvent>[\s\S]*?<\/TransmissionEvent>/g) || [])
      .map(e => ({ code: inTag(e, 'EventCode'), date: inTag(e, 'EventDate') }))
      .filter(e => e.code);
    const pdmpReports = (section('PDMPReportStatusList').match(/<PDMPReportStatus>[\s\S]*?<\/PDMPReportStatus>/g) || [])
      .map(r => ({
        code: inTag(r, 'Code'),
        message: inTag(r, 'Message') || undefined,
        reportDateTime: inTag(r, 'ReportDateTime') || undefined,
        error: inTag(r, 'Error') || undefined,
      }))
      .filter(r => r.code || r.message || r.error);
    out.push({
      rcopiaId: g('RcopiaID'),
      externalId: g('ExternalID') || undefined,
      prescriberOrderNumber: g('PrescriberOrderNumber') || undefined,
      status: g('Status') || undefined,
      needsSigningBy: needsSigning ? {
        username: inTag(needsSigning, 'Username') || undefined,
        npi: inTag(needsSigning, 'NPI') || undefined,
      } : undefined,
      error: g('Error') || undefined,
      sendMethod: g('SendMethod') || undefined,
      sendDate: g('SendDate') || undefined,
      transmissionEvents,
      cancellation: cancel ? {
        dateRequested: inTag(cancel, 'DateRequested') || undefined,
        reason: inTag(cancel, 'CancelReason') || undefined,
        status: inTag(cancel, 'Status') || undefined,
        responseStatus: inTag(cancelResponse, 'Status') || undefined,
        responseNotes: inTag(cancelResponse, 'Notes') || undefined,
        fillsCancelled: inTag(cancelResponse, 'FillsCancelled') || undefined,
      } : undefined,
      rxChange: rxChange ? {
        status: inTag(rxChange, 'Status') || undefined,
        originalRcopiaId: inTag((rxChange.match(/<OriginalPrescription>[\s\S]*?<\/OriginalPrescription>/) || [''])[0], 'RcopiaID') || undefined,
        changedRcopiaId: inTag((rxChange.match(/<ChangedPrescription>[\s\S]*?<\/ChangedPrescription>/) || [''])[0], 'RcopiaID') || undefined,
      } : undefined,
      pdmpReports,
    });
  }
  return out;
}

export interface DownloadedNotification {
  rcopiaId: string;
  type?: string;                    // e.g. renewal request
  status?: string;
  prescriberOrderNumber?: string;
  rxReferenceNumber?: string;
  followUpNumber?: string;          // >0 = pharmacy has re-asked
  originalRequestDate?: string;
  currentRequestDate?: string;
  providerName?: string;
  providerUsername?: string;
  patientRcopiaId?: string;
  patientExternalId?: string;
  patientName?: string;
  pharmacyName?: string;
  pharmacyPhone?: string;
  pharmacyNcpdpId?: string;
  drugPrescribed?: string;          // from <Sig> — what the provider wrote
  drugDispensed?: string;           // from <SigDispensed> — what the pharmacy filled
  quantity?: string;
  refills?: string;
  actionTaken?: string;
  finalActionDate?: string;
}

/**
 * update_notification — pharmacy-initiated renewal requests and related
 * notifications. Response carries BOTH the prescribed sig and the dispensed
 * sig (<SigDispensed>) so the provider can compare what was written against
 * what the pharmacy actually filled before approving a renewal.
 */
export async function updateNotifications(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    provider?: { rcopiaId?: string; username?: string; externalId?: string };
    patient?: { rcopiaId?: string; externalId?: string };
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; notifications: DownloadedNotification[] }> {
  const prov = opts.provider;
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    prov ? [
      '    <Provider>',
      prov.rcopiaId ? `      <RcopiaID>${esc(prov.rcopiaId)}</RcopiaID>` : '',
      prov.username ? `      <Username>${esc(prov.username)}</Username>` : '',
      prov.externalId ? `      <ExternalID>${esc(prov.externalId)}</ExternalID>` : '',
      '    </Provider>',
    ].filter(Boolean).join('\n') : '',
    opts.patient ? ['    <Patient>', patientIdXml(opts.patient).replace(/^ {6}/, '      '), '    </Patient>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('update_notification', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, notifications: parseNotificationDownload(result.raw) };
}

/** Parse the update_notification response into renewal-queue records. */
export function parseNotificationDownload(raw: string): DownloadedNotification[] {
  const out: DownloadedNotification[] = [];
  for (const block of raw.match(/<Notification>[\s\S]*?<\/Notification>/g) || []) {
    const g = (tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const drugOf = (sigBlock: string) => {
      const drug = (sigBlock.match(/<Drug>[\s\S]*?<\/Drug>/) || [''])[0];
      return [inTag(drug, 'BrandName') || inTag(drug, 'GenericName'), inTag(drug, 'Strength')].filter(Boolean).join(' ') || undefined;
    };
    const creation = section('CreationDate');
    const provider = section('Provider');
    const pharmacy = section('Pharmacy');
    const patient = section('Patient');
    const sig = section('Sig');
    const sigDispensed = section('SigDispensed');
    out.push({
      rcopiaId: g('RcopiaID'),
      type: g('Type') || undefined,
      status: g('Status') || undefined,
      prescriberOrderNumber: g('PrescriberOrderNumber') || undefined,
      rxReferenceNumber: g('RxReferenceNumber') || undefined,
      followUpNumber: inTag(creation, 'FollowUpNumber') || undefined,
      originalRequestDate: inTag(creation, 'OriginalRequestDate') || undefined,
      currentRequestDate: inTag(creation, 'CurrentRequestDate') || undefined,
      providerName: [inTag(provider, 'FirstName'), inTag(provider, 'LastName')].filter(Boolean).join(' ') || undefined,
      providerUsername: inTag(provider, 'Username') || undefined,
      patientRcopiaId: inTag(patient, 'RcopiaID') || undefined,
      patientExternalId: inTag(patient, 'ExternalID') || undefined,
      patientName: [inTag(patient, 'FirstName'), inTag(patient, 'LastName')].filter(Boolean).join(' ') || undefined,
      pharmacyName: inTag(pharmacy, 'Name') || undefined,
      pharmacyPhone: inTag(pharmacy, 'Phone') || undefined,
      pharmacyNcpdpId: inTag(pharmacy, 'NCPDPID') || undefined,
      drugPrescribed: drugOf(sig),
      drugDispensed: drugOf(sigDispensed),
      quantity: inTag(sig, 'Quantity') || undefined,
      refills: inTag(sig, 'Refills') || undefined,
      actionTaken: g('ActionTaken') || undefined,
      finalActionDate: g('FinalActionDate') || undefined,
    });
  }
  return out;
}

export interface RxChangeRequest {
  notificationId: string;
  status?: string;
  rxReferenceNumber?: string;
  requestType?: string;             // e.g. generic substitution, prior auth
  changeReason?: string;
  subTypes: { code: string; description: string }[];
  originalRequestDate?: string;
  lastActionDate?: string;
  responseCode?: string;
  responseNote?: string;
  originalPrescriptionRcopiaId?: string;
  changedPrescriptionRcopiaId?: string;
  patientRcopiaId?: string;
  patientExternalId?: string;
  patientName?: string;
  providerName?: string;
  providerUsername?: string;
  pharmacyName?: string;
  pharmacyPhone?: string;
  priorAuthConfirmation?: string;
  medicationOrdered?: { drug: string; quantity?: string; refills?: string; remainingRefills?: string };
  medicationsRequested: { drug: string; quantity?: string; refills?: string }[];
}

/**
 * update_rxchange — pharmacy-initiated change requests: the pharmacy proposes
 * one or more alternatives (MedicationRequestedList) to what was ordered
 * (MedicationOrdered), with a RequestType/ChangeReason such as generic
 * substitution or prior authorization required. The provider approves or
 * denies in Rcopia; this download keeps the Altrixs chart in sync.
 */
export async function updateRxChanges(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    provider?: { rcopiaId?: string; username?: string; externalId?: string };
    patient?: { rcopiaId?: string; externalId?: string };
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; rxChanges: RxChangeRequest[] }> {
  const prov = opts.provider;
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    prov ? [
      '    <Provider>',
      prov.rcopiaId ? `      <RcopiaID>${esc(prov.rcopiaId)}</RcopiaID>` : '',
      prov.username ? `      <Username>${esc(prov.username)}</Username>` : '',
      prov.externalId ? `      <ExternalID>${esc(prov.externalId)}</ExternalID>` : '',
      '    </Provider>',
    ].filter(Boolean).join('\n') : '',
    opts.patient ? ['    <Patient>', patientIdXml(opts.patient).replace(/^ {6}/, '      '), '    </Patient>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('update_rxchange', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, rxChanges: parseRxChangeDownload(result.raw) };
}

/** Parse the update_rxchange response. */
export function parseRxChangeDownload(raw: string): RxChangeRequest[] {
  const out: RxChangeRequest[] = [];
  for (const block of raw.match(/<RxChange>[\s\S]*?<\/RxChange>/g) || []) {
    const g = (tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const drugOf = (src: string) => {
      const drug = (src.match(/<Drug>[\s\S]*?<\/Drug>/) || [''])[0];
      return [inTag(drug, 'BrandName') || inTag(drug, 'GenericName'), inTag(drug, 'Strength')].filter(Boolean).join(' ');
    };
    if (!g('NotificationID')) continue;
    const patient = section('Patient');
    const provider = section('Provider');
    const pharmacy = section('Pharmacy');
    const ordered = section('MedicationOrdered');
    const requested = (section('MedicationRequestedList').match(/<MedicationRequested>[\s\S]*?<\/MedicationRequested>/g) || [])
      .map(m => ({
        drug: drugOf(m),
        quantity: inTag(m, 'Quantity') || undefined,
        refills: inTag(m, 'Refills') || undefined,
      }))
      .filter(m => m.drug);
    const subTypes = (section('RequestSubTypeList').match(/<RequestSubType>[\s\S]*?<\/RequestSubType>/g) || [])
      .map(st => ({ code: inTag(st, 'RequestSubTypeCode'), description: inTag(st, 'RequestSubTypeDescription') }))
      .filter(st => st.code || st.description);
    out.push({
      notificationId: g('NotificationID'),
      status: g('Status') || undefined,
      rxReferenceNumber: g('RxReferenceNumber') || undefined,
      requestType: g('RequestType') || undefined,
      changeReason: g('ChangeReason') || undefined,
      subTypes,
      originalRequestDate: g('OriginalRequestDate') || undefined,
      lastActionDate: g('LastActionDate') || undefined,
      responseCode: g('ResponseCode') || undefined,
      responseNote: g('ResponseNote') || undefined,
      originalPrescriptionRcopiaId: inTag(section('OriginalPrescription'), 'RcopiaID') || undefined,
      changedPrescriptionRcopiaId: inTag(section('ChangedPrescription'), 'RcopiaID') || undefined,
      patientRcopiaId: inTag(patient, 'RcopiaID') || undefined,
      patientExternalId: inTag(patient, 'ExternalID') || undefined,
      patientName: [inTag(patient, 'FirstName'), inTag(patient, 'LastName')].filter(Boolean).join(' ') || undefined,
      providerName: [inTag(provider, 'FirstName'), inTag(provider, 'LastName')].filter(Boolean).join(' ') || undefined,
      providerUsername: inTag(provider, 'Username') || undefined,
      pharmacyName: inTag(pharmacy, 'Name') || undefined,
      pharmacyPhone: inTag(pharmacy, 'Phone') || undefined,
      priorAuthConfirmation: g('PriorAuthConfirmation') || undefined,
      medicationOrdered: ordered ? {
        drug: drugOf(ordered),
        quantity: inTag(ordered, 'Quantity') || undefined,
        refills: inTag(ordered, 'Refills') || undefined,
        remainingRefills: inTag(ordered, 'RemainingRefills') || undefined,
      } : undefined,
      medicationsRequested: requested,
    });
  }
  return out;
}

export interface PharmacyFillEvent {
  notificationId: string;
  fillDate?: string;
  fillStatus: 'dispensed' | 'partially_dispensed' | 'not_dispensed' | 'transferred' | 'unknown';
  reasonCode?: string;
  reasonDescription?: string;
  fillNote?: string;
  prescriptionRcopiaId?: string;
  prescriberOrderNumber?: string;
  patientRcopiaId?: string;
  patientExternalId?: string;
  patientName?: string;
  providerName?: string;
  providerUsername?: string;
  pharmacyName?: string;
  drugPrescribed?: string;
  drugDispensed?: string;
}

/**
 * update_rxfill — pharmacy fill events. The medication-adherence signal:
 * dispensed / partially dispensed / NOT dispensed / transferred, each with a
 * reason. "Not dispensed" on a psychotropic is an outreach trigger for the
 * care team (never picked up, insurance rejected, out of stock, etc.).
 */
export async function updateRxFills(
  opts: { lastUpdateDate?: string; maximumLastUpdateDate?: string } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; fills: PharmacyFillEvent[] }> {
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('update_rxfill', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, fills: parseRxFillDownload(result.raw) };
}

/** Parse the update_rxfill response into adherence events. */
export function parseRxFillDownload(raw: string): PharmacyFillEvent[] {
  const out: PharmacyFillEvent[] = [];
  const STATUS_TAGS: [string, PharmacyFillEvent['fillStatus']][] = [
    ['Dispensed', 'dispensed'],
    ['PartiallyDispensed', 'partially_dispensed'],
    ['NotDispensed', 'not_dispensed'],
    ['Transferred', 'transferred'],
  ];
  for (const block of raw.match(/<PharmacyFillEvent>[\s\S]*?<\/PharmacyFillEvent>/g) || []) {
    const g = (tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
    const drugOf = (src: string) => {
      const drug = (src.match(/<Drug>[\s\S]*?<\/Drug>/) || [''])[0];
      return [inTag(drug, 'BrandName') || inTag(drug, 'GenericName'), inTag(drug, 'Strength')].filter(Boolean).join(' ') || undefined;
    };
    const fillStatusBlock = section('FillStatus');
    let fillStatus: PharmacyFillEvent['fillStatus'] = 'unknown';
    let reasonCode: string | undefined;
    let reasonDescription: string | undefined;
    let fillNote: string | undefined;
    for (const [tag, status] of STATUS_TAGS) {
      const sub = (fillStatusBlock.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [])[0];
      if (sub) {
        fillStatus = status;
        reasonCode = inTag(sub, 'ReasonCode') || undefined;
        reasonDescription = inTag(sub, 'ReasonCodeDescription') || undefined;
        fillNote = inTag(sub, 'FillNote') || undefined;
        break;
      }
    }
    const patient = section('Patient');
    const provider = section('Provider');
    out.push({
      notificationId: g('NotificationID'),
      fillDate: g('FillDate') || undefined,
      fillStatus,
      reasonCode,
      reasonDescription,
      fillNote,
      prescriptionRcopiaId: inTag(section('OriginalPrescription'), 'RcopiaID') || undefined,
      prescriberOrderNumber: inTag(section('OriginalPrescription'), 'PrescriberOrderNumber') || undefined,
      patientRcopiaId: inTag(patient, 'RcopiaID') || undefined,
      patientExternalId: inTag(patient, 'ExternalID') || undefined,
      patientName: [inTag(patient, 'FirstName'), inTag(patient, 'LastName')].filter(Boolean).join(' ') || undefined,
      providerName: [inTag(provider, 'FirstName'), inTag(provider, 'LastName')].filter(Boolean).join(' ') || undefined,
      providerUsername: inTag(provider, 'Username') || undefined,
      pharmacyName: inTag(section('Pharmacy'), 'Name') || undefined,
      drugPrescribed: drugOf(section('Sig')),
      drugDispensed: drugOf(section('SigDispensed')),
    });
  }
  return out;
}

interface ReviewRecord {
  reviewDate: string;
  reviewerName?: string;
  reviewerUsername?: string;
  reviewerNpi?: string;
}

export interface PatientReviewStatus {
  patientRcopiaId?: string;
  patientExternalId?: string;
  patientName?: string;
  medication: { complete?: boolean; hasRecords?: boolean; reviews: ReviewRecord[] };
  allergy: { known?: boolean; hasRecords?: boolean; reviews: ReviewRecord[] };
  problem: { hasRecords?: boolean; reviews: ReviewRecord[] };
}

/**
 * get_review_status — per-patient attestation that the medication, allergy,
 * and problem lists were reviewed in Rcopia: completeness flags plus the
 * review trail (who reviewed, when). This is the med-reconciliation evidence
 * for chart audits and Meaningful Use reporting.
 */
export async function getReviewStatus(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    patients?: { rcopiaId?: string; externalId?: string }[];
    maximumReviews?: number;
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; statuses: PatientReviewStatus[] }> {
  const patientList = (opts.patients || []).map(p => [
    '      <Patient>',
    patientIdXml(p).replace(/^ {6}/, '        '),
    '      </Patient>',
  ].join('\n'));
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    patientList.length ? ['    <PatientList>', ...patientList, '    </PatientList>'].join('\n') : '',
    opts.maximumReviews ? `    <MaximumReviews>${opts.maximumReviews}</MaximumReviews>` : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('get_review_status', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, statuses: parseReviewStatus(result.raw) };
}

/** Parse the get_review_status response. */
export function parseReviewStatus(raw: string): PatientReviewStatus[] {
  const out: PatientReviewStatus[] = [];
  const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
  const yn = (v: string) => v ? v.toLowerCase() === 'y' : undefined;
  const reviewsOf = (src: string): ReviewRecord[] => {
    const matches: string[] = src.match(/<Review>[\s\S]*?<\/Review>/g) || [];
    return matches
      .filter((r: string) => !r.startsWith('<ReviewList'))
      .map((r: string) => {
        const reviewer = (r.match(/<Reviewer>[\s\S]*?<\/Reviewer>/) || [''])[0];
        return {
          reviewDate: inTag(r, 'ReviewDate'),
          reviewerName: [inTag(reviewer, 'FirstName'), inTag(reviewer, 'LastName')].filter(Boolean).join(' ') || undefined,
          reviewerUsername: inTag(reviewer, 'Username') || undefined,
          reviewerNpi: inTag(reviewer, 'NPI') || undefined,
        };
      })
      .filter(r => r.reviewDate);
  };
  for (const block of raw.match(/<PatientReviewStatus>[\s\S]*?<\/PatientReviewStatus>/g) || []) {
    const section = (tag: string) => (block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)) || [''])[0];
    const patient = section('Patient');
    const med = section('MedicationReviewStatus');
    const alg = section('AllergyReviewStatus');
    const prob = section('ProblemReviewStatus');
    out.push({
      patientRcopiaId: inTag(patient, 'RcopiaID') || undefined,
      patientExternalId: inTag(patient, 'ExternalID') || undefined,
      patientName: [inTag(patient, 'FirstName'), inTag(patient, 'LastName')].filter(Boolean).join(' ') || undefined,
      medication: { complete: yn(inTag(med, 'Complete')), hasRecords: yn(inTag(med, 'HasRecords')), reviews: reviewsOf(med) },
      allergy: { known: yn(inTag(alg, 'Known')), hasRecords: yn(inTag(alg, 'HasRecords')), reviews: reviewsOf(alg) },
      problem: { hasRecords: yn(inTag(prob, 'HasRecords')), reviews: reviewsOf(prob) },
    });
  }
  return out;
}

export interface PdmpReviewEvent {
  reviewDate: string;
  patientRcopiaId?: string;
  patientExternalId?: string;
  patientName?: string;
  reviewerName?: string;
  reviewerUsername?: string;
  reviewerNpi?: string;
  reviewerLocationExternalId?: string;
}

/**
 * get_pdmp_events — the PDMP consultation audit trail: which reviewer checked
 * the PDMP for which patient, and when. Maryland mandates prescriber PDMP
 * review before controlled-substance prescribing; these events are the
 * documented evidence for chart audits and board inquiries.
 */
export async function getPdmpEvents(
  opts: {
    lastUpdateDate?: string;
    maximumLastUpdateDate?: string;
    patient?: { rcopiaId?: string; externalId?: string };
  } = {},
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean; nextCursor?: string; events: PdmpReviewEvent[] }> {
  const body = [
    opts.lastUpdateDate ? `    <LastUpdateDate>${esc(opts.lastUpdateDate)}</LastUpdateDate>` : '',
    opts.maximumLastUpdateDate ? `    <MaximumLastUpdateDate>${esc(opts.maximumLastUpdateDate)}</MaximumLastUpdateDate>` : '',
    opts.patient ? ['    <Patient>', patientIdXml(opts.patient).replace(/^ {6}/, '      '), '    </Patient>'].join('\n') : '',
  ].filter(Boolean).join('\n');
  const result = await rcopiaCommand('get_pdmp_events', body, rcopiaUserName);
  const nextCursor = (result.raw.match(/<LastUpdateDate>([^<]*)<\/LastUpdateDate>/) || [])[1] || undefined;
  return { ...result, nextCursor, events: parsePdmpEvents(result.raw) };
}

/** Parse the get_pdmp_events response. */
export function parsePdmpEvents(raw: string): PdmpReviewEvent[] {
  const out: PdmpReviewEvent[] = [];
  const inTag = (src: string, tag: string) => (src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || '';
  for (const block of raw.match(/<PdmpReviewEvent>[\s\S]*?<\/PdmpReviewEvent>/g) || []) {
    const patient = (block.match(/<Patient>[\s\S]*?<\/Patient>/) || [''])[0];
    const reviewer = (block.match(/<Reviewer>[\s\S]*?<\/Reviewer>/) || [''])[0];
    const location = (block.match(/<ReviewerLocation>[\s\S]*?<\/ReviewerLocation>/) || [''])[0];
    out.push({
      reviewDate: inTag(block, 'ReviewDate'),
      patientRcopiaId: inTag(patient, 'RcopiaID') || undefined,
      patientExternalId: inTag(patient, 'ExternalID') || undefined,
      patientName: [inTag(patient, 'FirstName'), inTag(patient, 'LastName')].filter(Boolean).join(' ') || undefined,
      reviewerName: [inTag(reviewer, 'FirstName'), inTag(reviewer, 'LastName')].filter(Boolean).join(' ') || undefined,
      reviewerUsername: inTag(reviewer, 'Username') || undefined,
      reviewerNpi: inTag(reviewer, 'NPI') || undefined,
      reviewerLocationExternalId: inTag(location, 'ExternalID') || undefined,
    });
  }
  return out;
}

/** update_patient_office_visits — download visit records (per-patient or practice-wide). */
export async function updateOfficeVisits(
  opts: { lastUpdateDate?: string; patients?: { rcopiaId?: string; externalId?: string }[] } = {},
  rcopiaUserName?: string,
) {
  return pollDownload('update_patient_office_visits', opts, rcopiaUserName);
}

/** search_drug_detail — drug lookup by brand/generic name prefix. */
export async function searchDrugDetail(
  query: string,
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  return rcopiaCommand('search_drug_detail', `    <SearchString>${esc(query)}</SearchString>`, rcopiaUserName);
}

// ─── send_prescription scope note ────────────────────────────────────────────
// Per the v2.54 spec's certification requirements, send_prescription is for
// the ACUTE (HIS) space only — hospital discharge prescriptions. MD Behavioral
// Health is ambulatory, so prescription CREATION stays inside Rcopia (SSO
// launch; provider signs there) and update_prescription syncs scripts back.
// The one certified ambulatory use is deleting a pending prescription when
// the deletion is initiated from the partner system — implemented below.

/**
 * send_patient_office_visits — document an office visit / transition of care.
 * Not linked to clinical records by DrFirst; used for documentation and
 * Meaningful Use tracking (rendering provider required for MU attribution).
 * Altrixs can trigger this when an appointment is completed.
 */
export async function sendOfficeVisit(
  patient: { rcopiaId?: string; externalId?: string },
  visit: {
    externalId?: string;            // visit ID from Altrixs — required to update/delete later
    visitDate: string;              // YYYY-MM-DD (mandatory)
    transitionOfCareDate?: string;  // YYYY-MM-DD
    renderingProviderUsername?: string;   // Rcopia username
    renderingProviderExternalId?: string; // or partner external ID
    deleted?: boolean;
  },
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  const us = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
  const provider = visit.renderingProviderUsername || visit.renderingProviderExternalId ? [
    '        <RenderingProvider>',
    visit.renderingProviderUsername ? `          <Username>${esc(visit.renderingProviderUsername)}</Username>` : '',
    !visit.renderingProviderUsername && visit.renderingProviderExternalId ? `          <ExternalID>${esc(visit.renderingProviderExternalId)}</ExternalID>` : '',
    '        </RenderingProvider>',
  ].filter(Boolean).join('\n') : '';
  const body = [
    '    <OfficeVisitList>',
    '      <OfficeVisit>',
    visit.deleted ? '        <Deleted>y</Deleted>' : '',
    visit.externalId ? `        <ExternalID>${esc(visit.externalId)}</ExternalID>` : '',
    '        <Patient>',
    patientIdXml(patient).replace(/^ {6}/, '          '),
    '        </Patient>',
    visit.transitionOfCareDate ? `        <TransitionOfCareDate>${us(visit.transitionOfCareDate)}</TransitionOfCareDate>` : '',
    `        <OfficeVisitDate>${us(visit.visitDate)}</OfficeVisitDate>`,
    provider,
    '      </OfficeVisit>',
    '    </OfficeVisitList>',
  ].filter(Boolean).join('\n');
  return rcopiaCommand('send_patient_office_visits', body, rcopiaUserName);
}

export const sendPatientOfficeVisits = sendOfficeVisit;

/**
 * Delete a pending prescription in Rcopia (the only send_prescription
 * workflow certified outside the hospital space). Requires the prescription's
 * RcopiaID (numeric portion only) and sets IsDischargePrescription='y' +
 * Deleted='y' exactly as the spec prescribes for non-discharge deletions.
 */
export async function deletePendingPrescription(
  patient: { rcopiaId?: string; externalId?: string },
  prescriptionRcopiaId: string,
  rcopiaUserName?: string,
): Promise<RcopiaCallResult & { demo: boolean }> {
  if (!/^\d+$/.test(prescriptionRcopiaId)) {
    return {
      ok: false, status: 'error', raw: '', demo: DEMO_MODE,
      error: { code: 'invalid_rcopia_id', text: 'Prescription RcopiaID must be the numeric portion only' },
    };
  }
  const body = [
    '    <PrescriptionList>',
    '      <Prescription>',
    "        <Deleted>y</Deleted>",
    `        <RcopiaID>${prescriptionRcopiaId}</RcopiaID>`,
    '        <IsDischargePrescription>y</IsDischargePrescription>',
    '        <Patient>',
    patientIdXml(patient).replace(/^ {6}/, '          '),
    '        </Patient>',
    '      </Prescription>',
    '    </PrescriptionList>',
  ].join('\n');
  return rcopiaCommand('send_prescription', body, rcopiaUserName);
}
