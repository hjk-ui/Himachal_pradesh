import 'server-only';

/**
 * Feature detection for Rcopia commands that a vendor login may not be allowed
 * to use (DrFirst answers not_permitted). The first refusal is cached per server
 * process so later calls answer "not enabled" without another round trip; the
 * cache expires so a command DrFirst enables later is picked up again.
 */
export type GatedCommand = 'search_problem' | 'search_drug_detail' | 'send_prescription';

const RECHECK_MS = 6 * 3600 * 1000;
const state = new Map<GatedCommand, { enabled: boolean; at: number }>();

/** true / false once known (false = refused within the last 6 hours), undefined = not tried yet. */
export function knownEnabled(command: GatedCommand, now = Date.now()): boolean | undefined {
  const s = state.get(command);
  if (!s) return undefined;
  if (!s.enabled && now - s.at > RECHECK_MS) {
    state.delete(command);
    return undefined;
  }
  return s.enabled;
}

/** Record the outcome of a real call: not_permitted disables, a successful call enables. */
export function recordOutcome(command: GatedCommand, res: { ok: boolean; demo?: boolean; error?: { code: string } }, now = Date.now()): void {
  if (res.demo) return;
  if (res.error?.code === 'not_permitted') state.set(command, { enabled: false, at: now });
  else if (res.ok) state.set(command, { enabled: true, at: now });
}

/** Test hook. */
export function resetFeatureCache(): void {
  state.clear();
}
