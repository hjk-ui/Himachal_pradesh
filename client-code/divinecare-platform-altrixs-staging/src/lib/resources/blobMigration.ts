/**
 * Plan for copying the legacy resource blobs (ClinicModuleState 'resource-uploads' and
 * 'resource-assignments') into resource_items / resource_assignments (pure; the script
 * scripts/migrate-resource-library-blob.ts does the writes, dry run by default).
 *
 * What the old page actually stored:
 *   uploads      metadata only (title, type, category, description). The upload form had no file
 *                input, so no file was ever stored.
 *   assignments  { resourceId, resourceTitle, clientId, clientName, message, dueDate, assignedAt }.
 *                resourceId was either an upload id or a number 1-12 from the page's built-in
 *                list, which had no file or link behind it. Nothing ever reached the portal.
 *
 * Rules (never fabricate):
 *   - uploads become DRAFT items with no file (a clinician must upload the real file and review
 *     it before it can be sent). Legacy source id = the upload id.
 *   - each distinct built-in title that was assigned becomes one RETIRED placeholder item marked
 *     as legacy (title only; no summary, link or file is invented).
 *   - assignments are kept as history with status WITHDRAWN, reason legacy_not_delivered: the
 *     client never received them, so they are not shown in the portal. The assigning user was
 *     not recorded and stays unknown.
 *   - client names in the blob are never copied; rows whose clientId is not a client of the
 *     organization are skipped and counted.
 */

export type LegacyKind = 'handout' | 'video' | 'article';

export type PlannedItem = {
  legacySourceId: string;
  title: string;
  kind: LegacyKind;
  status: 'draft' | 'retired';
  summary: string | null;
  topics: string[];
  placeholder: boolean;
};

export type PlannedAssignment = {
  legacySourceId: string;
  itemLegacySourceId: string;
  clientId: string;
  message: string | null;
  dueDate: string | null;
  assignedAt: Date | null;
};

export type ResourceMigrationCounts = {
  uploadsFound: number;
  uploadsPlanned: number;
  uploadsSkippedInvalid: number;
  uploadsAlreadyMigrated: number;
  placeholdersPlanned: number;
  assignmentsFound: number;
  assignmentsPlanned: number;
  assignmentsSkippedInvalid: number;
  assignmentsSkippedUnknownClient: number;
  assignmentsSkippedUnknownResource: number;
  assignmentsAlreadyMigrated: number;
};

export const emptyResourceCounts = (): ResourceMigrationCounts => ({
  uploadsFound: 0,
  uploadsPlanned: 0,
  uploadsSkippedInvalid: 0,
  uploadsAlreadyMigrated: 0,
  placeholdersPlanned: 0,
  assignmentsFound: 0,
  assignmentsPlanned: 0,
  assignmentsSkippedInvalid: 0,
  assignmentsSkippedUnknownClient: 0,
  assignmentsSkippedUnknownResource: 0,
  assignmentsAlreadyMigrated: 0,
});

const CATEGORY_TOPIC: Record<string, string> = {
  Anxiety: 'anxiety',
  Depression: 'depression',
  Trauma: 'trauma',
  Mindfulness: 'coping_skills',
  Crisis: 'crisis',
  Family: 'family_caregivers',
  'Substance Use': 'sud_recovery',
  Grief: 'grief',
};
const TYPE_KIND: Record<string, LegacyKind> = { Worksheet: 'handout', 'Audio Guide': 'handout', Video: 'video', Article: 'article' };
/** Default text the old upload form filled in when the description was blank (not real content) */
const DEFAULT_DESCRIPTION = 'Clinic-uploaded resource';

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const idStr = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v, 120));

export function uploadLegacyId(id: string) {
  return `upload:${id}`;
}
export function placeholderLegacyId(catalogId: string) {
  return `catalog:${catalogId}`;
}

export function planResourceBlobMigration(
  uploadsBlob: unknown,
  assignmentsBlob: unknown,
  ctx: { clientIds: Set<string>; existingItemLegacyIds: Set<string>; existingAssignmentLegacyIds: Set<string> },
): { items: PlannedItem[]; assignments: PlannedAssignment[]; counts: ResourceMigrationCounts } {
  const counts = emptyResourceCounts();
  const items: PlannedItem[] = [];
  const known = new Map<string, string>(); // legacy resource id -> item legacySourceId

  for (const raw of Array.isArray(uploadsBlob) ? uploadsBlob : []) {
    counts.uploadsFound++;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = idStr(r.id);
    const title = str(r.title, 300);
    if (!id || !title) { counts.uploadsSkippedInvalid++; continue; }
    const legacySourceId = uploadLegacyId(id);
    known.set(id, legacySourceId);
    if (ctx.existingItemLegacyIds.has(legacySourceId)) { counts.uploadsAlreadyMigrated++; continue; }
    const desc = str(r.description, 2000);
    const topic = typeof r.category === 'string' ? CATEGORY_TOPIC[r.category] : undefined;
    items.push({
      legacySourceId,
      title,
      kind: (typeof r.type === 'string' && TYPE_KIND[r.type]) || 'handout',
      status: 'draft',
      summary: desc && desc !== DEFAULT_DESCRIPTION ? desc : null,
      topics: topic ? [topic] : [],
      placeholder: false,
    });
    counts.uploadsPlanned++;
  }

  const assignments: PlannedAssignment[] = [];
  const placeholders = new Map<string, PlannedItem>();
  for (const raw of Array.isArray(assignmentsBlob) ? assignmentsBlob : []) {
    counts.assignmentsFound++;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = idStr(r.id);
    const resourceId = idStr(r.resourceId);
    const clientId = str(r.clientId, 64);
    if (!id || !resourceId || !clientId) { counts.assignmentsSkippedInvalid++; continue; }
    if (!ctx.clientIds.has(clientId)) { counts.assignmentsSkippedUnknownClient++; continue; }
    let itemLegacy = known.get(resourceId);
    if (!itemLegacy) {
      // Built-in list ids were the numbers 1-12; anything else is an upload that no longer exists
      if (!/^\d{1,3}$/.test(resourceId)) { counts.assignmentsSkippedUnknownResource++; continue; }
      const title = str(r.resourceTitle, 300);
      if (!title) { counts.assignmentsSkippedUnknownResource++; continue; }
      itemLegacy = placeholderLegacyId(resourceId);
      if (!placeholders.has(itemLegacy) && !ctx.existingItemLegacyIds.has(itemLegacy)) {
        placeholders.set(itemLegacy, { legacySourceId: itemLegacy, title, kind: 'handout', status: 'retired', summary: null, topics: [], placeholder: true });
      }
    }
    const legacySourceId = `assignment:${id}`;
    if (ctx.existingAssignmentLegacyIds.has(legacySourceId)) { counts.assignmentsAlreadyMigrated++; continue; }
    const due = str(r.dueDate, 10);
    const at = str(r.assignedAt, 40);
    const assignedAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
    assignments.push({
      legacySourceId,
      itemLegacySourceId: itemLegacy,
      clientId,
      message: str(r.message, 2000),
      dueDate: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      assignedAt,
    });
    counts.assignmentsPlanned++;
  }
  counts.placeholdersPlanned = placeholders.size;
  return { items: [...items, ...placeholders.values()], assignments, counts };
}
