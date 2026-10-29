/**
 * Client chart tab set, in display order. `key` is the ?tab= deep-link value; `aliases` keep
 * older links working (?tab=Measures, ?tab=insurance, ?tab=alerts …). Pure: safe for tests.
 * `group: 'medical'` = the primary-care tab group (src/lib/medical/medicalProgram.ts decides
 * when it shows). The problem list and lab orders are NOT duplicated there: they stay in
 * "Diagnoses & problems" and "Labs".
 */
export const CHART_TABS = [
  { key: 'summary', label: 'Summary', aliases: ['overview'] },
  { key: 'notes', label: 'Notes', aliases: ['progress-notes'] },
  { key: 'office-notes', label: 'Office notes', aliases: [] },
  { key: 'check-ins', label: 'Check-ins', aliases: ['checkins'] },
  { key: 'appointments', label: 'Appointments', aliases: ['schedule'] },
  { key: 'treatment-plan', label: 'Treatment plan', aliases: ['treatment-plans', 'plan'] },
  { key: 'assessments', label: 'Assessments & outcomes', aliases: ['measures', 'outcomes', 'mbc'] },
  { key: 'diagnoses', label: 'Diagnoses & problems', aliases: ['problems', 'diagnosis'] },
  { key: 'medications', label: 'Medications & eRx', aliases: ['meds', 'erx', 'prescriptions'] },
  { key: 'labs', label: 'Labs', aliases: ['lab'] },
  { key: 'safety', label: 'Safety plan & risk', aliases: ['alerts', 'risk', 'safety-plan'] },
  { key: 'documents', label: 'Documents & consents', aliases: ['consents', 'docs'] },
  { key: 'authorizations', label: 'Authorizations', aliases: ['prior-auths', 'prior-auth', 'auth'] },
  { key: 'billing', label: 'Billing & insurance', aliases: ['insurance', 'eligibility'] },
  { key: 'care-team', label: 'Care team & referrals', aliases: ['team', 'referrals'] },
  { key: 'messages', label: 'Messages', aliases: [] },
  { key: 'programs', label: 'Programs', aliases: ['prp'] },
  { key: 'discharge', label: 'Discharge', aliases: [] },
  { key: 'medical-visits', label: 'Visits & SOAP', aliases: ['medical', 'visits', 'soap', 'encounters'], group: 'medical' },
  { key: 'medical-vitals', label: 'Vitals flowsheet', aliases: ['vitals', 'flowsheet'], group: 'medical' },
  { key: 'medical-preventive', label: 'Preventive care', aliases: ['preventive', 'preventive-care', 'care-gaps'], group: 'medical' },
  { key: 'medical-history', label: 'Medical history', aliases: ['history', 'pmh'], group: 'medical' },
  { key: 'medical-orders', label: 'Orders & referrals', aliases: ['orders', 'imaging', 'medical-referrals'], group: 'medical' },
  { key: 'medical-ai', label: 'Medical AI', aliases: ['ai', 'medical-ai-suite'], group: 'medical' },
  { key: 'access-log', label: 'Access log', aliases: ['audit'] },
] as const;

/** Tab group label shown before a group's first visible tab */
export const CHART_TAB_GROUP_LABELS = { medical: 'Medical' } as const;

export function chartTabGroup(key: string): keyof typeof CHART_TAB_GROUP_LABELS | null {
  const t = CHART_TABS.find((x) => x.key === key);
  return t && 'group' in t ? t.group : null;
}

export type ChartTabKey = (typeof CHART_TABS)[number]['key'];

const slug = (v: string) => v.trim().toLowerCase().replace(/[\s_&]+/g, '-').replace(/-+/g, '-');

/** ?tab= value -> tab key (case/space-insensitive, aliases), or null when unknown */
export function chartTabFromParam(param: string | null | undefined): ChartTabKey | null {
  if (!param) return null;
  const s = slug(param);
  for (const t of CHART_TABS) {
    if (t.key === s || (t.aliases as readonly string[]).includes(s) || slug(t.label) === s) return t.key;
  }
  return null;
}

/**
 * The tab to show: the requested one when it exists and is visible, else Summary, else (roles
 * without Summary, e.g. medical roles) the first visible tab.
 */
export function resolveChartTab(param: string | null | undefined, visible: readonly ChartTabKey[]): ChartTabKey {
  const key = chartTabFromParam(param);
  if (key && visible.includes(key)) return key;
  if (visible.includes('summary') || !visible.length) return 'summary';
  return visible[0];
}

/** document.title for the chart (the nav breadcrumbs read the client name from it) */
export function chartDocumentTitle(shortName: string | null | undefined): string {
  return shortName ? `${shortName} · Client chart · Altrixs` : 'Client chart · Altrixs';
}
