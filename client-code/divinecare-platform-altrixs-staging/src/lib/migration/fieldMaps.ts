/** Canonical client fields we map CSV/JSON columns onto */
export type CanonicalClientField =
  | 'sourceId'
  | 'mrn'
  | 'firstName'
  | 'middleInitial'
  | 'lastName'
  | 'preferredName'
  | 'nameSuffix'
  | 'name'
  | 'email'
  | 'phone'
  | 'dateOfBirth'
  | 'gender'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'insurancePayer'
  | 'insuranceMemberId'
  | 'insuranceGroupNumber'
  | 'primaryDiagnosis'
  | 'primaryDiagnosisCode'
  | 'phoneSecondary'
  | 'insuranceType'
  | 'insuranceCoverageType'
  | 'insurancePayerPhone'
  | 'insuranceEffectiveFrom'
  | 'insuranceEffectiveTo'
  | 'copayAmount'
  | 'coverageNote'
  | 'insuranceInactive'
  | 'assignedProviders'
  | 'inactive'
  | 'location'
  /** Valant assigned facility as exported (Client.valantFacility) */
  | 'valantFacility'
  // Standard demographics (src/lib/clients/demographics.ts). Text values are mapped to codes by
  // exact label / synonym only; anything else is reported as unmapped, never guessed.
  | 'legalMiddleName'
  | 'administrativeSex'
  | 'sexAtBirth'
  | 'genderIdentity'
  | 'sexualOrientation'
  | 'pronouns'
  | 'race'
  | 'ethnicity'
  | 'preferredLanguage'
  | 'interpreterNeeded'
  | 'maritalStatus'
  | 'county'
  | 'phoneMobile'
  | 'phoneHome'
  | 'phoneWork'
  | 'emergencyContactRelationship'
  | 'guardianName'
  | 'guardianRelationship'
  | 'guardianPhone'
  | 'guarantorFirstName'
  | 'guarantorLastName'
  | 'guarantorRelationship'
  | 'guarantorDateOfBirth'
  | 'guarantorPhone'
  | 'guarantorAddressLine1'
  | 'guarantorAddressLine2'
  | 'guarantorCity'
  | 'guarantorState'
  | 'guarantorPostalCode'
  | 'medicaidId'
  | 'deceasedAt';

export type FieldAliasMap = Partial<Record<CanonicalClientField, string[]>>;

export type PlatformId =
  | 'valant'
  | 'athena'
  | 'icannotes'
  | 'simplepractice'
  | 'therapynotes'
  | 'netsmart'
  | 'kipu'
  | 'kareo'
  | 'advancedmd'
  | 'generic';

export type PlatformMeta = {
  id: PlatformId;
  label: string;
  color: string;
  note: string;
  popular?: boolean;
  exportHint: string;
};

export const PLATFORMS: PlatformMeta[] = [
  {
    id: 'valant',
    label: 'Valant',
    color: '#2563EB',
    note: 'Behavioral health EHR — patient & staff CSV exports',
    popular: true,
    exportHint: 'Reports → Patient Export → All Patients → CSV, all fields',
  },
  {
    id: 'athena',
    label: 'athenahealth',
    color: '#059669',
    note: 'Enterprise ambulatory — patient roster export',
    popular: true,
    exportHint: 'Admin → Patient Export → Patient List → CSV, insurance + demographics',
  },
  {
    id: 'icannotes',
    label: 'ICANotes',
    color: '#7C3AED',
    note: 'Behavioral health charting — client list export',
    popular: true,
    exportHint: 'Admin → Data Export → Clients → CSV including insurance',
  },
  {
    id: 'simplepractice',
    label: 'SimplePractice',
    color: '#06B6D4',
    note: 'Private practice EHR — client CSV',
    popular: true,
    exportHint: 'Settings → Data Export → Export Clients → CSV, Practice Admin',
  },
  {
    id: 'therapynotes',
    label: 'TherapyNotes',
    color: '#D97706',
    note: 'Practice management — patient export',
    exportHint: 'Reports → Client Export → All Clients → CSV',
  },
  {
    id: 'netsmart',
    label: 'Netsmart / myAvatar',
    color: '#DC2626',
    note: 'Enterprise BH — census / client extract',
    exportHint: 'Reports → Client Roster Export → demographics + insurance → CSV',
  },
  {
    id: 'kipu',
    label: 'Kipu',
    color: '#0891B2',
    note: 'SUD / residential — patient roster',
    exportHint: 'Admin → Export Data → Patient Demographics → CSV',
  },
  {
    id: 'kareo',
    label: 'Kareo / Tebra',
    color: '#7C3AED',
    note: 'PM / EHR — patient demographics export',
    exportHint: 'Reports → Patient Lists → All Patients → CSV',
  },
  {
    id: 'advancedmd',
    label: 'AdvancedMD',
    color: '#374151',
    note: 'PM / EHR — patient list export',
    exportHint: 'Reports → Patient Summary → Export All → CSV',
  },
  {
    id: 'generic',
    label: 'Generic CSV',
    color: '#6B7280',
    note: 'Map common column names from any spreadsheet',
    exportHint: '',
  },
];

