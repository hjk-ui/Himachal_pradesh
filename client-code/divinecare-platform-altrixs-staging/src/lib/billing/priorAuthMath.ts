/** Prior authorization unit math (pure; used by the mapper and priorAuthUsage.ts). */

export type AuthUsage = { authId: string; authNumber: string; units: number; countedAt: string };

/** Units of the lines an auth covers: lines with one of its CPTs, or every line when it lists none (e.g. Valant imports). */
export function authUnitsForLines(authCpts: string[], lines: Array<{ cpt: string; units: number }>): number {
  const codes = authCpts.map((c) => c.split('-')[0].trim().toUpperCase()).filter(Boolean);
  return lines
    .filter((l) => !codes.length || codes.includes(l.cpt.split('-')[0].trim().toUpperCase()))
    .reduce((t, l) => t + Math.max(0, Math.trunc(l.units) || 0), 0);
}
