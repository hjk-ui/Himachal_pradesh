import { clean, orgTag, type Coding, type FhirResource } from './common';

export type MapContext = {
  organizationId: string;
  /** meta.security labels from privacyDecision() */
  security?: Coding[];
};

/** Org tag (used for org-scoped search), optional meta.source and security labels; strips empties. */
export function finalize<T extends FhirResource>(resource: T, ctx: MapContext, source?: string): T {
  const meta: FhirResource['meta'] = {
    ...(source ? { source } : {}),
    tag: [orgTag(ctx.organizationId)],
    ...(ctx.security?.length ? { security: dedupeCodings(ctx.security) } : {}),
  };
  return clean({ ...resource, meta }) as T;
}

function dedupeCodings(list: Coding[]): Coding[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.system}|${c.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
