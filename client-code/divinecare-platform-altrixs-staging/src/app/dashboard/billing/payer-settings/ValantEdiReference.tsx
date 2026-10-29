'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

export type ValantReference = {
  mappingId: string;
  payerName: string;
  waystarPayerId: string;
  verified: boolean;
  valant: { id: string; name: string; ediPayerId: string; match: 'name' | 'equivalent'; reason?: string; clientCount?: number }[];
  discrepancies: string[];
};

/** Valant EDI payer IDs per Waystar mapping (reference only; never written to the mapping). */
export function useValantReferences(reloadKey?: unknown) {
  const [refs, setRefs] = useState<Map<string, ValantReference> | null>(null);
  useEffect(() => {
    apiJson<{ imported: boolean; references: ValantReference[] }>('/api/billing/insurance-companies/waystar-check')
      .then((d) => setRefs(d.imported ? new Map(d.references.map((r) => [r.mappingId, r])) : new Map()))
      .catch(() => setRefs(new Map()));
  }, [reloadKey]);
  return refs;
}

/** Table cell: the Valant EDI payer ID(s) for a mapping, highlighted when they differ from the Waystar ID. */
export function ValantEdiCell({ reference }: { reference: ValantReference | undefined }) {
  if (!reference || reference.valant.length === 0) return <td className="px-4 py-2 text-gray-400">—</td>;
  const differs = reference.discrepancies.length > 0;
  return (
    <td className={`px-4 py-2 ${differs ? 'bg-amber-50' : ''}`}>
      {reference.valant.map((v) => (
        <p key={v.id} className={differs && v.ediPayerId && v.ediPayerId !== reference.waystarPayerId.toUpperCase() ? 'text-amber-900' : 'text-gray-700'}>
          <span className="font-mono font-bold">{v.ediPayerId || 'none'}</span> <span className="text-gray-500">{v.name}</span>
          {typeof v.clientCount === 'number' ? <span className="text-gray-400"> · {v.clientCount} clients</span> : null}
          {v.match === 'equivalent' ? <span className="block text-[11px] text-gray-500">Likely the same program: {v.reason}</span> : null}
        </p>
      ))}
      {differs ? (
        <p className="mt-0.5 flex items-start gap-1 text-[11px] font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Valant used {reference.discrepancies.join(', ')}; Waystar ID is {reference.waystarPayerId}. Verify against Waystar&apos;s payer list.
        </p>
      ) : null}
      <Link href="/dashboard/billing/insurance-companies" className="text-[11px] font-semibold text-purple-700">
        Insurance companies
      </Link>
    </td>
  );
}
