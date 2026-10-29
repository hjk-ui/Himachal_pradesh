/** Canonical client fields we map CSV/JSON columns onto */
export type CanonicalClientField =
  | 'sourceId'
  | 'mrn'
  | 'firstName'
  | 'lastName'
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
  | 'primaryDiagnosisCode';

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
  gender: ['gender', 'sex', 'gender_identity', 'patient_sex'],
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
  valant: {
    ...COMMON,
    sourceId: ['patient_id', 'valant_id', 'patientid', ...COMMON.sourceId!],
    firstName: [
      'first name', 'firstname', 'patient first name', 'patient_first_name', ...COMMON.firstName!,
    ],
    lastName: [
      'last name', 'lastname', 'patient last name', 'patient_last_name', ...COMMON.lastName!,
    ],
    mrn: ['chart_id', 'mrn', 'patient_number', ...COMMON.mrn!],
    name: ['patient_name', 'client_name', ...COMMON.name!],
    phone: ['home_phone', 'cell_phone', 'preferred_phone', ...COMMON.phone!],
    insurancePayer: ['primary_payer', 'insurance_company', ...COMMON.insurancePayer!],
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
    gender: ['sex', 'gender_code', ...COMMON.gender!],
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
    .replace(/[^a-z0-9]+/g, '_');
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
