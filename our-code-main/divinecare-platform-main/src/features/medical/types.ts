export type SomaticStatus = 'Active' | 'Chronic' | 'Acute' | 'Resolved' | 'Monitoring';

export interface MedicalProblem {
  id: string;
  icd10: string;
  description: string;
  onsetDate: string;
  status: SomaticStatus;
  severity: 'Mild' | 'Moderate' | 'Severe' | '';
  category: 'Cardiovascular' | 'Endocrine' | 'Respiratory' | 'Renal' | 'GI' | 'Musculoskeletal' | 'Neurological' | 'Other' | '';
  notes?: string;
}

export interface MedicalMedication {
  id: string;
  name: string;
  dosage: string;
  route: string;
  frequency: string;
  refills: number;
  indication: string;
  startDate: string;
  status: 'Active' | 'Discontinued' | 'On Hold';
  prescribedBy: string;
  rxNorm?: string;
  instructions: string;
}

export interface MedicalAllergy {
  id: string;
  substance: string;
  reaction: string;
  severity: 'Severe/Anaphylaxis' | 'Moderate' | 'Mild' | '';
  type: 'Drug' | 'Food' | 'Environmental' | '';
  onsetDate?: string;
  rxnormId?: string;
}

export interface MedicalVitalRecord {
  id: string;
  recordedAt: string;
  recordedBy: string;
  systolic: number;
  diastolic: number;
  heartRate: number;
  respRate: number;
  temperatureF: number;
  heightInches: number;
  weightLbs: number;
  bmi: number;
  oxygenSat: number;
  notes?: string;
}

export interface MedicalLabResult {
  id: string;
  testName: string;
  loincCode: string;
  value: string;
  numericValue: number;
  unit: string;
  referenceRange: string;
  flag: 'Normal' | 'High' | 'Low' | 'Critical/Panic';
  collectionDate: string;
  resultDate: string;
  orderingClinician: string;
  interpretation?: string;
  sparklineHistory: number[];
}

export interface MedicalPreventiveItem {
  id: string;
  title: string;
  uspstfGrade: 'A' | 'B' | 'C' | 'I';
  targetGroup: string;
  recommendedIntervalMonths: number;
  lastCompletedDate?: string;
  dueDate: string;
  status: 'Up to Date' | 'Due Soon' | 'Overdue';
  actionType: 'Order Lab' | 'Referral' | 'Clinical Assessment' | 'Immunization';
  cptCode?: string;
}

export interface MedicalReferral {
  id: string;
  type: 'Specialist' | 'Imaging';
  specialtyOrModality: string;
  cptCode?: string;
  providerOrFacility: string;
  status: 'Draft' | 'Sent' | 'Pending Authorization' | 'Scheduled' | 'Completed';
  orderDate: string;
  reason: string;
  clinicalSummary: string;
  urgency: 'Routine' | 'Urgent' | 'STAT';
}

export interface MedicalEncounter {
  id: string;
  patientId: string;
  patientName: string;
  visitDate: string;
  visitType: 'Annual Physical' | 'HTN Follow-up' | 'Diabetes Management' | 'Acute Visit' | 'Well-Woman';
  provider: string;
  room?: string;
  isTelehealth: boolean;
  hpi: string;
  ros: Record<string, 'Negative' | 'Positive' | 'Not Reviewed'>;
  rosNotes?: string;
  vitals: MedicalVitalRecord;
  physicalExam: Record<string, string>;
  assessmentDiagnoses: { icd10: string; description: string }[];
  mdmComplexity: 'Straightforward' | 'Low' | 'Moderate' | 'High';
  recommendedCpt: '99212' | '99213' | '99214' | '99215';
  cptRationale: string;
  prescriptions: string[];
  labOrders: string[];
  referralOrders: string[];
  patientCounseling: string;
  isLocked: boolean;
  signedAt?: string;
  signedBy?: string;
}

