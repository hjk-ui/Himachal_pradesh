/**
 * In-memory cache for pre-visit briefs: one entry per org + client + practice day + audience
 * (+ whether AI was allowed). Entries expire after MAX_AGE_MS and on the next practice day (the
 * day is in the key). Process-local by design: a restart or "Refresh" simply rebuilds the brief.
 * Access checks run before every cache read (service.ts), so the cache never widens access.
 */
import type { PreVisitBrief } from '@/lib/ai/previsit/service';

export const MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_ENTRIES = 1000;

export class PreVisitBriefCache {
  private map = new Map<string, { brief: PreVisitBrief; at: number }>();

  static key(k: { organizationId: string; clientId: string; forDate: string; audience: string; aiAllowed: boolean }): string {
    return [k.organizationId, k.clientId, k.forDate, k.audience, k.aiAllowed ? 'ai' : 'rules'].join('|');
  }

  get(key: string, now: Date): PreVisitBrief | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (now.getTime() - e.at > MAX_AGE_MS) {
      this.map.delete(key);
      return null;
    }
    return e.brief;
  }

  set(key: string, brief: PreVisitBrief, now: Date): void {
    this.map.delete(key);
    this.map.set(key, { brief, at: now.getTime() });
    while (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const g = globalThis as unknown as { __altrixsPreVisitCache?: PreVisitBriefCache };
export const sharedPreVisitCache: PreVisitBriefCache = g.__altrixsPreVisitCache ?? (g.__altrixsPreVisitCache = new PreVisitBriefCache());