const COMMON: FieldAliasMap = {
  sourceId: [
    'source_id', 'sourceid', 'external_id', 'externalid', 'patient_id', 'patientid',
    'id', 'chart_id', 'chartid', 'client_id', 'clientid',
  ],
  mrn: [
    'mrn', 'medical_record_number', 'medicalrecordnumber', 'chart_number', 'chartnumber',
    'account_number', 'account', 'patient_number',
  ],
  firstName: [
    'first_name', 'firstname', 'first', 'given_name', 'givenname',
    'patient_first_name', 'patient first name', 'first name',
  ],
  lastName: [
    'last_name', 'lastname', 'last', 'surname', 'family_name', 'familyname',
    'patient_last_name', 'patient last name', 'last name',
  ],
  name: ['name', 'full_name', 'fullname', 'patient_name', 'client_name', 'patient'],
  email: ['email', 'email_address', 'emailaddress', 'e-mail', 'patient_email'],
  phone: [
    'phone', 'phone_number', 'phonenumber', 'mobile', 'mobilephone', 'mobile_phone',
    'cell', 'cellphone', 'home_phone', 'primary_phone', 'telephone',
  ],
  dateOfBirth: [
    'date_of_birth', 'dateofbirth', 'dob', 'birth_date', 'birthdate', 'birthday',
  ],
  // `gender` stays the legacy free-text column; sex and gender identity are separate standard fields
  gender: ['gender', 'patient_gender'],
  administrativeSex: ['sex', 'patient_sex', 'legal_sex', 'administrative_sex', 'sex_on_insurance'],
  sexAtBirth: ['sex_at_birth', 'birth_sex', 'sex_assigned_at_birth'],
  genderIdentity: ['gender_identity'],
  sexualOrientation: ['sexual_orientation'],
  pronouns: ['pronouns', 'preferred_pronouns'],
  race: ['race'],
  ethnicity: ['ethnicity'],
  preferredLanguage: ['language', 'preferred_language', 'primary_language'],
  interpreterNeeded: ['interpreter', 'interpreter_needed', 'needs_interpreter'],
  maritalStatus: ['marital_status'],
  county: ['county'],
  medicaidId: ['medicaid_id', 'medicaid_number', 'ma_number', 'medical_assistance_number'],
  deceasedAt: ['date_of_death', 'deceased_date', 'death_date'],
  addressLine1: [
    'address', 'address1', 'address_line_1', 'addressline1', 'street', 'street1', 'addr1',
  ],
  addressLine2: [
    'address2', 'address_line_2', 'addressline2', 'street2', 'apt', 'suite', 'addr2',
  ],
  city: ['city', 'town'],
  state: ['state', 'province', 'region', 'st'],
  postalCode: ['postal_code', 'postalcode', 'zip', 'zip_code', 'zipcode', 'postcode'],
  emergencyContactName: [
    'emergency_contact', 'emergency_contact_name', 'emergencycontactname', 'ec_name', 'emerg_contact',
  ],
  emergencyContactPhone: [
    'emergency_phone', 'emergency_contact_phone', 'emergencycontactphone', 'ec_phone', 'emerg_phone',
  ],
  insurancePayer: [
    'insurance', 'payer', 'insurance_payer', 'insurancepayer', 'primary_insurance',
    'primaryinsurance', 'insurer', 'subscriber_name', 'subscribername',
  ],
  insuranceMemberId: [
    'member_id', 'memberid', 'insurance_id', 'subscriber_id', 'policy_number',
    'policynumber', 'policy_number',
  ],
  insuranceGroupNumber: [
    'group_number', 'groupnumber', 'group_id', 'groupid', 'insurance_group',
  ],
  primaryDiagnosis: [
    'diagnosis', 'primary_diagnosis', 'primarydiagnosis', 'dx', 'dx_description',
  ],
  primaryDiagnosisCode: [
    'diagnosis_code', 'diagnosiscode', 'icd10', 'icd_10', 'dx_code', 'primary_dx_code',
  ],
};

