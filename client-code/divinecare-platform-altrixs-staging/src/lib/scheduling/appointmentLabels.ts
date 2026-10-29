/**
 * Calendar color labels (Valant "appointment labels"). Pure and client-safe: no Prisma here.
 * Server code lives in appointmentLabelsServer.ts.
 */
import { z } from 'zod';

export const LABEL_AVAILABILITY = ['free', 'busy', 'tentative'] as const;
export type LabelAvailability = (typeof LABEL_AVAILABILITY)[number];

export const LABEL_SOURCES = ['valant', 'altrixs'] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

export const LABEL_MEANINGS = [
  'tele',
  'rescheduled',
  'reeval',
  'cancelled',
  'in_person',
  'issue',
  'new',
  'not_confirmed',
  'testing',
] as const;
export type LabelMeaning = (typeof LABEL_MEANINGS)[number];

export const LABEL_MEANING_TEXT: Record<LabelMeaning, string> = {
  tele: 'Telehealth',
  rescheduled: 'Rescheduled',
  reeval: 'Re-evaluation',
  cancelled: 'Cancelled',
  in_person: 'In person',
  issue: 'Issue',
  new: 'New client',
  not_confirmed: 'Not confirmed',
  testing: 'Testing (no provider needed)',
};

export const AVAILABILITY_TEXT: Record<LabelAvailability, string> = {
  free: 'Free',
  busy: 'Busy',
  tentative: 'Tentative',
};

export type AppointmentLabelDto = {
  id: string;
  name: string;
  displayName: string;
  color: string;
  textColor: string;
  availability: LabelAvailability;
  sortOrder: number;
  active: boolean;
  source: LabelSource;
  meaning: LabelMeaning | null;
};

/** The small label shape carried on each appointment */
export type AppointmentLabelChipData = Pick<
  AppointmentLabelDto,
  'id' | 'name' | 'displayName' | 'color' | 'textColor' | 'meaning'
>;

/**
 * Valant's label list as the practice has it (Name → Display Name; Availability "Free" for all).
 * Valant only gives color names; the hexes are accessible equivalents chosen here.
 */
export const VALANT_APPOINTMENT_LABELS: ReadonlyArray<{
  name: string;
  displayName: string;
  color: string;
  availability: LabelAvailability;
  meaning: LabelMeaning | null;
}> = [
  { name: 'Blue', displayName: 'Blue (Tele)', color: '#2563EB', availability: 'free', meaning: 'tele' },
  { name: 'Brown', displayName: 'Brown (Rescheduled)', color: '#92400E', availability: 'free', meaning: 'rescheduled' },
  { name: 'Cyan', displayName: 'Cyan', color: '#0891B2', availability: 'free', meaning: null },
  { name: 'Green', displayName: 'Green (Re-eval)', color: '#16A34A', availability: 'free', meaning: 'reeval' },
  { name: 'Lime', displayName: 'Lime (Cancelled)', color: '#65A30D', availability: 'free', meaning: 'cancelled' },
  { name: 'Maroon', displayName: 'Maroon', color: '#7F1D1D', availability: 'free', meaning: null },
  { name: 'Orange', displayName: 'Orange (In Person)', color: '#EA580C', availability: 'free', meaning: 'in_person' },
  { name: 'Pink', displayName: 'Pink (Issue)', color: '#DB2777', availability: 'free', meaning: 'issue' },
  { name: 'Purple', displayName: 'Purple (New)', color: '#7C3AED', availability: 'free', meaning: 'new' },
  { name: 'Red', displayName: 'Red (Not Confirmed)', color: '#DC2626', availability: 'free', meaning: 'not_confirmed' },
  { name: 'Tan', displayName: 'Tan (Testing, no provider needed)', color: '#B08D57', availability: 'free', meaning: 'testing' },
  { name: 'Yellow', displayName: 'Yellow', color: '#CA8A04', availability: 'free', meaning: null },
];

// ─── Color contrast (WCAG 2.x) ───────────────────────────────────────────────

