import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { MarketingDocShell } from '@/components/marketing/MarketingDocShell';
import { BaaDocument } from '@/components/legal/BaaDocument';
import { BAA_DRAFT_BANNER, BAA_LEGAL_REVIEWED, BAA_OPEN_ITEMS, BAA_TITLE, BAA_VERSION } from '@/lib/legal/baa';

export const metadata: Metadata = {
  title: 'Business Associate Agreement',
  description:
    'The Altrixs Business Associate Agreement, with a 42 CFR Part 2 qualified service organization addendum, accepted by clinics that use the Altrixs behavioral health EHR.',
};

export default function BaaPage() {
  return (
    <MarketingDocShell title={BAA_TITLE}>
      <p className="text-sm text-slate-500">Version {BAA_VERSION}</p>
      {!BAA_LEGAL_REVIEWED ? (
        <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {BAA_DRAFT_BANNER}
          </p>
          <p className="mt-2">This text is a draft and may change before it is final. Open items:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {BAA_OPEN_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <BaaDocument headingLevel="h1" showTitle={false} />
    </MarketingDocShell>
  );
}