export const PLATFORM_FIELD_MAPS: Record<PlatformId, FieldAliasMap> = {
  // Valant's Data Export names columns like "Pt. Name (First)" → pt_name_first
  valant: {
    ...COMMON,
    sourceId: ['pt_id', 'patient_id', 'valant_id', 'patientid', ...COMMON.sourceId!],
    firstName: [
      'pt_name_first', 'first name', 'firstname', 'patient first name', 'patient_first_name',
      ...COMMON.firstName!,
    ],
    middleInitial: ['pt_name_mi', 'middle_initial', 'mi'],
    // Not seen in an export yet: column names follow Valant's "Pt. Name (First)" → pt_name_first pattern
    preferredName: ['pt_name_preferred', 'pt_preferred_name', 'preferred_name', 'nickname'],
    nameSuffix: ['pt_name_suffix', 'pt_suffix', 'name_suffix', 'suffix'],
    lastName: [
      'pt_name_last', 'last name', 'lastname', 'patient last name', 'patient_last_name',
      ...COMMON.lastName!,
    ],
    mrn: ['pt_chart_number', 'chart_id', 'mrn', 'patient_number', ...COMMON.mrn!],
    name: ['pt_name_display', 'patient_name', 'client_name', ...COMMON.name!],
    email: ['pt_email_home', 'pt_email_work', 'pt_email', ...COMMON.email!],
    phone: ['pt_phone_main', 'pt_phone', 'home_phone', 'cell_phone', 'preferred_phone', ...COMMON.phone!],
    phoneSecondary: ['pt_phone_2', 'pt_phone_3', 'secondary_phone', 'alternate_phone'],
    dateOfBirth: ['pt_birth_date', 'pt_dob', ...COMMON.dateOfBirth!],
    gender: ['pt_gender', ...COMMON.gender!],
    // Valant "Pt. Sex" is the sex on the insurance / legal record (X12 DMG03)
    administrativeSex: ['pt_sex', ...COMMON.administrativeSex!],
    // ─── Not seen in a real Valant export yet: names follow the "Pt. X (Y)" -> pt_x_y pattern. ───
    // Confirm against the real client export before relying on them (unmatched columns are ignored).
    legalMiddleName: ['pt_name_middle', 'pt_middle_name', 'middle_name'],
    sexAtBirth: ['pt_sex_at_birth', 'pt_birth_sex', ...COMMON.sexAtBirth!],
    genderIdentity: ['pt_gender_identity', ...COMMON.genderIdentity!],
    sexualOrientation: ['pt_sexual_orientation', ...COMMON.sexualOrientation!],
    pronouns: ['pt_pronouns', 'pt_preferred_pronouns', ...COMMON.pronouns!],
    race: ['pt_race', ...COMMON.race!],
    ethnicity: ['pt_ethnicity', ...COMMON.ethnicity!],
    preferredLanguage: ['pt_language', 'pt_primary_language', 'pt_preferred_language', ...COMMON.preferredLanguage!],
    interpreterNeeded: ['pt_interpreter_needed', 'pt_interpreter', ...COMMON.interpreterNeeded!],
    maritalStatus: ['pt_marital_status', ...COMMON.maritalStatus!],
    county: ['pt_address_county', ...COMMON.county!],
    phoneMobile: ['pt_phone_cell', 'pt_phone_mobile', 'cell_phone', 'mobile_phone'],
    phoneHome: ['pt_phone_home', 'home_phone'],
    phoneWork: ['pt_phone_work', 'work_phone'],
    emergencyContactRelationship: ['pt_emergency_contact_relationship', 'pt_emergency_contact_relation', 'emergency_contact_relationship'],
    guardianName: ['pt_guardian_name', 'pt_guardian', 'guardian_name', 'legal_guardian'],
    guardianRelationship: ['pt_guardian_relationship', 'pt_guardian_relation', 'guardian_relationship'],
    guardianPhone: ['pt_guardian_phone', 'pt_guardian_phone_main', 'guardian_phone'],
    guarantorFirstName: ['pt_guarantor_name_first', 'pt_guarantor_first_name', 'guarantor_first_name'],
    guarantorLastName: ['pt_guarantor_name_last', 'pt_guarantor_last_name', 'guarantor_last_name'],
    guarantorRelationship: ['pt_guarantor_relationship', 'pt_guarantor_relation', 'guarantor_relationship'],
    guarantorDateOfBirth: ['pt_guarantor_birth_date', 'pt_guarantor_dob', 'guarantor_dob'],
    guarantorPhone: ['pt_guarantor_phone', 'pt_guarantor_phone_main', 'guarantor_phone'],
    guarantorAddressLine1: ['pt_guarantor_address_street1', 'pt_guarantor_address', 'guarantor_address'],
    guarantorAddressLine2: ['pt_guarantor_address_street2'],
    guarantorCity: ['pt_guarantor_address_city', 'guarantor_city'],
    guarantorState: ['pt_guarantor_address_state', 'guarantor_state'],
    guarantorPostalCode: ['pt_guarantor_address_zip', 'pt_guarantor_address_zip_code', 'guarantor_zip'],
    medicaidId: ['pt_medicaid_id', 'pt_ma_number', ...COMMON.medicaidId!],
    deceasedAt: ['pt_deceased_date', 'pt_date_of_death', ...COMMON.deceasedAt!],
    addressLine1: ['pt_address_street1', 'pt_address_street', ...COMMON.addressLine1!],
    addressLine2: ['pt_address_street2', ...COMMON.addressLine2!],
    city: ['pt_address_city', ...COMMON.city!],
    state: ['pt_address_state', ...COMMON.state!],
    postalCode: [
      'pt_address_zip', 'pt_address_zip_code', 'pt_address_postal_code', ...COMMON.postalCode!,
    ],
    emergencyContactName: ['pt_emergency_contact_name', ...COMMON.emergencyContactName!],
    emergencyContactPhone: ['pt_emergency_contact_phone', ...COMMON.emergencyContactPhone!],
    insurancePayer: [
      'pt_ins1_name', 'pt_ins1_company', 'pt_ins1_payer', 'pt_ins1_carrier',
      'primary_payer', 'insurance_company', ...COMMON.insurancePayer!,
    ],
    insuranceMemberId: [
      'pt_ins1_id_number', 'pt_ins1_member_id', 'pt_ins1_subscriber_id', 'pt_ins1_policy_number', 'pt_ins1_id',
      ...COMMON.insuranceMemberId!,
    ],
    insuranceGroupNumber: ['pt_ins1_group_number', 'pt_ins1_group', ...COMMON.insuranceGroupNumber!],
    insuranceType: ['pt_ins1_insurance_type', 'insurance_type'],
    insuranceCoverageType: ['pt_ins1_coverage_type', 'coverage_type'],
    insurancePayerPhone: ['pt_ins1_phone', 'payer_phone', 'insurance_phone'],
    insuranceEffectiveFrom: ['pt_ins1_effective_date_start', 'insurance_effective_date'],
    insuranceEffectiveTo: ['pt_ins1_effective_date_end', 'insurance_termination_date'],
    copayAmount: ['pt_ins1_copay', 'pt_copay', 'copay'],
    // Free text in Valant, e.g. "$2450 Deductible once met 25%"
    coverageNote: ['pt_coinsurance', 'coinsurance'],
    insuranceInactive: ['pt_ins1_inactive'],
    assignedProviders: ['pt_assigned_prv', 'pt_assigned_providers', 'assigned_providers', 'assigned_provider'],
    inactive: ['pt_inactive', 'inactive'],
    location: ['assigned_fac_address_city', 'assigned_fac_name', 'facility', 'location'],
    // Facility Id (the journal's facility name) when the export has it, else Assigned Fac Name (= billing entity)
    valantFacility: ['assigned_fac_id', 'assigned_facility_id', 'assigned_facility', 'assigned_fac_name', 'assigned_fac'],
  },
  athena: {
    ...COMMON,
    sourceId: ['patientid', 'patient_id', 'enterpriseid', ...COMMON.sourceId!],
    mrn: ['mrn', 'chartid', ...COMMON.mrn!],
    firstName: ['firstname', 'first_name', 'FIRSTNAME', ...COMMON.firstName!],
    lastName: ['lastname', 'last_name', 'LASTNAME', ...COMMON.lastName!],
    dateOfBirth: ['dateofbirth', 'dob', 'DATEOFBIRTH', ...COMMON.dateOfBirth!],
    phone: ['mobilephone', 'MOBILEPHONE', 'homephone', 'workphone', ...COMMON.phone!],
    addressLine1: ['address1', 'streetaddress', ...COMMON.addressLine1!],
    postalCode: ['zip', 'zipcode', ...COMMON.postalCode!],
    insurancePayer: [
      'primaryinsurancepackageid', 'insurancepackagename', ...COMMON.insurancePayer!,
    ],
  },
  icannotes: {
    ...COMMON,
    sourceId: ['client_id', 'patient_id', 'ica_id', ...COMMON.sourceId!],
    name: ['client', 'patient', 'client_name', ...COMMON.name!],
    mrn: ['chart_no', 'chart_number', 'mrn', ...COMMON.mrn!],
    primaryDiagnosisCode: ['axis_i', 'icd10', 'primary_dx', ...COMMON.primaryDiagnosisCode!],
  },
  simplepractice: {
    ...COMMON,
    sourceId: ['client_id', 'id', ...COMMON.sourceId!],
    name: ['client', 'preferred_name', 'legal_name', ...COMMON.name!],
    firstName: ['first_name', 'preferred_first_name', ...COMMON.firstName!],
    lastName: ['last_name', ...COMMON.lastName!],
    phone: ['mobile_number', 'home_number', 'phone_number', ...COMMON.phone!],
    insurancePayer: [
      'primary_insurance_company', 'insurance_company', ...COMMON.insurancePayer!,
    ],
    insuranceMemberId: [
      'primary_insurance_member_id', 'member_id', ...COMMON.insuranceMemberId!,
    ],
  },
  therapynotes: {
    ...COMMON,
    sourceId: ['patient_id', 'patientid', 'pn_id', ...COMMON.sourceId!],
    name: ['patient', 'patient_name', ...COMMON.name!],
    mrn: ['account_number', 'mrn', ...COMMON.mrn!],
    phone: ['primary_phone', 'cell_phone', 'home_phone', ...COMMON.phone!],
    dateOfBirth: ['birthdate', 'dob', ...COMMON.dateOfBirth!],
  },
  netsmart: {
    ...COMMON,
    sourceId: ['client_id', 'person_id', 'avatar_id', ...COMMON.sourceId!],
    mrn: ['medical_record_number', 'mrn', 'client_number', ...COMMON.mrn!],
    name: ['client_name', 'full_name', ...COMMON.name!],
    gender: ['gender_code', ...COMMON.gender!],
    primaryDiagnosisCode: [
      'primary_diagnosis_code', 'icd10_code', ...COMMON.primaryDiagnosisCode!,
    ],
  },
  kipu: {
    ...COMMON,
    sourceId: ['patient_id', 'kipu_id', 'episode_id', ...COMMON.sourceId!],
    mrn: ['mrn', 'patient_number', ...COMMON.mrn!],
    firstName: ['first_name', 'patient_first_name', ...COMMON.firstName!],
    lastName: ['last_name', 'patient_last_name', ...COMMON.lastName!],
    name: ['patient_name', 'full_name', ...COMMON.name!],
    phone: ['phone_number', 'mobile_phone', ...COMMON.phone!],
    insurancePayer: ['primary_payor', 'payor', ...COMMON.insurancePayer!],
  },
  kareo: {
    ...COMMON,
    sourceId: ['patientid', 'patient_id', 'guid', ...COMMON.sourceId!],
    mrn: ['medicalrecordnumber', 'chartnumber', 'mrn', ...COMMON.mrn!],
    firstName: ['firstname', ...COMMON.firstName!],
    lastName: ['lastname', ...COMMON.lastName!],
    addressLine1: ['addressline1', 'street1', ...COMMON.addressLine1!],
    postalCode: ['postalcode', 'zipcode', ...COMMON.postalCode!],
    insurancePayer: [
      'primaryinsuranceplanname', 'insuranceplanname', ...COMMON.insurancePayer!,
    ],
  },
  advancedmd: {
    ...COMMON,
    sourceId: ['patientid', 'patient_id', 'profileid', ...COMMON.sourceId!],
    mrn: ['chart', 'chartid', 'mrn', ...COMMON.mrn!],
    name: ['patientname', 'fullname', ...COMMON.name!],
    phone: ['homephone', 'cellphone', 'workphone', ...COMMON.phone!],
    dateOfBirth: ['dob', 'dateofbirth', ...COMMON.dateOfBirth!],
  },
  generic: { ...COMMON },
};

