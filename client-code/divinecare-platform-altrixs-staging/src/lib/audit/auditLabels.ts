/**
 * Human-readable labels for HIPAA audit rows. Pure and browser-safe: works only from the
 * stored action / resourceType strings (which carry no PHI) and never from metadata.
 */

/** Actions that read or export patient data (used for "PHI reads" counts and the volume rule). */
export const PHI_READ_ACTIONS = [
  'READ',
  'LIST',
  'EXPORT',
  'FHIR_PATIENT_READ',
  'AI_ACCESS',
  'BREAK_GLASS',
] as const;

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type AuditOutcomeValue = (typeof AUDIT_OUTCOMES)[number];

const ACTION_LABELS: Record<string, string> = {
  READ: 'Viewed',
  LIST: 'Viewed list',
  WRITE: 'Saved',
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  EXPORT: 'Exported',
  SUBMIT: 'Submitted',
  UPLOAD: 'Uploaded',
  AI_ACCESS: 'AI processed',
  BREAK_GLASS: 'Break-the-glass access',
  NOTE_SIGN: 'Signed note',
  NOTE_LOCK: 'Locked note',
  NOTE_ADDENDUM: 'Added note addendum',
  NOTE_COSIGN: 'Co-signed note',
  NOTE_TYPE_CHANGE: 'Changed note type',
  NOTE_DISMISS: 'Dismissed unsigned note',
  NOTE_DISMISS_UNDO: 'Undid note dismissal',
  FILE_TO_CHART: 'Filed to chart',
  SPLIT: 'Split document',
  ELIGIBILITY_CHECK: 'Checked eligibility',
  DRFIRST_SSO_LAUNCH: 'Opened DrFirst (e-prescribing)',
  TELEHEALTH_JOIN: 'Joined telehealth session',
  TELEHEALTH_CHECK_IN: 'Telehealth check-in',
  FHIR_PATIENT_READ: 'FHIR patient read',
  LOGIN: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  LOGOUT: 'Signed out',
  PART2_DISCLOSURE_RECORDED: 'Recorded Part 2 disclosure',
  PROTECTED_RECORD_DENIED: 'Protected record access denied',
};

const RESOURCE_LABELS: Record<string, string> = {
  auditLog: 'HIPAA audit log',
  auditLogSummary: 'HIPAA audit log summary',
  auditLogExport: 'HIPAA audit log export',
  auditLogMonitoring: 'Unusual-access review',
  reportLibrary: 'Report library report',
  outcomesReport: 'Outcomes report',
  populationHealth: 'Population health report',
  progressNote: 'Progress note',
  clinicalNote: 'Clinical note',
  officeNote: 'Office note',
  treatmentPlan: 'Treatment plan',
  sensitiveRecord: 'Protected record settings',
  sensitiveAccessLog: 'Protected record access log',
  sensitiveRecordWhitelist: 'Protected record access list',
  part2Disclosure: 'Part 2 disclosure',
  part2DisclosureAccounting: 'Part 2 accounting of disclosures',
  part2AuditTrail: 'Part 2 audit trail',
  patient: 'Patient',
  Patient: 'Patient',
  Client: 'Client record',
  client: 'Client record',
  medicalPatient: 'Primary care patient',
  claim: 'Claim',
  Claim: 'Claim',
  priorAuth: 'Prior authorization',
  eligibilityCheck: 'Eligibility check',
  telehealthSession: 'Telehealth session',
  migrationJob: 'Data import job',
};

function humanize(raw: string): string {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : raw;
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return 'Unknown action';
  return ACTION_LABELS[action] ?? humanize(action);
}

/** "chart:access-log" → "Client chart · Access log"; "progressNote" → "Progress note". */
export function describeResource(resourceType: string | null | undefined): string {
  if (!resourceType) return 'General';
  if (RESOURCE_LABELS[resourceType]) return RESOURCE_LABELS[resourceType];
  const [head, ...rest] = resourceType.split(':');
  if (rest.length) {
    const headLabel = head === 'chart' ? 'Client chart' : RESOURCE_LABELS[head] ?? humanize(head);
    return `${headLabel} · ${humanize(rest.join(' '))}`;
  }
  return humanize(resourceType);
}

export function outcomeLabel(outcome: string | null | undefined): string {
  if (outcome === 'SUCCESS') return 'Success';
  if (outcome === 'FAILURE') return 'Failed';
  if (outcome === 'DENIED') return 'Denied';
  return outcome || 'Unknown';
}

/** Protected-record access types from SensitiveAccessLog. */
export function sensitiveAccessLabel(accessType: string | null | undefined): string {
  switch (accessType) {
    case 'whitelist':
      return 'Opened (on access list)';
    case 'break_the_glass':
      return 'Opened (break-the-glass)';
    case 'admin_bypass':
      return 'Opened (leadership access)';
    case 'denied':
      return 'Access denied';
    default:
      return accessType ? humanize(accessType) : 'Unknown';
  }
}
