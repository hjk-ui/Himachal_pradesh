/**
 * Role x area access matrix (docs/role-access-matrix.md). Encodes, for every clinic role, which
 * pages open (canAccessPath: proxy, dashboard layout, sidebar), the API gates the proxy enforces
 * (canAccessApiPath) and the key per-route helpers. Any change to a role's access fails here
 * first: update docs/role-access-matrix.md together with this file.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Role } from '@prisma/client';
import {
  canAccessApiPath,
  canAccessPath,
  canBreakGlass,
  homePathForRole,
  postLoginPath,
  shouldBlockDashboardPath,
} from '../src/lib/auth/roleAccess';
import {
  canAccessClientChartNotes,
  canAccessClientMessages,
  canAccessClientRoster,
  canEditClientProfile,
  canWriteClientChartNotes,
  canRequestClientBriefing,
  canEditClientDiagnoses,
  canEditClientRiskLevel,
  canSeeClientCheckIns,
  canSeeClientDiagnoses,
  canSeeClientInsurance,
  canSeeClientRiskDetail,
  canViewClientMedications,
  canWriteClientCheckIns,
  canWriteClientMedications,
  clientAccessWhere,
} from '../src/lib/clients/orgScope';
import { sectionAllowed } from '../src/lib/clients/chartSectionAccess';
import { canEnterLabResults, canOrderLabs, canReviewLabResults, canViewLabs } from '../src/lib/labs/access';
import { canViewPrescriptions, canWritePrescriptions } from '../src/lib/prescriptions/access';
import { canAccessClaims, canGenerateDraftClaim } from '../src/lib/billing/claims';
import { canMutateLedger, canReadLedger, stubChargesAllowed } from '../src/lib/billing/ledger';
import { CHART_SECTIONS } from '../src/lib/clients/chartSectionAccess';
import { loadChartBanner, type ChartBannerSource } from '../src/lib/clients/chartBanner';
import { filterRowsToCaseload, programRowsNeedCaseload } from '../src/lib/programs/caseloadRows';
import { canUseClinicModule } from '../src/lib/modules/access';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canAccessHrCorner } from '../src/lib/hr/corner';
import { isSensitivePrivilegedRole } from '../src/lib/privacy/sensitiveAccess';
import { maskLockedTasks, taskSourcesForRole, type StaffTask } from '../src/lib/tasks/manage';
import { ADMIN_MESSAGE_TOPICS, messageTopicsRestricted, threadAssigneeOr } from '../src/lib/messages/assignee';
import { redactSupervisionForViewer, type SupervisionLogItem } from '../src/lib/hr/supervision';
import { canReadClinicModule } from '../src/lib/modules/access';
import { LAUNCH_ROLES, canLaunchCrisp } from '../src/lib/fhir/config';
import { canReadDenials, canUpdateDenialStatus, canUpdateMedicalChargeStatus } from '../src/lib/billing/billingAccess';
import { hasCaseloadCosign, hasCosignAuthority } from '../src/lib/notes/transitions';
import { canReviewAllIncidents } from '../src/lib/incidents/access';
import { canSeeMedicationReminderDetails } from '../src/lib/notifications/medicationMasking';
const noDates = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/"gte":"[^"]+"/g, '"gte":"D"'));

const ROLES = {
  ADM: 'ADMIN',
  DIR: 'DIRECTOR',
  PD: 'PRACTICE_DIRECTOR',
  OM: 'OFFICE_MANAGER',
  FD: 'FRONT_DESK',
  BIL: 'BILLING',
  HR: 'HR',
  THR: 'THERAPIST',
  CLN: 'CLINICIAN',
  PSY: 'PSYCHIATRIST',
  NP: 'NP',
  PRP: 'PRP_SPECIALIST',
  CM: 'CASE_MANAGER',
  PEER: 'PEER_SUPPORT',
  CRI: 'CRISIS_RESPONDER',
  PHY: 'PHYSICIAN',
  MNP: 'MEDICAL_NP',
  MA: 'MEDICAL_ASSISTANT',
} as const;
type Abbr = keyof typeof ROLES;
const ABBRS = Object.keys(ROLES) as Abbr[];

/** 'ALL' | '' | space-separated abbreviations -> the set of allowed abbreviations */
function expected(spec: string): Set<Abbr> {
  if (spec === 'ALL') return new Set(ABBRS);
  return new Set(spec.split(/\s+/).filter(Boolean) as Abbr[]);
}

function checkMatrix(name: string, rows: [string, string][], allowed: (role: string, key: string) => boolean) {
  for (const [key, spec] of rows) {
    const want = expected(spec);
    for (const a of want) assert.ok(a in ROLES, `${name} ${key}: unknown role ${a}`);
    for (const a of ABBRS) {
      assert.equal(
        allowed(ROLES[a], key),
        want.has(a),
        `${name} ${key}: ${ROLES[a]} should be ${want.has(a) ? 'allowed' : 'denied'}`,
      );
    }
  }
}

// ─── Pages (canAccessPath) ───────────────────────────────────────────────────