/** Find first non-empty value in row matching any alias (case/space/punct insensitive keys) */
export function findField(
  row: Record<string, unknown>,
  aliases: string[]
): string | null {
  if (!row || !aliases?.length) return null;

  const normalized = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    normalized.set(normalizeKey(k), v);
  }

  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (!normalized.has(key)) continue;
    const raw = normalized.get(key);
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s.length) return s;
  }
  return null;
}

export function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[#]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getFieldMap(platform: string | null | undefined): FieldAliasMap {
  const id = (platform || 'generic').toLowerCase() as PlatformId;
  return PLATFORM_FIELD_MAPS[id] ?? PLATFORM_FIELD_MAPS.generic;
}

export function resolveClientFields(
  row: Record<string, unknown>,
  platform?: string | null
): Partial<Record<CanonicalClientField, string>> {
  const map = getFieldMap(platform);
  const out: Partial<Record<CanonicalClientField, string>> = {};
  for (const [field, aliases] of Object.entries(map) as [CanonicalClientField, string[]][]) {
    const val = findField(row, aliases);
    if (val != null) out[field] = val;
  }
  return out;
}

export type ColumnReport = {
  /** Headers matched to at least one canonical field, with the fields they feed */
  recognized: { header: string; fields: CanonicalClientField[] }[];
  /** Headers no alias matches: their data is ignored. Add an alias here to use one. */
  ignored: string[];
};

/** Which spreadsheet headers the platform's field map recognizes and which it ignores (file order) */
export function describeColumns(headers: readonly string[], platform?: string | null): ColumnReport {
  const map = getFieldMap(platform);
  const byKey = new Map<string, CanonicalClientField[]>();
  for (const [field, aliases] of Object.entries(map) as [CanonicalClientField, string[]][]) {
    for (const a of aliases) {
      const k = normalizeKey(a);
      const arr = byKey.get(k) ?? [];
      if (!arr.includes(field)) arr.push(field);
      byKey.set(k, arr);
    }
  }
  const out: ColumnReport = { recognized: [], ignored: [] };
  const seen = new Set<string>();
  for (const raw of headers) {
    const header = String(raw ?? '').trim();
    if (!header || seen.has(header)) continue;
    seen.add(header);
    const fields = byKey.get(normalizeKey(header));
    if (fields?.length) out.recognized.push({ header, fields: [...fields] });
    else out.ignored.push(header);
  }
  return out;
}

/** Union of the column headers across rows, in first-seen order */
export function rowHeaders(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r ?? {})) seen.add(k);
  return [...seen];
}
