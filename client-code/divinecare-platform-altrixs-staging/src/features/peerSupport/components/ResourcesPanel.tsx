'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Phone } from 'lucide-react';
import { RESOURCE_DOMAINS, RESOURCE_DOMAIN_LABEL, type ResourceDomain } from '@/lib/sdoh/workflow';
import type { CommunityResource } from '../api';
import { EmptyState, Pill, formatDate } from './ui';

/** Read-only view of the org's SDOH resource directory (the one list staff maintain on /dashboard/sdoh). */
export function ResourcesPanel({ resources, canManage }: { resources: CommunityResource[]; canManage: boolean }) {
  const [domain, setDomain] = useState<ResourceDomain | ''>('');
  const list = useMemo(() => (domain ? resources.filter((r) => r.domains.includes(domain)) : resources), [resources, domain]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          From the clinic&apos;s community resource directory.{' '}
          {canManage ? (
            <Link href="/dashboard/sdoh?tab=directory" className="font-semibold text-[#5C2D91] hover:underline">Manage the directory</Link>
          ) : (
            'Ask a case manager or clinician to add or correct an entry.'
          )}
        </p>
        <select aria-label="Filter by area" value={domain} onChange={(e) => setDomain(e.target.value as ResourceDomain | '')} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <option value="">All areas</option>
          {RESOURCE_DOMAINS.map((d) => (
            <option key={d} value={d}>{RESOURCE_DOMAIN_LABEL[d]}</option>
          ))}
        </select>
      </div>
      {list.length === 0 ? (
        <EmptyState title={resources.length ? 'No resources in this area' : 'The resource directory is empty'}>
          {resources.length ? 'Try another area.' : 'Resources are added on the Social needs (SDOH) page.'}
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((r) => (
            <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">{r.name}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.domains.map((d) => (
                  <Pill key={d}>{RESOURCE_DOMAIN_LABEL[d as ResourceDomain] ?? d}</Pill>
                ))}
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                {(r.address || r.city) && <p>{[r.address, r.city, r.state].filter(Boolean).join(', ')}</p>}
                {r.hours && <p>Hours: {r.hours}</p>}
                {r.cost && <p>Cost: {r.cost}</p>}
                {r.eligibilityNotes && <p className="text-slate-500">{r.eligibilityNotes}</p>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 font-semibold text-[#5C2D91]">
                    <Phone size={12} /> {r.phone}
                  </a>
                )}
                {r.website && (
                  <a href={r.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#5C2D91]">
                    <ExternalLink size={12} /> Website
                  </a>
                )}
                <span className="text-slate-400">{r.lastVerifiedAt ? `Verified ${formatDate(r.lastVerifiedAt)}` : 'Not verified'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
