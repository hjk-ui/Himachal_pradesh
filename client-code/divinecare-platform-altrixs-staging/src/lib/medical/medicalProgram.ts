/**
 * Primary care (Family Practice) inside the one client record. Pure: no prisma, safe for tests.
 *
 * Primary care is offered only at the Silver Spring and Bowie locations, and both also run
 * behavioral health, so a client's location never makes them a primary-care patient by itself.
 * A client IS a primary-care patient when ANY of these holds (primaryCarePatientWhere):
 *  1. primary-care clinical records on file: MedicalVisit / MedicalVital / MedicalCharge.
 *     MedicalProblem / MedicalAllergy do NOT count: DrFirst downloads them for psychiatric clients
 *     too, and they already show in "Diagnoses & problems" and the banner for every chart;
 *  2. created through primary-care intake (Client.primaryCare, set only by that route);
 *  3. imported Valant Transaction Journal rows with facility "Family Practice".
 * The chart shows the Medical tab group for primary-care patients, or when the viewer is a
 * medical role (PHYSICIAN / MEDICAL_NP / MEDICAL_ASSISTANT). Each medical tab is then shown only
 * to roles that may open the matching practice-wide page.
 */
import { canAccessPath } from '@/lib/auth/roleAccess';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

/**
 * The locations that offer primary care, matched against Location.name or Location.city
 * (case/space-insensitive, whole value). Edit here (one place) when a location is renamed or added.
 * Used for the primary-care intake location choices and the Family Practice list filter.
 */
export const PRIMARY_CARE_LOCATION_NAMES: readonly string[] = ['Silver Spring', 'Bowie'];

/** Facility value on the imported Valant Transaction Journal for primary care visits */
export const PRIMARY_CARE_VALANT_FACILITY = 'Family Practice';

/** ?program= value on the client list that selects primary-care clients */
export const MEDICAL_PROGRAM = 'medical';
export const MEDICAL_CLIENTS_HREF = `/dashboard/clients?program=${MEDICAL_PROGRAM}`;

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Location offers primary care: its name or city is one of PRIMARY_CARE_LOCATION_NAMES */
export function isPrimaryCareLocation(loc: { name?: string | null; city?: string | null } | null | undefined): boolean {
  if (!loc) return false;
  const values = [norm(loc.name), norm(loc.city)].filter(Boolean);
  return values.some((v) => PRIMARY_CARE_LOCATION_NAMES.some((m) => norm(m) === v));
}

export function isMedicalViewerRole(role: string | null | undefined): boolean {
  const r = normalizeStaffRole(role ?? '');
  return r === 'PHYSICIAN' || r === 'MEDICAL_NP' || r === 'MEDICAL_ASSISTANT';
}

export function shouldShowMedicalTabs(input: {
  /** banner.primaryCarePatient (records, intake marker or Valant Family Practice rows) */
  primaryCarePatient: boolean;
  role: string | null | undefined;
}): boolean {
  return input.primaryCarePatient || isMedicalViewerRole(input.role);
}

/** Medical chart tab -> practice-wide page whose role rule gates it */
export const MEDICAL_TAB_PATHS = {
  'medical-visits': '/dashboard/medical/visits',
  'medical-vitals': '/dashboard/medical/vitals',
  'medical-preventive': '/dashboard/medical/preventive-care',
  'medical-history': '/dashboard/medical/history',
  'medical-orders': '/dashboard/medical/referrals',
  'medical-ai': '/dashboard/medical/ai',
} as const;

export type MedicalTabKey = keyof typeof MEDICAL_TAB_PATHS;
export const MEDICAL_TAB_KEYS = Object.keys(MEDICAL_TAB_PATHS) as MedicalTabKey[];

export function isMedicalTabKey(key: string): key is MedicalTabKey {
  return key in MEDICAL_TAB_PATHS;
}

export function medicalTabAllowed(key: MedicalTabKey, role: string | null | undefined): boolean {
  return canAccessPath(role, MEDICAL_TAB_PATHS[key]);
}

/** Problem list lives in "Diagnoses & problems"; medical roles reach it through this page's rule */
export const MEDICAL_PROBLEM_LIST_PATH = '/dashboard/medical/problem-list';
export const MEDICAL_LABS_PATH = '/dashboard/medical/labs';

/**
 * Chart tabs a medical role sees. Behavioral-health tabs (notes, office notes, check-ins, safety,
 * programs, messages, documents, discharge, summary with BH diagnoses / mood / alerts) stay hidden,
 * matching the existing rule that primary care roles do not read BH chart notes (42 CFR Part 2).
 */
export const MEDICAL_ROLE_CHART_TABS: readonly string[] = [
  'appointments',
  'diagnoses',
  'medications',
  'labs',
  'billing',
  ...MEDICAL_TAB_KEYS,
];

/** Server chart sections a medical role may load (mirrors MEDICAL_ROLE_CHART_TABS) */
export const MEDICAL_ROLE_CHART_SECTIONS: readonly string[] = [
  'diagnoses',
  'labs',
  'eligibility',
  'medical-visits',
  'medical-vitals',
  'medical-history',
];

/** Chart URL for a client, opened on the medical tab group */
export function medicalChartHref(clientId: string, tab: MedicalTabKey = 'medical-visits'): string {
  return `/dashboard/clients/${encodeURIComponent(clientId)}?tab=${tab}`;
}

/**
 * Where /dashboard/medical/patients/[id] goes once the id has been resolved to a client: the
 * client chart's Medical tabs, with ?from=medical so the chart links back to Primary care
 * patients (null = no linked client: the Primary care patients list, flagged so it can say so).
 */
export function legacyMedicalPatientRedirect(clientId: string | null): string {
  return clientId ? `${medicalChartHref(clientId)}&from=medical` : '/dashboard/medical/patients?unlinked=1';
}

type ClientWhere = import('@prisma/client').Prisma.ClientWhereInput;
type LocationWhere = import('@prisma/client').Prisma.LocationWhereInput;

/** Location where-clause: the primary-care locations (name or city, case-insensitive) */
export function primaryCareLocationWhere(): LocationWhere {
  return {
    OR: PRIMARY_CARE_LOCATION_NAMES.flatMap((name) => [
      { name: { equals: name, mode: 'insensitive' as const } },
      { city: { equals: name, mode: 'insensitive' as const } },
    ]),
  };
}

/** Client where-clause: primary-care patient (see the rule at the top of this file). Never location. */
export function primaryCarePatientWhere(): ClientWhere {
  return {
    OR: [
      { primaryCare: true },
      { medicalVisits: { some: {} } },
      { medicalVitals: { some: {} } },
      { medicalCharges: { some: {} } },
      { valantTransactions: { some: { facility: { equals: PRIMARY_CARE_VALANT_FACILITY, mode: 'insensitive' as const } } } },
    ],
  };
}

/**
 * Client where-clause for ?program=medical ("Family Practice patients"): a primary-care patient
 * whose location is a primary-care location. Clients with no location on file are kept (missing
 * data is not evidence they are seen elsewhere).
 */
export function medicalProgramClientWhere(): ClientWhere {
  return {
    AND: [primaryCarePatientWhere(), { OR: [{ locationId: null }, { location: primaryCareLocationWhere() }] }],
  };
}
