/**
 * Freezing a rendered template into a signed record (pure; node crypto). The SHA-256 of the
 * canonical rendered text is stored with it, so any later change to the stored text is detectable.
 */
import { createHash } from 'crypto';
import type { FrozenSection, RenderedTemplate } from './types';

export function hashRendered(r: RenderedTemplate): string {
  return createHash('sha256').update(JSON.stringify(r)).digest('hex');
}

export function freeze(r: RenderedTemplate, at: Date): FrozenSection {
  return { ...r, sha256: hashRendered(r), frozenAt: at.toISOString() };
}

/** True when the frozen text still matches its hash (tamper evidence). */
export function frozenIntact(f: FrozenSection): boolean {
  const { sha256, frozenAt, ...rest } = f;
  void frozenAt;
  return hashRendered(rest as RenderedTemplate) === sha256;
}