export const LIGHT_TEXT = '#FFFFFF';
export const DARK_TEXT = '#111827';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black text, whichever contrasts more with the label color. */
export function labelTextColor(bg: string): string {
  return contrastRatio(bg, LIGHT_TEXT) >= contrastRatio(bg, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

// ─── Loader plan (idempotent) ────────────────────────────────────────────────

/**
 * Which Valant labels still need to be created. Matches existing labels by name
 * (case-insensitive) so running it again, or after the practice made its own "Blue", adds nothing.
 */
export function planValantLabelLoad(existing: ReadonlyArray<{ name: string; sortOrder?: number }>) {
  const have = new Set(existing.map((l) => l.name.trim().toLowerCase()));
  const start = existing.reduce((m, l) => Math.max(m, (l.sortOrder ?? -1) + 1), 0);
  let next = start;
  return VALANT_APPOINTMENT_LABELS.filter((l) => !have.has(l.name.toLowerCase())).map((l) => ({
    ...l,
    source: 'valant' as const,
    sortOrder: next++,
  }));
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

export type LabelSuggestionInput = {
  isVirtual: boolean;
  /** UI visit status (scheduled, cancelled, late-cancel, ...) */
  status: string;
  /** No earlier, non-cancelled appointment for this client */
  isFirstAppointment?: boolean;
  /** rescheduleRequestedAt set, or a Valant "RESCHEDULED" code */
  rescheduled?: boolean;
  /**
   * Explicit confirmation state. Altrixs does not track appointment confirmation yet, so callers
   * pass null/undefined and "Not confirmed" is never suggested from a guess.
   */
  confirmed?: boolean | null;
};

/** Ordered most-specific first. Only meanings the owner asked to suggest. */
export function suggestLabelMeanings(input: LabelSuggestionInput): LabelMeaning[] {
  const out: LabelMeaning[] = [];
  const s = String(input.status || '').toLowerCase().replace('_', '-');
  if (input.rescheduled) out.push('rescheduled');
  if (s === 'cancelled' || s === 'late-cancel') out.push('cancelled');
  const open = s === 'scheduled' || s === 'checked-in' || s === '';
  if (open && input.confirmed === false) out.push('not_confirmed');
  if (input.isFirstAppointment && s !== 'cancelled' && s !== 'late-cancel') out.push('new');
  if (input.isVirtual) out.push('tele');
  // Valant convention: Blue = tele, Orange = in person (kept visits only)
  else if (s !== 'cancelled' && s !== 'late-cancel' && s !== 'no-show') out.push('in_person');
  return out;
}

const STATE_CHANGE: ReadonlySet<LabelMeaning> = new Set(['rescheduled', 'cancelled']);

/**
 * The one suggestion to offer, or null. With no label: the top suggestion. With a label that
 * already matches a suggestion: nothing, unless the appointment was since cancelled/rescheduled.
 */
export function pickSuggestedMeaning(
  suggestions: readonly LabelMeaning[],
  currentMeaning: LabelMeaning | null | undefined,
  hasLabel: boolean
): LabelMeaning | null {
  const top = suggestions[0];
  if (!top) return null;
  if (!hasLabel) return top;
  if (currentMeaning === top) return null;
  return STATE_CHANGE.has(top) ? top : null;
}

/** The active label for a meaning (lowest sort order wins). */
export function labelForMeaning<T extends { meaning: string | null; active: boolean; sortOrder: number }>(
  labels: readonly T[],
  meaning: LabelMeaning | null
): T | null {
  if (!meaning) return null;
  return (
    labels
      .filter((l) => l.active && l.meaning === meaning)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null
  );
}

/** Valant's appointment report puts "RESCHEDULED" in the procedure column; the importer keeps it in notes. */
export function looksRescheduled(a: { rescheduleRequestedAt?: Date | string | null; notes?: string | null }) {
  return Boolean(a.rescheduleRequestedAt) || /Valant code:\s*RESCHEDULED/i.test(a.notes || '');
}

// ─── Input schemas ───────────────────────────────────────────────────────────

const meaningSchema = z.enum(LABEL_MEANINGS).nullable();

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1).max(80),
  color: z.string().trim().regex(HEX_RE, 'Color must be #RRGGBB').transform((v) => v.toUpperCase()),
  availability: z.enum(LABEL_AVAILABILITY).default('free'),
  meaning: meaningSchema.optional(),
  active: z.boolean().optional(),
});

export const labelUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    color: z.string().trim().regex(HEX_RE, 'Color must be #RRGGBB').transform((v) => v.toUpperCase()).optional(),
    availability: z.enum(LABEL_AVAILABILITY).optional(),
    meaning: meaningSchema.optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'No changes provided');

export const labelCollectionPutSchema = z
  .object({
    order: z.array(z.string().min(1).max(64)).max(200).optional(),
    autoApplySuggested: z.boolean().optional(),
  })
  .refine((v) => v.order !== undefined || v.autoApplySuggested !== undefined, 'No changes provided');

export const appointmentLabelSetSchema = z.object({
  labelId: z.string().min(1).max(64).nullable(),
  /** The UI sends the suggestion it applied, for the audit trail */
  viaSuggestion: z.enum(LABEL_MEANINGS).optional(),
});

export function toLabelDto(row: {
  id: string;
  name: string;
  displayName: string;
  color: string;
  availability: string;
  sortOrder: number;
  active: boolean;
  source: string;
  meaning: string | null;
}): AppointmentLabelDto {
  const color = isHexColor(row.color) ? row.color.toUpperCase() : '#6B7280';
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    color,
    textColor: labelTextColor(color),
    availability: (LABEL_AVAILABILITY as readonly string[]).includes(row.availability)
      ? (row.availability as LabelAvailability)
      : 'free',
    sortOrder: row.sortOrder,
    active: row.active,
    source: row.source === 'valant' ? 'valant' : 'altrixs',
    meaning: (LABEL_MEANINGS as readonly string[]).includes(row.meaning ?? '') ? (row.meaning as LabelMeaning) : null,
  };
}
