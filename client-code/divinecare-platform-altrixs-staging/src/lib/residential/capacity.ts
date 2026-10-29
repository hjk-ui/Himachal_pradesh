/**
 * Residential program capacity (beds per location and ASAM level). Pure and client-safe: no Prisma.
 * Server side: capacityServer.ts. Stored in residential_capacity (20261018_residential_capacity.sql).
 *
 * There are NO default bed counts: a level with no saved row is "not configured" and every screen
 * says so instead of showing a made-up total.
 */
import { z } from 'zod';

export const RESIDENTIAL_ASAM_LEVELS = ['3.1', '3.5', '3.7'] as const;
export type ResidentialAsamLevel = (typeof RESIDENTIAL_ASAM_LEVELS)[number];

export const ASAM_LEVEL_LABELS: Record<ResidentialAsamLevel, string> = {
  '3.1': 'ASAM 3.1 Clinically managed low-intensity residential',
  '3.5': 'ASAM 3.5 Clinically managed high-intensity residential',
  '3.7': 'ASAM 3.7 Medically monitored intensive inpatient',
};

export const BEDS_NOT_CONFIGURED = 'Beds not configured';
export const CAPACITY_SETTINGS_HREF = '/dashboard/practice-setup?section=programs';

export type CapacityRow = {
  locationId: string;
  asamLevel: string;
  beds: number;
  rooms: string[];
};

export type CapacityLevelSummary = {
  level: ResidentialAsamLevel;
  /** null = not configured for any location */
  beds: number | null;
  rooms: string[];
  locationIds: string[];
};

export type CapacitySummary = {
  configured: boolean;
  /** sum of configured levels; null when nothing is configured */
  totalBeds: number | null;
  levels: CapacityLevelSummary[];
  /** locations that have at least one configured level */
  locationIds: string[];
};

export function isAsamLevel(v: unknown): v is ResidentialAsamLevel {
  return typeof v === 'string' && (RESIDENTIAL_ASAM_LEVELS as readonly string[]).includes(v);
}

/** Capacity across the given rows (optionally one location). */
export function summarizeCapacity(rows: CapacityRow[], locationId: string | null = null): CapacitySummary {
  const use = rows.filter((r) => isAsamLevel(r.asamLevel) && (!locationId || r.locationId === locationId));
  const levels = RESIDENTIAL_ASAM_LEVELS.map((level): CapacityLevelSummary => {
    const at = use.filter((r) => r.asamLevel === level);
    return {
      level,
      beds: at.length ? at.reduce((s, r) => s + Math.max(0, r.beds), 0) : null,
      rooms: [...new Set(at.flatMap((r) => r.rooms))],
      locationIds: [...new Set(at.map((r) => r.locationId))],
    };
  });
  const configured = levels.some((l) => l.beds !== null);
  return {
    configured,
    totalBeds: configured ? levels.reduce((s, l) => s + (l.beds ?? 0), 0) : null,
    levels,
    locationIds: [...new Set(use.map((r) => r.locationId))],
  };
}

export type LevelOccupancy = {
  level: ResidentialAsamLevel;
  beds: number | null;
  residents: number;
  /** null when beds are not configured; never negative (over capacity shows in overCapacity) */
  open: number | null;
  overCapacity: number;
  /** 0-100, null when beds not configured or 0 beds */
  occupancyPct: number | null;
};

/** Occupancy per level from residents' program values ("3.1" / "3.5" / "3.7"). */
export function occupancyByLevel(summary: CapacitySummary, residentPrograms: string[]): LevelOccupancy[] {
  return summary.levels.map((l) => {
    const residents = residentPrograms.filter((p) => p === l.level).length;
    const open = l.beds === null ? null : Math.max(0, l.beds - residents);
    return {
      level: l.level,
      beds: l.beds,
      residents,
      open,
      overCapacity: l.beds === null ? 0 : Math.max(0, residents - l.beds),
      occupancyPct: l.beds ? Math.round((residents / l.beds) * 100) : null,
    };
  });
}

export function totalOccupancy(levels: LevelOccupancy[]): { residents: number; beds: number | null; open: number | null; occupancyPct: number | null } {
  const residents = levels.reduce((s, l) => s + l.residents, 0);
  const conf = levels.filter((l) => l.beds !== null);
  if (!conf.length) return { residents, beds: null, open: null, occupancyPct: null };
  const beds = conf.reduce((s, l) => s + (l.beds ?? 0), 0);
  // residents at an unconfigured level are not counted against configured beds
  const inConf = conf.reduce((s, l) => s + l.residents, 0);
  return { residents, beds, open: Math.max(0, beds - inConf), occupancyPct: beds ? Math.round((inConf / beds) * 100) : null };
}

/** "8/10 beds" or "3 residents · Beds not configured" */
export function occupancyLabel(o: { residents: number; beds: number | null }): string {
  return o.beds === null ? `${o.residents} resident${o.residents === 1 ? '' : 's'} · ${BEDS_NOT_CONFIGURED}` : `${o.residents}/${o.beds} beds`;
}

/** Open room labels of a level (configured rooms minus occupied rooms); [] when no rooms are configured. */
export function openRoomLabels(summary: CapacitySummary, level: string, occupiedRooms: string[]): string[] {
  const l = summary.levels.find((x) => x.level === level);
  if (!l) return [];
  const taken = new Set(occupiedRooms.map((r) => r.trim().toLowerCase()));
  return l.rooms.filter((r) => !taken.has(r.trim().toLowerCase()));
}

// ─── Input ───────────────────────────────────────────────────────────────────

const roomList = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : (v ?? '').split(/[,\n]/)))
  .transform((v) => [...new Set(v.map((r) => r.trim()).filter(Boolean))])
  .pipe(z.array(z.string().max(40, 'Room labels are 40 characters or fewer')).max(500, 'At most 500 rooms per level'));

export const capacityEntrySchema = z
  .object({
    locationId: z.string().trim().min(1, 'Choose a location'),
    asamLevel: z.enum(RESIDENTIAL_ASAM_LEVELS),
    /** null = remove this level (not configured) */
    beds: z.union([z.number().int().min(0, 'Beds cannot be negative').max(500, 'At most 500 beds'), z.null()]),
    rooms: roomList,
    note: z.union([z.string(), z.null()]).optional().transform((v) => (v ?? '').trim().slice(0, 500) || null),
  })
  .refine((e) => e.beds === null || e.rooms.length === 0 || e.rooms.length === e.beds, {
    message: 'Room labels must match the number of beds (or leave rooms empty)',
    path: ['rooms'],
  });

export const capacityInputSchema = z.object({ entries: z.array(capacityEntrySchema).max(60) });
export type CapacityEntryInput = z.infer<typeof capacityEntrySchema>;
