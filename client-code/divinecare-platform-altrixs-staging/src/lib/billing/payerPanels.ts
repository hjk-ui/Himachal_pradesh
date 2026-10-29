/**
 * Insurance panels (payer credentialing / contracts) for Billing › Insurance Panels (PayerPanel).
 * Pure: no Prisma. Persistence and audit: src/app/api/billing/panels.
 *
 *  - The payer is picked from the payer master (PayerRegistry); free text only when the payer is
 *    not in the master yet.
 *  - Providers are org staff (User ids), checked on the server.
 *  - Edits by billing + leadership (canEditPayerMaster); audits name the changed fields only.
 *  - Panels saved by the old page live in the 'payer-panels' module list; staff import them once
 *    (legacyPanelToInput, deduped by legacyId).
 */
import { z } from 'zod';

export const PANEL_STATUSES = [
  ['not_started', 'Not started'],
  ['application_submitted', 'Application submitted'],
  ['in_process', 'In process'],
  ['approved', 'Approved / in network'],
  ['denied', 'Denied'],
  ['termed', 'Termed'],
] as const;
export type PanelStatus = (typeof PANEL_STATUSES)[number][0];
export const PANEL_STATUS_LABEL: Record<string, string> = Object.fromEntries(PANEL_STATUSES);

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blankToNull, s.nullable().optional());
const isoDate = opt(
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD')
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a valid date'),
);

export const panelInputSchema = z
  .object({
    payerRegistryId: opt(z.string().trim().min(1).max(64)),
    /** Free text only when the payer is not in the payer master; ignored when payerRegistryId is set */
    payerName: opt(z.string().trim().min(2, 'Enter the payer name').max(200)),
    providerUserIds: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
    status: z.enum(PANEL_STATUSES.map((s) => s[0]) as [PanelStatus, ...PanelStatus[]]).default('not_started'),
    submittedDate: isoDate,
    effectiveDate: isoDate,
    recredentialingDueDate: isoDate,
    providerPin: opt(z.string().trim().max(40)),
    openToNewClients: z.boolean().default(false),
    contactName: opt(z.string().trim().max(120)),
    contactPhone: z.preprocess(
      (v) => {
        const d = typeof v === 'string' ? v.replace(/\D/g, '') : v;
        if (d === '') return null;
        return typeof d === 'string' && d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
      },
      z.string().regex(/^\d{10}$/, 'Phone is 10 digits').nullable().optional(),
    ),
    contactEmail: opt(z.string().trim().toLowerCase().max(200).email('Enter a valid email')),
    notes: opt(z.string().trim().max(4000)),
  })
  .superRefine((v, ctx) => {
    if (!v.payerRegistryId && !v.payerName) {
      ctx.addIssue({ code: 'custom', path: ['payerName'], message: 'Pick a payer from the payer list or type its name' });
    }
  });

export type PanelInput = z.infer<typeof panelInputSchema>;

export type PanelRow = {
  id: string;
  payerRegistryId: string | null;
  payerName: string;
  /** payer master ID (Waystar), when linked */
  registryPayerId: string | null;
  providerUserIds: string[];
  providers: { id: string; name: string; npi: string | null }[];
  status: PanelStatus;
  submittedDate: string | null;
  effectiveDate: string | null;
  recredentialingDueDate: string | null;
  providerPin: string | null;
  openToNewClients: boolean;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  updatedAt: string;
};

/** Summary tiles, from saved panels only. Re-credentialing "due soon" = within `days` of `today` (or overdue). */
export function panelCounts(rows: Pick<PanelRow, 'status' | 'openToNewClients' | 'recredentialingDueDate'>[], today = new Date(), days = 90) {
  const limit = new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return {
    active: rows.filter((p) => p.status === 'approved').length,
    pending: rows.filter((p) => p.status === 'application_submitted' || p.status === 'in_process').length,
    open: rows.filter((p) => p.status === 'approved' && p.openToNewClients).length,
    recredDue: rows.filter((p) => p.status === 'approved' && p.recredentialingDueDate && p.recredentialingDueDate <= limit).length,
  };
}

const LEGACY_STATUS: Record<string, PanelStatus> = {
  active: 'approved',
  closed: 'approved',
  pending: 'application_submitted',
  credentialing: 'in_process',
  not_credentialed: 'not_started',
  terminated: 'termed',
};

/** A panel saved by the old page ('payer-panels' module list) as a PayerPanel input. Nothing invented. */
export function legacyPanelToInput(old: Record<string, unknown>): { legacyId: string; input: Record<string, unknown> } | null {
  const legacyId = typeof old.panelId === 'string' ? old.panelId.trim() : '';
  const payer = typeof old.payer === 'string' ? old.payer.trim() : '';
  if (!legacyId || payer.length < 2) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const status = LEGACY_STATUS[String(old.status)] ?? 'not_started';
  const notes = [
    str(old.notes),
    str(old.payerId) ? `Payer ID entered on the old panel page: ${str(old.payerId)}` : null,
    str(old.feeSchedule) ? `Fee schedule: ${str(old.feeSchedule)}` : null,
    date(old.contractRenewalDate) ? `Contract renewal: ${date(old.contractRenewalDate)}` : null,
    old.status === 'closed' ? 'Imported as a closed panel (in network, not open to new clients).' : null,
  ].filter(Boolean).join('\n');
  return {
    legacyId,
    input: {
      payerName: payer,
      status,
      effectiveDate: date(old.effectiveDate),
      // Old free-text contact: kept as the contact name (staff split phone / email when editing)
      contactName: str(old.credentialingContact)?.slice(0, 120) ?? null,
      openToNewClients: old.status === 'closed' ? false : old.openToNewClients === true,
      notes: notes || null,
    },
  };
}
