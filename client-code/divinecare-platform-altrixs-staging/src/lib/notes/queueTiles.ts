/**
 * Home "My documentation" tiles from the Notes worklist counts (pure; tested). Labels match the
 * worklist tabs so the home number and the list it opens say the same thing.
 */
export type NotesQueueCounts = Partial<Record<'missing' | 'drafts' | 'ready' | 'cosign' | 'returned' | 'signed' | 'all' | 'escalated', number>>;

export type NotesQueueTile = { tab: string; label: string; hint: string; count: number; href: string; attention: boolean };

const TILES: { tab: keyof NotesQueueCounts; label: string; hint: string; always: boolean }[] = [
  { tab: 'missing', label: 'To write', hint: 'Your past visits (30 days) with no note yet', always: true },
  { tab: 'drafts', label: 'Drafts', hint: 'Your unsigned notes with something left to complete', always: true },
  { tab: 'ready', label: 'Ready to sign', hint: 'Your drafts with nothing blocking signature', always: true },
  { tab: 'returned', label: 'Returned', hint: 'Your notes a supervisor returned for correction', always: true },
  { tab: 'cosign', label: 'Co-sign', hint: 'Notes waiting for your co-signature, and yours waiting for a supervisor', always: false },
  { tab: 'escalated', label: 'Overdue > 7 days', hint: 'Unsigned notes more than 7 days past due by clinicians you supervise', always: false },
];

export function notesQueueTiles(counts: NotesQueueCounts): NotesQueueTile[] {
  return TILES.filter((t) => t.always || (counts[t.tab] ?? 0) > 0).map((t) => {
    const count = counts[t.tab] ?? 0;
    return {
      tab: t.tab,
      label: t.label,
      hint: t.hint,
      count,
      href: `/dashboard/ehr/notes?tab=${t.tab}`,
      attention: count > 0 && t.tab !== 'cosign',
    };
  });
}
