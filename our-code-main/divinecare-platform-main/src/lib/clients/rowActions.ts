/**
 * Client list row actions (Oct 25): menu contents + who sees which item.
 * Pure — the menu component only renders what this returns.
 */

/** Roles that may assign / transfer a clinician from the row menu. */
export const ROW_ACTION_ASSIGN_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'PRACTICE_DIRECTOR',
  'FRONT_DESK',
  'OFFICE_MANAGER',
] as const;

export function canAssignFromRowMenu(role: string | null | undefined): boolean {
  return (ROW_ACTION_ASSIGN_ROLES as readonly string[]).includes((role ?? '').toUpperCase());
}

export const ROW_ACTION_LABELS = {
  assign: 'Assign clinician',
  transfer: 'Transfer (warm handoff)',
  edit: 'Edit client',
  view: 'View chart',
} as const;

export type RowActionKey = 'handoff' | 'edit' | 'view';

export type RowActionItem = {
  key: RowActionKey;
  label: string;
};

export function rowActionAriaLabel(clientName: string): string {
  return `Actions for ${clientName}`;
}

export function chartHref(clientId: string): string {
  return `/dashboard/clients/${clientId}`;
}

export function rowActionItems(input: {
  /** No assigned clinician / prescriber yet. */
  unassigned: boolean;
  canAssignTeam: boolean;
  canEditRow: boolean;
}): RowActionItem[] {
  const items: RowActionItem[] = [];
  if (input.canAssignTeam) {
    items.push({
      key: 'handoff',
      label: input.unassigned ? ROW_ACTION_LABELS.assign : ROW_ACTION_LABELS.transfer,
    });
  }
  if (input.canEditRow) items.push({ key: 'edit', label: ROW_ACTION_LABELS.edit });
  items.push({ key: 'view', label: ROW_ACTION_LABELS.view });
  return items;
}