export interface ONCDemographics {
  legalName: string;
  preferredName: string;
  dateOfBirth: string;
  sexAtBirth: 'Male' | 'Female' | 'Intersex' | 'Unknown';
  genderIdentity: string;
  sexualOrientation: string;
  pronouns: string;
  ombRace: string;
  ombEthnicity: string;
  preferredLanguage: string;
  interpreterNeeded: boolean;
  portalStatus: 'Active' | 'Invited' | 'Declined' | '';
  primaryInsurance: {
    payerName: string;
    payerId: string;
    memberId: string;
    groupNumber: string;
    subscriberName: string;
    subscriberDob: string;
    relationship: 'Self' | 'Spouse' | 'Child' | 'Other';
  };
  secondaryInsurance?: {
    payerName: string;
    payerId: string;
    memberId: string;
    groupNumber: string;
    subscriberName: string;
    relationship: 'Self' | 'Spouse' | 'Child' | 'Other';
  };
  guarantor: {
    name: string;
    relationship: 'Self' | 'Spouse' | 'Parent/Guardian' | 'Other';
    phone: string;
    address: string;
  };
  emergencyContacts: {
    name: string;
    relationship: string;
    phone: string;
    isAuthorizedProxy: boolean;
  }[];
  codeStatus: 'Full Code' | 'DNR' | 'DNI' | 'Comfort Measures Only' | '';
  advanceDirectives: {
    hasLivingWill: boolean;
    hasPOLST: boolean;
    healthcareProxyName?: string;
    healthcareProxyPhone?: string;
  };
  chartFlags: string[];
}

export interface MedicalPatient {
  id: string;
  mrn: string;
  name: string;
  preferredName?: string;
  dob: string;
  age: number;
  gender: string;
  pronouns: string;
  pcp: string;
  phone: string;
  email: string;
  demographics: ONCDemographics;
  problems: MedicalProblem[];
  medications: MedicalMedication[];
  allergies: MedicalAllergy[];
  vitals: MedicalVitalRecord[];
  labs: MedicalLabResult[];
  preventiveCare: MedicalPreventiveItem[];
  referrals: MedicalReferral[];
  encounters: MedicalEncounter[];
  lastVisit: string;
  nextVisit?: string;
  hasCareGaps: boolean;
  hasAbnormalLabs: boolean;
  hasCriticalPanicLab?: boolean;
  bhCrossReference?: {
    hasBhChart: boolean;
    bhClientId?: string;
    hasPart2Consent: boolean;
    therapist?: string;
    prescriber?: string;
    primaryDiagnosis?: string;
  };
}

export interface CriticalLabAlert {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  testName: string;
  value: string;
  unit: string;
  refRange: string;
  flag: 'Critical/Panic';
  resultedAt: string;
  orderingClinician: string;
  clinicalSignificance: string;
  acknowledged: boolean;
}

export interface MedicalClaimItem {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  dos: string;
  cptCode: string;
  modifiers: string[];
  icd10Pointers: string[];
  billedAmount: number;
  allowedAmount: number;
  paidAmount: number;
  balance: number;
  payerName: string;
  payerId: string;
  status: 'Draft' | 'Ready' | 'Submitted' | 'Paid' | 'Denied';
  denialCode?: string;
  denialReason?: string;
  renderingNpi: string;
  supervisingNpi?: string;
}

export interface PayerSetting {
  id: string;
  name: string;
  payerId: string;
  type: 'Commercial' | 'Medicare' | 'Medicaid MCO';
  clearinghouse: 'Availity' | 'Change Healthcare' | 'Office Ally';
  timelyFilingDays: number;
  timelyFilingWarningDays?: number;
  // Clinical Coding & Scrubbing Rules
  autoAttachModifier25: boolean;
  autoAttachModifier59?: boolean;
  telehealthModifier: '-95' | '-GT' | '-FQ' | '-93';
  telehealthPos?: '02' | '10' | '11';
  requireCliaNumber?: boolean;
  // Provider & Credentialing Rules
  requiresSupervisorNpi: boolean;
  enforceNpiType2?: boolean;
  taxonomyRequired?: boolean;
  // Prior Authorization & Claims Workflow
  requirePriorAuth?: boolean;
  priorAuthCptCodes?: string[];
  electronicClaimsEnabled: boolean;
  realtimeEligibilityEnabled: boolean;
  acceptElectronicSecondary?: boolean;
  autoPostEra835?: boolean;
  patientCopayPolicy?: 'Collect at Check-in' | 'Bill Post-Adjudication';
}
