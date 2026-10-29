/**
 * Template lifecycle (pure): Draft → Approved → Active → Retired, per practice.
 *
 * - Approve (Draft → Approved) and Activate (Approved → Active) are restricted to ADMIN and
 *   PRACTICE_DIRECTOR and recorded with who / when (ConsentTemplateState).
 * - Activating a version retires the version of the same template that was Active.
 * - The practice's own packet sections ship Active (approval source "practice packet"), proposed
 *   wording ships Draft. Only an Active version whose required practice settings exist can be sent.
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';
import type { ConsentTemplateVersion, TemplateStatus } from './types';
import { ALL_TEMPLATE_VERSIONS, versionsOf } from './catalog';

export type TemplateStateRow = {
  templateKey: string;
  version: number;
  status: string;
  approvedAt?: Date | string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
  activatedAt?: Date | string | null;
  activatedById?: string | null;
  retiredAt?: Date | string | null;
};

export type LibraryConfig = {
  /** Practice NPP document linked or uploaded (npp-acknowledgment can be sent) */
  nppReady: boolean;
};

export const TEMPLATE_APPROVER_ROLES = ['ADMIN', 'PRACTICE_DIRECTOR'] as const;
export const canApproveTemplates = (role: string | null | undefined) =>
  Boolean(role) && (TEMPLATE_APPROVER_ROLES as readonly string[]).includes(normalizeStaffRole(role));

const asStatus = (s: string | null | undefined): TemplateStatus | null =>
  s === 'DRAFT' || s === 'APPROVED' || s === 'ACTIVE' || s === 'RETIRED' ? s : null;

export function stateKey(key: string, version: number) {
  return `${key}@${version}`;
}

export function indexStates(rows: TemplateStateRow[]): Map<string, TemplateStateRow> {
  return new Map(rows.map((r) => [stateKey(r.templateKey, r.version), r]));
}

export function effectiveStatus(t: ConsentTemplateVersion, states: Map<string, TemplateStateRow>): TemplateStatus {
  return asStatus(states.get(stateKey(t.key, t.version))?.status) ?? t.defaultStatus;
}

/** The Active version of a template (highest version if data ever had two), or null. */
export function activeVersion(key: string, states: Map<string, TemplateStateRow>): ConsentTemplateVersion | null {
  const active = versionsOf(key).filter((t) => effectiveStatus(t, states) === 'ACTIVE');
  return active[active.length - 1] ?? null;
}

export type SendCheck = { ok: true } | { ok: false; reason: string };

/** Only an Active version can be sent; some need practice settings first. */
export function canSendTemplate(t: ConsentTemplateVersion, states: Map<string, TemplateStateRow>, config: LibraryConfig): SendCheck {
  const s = effectiveStatus(t, states);
  if (s !== 'ACTIVE') return { ok: false, reason: `${t.title} version ${t.version} is ${s.toLowerCase()}; only an Active version can be sent.` };
  if (t.requiresConfig === 'npp_document' && !config.nppReady) {
    return { ok: false, reason: 'Link or upload the practice Notice of Privacy Practices first (Consents > Library > Settings).' };
  }
  return { ok: true };
}

export type LifecycleAction = 'approve' | 'activate' | 'retire' | 'return_to_draft';

const TRANSITIONS: Record<LifecycleAction, { from: readonly TemplateStatus[]; to: TemplateStatus; error: string }> = {
  approve: { from: ['DRAFT'], to: 'APPROVED', error: 'Only a Draft version can be approved.' },
  activate: { from: ['APPROVED'], to: 'ACTIVE', error: 'A version must be approved before it can be activated.' },
  retire: { from: ['ACTIVE', 'APPROVED'], to: 'RETIRED', error: 'Only an Approved or Active version can be retired.' },
  return_to_draft: { from: ['APPROVED'], to: 'DRAFT', error: 'Only an Approved (not yet active) version can go back to Draft.' },
};

export type LifecyclePlan =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      /** rows to upsert: this version, plus the previously Active version that is retired */
      writes: { templateKey: string; version: number; status: TemplateStatus; stamp: 'approved' | 'activated' | 'retired' | 'reset' }[];
      retiredVersion: number | null;
    };

/** Plan a lifecycle change (the store writes it, with the actor and time, in one transaction). */
export function planLifecycle(role: string | null | undefined, key: string, version: number, action: LifecycleAction, states: Map<string, TemplateStateRow>): LifecyclePlan {
  if (!canApproveTemplates(role)) return { ok: false, status: 403, error: 'Only an administrator or the practice director can approve, activate or retire consent templates.' };
  const t = ALL_TEMPLATE_VERSIONS.find((x) => x.key === key && x.version === version);
  if (!t) return { ok: false, status: 404, error: 'Unknown template version' };
  const current = effectiveStatus(t, states);
  const tr = TRANSITIONS[action];
  if (!tr.from.includes(current)) return { ok: false, status: 409, error: tr.error };
  const stamp = action === 'approve' ? 'approved' : action === 'activate' ? 'activated' : action === 'retire' ? 'retired' : 'reset';
  const writes: { templateKey: string; version: number; status: TemplateStatus; stamp: 'approved' | 'activated' | 'retired' | 'reset' }[] = [{ templateKey: key, version, status: tr.to, stamp }];
  let retiredVersion: number | null = null;
  if (action === 'activate') {
    for (const other of versionsOf(key)) {
      if (other.version !== version && effectiveStatus(other, states) === 'ACTIVE') {
        writes.push({ templateKey: key, version: other.version, status: 'RETIRED', stamp: 'retired' });
        retiredVersion = other.version;
      }
    }
  }
  return { ok: true, writes, retiredVersion };
}

/** How the approval of a version is described (practice packet versions were approved by use). */
export function approvalLabel(t: ConsentTemplateVersion, row: TemplateStateRow | undefined): string {
  if (row?.approvedAt) return `Approved by ${row.approvedByName || 'an administrator'} on ${new Date(row.approvedAt).toISOString().slice(0, 10)}`;
  if (t.origin === 'practice_packet') return "In use by the practice (from its own Valant packet); no Altrixs approval recorded";
  if (t.origin === 'standard') return 'Regulatory standard text; no Altrixs approval recorded';
  return 'Not approved';
}
