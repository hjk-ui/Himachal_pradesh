/**
 * Org-scoped HealthLake FHIR search (pure helpers). Every query is forced to
 * _tag=urn:altrixs:organization|<caller org>, and every returned entry is checked again
 * for that tag (defense in depth) before the Bundle is passed through.
 */
import { SYSTEMS } from '@/lib/fhir/mapping/common';
import type { FhirBundle } from './client';

export const ALLOWED_SEARCH_PARAMS = new Set([
  '_id',
  '_count',
  '_lastUpdated',
  '_sort',
  'page',
  'patient',
  'subject',
  'identifier',
  'name',
  'family',
  'given',
  'birthdate',
  'gender',
  'date',
  'status',
  'code',
  'clinical-status',
  'category',
  'type',
]);

export function orgTagParam(organizationId: string): string {
  return `${SYSTEMS.organizationTag}|${organizationId}`;
}

export function buildScopedSearch(
  organizationId: string,
  query: URLSearchParams
): { ok: true; params: URLSearchParams } | { ok: false; error: string } {
  const params = new URLSearchParams();
  const rejected: string[] = [];
  for (const [k, v] of query.entries()) {
    if (!ALLOWED_SEARCH_PARAMS.has(k)) {
      rejected.push(k);
      continue;
    }
    if (k === '_count') continue;
    if (v.length > 200) return { ok: false, error: `Search parameter ${k} is too long` };
    params.append(k, v);
  }
  if (rejected.length) {
    return { ok: false, error: `Unsupported search parameter(s): ${rejected.slice(0, 5).join(', ')}` };
  }
  const count = Number(query.get('_count') ?? 20);
  params.set('_count', String(Number.isFinite(count) ? Math.min(100, Math.max(1, Math.trunc(count))) : 20));
  params.set('_tag', orgTagParam(organizationId));
  return { ok: true, params };
}

export function hasOrgTag(resource: { meta?: { tag?: Array<{ system?: string; code?: string }> } } | undefined, organizationId: string): boolean {
  return !!resource?.meta?.tag?.some((t) => t.system === SYSTEMS.organizationTag && t.code === organizationId);
}

/** Keep only this org's entries; rewrite HealthLake links to our route (allowed params only). */
export function scopeBundle(bundle: FhirBundle, organizationId: string, routePath: string): { bundle: FhirBundle; dropped: number } {
  const entries = bundle.entry ?? [];
  const kept = entries.filter((e) => hasOrgTag(e.resource, organizationId));
  const dropped = entries.length - kept.length;
  const link = (bundle.link ?? [])
    .map((l) => {
      let qs = '';
      try {
        const u = new URL(l.url);
        const p = new URLSearchParams();
        for (const [k, v] of u.searchParams.entries()) if (ALLOWED_SEARCH_PARAMS.has(k)) p.append(k, v);
        qs = p.toString();
      } catch {
        return null;
      }
      return { relation: l.relation, url: `${routePath}${qs ? `?${qs}` : ''}` };
    })
    .filter((l): l is { relation: string; url: string } => !!l);
  return {
    dropped,
    bundle: {
      resourceType: 'Bundle',
      type: bundle.type ?? 'searchset',
      ...(dropped === 0 && typeof bundle.total === 'number' ? { total: bundle.total } : {}),
      link,
      entry: kept.map((e) => ({
        fullUrl: e.resource?.resourceType && e.resource?.id ? `${e.resource.resourceType}/${e.resource.id}` : undefined,
        resource: e.resource,
        search: e.search,
      })),
    },
  };
}