const PAGE_MATRIX: [string, string][] = [
  ['/dashboard', 'ALL'],
  ['/dashboard/clients', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/clients/abc', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/clients/intake', 'ADM DIR PD OM FD'],
  ['/dashboard/clients/waitlist', 'ADM DIR PD OM FD THR CLN PSY NP PHY MNP'],
  ['/dashboard/appointments', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI PHY MNP'],
  ['/dashboard/telehealth', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/messages', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI'],
  ['/dashboard/communications', 'ADM DIR PD OM THR PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/inbox', 'ALL'],
  ['/dashboard/tasks', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/ehr', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/notes', 'ADM DIR PD THR CLN PSY NP PRP'],
  ['/dashboard/ehr/note-builder', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/treatment-plans', 'ADM DIR PD THR CLN PSY NP PRP'],
  ['/dashboard/ehr/assessments', 'ADM DIR PD THR CLN PSY NP PRP'],
  ['/dashboard/ehr/assessments/cssrs', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/evaluations', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/diagnoses', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/prescriptions', 'ADM DIR PD PSY NP'],
  ['/dashboard/ehr/labs', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/safety-plan', 'ADM DIR PD THR CLN PSY NP PRP CM'],
  ['/dashboard/ehr/discharge', 'ADM DIR PD THR CLN PSY NP CM'],
  ['/dashboard/ehr/supervisor-review', 'ADM DIR PD THR CLN PSY NP'],
  ['/dashboard/ehr/consents', 'ADM DIR PD OM FD THR CLN PSY NP'],
  ['/dashboard/ehr/eligibility', 'ADM DIR PD OM FD BIL THR CLN PSY NP'],
  ['/dashboard/ehr/hie', 'ADM DIR PD THR CLN PSY NP PRP CM PHY MNP'],
  ['/dashboard/ehr/part2', 'ADM DIR PD OM BIL THR CLN PSY NP PRP'],
  ['/dashboard/ehr/scanner', 'DIR PD THR PSY NP CM'],
  ['/dashboard/ehr/tms-spravato', 'ADM DIR PD THR PSY NP'],
  ['/dashboard/ehr/group-sessions', 'ADM DIR PD THR CLN PRP CM'],
  ['/dashboard/ehr/sud-groups', 'ADM DIR PD THR CLN CM'],
  ['/dashboard/protected-records', 'PD'],
  ['/dashboard/medical', 'ADM DIR PD OM FD THR CLN PSY NP CM PHY MNP MA'],
  ['/dashboard/medical/patients/intake', 'ADM DIR PD OM FD THR CLN PSY NP CM PHY MNP MA'],
  ['/dashboard/medical/visits', 'ADM DIR PD CLN PSY NP PHY MNP MA'],
  ['/dashboard/medical/vitals', 'ADM DIR PD CLN PSY NP PHY MNP MA'],
  ['/dashboard/medical/history', 'ADM DIR PD CLN PSY NP PHY MNP MA'],
  ['/dashboard/medical/problem-list', 'ADM DIR PD CLN PSY NP PHY MNP'],
  ['/dashboard/medical/preventive-care', 'ADM DIR PD CLN PSY NP PHY MNP'],
  ['/dashboard/medical/labs', 'ADM DIR PD THR CLN PSY NP PHY MNP MA'],
  ['/dashboard/medical/ai', 'ADM DIR PD CLN PSY NP PHY MNP MA'],
  ['/dashboard/medical/billing', 'ADM DIR PD BIL PHY MNP'],
  ['/dashboard/medical/payer-settings', 'ADM DIR PD BIL'],
  ['/dashboard/billing', 'ADM DIR PD BIL'],
  ['/dashboard/billing/claims', 'ADM DIR PD BIL'],
  ['/dashboard/billing/claim-scrubber', 'ADM DIR PD BIL'],
  ['/dashboard/billing/payments', 'ADM DIR PD OM FD BIL'],
  ['/dashboard/billing/superbills', 'ADM DIR PD BIL'],
  ['/dashboard/billing/denials', 'ADM DIR PD BIL'],
  ['/dashboard/billing/statements', 'ADM DIR PD OM BIL'],
  ['/dashboard/billing/ar-control', 'ADM DIR PD BIL'],
  ['/dashboard/billing/valant-balances', 'ADM DIR PD BIL'],
  ['/dashboard/billing/payer-settings', 'ADM DIR PD BIL'],
  ['/dashboard/billing/fee-schedule', 'ADM DIR PD BIL'],
  ['/dashboard/billing/authorizations', 'ADM DIR PD OM FD BIL THR CLN PSY NP'],
  ['/dashboard/billing/residential-crisis', 'ADM DIR PD BIL'],
  // 2026-10-22 owner: Office Manager patient-side billing only (payments, statements, AutoPay, auths)
  ['/dashboard/billing/autopay', 'ADM DIR PD OM FD BIL'],
  ['/dashboard/billing/prior-auth', 'ADM DIR PD OM BIL THR CLN PSY NP'],
  ['/dashboard/billing/insurance-companies', 'ADM DIR PD BIL'],
  ['/dashboard/billing/panels', 'ADM DIR PD BIL'],
  ['/dashboard/billing/provider-collections', 'ADM DIR PD BIL'],
  ['/dashboard/billing/clearinghouse', 'ADM DIR PD BIL'],
  ['/dashboard/coding', 'ADM DIR PD BIL THR CLN PSY NP'],
  ['/dashboard/reports', 'ADM DIR PD OM FD BIL HR'],
  ['/dashboard/reports/outcomes', 'ADM DIR PD'],
  ['/dashboard/analytics/schedule', 'ADM DIR PD OM FD'],
  ['/dashboard/analytics/productivity', 'ADM DIR PD OM'],
  ['/dashboard/analytics/surveys', 'ADM DIR PD OM'],
  ['/dashboard/population', 'ADM DIR PD'],
  ['/dashboard/ai-insights', 'ADM DIR PD THR CLN PSY NP CRI'],
  ['/dashboard/mbc', 'ADM DIR PD THR CLN PSY NP CRI'],
  ['/dashboard/scribe', 'ADM DIR PD THR CLN PSY NP CRI'],
  ['/dashboard/hr', 'ADM DIR PD HR'],
  ['/dashboard/hr/credentialing', 'ADM DIR PD OM HR'],
  ['/dashboard/hr/supervision', 'ADM DIR PD OM HR THR CLN PSY NP'],
  ['/dashboard/hr/training', 'ADM DIR PD OM HR'],
  ['/dashboard/hr/people', 'ADM DIR PD OM HR'],
  ['/dashboard/hr/onboarding', 'ADM DIR PD HR'],
  ['/dashboard/hr/offboarding', 'ADM DIR PD HR'],
  ['/dashboard/hr/time-off', 'ADM DIR PD HR'],
  ['/dashboard/hr/performance', 'ADM DIR PD HR'],
  ['/dashboard/hr/settings', 'ADM DIR PD HR'],
  ['/dashboard/hr/org-chart', 'ADM DIR PD OM FD BIL HR THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/hr/me', 'ADM DIR PD OM FD BIL HR THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['/dashboard/compliance', 'ADM DIR PD OM HR'],
  ['/dashboard/admin', 'ADM DIR PD'],
  ['/dashboard/admin/audit-log', 'ADM PD'],
  ['/dashboard/admin/migration', 'ADM DIR PD'],
  ['/dashboard/admin/scheduling-settings', 'ADM DIR PD OM'],
  ['/dashboard/subscription', 'ADM DIR PD'],
  ['/dashboard/practice-setup', 'ADM DIR PD'],
  ['/dashboard/enterprise', 'ADM DIR PD OM'],
  ['/dashboard/settings', 'ALL'],
  ['/dashboard/notifications', 'ADM DIR PD OM'],
  ['/dashboard/alerts', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['/dashboard/crisis', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['/dashboard/prp', 'ADM DIR PD THR CLN PSY NP PRP'],
  ['/dashboard/prp/assessment', 'ADM DIR PD PRP CM'],
  ['/dashboard/prp/referral', 'ADM DIR PD PSY NP THR CLN'],
  ['/dashboard/residential', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  // Intensive programs (IOP / PHP): treating team + leadership; no PRP / peer (SUD IOP is Part 2), no OM / FD / billing
  ['/dashboard/programs/intensive', 'ADM DIR PD THR CLN PSY NP CM'],
  ['/dashboard/programs/intensive/abc', 'ADM DIR PD THR CLN PSY NP CM'],
  ['/dashboard/programs/intensive/billing', 'ADM DIR PD BIL'],
  ['/dashboard/aot', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['/dashboard/community', 'ADM DIR PD OM CM PEER'],
  ['/dashboard/community/referrals', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI'],
  ['/dashboard/peer-support', 'ADM DIR PD PRP CM PEER'],
  ['/dashboard/pr', 'ADM DIR PD OM'],
  // Growth & Marketing hub: leadership + OM; lead inbox adds Front Desk; clinicians none
  ['/dashboard/marketing', 'ADM DIR PD OM'],
  ['/dashboard/marketing/leads', 'ADM DIR PD OM FD'],
  ['/dashboard/incidents', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PHY MNP'],
  ['/dashboard/grievances', 'ADM DIR PD OM'],
  ['/dashboard/qi', 'ADM DIR PD OM'],
  // Patient education library: care team + office manager + primary care (patient education for diabetes / hypertension)
  ['/dashboard/resources', 'ADM DIR PD OM THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  // Staff resources (policies, forms, training; no PHI): every clinic role, items narrowed by visibleRoles
  ['/dashboard/resources/staff', 'ALL'],
  ['/dashboard/projects', 'ALL'],
  ['/dashboard/sdoh', 'ADM DIR PD THR CLN PSY NP PRP CM'],
  ['/platform', ''],
];

test('page access matrix: every role x every area', () => {
  checkMatrix('page', PAGE_MATRIX, (role, path) => canAccessPath(role, path));
});

// ─── API gates enforced by the proxy (canAccessApiPath) ──────────────────────
// Rows are the proxy gate only. The route's own checks (caseload scope, prescriber, Part 2,
// requireFullAdmin, ...) still apply after it; see the helper matrix below.

const API_MATRIX: [string, string][] = [
  ['GET /api/clients', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/clients/x/notes', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/clinical/medications', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/appointments', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/messages', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/billing/claims', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/billing/statements', 'ADM DIR PD OM BIL'],
  // Payer / revenue billing APIs: billing + leadership at the proxy (2026-10-22: not Office Manager)
  ['GET /api/billing/overview', 'ADM DIR PD BIL'],
  ['GET /api/billing/ar', 'ADM DIR PD BIL'],
  ['POST /api/billing/ar/action', 'ADM DIR PD BIL'],
  ['GET /api/billing/claim-scrub', 'ADM DIR PD BIL'],
  ['GET /api/billing/provider-collections', 'ADM DIR PD BIL'],
  ['GET /api/billing/valant-archive', 'ADM DIR PD BIL'],
  ['GET /api/billing/residential-crisis', 'ADM DIR PD BIL'],
  ['GET /api/billing/specialized', 'ADM DIR PD BIL'],
  ['GET /api/billing/insurance-companies', 'ADM DIR PD BIL'],
  ['GET /api/billing/appeals', 'ADM DIR PD BIL'],
  ['GET /api/billing/denials', 'ADM DIR PD BIL'],
  ['POST /api/billing/appeals/draft', 'ADM DIR PD BIL'],
  ['GET /api/medical/billing/charges', 'ADM DIR PD BIL PHY MNP'],
  ['GET /api/medical/payer-settings', 'ADM DIR PD BIL'],
  ['GET /api/medical/patients', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/labs/orders', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/prescriptions', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/ehr/notes', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/part2/disclosures', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['POST /api/sensitive-records/x/break-glass', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/dashboard/overview', 'ADM DIR PD'],
  ['GET /api/reports/library', 'ADM DIR PD OM FD BIL HR'],
  ['GET /api/crisis/episodes', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['POST /api/crisis/episodes', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['PUT /api/crisis/episodes/x', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['POST /api/crisis/paging', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['POST /api/crisis/triage', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['GET /api/residential/residents', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['GET /api/intensive/hub', 'ADM DIR PD THR CLN PSY NP CM'],
  ['POST /api/intensive/attendance', 'ADM DIR PD THR CLN PSY NP CM'],
  ['GET /api/intensive/charges', 'ADM DIR PD BIL'],
  ['GET /api/aot/participants', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['GET /api/prp/workflow', 'ADM DIR PD THR CLN PSY NP PRP CM'],
  ['GET /api/alerts', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['GET /api/risk-alerts', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['GET /api/communications/voicemails', 'ADM DIR PD OM THR PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['POST /api/connect/external-call', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['GET /api/hr/credentialing/intake-grid', 'ADM DIR PD OM HR'],
  ['GET /api/hr/dashboard', 'ADM DIR PD HR'],
  ['GET /api/hr/discipline', 'ADM DIR PD HR'],
  ['GET /api/hr/exclusions', 'ADM DIR PD OM HR'],
  ['PATCH /api/hr/people/x', 'ADM DIR PD OM HR'],
  ['GET /api/hr/me', 'ADM DIR PD OM FD BIL HR THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['PUT /api/hr/credentialing/toggle-doc', 'ADM DIR PD OM HR'],
  ['GET /api/hr/credentials', 'ALL'],
  ['GET /api/staff', 'ALL'],
  ['GET /api/inbox/items', 'ALL'],
  ['GET /api/tasks', 'ALL'],
  ['GET /api/profile', 'ALL'],
  ['GET /api/locations', 'ALL'],
  ['GET /api/marketing/analytics', 'ADM DIR PD OM'],
  ['POST /api/marketing/campaigns', 'ADM DIR PD OM'],
  ['GET /api/marketing/leads', 'ADM DIR PD OM FD'],
  ['POST /api/marketing/leads/x/convert', 'ADM DIR PD OM FD'],
];

test('API proxy gate matrix: every role x key API', () => {
  checkMatrix('api', API_MATRIX, (role, key) => {
    const [method, path] = key.split(' ');
    return canAccessApiPath(role, path, method);
  });
});

// ─── Route-level helpers (what an API returns once past the proxy) ───────────

const HELPER_MATRIX: [string, string][] = [
  ['client roster', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['edit demographics', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM CRI PHY MNP MA'],
  ['client messages', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM PEER CRI PHY MNP MA'],
  ['BH chart notes read', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['BH chart notes write', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['chart safety section', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['labs view', 'ADM DIR PD THR CLN PSY NP PHY MNP MA'],
  ['labs order', 'PSY NP PHY MNP'],
  ['labs enter results', 'ADM DIR PD CLN PSY NP PHY MNP MA'],
  ['labs review / sign off', 'PSY NP PHY MNP'],
  ['prescriptions view', 'ADM DIR PD PSY NP PHY MNP'],
  ['prescriptions write', 'PSY NP PHY MNP'],
  ['claims', 'ADM DIR PD BIL'],
  ['draft claim from locked note', 'ADM DIR PD BIL THR CLN PSY NP'],
  ['patient ledger read', 'ADM DIR PD OM FD BIL'],
  ['patient ledger post', 'ADM DIR PD BIL'],
  ['HR corner', 'ADM DIR PD HR'],
  ['Part 2 / sensitive privileged', 'ADM PD'],
  ['break-the-glass', 'ADM DIR PD THR CLN PSY NP PHY MNP'],
  ['medication list, view', 'ADM DIR PD THR CLN PSY NP CRI PHY MNP MA'],
  ['medication list, write', 'ADM DIR PD THR CLN PSY NP PHY MNP MA'],
  ['insurance / payer / copay', 'ADM DIR PD OM FD BIL THR CLN PSY NP PRP CM CRI PHY MNP MA'],
  ['BH diagnoses on client record / roster', 'ADM DIR PD BIL THR CLN PSY NP PRP CM CRI'],
  ['risk detail + SUD flag on chart banner', 'ADM DIR PD THR CLN PSY NP PRP CM CRI'],
  ['check-in scores / notes', 'ADM DIR PD THR CLN PSY NP PRP CM PEER CRI'],
  ['edit BH diagnoses', 'ADM DIR PD THR CLN PSY NP'],
  ['edit clinical risk level', 'ADM DIR PD THR CLN PSY NP CRI'],
  ['check-in entry', 'ADM DIR PD OM FD THR CLN PSY NP PRP CM CRI'],
  ['AI pre-session briefing', 'ADM DIR PD THR CLN PSY NP PHY MNP'],
  ['denials read', 'ADM DIR PD BIL'],
  ['denial status change / appeal draft', 'ADM DIR PD BIL'],
  ['primary care charge status (mark submitted)', 'ADM DIR PD BIL'],
  ['co-sign org-wide', 'ADM DIR PD'],
  ['co-sign own caseload (plus supervisees)', 'PSY'],
  ['incident review (org-wide)', 'ADM DIR PD OM'],
  ['CRISP HIE launch', 'ADM DIR PD THR CLN PSY NP PRP CM PHY MNP'],
  ['medication reminder details (notifications)', 'ADM DIR PD THR CLN PSY NP CRI PHY MNP MA'],
];

const HELPERS: Record<string, (role: string) => boolean> = {
  'client roster': canAccessClientRoster,
  'edit demographics': canEditClientProfile,
  'client messages': canAccessClientMessages,
  'BH chart notes read': canAccessClientChartNotes,
  'BH chart notes write': canWriteClientChartNotes,
  'chart safety section': (r) => sectionAllowed('safety', r),
  'labs view': canViewLabs,
  'labs order': canOrderLabs,
  'labs enter results': canEnterLabResults,
  'labs review / sign off': canReviewLabResults,
  'prescriptions view': canViewPrescriptions,
  'prescriptions write': canWritePrescriptions,
  claims: (r) => canAccessClaims(r as Role),
  'draft claim from locked note': (r) => canGenerateDraftClaim(r as Role),
  'patient ledger read': (r) => canReadLedger(r as Role),
  'patient ledger post': (r) => canMutateLedger(r as Role),
  'HR corner': (r) => canAccessHrCorner(r as Role),
  'Part 2 / sensitive privileged': isSensitivePrivilegedRole,
  'break-the-glass': canBreakGlass,
  'medication list, view': canViewClientMedications,
  'medication list, write': canWriteClientMedications,
  'insurance / payer / copay': canSeeClientInsurance,
  'BH diagnoses on client record / roster': canSeeClientDiagnoses,
  'risk detail + SUD flag on chart banner': canSeeClientRiskDetail,
  'check-in scores / notes': canSeeClientCheckIns,
  'edit BH diagnoses': canEditClientDiagnoses,
  'edit clinical risk level': canEditClientRiskLevel,
  'check-in entry': canWriteClientCheckIns,
  'AI pre-session briefing': canRequestClientBriefing,
  'denials read': canReadDenials,
  'denial status change / appeal draft': canUpdateDenialStatus,
  'primary care charge status (mark submitted)': canUpdateMedicalChargeStatus,
  'co-sign org-wide': (r) => hasCosignAuthority(r),
  'co-sign own caseload (plus supervisees)': hasCaseloadCosign,
  'incident review (org-wide)': (r) => canReviewAllIncidents(r),
  'CRISP HIE launch': canLaunchCrisp,
  'medication reminder details (notifications)': canSeeMedicationReminderDetails,
};

test('route helper matrix: every role x key helper', () => {
  checkMatrix('helper', HELPER_MATRIX, (role, key) => {
    const fn = HELPERS[key];
    assert.ok(fn, `no helper for ${key}`);
    return fn(role);
  });
});

// ─── Landing ─────────────────────────────────────────────────────────────────

const LANDING: Record<Abbr, string> = {
  ADM: '/dashboard',
  DIR: '/dashboard',
  PD: '/dashboard',
  OM: '/dashboard',
  FD: '/dashboard',
  BIL: '/dashboard',
  HR: '/dashboard',
  THR: '/dashboard',
  CLN: '/dashboard',
  PSY: '/dashboard',
  NP: '/dashboard', // psychiatric NP: prescriber role home rendered on /dashboard (PsychRoleHome)
  PRP: '/dashboard',
  CM: '/dashboard',
  PEER: '/dashboard',
  CRI: '/dashboard/crisis',
  PHY: '/dashboard/medical', // primary care overview, never the Clients list
  MNP: '/dashboard/medical',
  MA: '/dashboard/medical',
};

test('landing page per role is the role home and always a page the role can open', () => {
  for (const a of ABBRS) {
    const role = ROLES[a];
    const home = homePathForRole(role);
    assert.equal(home, LANDING[a], `${role} landing`);
    assert.equal(canAccessPath(role, home), true, `${role} cannot open its own home ${home}`);
    assert.equal(shouldBlockDashboardPath(role, home), false, `${role} home is blocked`);
    assert.ok(!home.startsWith('/dashboard/clients'), `${role} must not land on the Clients list`);
  }
  // lower-case aliases from older tokens resolve the same way
  assert.equal(homePathForRole('physician'), '/dashboard/medical');
  assert.equal(homePathForRole('medical_np'), '/dashboard/medical');
  assert.equal(homePathForRole('crisis_responder'), '/dashboard/crisis');
  assert.equal(homePathForRole('SUPER_ADMIN'), '/platform');
});

test('post-login: callbackUrl only when same-site and permitted, else the role home', () => {
  assert.equal(postLoginPath('PHYSICIAN', null), '/dashboard/medical');
  assert.equal(postLoginPath('MEDICAL_NP', ''), '/dashboard/medical');
  assert.equal(postLoginPath('NP', undefined), '/dashboard');
  assert.equal(postLoginPath('CRISIS_RESPONDER', null), '/dashboard/crisis');
  // /dashboard itself resolves to the role home
  assert.equal(postLoginPath('PHYSICIAN', '/dashboard'), '/dashboard/medical');
  // a permitted deep link is kept (query included)
  assert.equal(postLoginPath('PHYSICIAN', '/dashboard/medical/visits?patient=c1'), '/dashboard/medical/visits?patient=c1');
  assert.equal(postLoginPath('NP', '/dashboard/ehr/prescriptions'), '/dashboard/ehr/prescriptions');
  // a page the role cannot open -> home (never a bounce through a blocked page)
  assert.equal(postLoginPath('PHYSICIAN', '/dashboard/ehr/notes'), '/dashboard/medical');
  assert.equal(postLoginPath('HR', '/dashboard/clients'), '/dashboard');
  assert.equal(postLoginPath('BILLING', '/dashboard/ehr/notes'), '/dashboard');
  // open redirects and non-dashboard targets are refused
  for (const bad of ['https://evil.example/dashboard', '//evil.example/dashboard', '/\\evil', '/dashboard%2F..%2Fx', '/login', '/api/clients', 'dashboard/clients']) {
    assert.equal(postLoginPath('ADMIN', bad), '/dashboard', bad);
  }
  // platform admin: /platform targets only
  assert.equal(postLoginPath('SUPER_ADMIN', '/dashboard/clients'), '/platform');
  assert.equal(postLoginPath('SUPER_ADMIN', '/platform/orgs'), '/platform/orgs');
  assert.equal(postLoginPath(null, '/dashboard/clients'), '/dashboard');
});

// ─── Minimum-necessary invariants (spelled out so the intent survives refactors) ─

const PHI_PAGES = [
  '/dashboard/clients',
  '/dashboard/ehr/notes',
  '/dashboard/appointments',
  '/dashboard/messages',
  '/dashboard/alerts',
  '/dashboard/crisis',
  '/dashboard/billing',
  '/dashboard/medical',
  '/dashboard/telehealth',
  '/dashboard/notifications',
];
const PHI_APIS = [
  '/api/clients',
  '/api/clinical/medications',
  '/api/ehr/notes',
  '/api/appointments',
  '/api/messages',
  '/api/billing/claims',
  '/api/medical/patients',
  '/api/labs/orders',
  '/api/alerts',
  '/api/crisis/episodes',
  '/api/telehealth/sessions',
  '/api/sensitive-records/x/break-glass',
  '/api/dashboard/overview',
];

test('HR never reaches client PHI (pages or APIs)', () => {
  for (const p of PHI_PAGES) assert.equal(canAccessPath('HR', p), false, `HR page ${p}`);
  for (const p of PHI_APIS) {
    for (const m of ['GET', 'POST']) assert.equal(canAccessApiPath('HR', p, m), false, `HR ${m} ${p}`);
  }
  assert.equal(canAccessClientRoster('HR'), false);
  assert.equal(canAccessClientChartNotes('HR'), false);
  assert.equal(canBreakGlass('HR'), false);
  // HR keeps its own workspace
  assert.equal(canAccessApiPath('HR', '/api/hr/credentials'), true);
  assert.equal(canAccessApiPath('HR', '/api/hr/credentialing/intake-grid'), true);
  assert.equal(canAccessApiPath('HR', '/api/staff'), true);
  assert.equal(canAccessApiPath('HR', '/api/profile'), true);
});

test('Front Desk and Office Manager: scheduling / demographics / insurance, no BH note bodies', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER']) {
    assert.equal(canAccessClientChartNotes(r), false, `${r} reads notes`);
    assert.equal(canWriteClientChartNotes(r), false, `${r} writes notes`);
    assert.equal(canAccessPath(r, '/dashboard/ehr/notes'), false);
    assert.equal(canAccessPath(r, '/dashboard/appointments'), true);
    assert.equal(canAccessPath(r, '/dashboard/ehr/eligibility'), true);
    assert.equal(canEditClientProfile(r), true);
  }
  assert.equal(sectionAllowed('safety', 'FRONT_DESK'), false, 'risk alerts / C-SSRS not for Front Desk');
});

test('Billing: roster, insurance and billing; never notes, alerts or crisis', () => {
  assert.equal(canAccessClientRoster('BILLING'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/ehr/eligibility'), true);
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/claims'), true);
  assert.equal(canAccessClientChartNotes('BILLING'), false);
  assert.equal(sectionAllowed('safety', 'BILLING'), false);
  assert.equal(canAccessApiPath('BILLING', '/api/alerts'), false);
  assert.equal(canAccessApiPath('BILLING', '/api/crisis/episodes', 'GET'), false);
  assert.equal(canAccessApiPath('BILLING', '/api/crisis/episodes', 'POST'), false);
  assert.equal(canBreakGlass('BILLING'), false);
});

test('primary care roles: no behavioral-health notes, BH alerts or crisis lists', () => {
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    assert.equal(canAccessClientChartNotes(r), false, r);
    assert.equal(canWriteClientChartNotes(r), false, r);
    assert.equal(canAccessPath(r, '/dashboard/ehr/notes'), false, r);
    assert.equal(canAccessPath(r, '/dashboard/alerts'), false, r);
    assert.equal(canAccessApiPath(r, '/api/alerts'), false, r);
    assert.equal(canAccessApiPath(r, '/api/crisis/episodes', 'GET'), false, r);
    assert.equal(canAccessPath(r, '/dashboard/medical'), true, r);
    assert.equal(canAccessPath(r, '/dashboard/settings'), true, `${r} own profile`);
  }
  assert.equal(canWritePrescriptions('MEDICAL_ASSISTANT'), false);
  assert.equal(canOrderLabs('MEDICAL_ASSISTANT'), false);
});

test('crisis escalation from telehealth stays open to every clinical role', () => {
  for (const a of ABBRS) {
    const r = ROLES[a];
    const want = r !== 'HR' && r !== 'BILLING';
    assert.equal(canAccessApiPath(r, '/api/crisis/episodes', 'POST'), want, r);
    assert.equal(canAccessApiPath(r, '/api/crisis/paging', 'POST'), want, r);
    if (canAccessPath(r, '/dashboard/telehealth')) assert.equal(want, true, `${r} telehealth without escalation`);
  }
});

test('therapist: no prescribing, no lab ordering; peer support: no notes or safety section', () => {
  assert.equal(canWritePrescriptions('THERAPIST'), false);
  assert.equal(canOrderLabs('THERAPIST'), false);
  assert.equal(canReviewLabResults('THERAPIST'), false);
  assert.equal(canAccessClientChartNotes('PEER_SUPPORT'), false);
  assert.equal(canWriteClientChartNotes('PEER_SUPPORT'), false);
  assert.equal(sectionAllowed('safety', 'PEER_SUPPORT'), false);
});

test('a page a role can open is never backed by an API the proxy refuses for that role', () => {
  const PAGE_API: [string, string, string][] = [
    ['/dashboard/crisis', 'GET', '/api/crisis/episodes'],
    ['/dashboard/residential', 'GET', '/api/residential/residents'],
    ['/dashboard/programs/intensive', 'GET', '/api/intensive/hub'],
    ['/dashboard/programs/intensive/billing', 'GET', '/api/intensive/charges'],
    ['/dashboard/aot', 'GET', '/api/aot/participants'],
    ['/dashboard/prp', 'GET', '/api/prp/workflow'],
    ['/dashboard/prp/assessment', 'GET', '/api/prp/workflow'],
    ['/dashboard/alerts', 'GET', '/api/alerts'],
    ['/dashboard/communications', 'GET', '/api/communications/voicemails'],
    ['/dashboard/telehealth', 'POST', '/api/connect/external-call'],
    ['/dashboard/hr/credentialing', 'GET', '/api/hr/credentialing/intake-grid'],
    ['/dashboard/billing/statements', 'GET', '/api/billing/statements'],
    ['/dashboard/billing/denials', 'GET', '/api/billing/denials'],
    ['/dashboard/medical/billing', 'GET', '/api/medical/billing/charges'],
    ['/dashboard/clients', 'GET', '/api/clients'],
  ];
  for (const [page, method, api] of PAGE_API) {
    for (const a of ABBRS) {
      const r = ROLES[a];
      if (canAccessPath(r, page)) {
        assert.equal(canAccessApiPath(r, api, method), true, `${r} opens ${page} but ${method} ${api} is refused`);
      }
    }
  }
  // Primary care Labs page: same readers as the lab API
  for (const a of ABBRS) {
    const r = ROLES[a];
    if (canAccessPath(r, '/dashboard/medical/labs')) assert.equal(canViewLabs(r), true, `${r} medical labs page vs lab API`);
  }
});

// ─── Follow-up security fixes (peer support sweep, stub charges) ─────────────

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('chart sections are deny-by-default; Peer Support and HR get none of them', () => {
  for (const s of CHART_SECTIONS) assert.equal(sectionAllowed(s, 'PEER_SUPPORT'), false, `peer ${s}`);
  for (const s of CHART_SECTIONS) assert.equal(sectionAllowed(s, 'HR'), false, `HR ${s}`);
  assert.equal(sectionAllowed('not-a-section' as never, 'ADMIN'), false, 'unknown section refused');
  assert.equal(sectionAllowed('programs', 'FRONT_DESK'), false);
  assert.equal(sectionAllowed('programs', 'THERAPIST'), true);
  assert.equal(sectionAllowed('care-team', 'FRONT_DESK'), true);
});

test('Peer Support caseload = assigned OR on the care team (same as the peer workspace)', () => {
  const where = clientAccessWhere({ organizationId: 'org-1', actorUserId: 'peer-1', actorRole: 'PEER_SUPPORT' });
  assert.deepEqual((where as { AND: unknown[] }).AND[1], {
    OR: [{ assignedToId: 'peer-1' }, { treatmentTeamMembers: { some: { providerId: 'peer-1' } } }],
  });
  const cm = clientAccessWhere({ organizationId: 'org-1', actorUserId: 'cm-1', actorRole: 'CASE_MANAGER' });
  assert.deepEqual(noDates((cm as { AND: unknown[] }).AND[1]), { OR: [{ assignedToId: 'cm-1' }, { treatmentTeamMembers: { some: { providerId: 'cm-1' } } }, { appointments: { some: { clinicianId: 'cm-1', startsAt: { gte: 'D' } } } }] });
});

test('chart banner: Peer Support gets no payer, authorization, C-SSRS / alert detail or SUD flag', async () => {
  const client = {
    id: 'c1', name: 'Jane Doe', legalFirstName: 'Jane', middleInitial: null, legalLastName: 'Doe', mrn: 'A1',
    dateOfBirth: null, status: 'ACTIVE', riskLevel: 'LOW', assignedToId: 'peer-1', assignedToName: 'Peer',
    locationName: null, insurancePayer: 'Medicaid', insuranceMemberId: '123456789',
    primaryDiagnosis: 'Opioid use disorder', primaryDiagnosisCode: 'F11.20', secondaryDiagnoses: null,
  };
  const source: ChartBannerSource = {
    findClient: async () => client,
    sensitiveState: async () => 'none',
    sensitiveAlias: async () => null,
    hasForwardedThread: async () => false,
    allergies: async () => [],
    priorAuths: async () =>
      [{ id: 'pa1', payer: 'Medicaid', authNumber: 'A-1', cptCodes: ['90837'], unitsApproved: 10, unitsUsed: 1, status: 'APPROVED', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01') }] as never,
    riskAlerts: async () => [],
    latestCssrs: async () => ({ id: 'cs1', instrumentName: 'C-SSRS', totalScore: 5, severity: 'high', safetyFlagged: true, createdAt: new Date('2026-10-01') }),
    nextAppointment: async () => null,
    balanceCents: async () => null,
    sessionFrequency: async () => null,
  };
  const now = new Date('2026-10-18T12:00:00Z');
  const peer = await loadChartBanner(source, { organizationId: 'o', userId: 'peer-1', role: 'PEER_SUPPORT', billingVisible: false }, 'c1', now);
  assert.ok(peer.ok && peer.banner.locked === false);
  if (peer.ok && peer.banner.locked === false) {
    assert.equal(peer.banner.payer, null);
    assert.equal(peer.banner.authorization, null);
    assert.equal(peer.banner.risk.latestCssrs, null);
    assert.equal(peer.banner.risk.latestAlert, null);
    assert.equal(peer.banner.protection.sudDiagnosis, false);
    assert.equal(peer.banner.risk.level, 'high', 'generic safety flag kept: follow the safety protocol');
  }
  const ther = await loadChartBanner(source, { organizationId: 'o', userId: 'peer-1', role: 'THERAPIST', billingVisible: false }, 'c1', now);
  assert.ok(ther.ok && ther.banner.locked === false);
  if (ther.ok && ther.banner.locked === false) {
    assert.ok(ther.banner.payer);
    assert.ok(ther.banner.risk.latestCssrs);
    assert.equal(ther.banner.protection.sudDiagnosis, true);
  }
});

test('program boards: peer / case manager / PRP see only rows linked to their caseload', () => {
  for (const r of ['PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST']) assert.equal(programRowsNeedCaseload(r), true, r);
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CRISIS_RESPONDER']) {
    assert.equal(programRowsNeedCaseload(r), false, r);
  }
  const rows = [{ clientId: 'a' }, { clientId: 'b' }, { clientId: null }];
  assert.deepEqual(filterRowsToCaseload(rows, new Set(['a'])), [{ clientId: 'a' }]);
  assert.deepEqual(filterRowsToCaseload(rows, null), rows);
  for (const f of ['src/app/api/crisis/episodes/route.ts', 'src/app/api/residential/residents/route.ts', 'src/app/api/aot/participants/route.ts']) {
    assert.match(src(f), /filterRowsToCaseload\(/, f);
  }
});

test('referrals module data uses the referrals page roles (incl. Peer Support)', () => {
  for (const a of ABBRS) {
    const r = ROLES[a];
    assert.equal(canUseClinicModule(r, 'referrals'), canAccessPath(r, '/dashboard/community/referrals'), r);
  }
  assert.equal(canUseClinicModule('PEER_SUPPORT', 'referrals'), true);
});

test('one-client clinical APIs run the role rule + chart rule and audit DENIED', () => {
  const gated: [string, RegExp][] = [
    ['src/app/api/clients/[id]/medications/route.ts', /canWriteClientMedications/],
    ['src/app/api/clients/[id]/safety-check/route.ts', /canViewClientMedications/],
    ['src/app/api/drfirst/medications/route.ts', /canViewClientMedications/],
    ['src/app/api/telehealth/in-call/route.ts', /canAccessClientChartNotes/],
    ['src/app/api/telehealth/room/[appointmentId]/route.ts', /canAccessClientAppointments/],
    ['src/app/fhir/launch/route.ts', /gateClientRoute/],
    ['src/app/api/clients/[id]/briefing/route.ts', /canRequestClientBriefing/],
    ['src/app/api/clients/[id]/check-ins/route.ts', /canWriteClientCheckIns/],
  ];
  for (const [f, re] of gated) {
    const s = src(f);
    assert.match(s, re, f);
    assert.match(s, /DENIED/, `${f} audits denials`);
  }
  for (const f of ['src/app/api/clients/[id]/medications/route.ts', 'src/app/api/clients/[id]/safety-check/route.ts', 'src/app/api/drfirst/medications/route.ts', 'src/app/fhir/launch/route.ts']) {
    assert.match(src(f), /gateClientRoute\(/, `${f} uses the chart rule`);
  }
  assert.match(src('src/app/api/sensitive-records/[clientId]/break-glass/route.ts'), /isLeadershipRole[\s\S]*clientAccessWhere/);
  assert.match(src('src/app/fhir/launch/route.ts'), /startsWith\('demo-'\) && !DEMO_MODE/);
  assert.match(src('src/app/api/clients/[id]/care-team/route.ts'), /already on the care team/);
  assert.match(src('src/app/api/clients/[id]/route.ts'), /peerView \? null : client\.insurancePayer/);
  assert.match(src('src/app/api/clients/[id]/route.ts'), /peerView && 'primaryDiagnosis' in detail[\s\S]*primaryDiagnosis: null/);
  assert.match(src('src/lib/clients/manage.ts'), /canSeeClientDiagnoses\(actor\.role\)/);
  assert.match(src('src/lib/clients/manage.ts'), /canSeeClientInsurance\(actor\.role\)/);
});

test('stub (no-money) charges: development + ALLOW_STUB_CHARGES=1 only', () => {
  assert.equal(stubChargesAllowed({ NODE_ENV: 'production', ALLOW_STUB_CHARGES: '1' }), false);
  assert.equal(stubChargesAllowed({ NODE_ENV: 'test', ALLOW_STUB_CHARGES: '1' }), false, 'staging / test builds');
  assert.equal(stubChargesAllowed({ NODE_ENV: 'development' }), false, 'needs the explicit flag');
  assert.equal(stubChargesAllowed({ NODE_ENV: 'development', ALLOW_STUB_CHARGES: 'true' }), false);
  assert.match(src('src/app/api/billing/payments/charge/route.ts'), /stubChargesAllowed\(\)[\s\S]*DENIED/);
  assert.match(src('src/lib/billing/ledger.ts'), /input\.method === 'STUB' && !stubChargesAllowed\(\)/);
});

// ─── Least-privilege pass (Oct 20 2026): data-level fixes ────────────────────

test('task feeds follow the page each task links to (no risk text, plan diagnoses or claims for the wrong roles)', () => {
  const fd = taskSourcesForRole('FRONT_DESK');
  assert.equal(fd.riskAlerts, false, 'Front Desk: no risk alert descriptions');
  assert.equal(fd.treatmentPlans, false);
  assert.equal(fd.draftNotes, false);
  assert.equal(fd.claims, false);
  assert.equal(fd.intakeAndWaitlist, true);
  assert.equal(fd.consents, true);
  for (const r of ['BILLING', 'PEER_SUPPORT', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'OFFICE_MANAGER']) {
    assert.equal(taskSourcesForRole(r).riskAlerts, false, `${r} risk alerts`);
  }
  for (const r of ['THERAPIST', 'PEER_SUPPORT', 'CASE_MANAGER', 'PHYSICIAN', 'BILLING']) {
    assert.equal(taskSourcesForRole(r).intakeAndWaitlist, false, `${r} intake / waitlist outside their work`);
  }
  assert.equal(taskSourcesForRole('BILLING').claims, true);
  assert.equal(taskSourcesForRole('THERAPIST').claims, false);
  assert.equal(taskSourcesForRole('THERAPIST').riskAlerts, true);
  assert.equal(taskSourcesForRole('THERAPIST').missingNotes, true);
  assert.equal(taskSourcesForRole('OFFICE_MANAGER').missingNotes, false);
  const tasks = src('src/lib/tasks/manage.ts');
  assert.doesNotMatch(tasks, /clinician: \{ organizationId: input\.organizationId \}/, 'no org-wide appointment branch for caseload roles');
  assert.doesNotMatch(tasks, /plan\.diagnosisCodes\[0\]/, 'no diagnosis code in task text');
  const route = src('src/app/api/tasks/route.ts');
  assert.match(route, /lockedSensitiveClientIds\(/);
  assert.match(route, /maskLockedTasks\(raw, locked\)/);
  assert.match(route, /resourceType: 'task'/);
});

test('tasks about protected clients are masked; a failed lookup masks every client task', () => {
  const t = (id: string, clientId?: string): StaffTask => ({
    taskId: id, type: 'risk_alert', priority: 'urgent', title: 'Unreviewed risk alert', description: 'SI with plan',
    clientName: 'Jane Doe', clientId, actionLabel: 'Review', actionHref: '/dashboard/alerts',
  });
  const out = maskLockedTasks([t('a', 'c1'), t('b', 'c2'), t('c')], new Set(['c1']));
  assert.equal(out[0].clientName, 'Protected Client');
  assert.ok(!out[0].description.includes('SI'));
  assert.equal(out[0].clientId, undefined);
  assert.equal(out[1].clientName, 'Jane Doe');
  assert.equal(out[2].description, 'SI with plan', 'no client: unchanged');
  const failed = maskLockedTasks([t('a', 'c2')], null);
  assert.equal(failed[0].clientName, 'Protected Client');
});

test('messages: Front Desk / Office Manager read administrative topics only; assignee match is exact', () => {
  assert.equal(messageTopicsRestricted('FRONT_DESK'), true);
  assert.equal(messageTopicsRestricted('OFFICE_MANAGER'), true);
  for (const r of ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'THERAPIST', 'PSYCHIATRIST']) assert.equal(messageTopicsRestricted(r), false, r);
  assert.deepEqual([...ADMIN_MESSAGE_TOPICS].sort(), ['BILLING', 'GENERAL', 'SCHEDULING']);
  const or = threadAssigneeOr({ userId: 'u1', name: ' Ann Lee ', email: 'ann@x.test' });
  assert.ok(!JSON.stringify(or).includes('contains'), 'no substring match');
  assert.deepEqual(or[1], { forwardedTo: { equals: 'Ann Lee', mode: 'insensitive' } });
  const manage = src('src/lib/messages/manage.ts');
  assert.match(manage, /OR: \[\{ topic: \{ in: ADMIN_MESSAGE_TOPICS \} \}, \.\.\.assignee\]/);
  assert.match(manage, /lockedSensitiveClientIds\(/);
  assert.match(manage, /assertClientPhiAccess\(/);
  for (const f of ['src/lib/messages/manage.ts', 'src/lib/clients/chartAccess.ts', 'src/lib/clients/notes.ts', 'src/app/api/clients/[id]/route.ts']) {
    assert.doesNotMatch(src(f), /contains: actorName/, `${f}: substring name match`);
  }
});

test('client record: diagnoses / check-ins / risk detail per role; profile edits cannot change diagnoses or risk', () => {
  for (const r of ['FRONT_DESK', 'OFFICE_MANAGER']) {
    assert.equal(canSeeClientDiagnoses(r), false, r);
    assert.equal(canSeeClientCheckIns(r), false, r);
    assert.equal(canSeeClientRiskDetail(r), false, r);
    assert.equal(canSeeClientInsurance(r), true, r);
    assert.equal(canEditClientDiagnoses(r), false, r);
    assert.equal(canEditClientRiskLevel(r), false, r);
  }
  assert.equal(canSeeClientDiagnoses('BILLING'), true, 'codes for claims');
  assert.equal(canSeeClientCheckIns('BILLING'), false);
  const detail = src('src/app/api/clients/[id]/route.ts');
  assert.match(detail, /if \(!canEditClientDiagnoses\(gate\.role\)\) \{[\s\S]*delete \(body as Record<string, unknown>\)\.primaryDiagnosis;/);
  assert.match(detail, /if \(!canEditClientRiskLevel\(gate\.role\)\) delete \(body as Record<string, unknown>\)\.riskLevel;/);
  const roster = src('src/lib/clients/manage.ts');
  assert.match(roster, /avgMood: locked \|\| !checkInsVisible \? 0 : avgMood/);
  const modal = src('src/features/clients/components/EditClientModal.tsx');
  assert.match(modal, /\.\.\.\(canEditDx\s*\?/);
});

test('chart banner: Front Desk keeps payer and the risk level, not C-SSRS / alert detail or the SUD flag', async () => {
  const client = {
    id: 'c1', name: 'Jane Doe', legalFirstName: 'Jane', middleInitial: null, legalLastName: 'Doe', mrn: 'A1',
    dateOfBirth: null, status: 'ACTIVE', riskLevel: 'HIGH', assignedToId: 't1', assignedToName: 'Ther',
    locationName: null, insurancePayer: 'Medicaid', insuranceMemberId: '123456789',
    primaryDiagnosis: 'Opioid use disorder', primaryDiagnosisCode: 'F11.20', secondaryDiagnoses: null,
  };
  const source: ChartBannerSource = {
    findClient: async () => client,
    sensitiveState: async () => 'none',
    sensitiveAlias: async () => null,
    hasForwardedThread: async () => false,
    allergies: async () => [],
    priorAuths: async () => [],
    riskAlerts: async () => [],
    latestCssrs: async () => ({ id: 'cs1', instrumentName: 'C-SSRS', totalScore: 5, severity: 'high', safetyFlagged: true, createdAt: new Date('2026-10-01') }),
    nextAppointment: async () => null,
    balanceCents: async () => null,
    sessionFrequency: async () => null,
  };
  const fd = await loadChartBanner(source, { organizationId: 'o', userId: 'fd', role: 'FRONT_DESK', billingVisible: false }, 'c1', new Date('2026-10-18T12:00:00Z'));
  assert.ok(fd.ok && fd.banner.locked === false);
  if (fd.ok && fd.banner.locked === false) {
    assert.ok(fd.banner.payer, 'insurance kept for eligibility');
    assert.equal(fd.banner.risk.latestCssrs, null);
    assert.equal(fd.banner.risk.latestAlert, null);
    assert.equal(fd.banner.protection.sudDiagnosis, false, 'Part 2 SUD flag hidden');
    assert.equal(fd.banner.risk.level, 'high', 'generic safety flag kept');
  }
});

test('supervision logs: cases and topics only for the supervisor / supervisee; no sign-off on their behalf', () => {
  const log = {
    id: 'l1', organizationId: 'o', supervisorId: 's1', supervisorName: 'S', superviseeId: 'e1', superviseeName: 'E',
    sessionAt: '2026-10-01', sessionType: 'Individual', durationMin: 60, hoursTowardLicensure: 1, hoursCredited: 1,
    topics: 'Client J.D. SI risk', clientRefs: ['J.D.'], signedBySupervisorAt: null, signedBySuperviseeAt: null, createdAt: '2026-10-01',
  } as SupervisionLogItem;
  const hr = redactSupervisionForViewer(log, 'hr-user');
  assert.deepEqual(hr.clientRefs, []);
  assert.equal(hr.topics, '');
  assert.equal(hr.hoursCredited, 1, 'hours stay');
  assert.deepEqual(redactSupervisionForViewer(log, 's1').clientRefs, ['J.D.']);
  assert.deepEqual(redactSupervisionForViewer(log, 'e1').clientRefs, ['J.D.']);
  const lib = src('src/lib/hr/supervision.ts');
  assert.doesNotMatch(lib, /!hr && existing\./, 'HR / leadership bypass removed');
  assert.match(lib, /if \(existing\.supervisorId !== actor\.actorUserId\)/);
});

test('clinic modules: practice admin, admin audit log and legacy Part 2 audit are not HR / Office Manager data', () => {
  for (const m of ['admin-integrations', 'admin-notification-rules', 'admin-compliance']) {
    for (const r of ['HR', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING']) {
      assert.equal(canUseClinicModule(r as never, m), false, `${r} ${m}`);
      assert.equal(canReadClinicModule(r as never, m), false, `${r} read ${m}`);
    }
    assert.equal(canUseClinicModule('ADMIN', m), true);
    assert.equal(canUseClinicModule('PRACTICE_DIRECTOR', m), true);
  }
  assert.equal(canUseClinicModule('DIRECTOR', 'admin-audit-log'), false, 'audit log: ADMIN / PRACTICE_DIRECTOR');
  assert.equal(canUseClinicModule('ADMIN', 'admin-audit-log'), true);
  assert.equal(canUseClinicModule('HR', 'admin-audit-log'), false);
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'BILLING', 'OFFICE_MANAGER', 'THERAPIST']) {
    assert.equal(canUseClinicModule(r as never, 'part2-audit'), false, `${r} writes legacy Part 2 audit`);
  }
  assert.equal(canReadClinicModule('PRACTICE_DIRECTOR', 'part2-audit'), true);
  assert.equal(canReadClinicModule('ADMIN', 'part2-audit'), true);
  for (const r of ['BILLING', 'OFFICE_MANAGER', 'THERAPIST', 'PRP_SPECIALIST', 'DIRECTOR']) {
    assert.equal(canReadClinicModule(r as never, 'part2-audit'), false, `${r} reads legacy Part 2 audit`);
  }
  assert.match(src('src/app/dashboard/ehr/part2/page.tsx'), /legacy=\{privileged \? legacyAudit : \[\]\}/);
  assert.equal(canUseClinicModule('THERAPIST', 'invoices'), false, 'no clinician billing modules');
  assert.equal(canUseClinicModule('FRONT_DESK', 'invoices'), true);
});

test('CRISP HIE launch and page: treating roles only (no Office Manager, Peer Support or Medical Assistant)', () => {
  for (const r of ['OFFICE_MANAGER', 'PEER_SUPPORT', 'FRONT_DESK', 'BILLING', 'HR', 'MEDICAL_ASSISTANT']) {
    assert.equal((LAUNCH_ROLES as readonly string[]).includes(r), false, r);
    assert.equal(canLaunchCrisp(r), false, r);
    assert.equal(canAccessPath(r, '/dashboard/ehr/hie'), false, r);
  }
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'PRP_SPECIALIST', 'ADMIN', 'PRACTICE_DIRECTOR', 'PHYSICIAN', 'MEDICAL_NP']) {
    assert.equal((LAUNCH_ROLES as readonly string[]).includes(r), true, r);
    assert.equal(canLaunchCrisp(r), true, r);
    assert.equal(canAccessPath(r, '/dashboard/ehr/hie'), true, r);
  }
  // Legacy lowercase role strings are normalized
  assert.equal(canLaunchCrisp('physician'), true);
  assert.equal(canLaunchCrisp('medical_np'), true);
  // Primary care launch uses the same caseload / care-team gate as the BH prescribers
  const launch = src('src/app/fhir/launch/route.ts');
  assert.match(launch, /canLaunchCrisp\(gate\.role\)/);
  assert.match(launch, /gateClientRoute\(/);
});

test('Office Manager: operations, not clinical boards; still escalates a crisis', () => {
  for (const p of ['/dashboard/alerts', '/dashboard/crisis', '/dashboard/residential', '/dashboard/aot', '/dashboard/prp', '/dashboard/ehr/scanner', '/dashboard/ehr/hie', '/dashboard/hr']) {
    assert.equal(canAccessPath('OFFICE_MANAGER', p), false, p);
  }
  for (const p of ['/dashboard/appointments', '/dashboard/clients/waitlist', '/dashboard/ehr/consents', '/dashboard/billing/payments', '/dashboard/hr/credentialing', '/dashboard/hr/training', '/dashboard/admin/scheduling-settings', '/dashboard/ehr/part2']) {
    assert.equal(canAccessPath('OFFICE_MANAGER', p), true, p);
  }
  assert.equal(canAccessApiPath('OFFICE_MANAGER', '/api/crisis/episodes', 'POST'), true);
  assert.equal(canAccessApiPath('OFFICE_MANAGER', '/api/crisis/paging', 'POST'), true);
  assert.equal(canAccessApiPath('OFFICE_MANAGER', '/api/alerts'), false);
});
