export const SERVICES = ['PRP', 'Spravato', 'TMS', 'AOT', 'Residential'] as const;
export type Service = (typeof SERVICES)[number];
export const SCAN_STATUSES = ['Eligible', 'Potential', 'Needs Data'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];
export type Screening = {
  status: ScanStatus;
  met: string[];
  notMet: string[];
  missing: string[];
  recommendation: string;
};
export type ScannerPatient = {
  id: string;
  name: string;
  age: number;
  gender: string;
  diagnosis: string;
  services: Record<Service, Screening>;
};
export const SERVICE_DESCRIPTIONS: Record<Service, string> = {
  PRP: 'Psychiatric Rehabilitation Program',
  Spravato: 'Esketamine / TRD screening',
  TMS: 'Transcranial Magnetic Stimulation',
  AOT: 'Assisted Outpatient Treatment',
  Residential: 'ASAM 3.1 / 3.5 Residential Treatment',
};
const CRITERIA: Record<Service, { met: string[]; gap: string; missing: string }> = {
  PRP: {
    met: ['Functional support needs documented', 'Recovery goals identified'],
    gap: 'Rehabilitation assessment incomplete',
    missing: 'Current functional assessment and service history',
  },
  Spravato: {
    met: ['Adult patient', 'Depression assessment available'],
    gap: 'Adequate prior treatment trials not established',
    missing: 'Medication trials, contraindication review and REMS status',
  },
  TMS: {
    met: ['Adult patient', 'Treatment history reviewed'],
    gap: 'Indication and prior treatment response require review',
    missing: 'Implant / seizure safety screening and medication trial history',
  },
  AOT: {
    met: ['Community support needs documented', 'Care coordination review available'],
    gap: 'Statutory criteria have not been established',
    missing: 'Documented history, legal review and less restrictive alternatives',
  },
  Residential: {
    met: ['Substance use or co-occurring disorder identified', 'Milieu stabilization indication'],
    gap: 'ASAM 6-Dimension Assessment incomplete',
    missing: 'Comprehensive SUD assessment, toxicology screen, Prior Auth determination',
  },
};
function screening(service: Service, status: ScanStatus): Screening {
  const criteria = CRITERIA[service];
  return {
    status,
    met:
      status === 'Eligible'
        ? [...criteria.met, 'Demo screening checklist completed']
        : [...criteria.met],
    notMet: status === 'Potential' ? [criteria.gap] : [],
    missing: status === 'Needs Data' ? [criteria.missing] : [],
    recommendation:
      service === 'AOT'
        ? 'Request multidisciplinary and legal review. This preview cannot establish statutory eligibility or authorize court-ordered treatment.'
        : service === 'Residential'
          ? status === 'Eligible'
            ? 'Patient meets ASAM 3.1/3.5 residential admission threshold. Proceed with Bed Board intake and Prior Auth.'
            : status === 'Potential'
              ? 'Complete ASAM 6-dimension evaluation to determine whether Level 3.1 or 3.5 is clinically indicated.'
              : 'Obtain toxicology screen, medical clearance, and insurance carve-out verification.'
          : status === 'Eligible'
            ? `Consider a ${service} assessment after clinician verification of indications, safety and payer requirements.`
            : status === 'Potential'
              ? `Review the unmet ${service} screening items with the care team before considering referral.`
              : `Collect the missing ${service} documentation and have a clinician reassess the screening.`,
  };
}
const PATIENTS: [string, number, string, string, ScanStatus, ScanStatus, ScanStatus, ScanStatus, ScanStatus][] = [];
export const SCANNER_PATIENTS: ScannerPatient[] = PATIENTS.map(
  ([name, age, gender, diagnosis, prp, spravato, tms, aot, residential], i) => ({
    id: `demo-screen-${i + 1}`,
    name,
    age,
    gender,
    diagnosis,
    services: {
      PRP: screening('PRP', prp),
      Spravato: screening('Spravato', spravato),
      TMS: screening('TMS', tms),
      AOT: screening('AOT', aot),
      Residential: screening('Residential', residential),
    },
  }),
);
export function filterScannerPatients(
  patients: ScannerPatient[],
  query: string,
  service: Service | null,
  status: ScanStatus | 'All',
) {
  const search = query.trim().toLowerCase();
  return patients.filter(
    (patient) =>
      `${patient.name} ${patient.diagnosis}`.toLowerCase().includes(search) &&
      (status === 'All' ||
        (service
          ? patient.services[service].status === status
          : SERVICES.some((key) => patient.services[key].status === status))),
  );
}
