'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HeartHandshake } from 'lucide-react';
import { DOMAIN_LABEL } from '@/lib/sdoh/ahcHrsn';
import { sdohApi, type ClientSdoh } from '../api';
import { Pill, formatDate } from './ui';
import { cardClasses, cx } from '@/components/ui';

/** Chart Summary card: latest AHC HRSN screening, open referrals, rescreen due. Renders nothing when the user can't see SDOH data. */
export function SocialNeedsCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientSdoh | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let cancel = false;
    sdohApi
      .clientSdoh(clientId)
      .then((d) => !cancel && setData(d))
      .catch(() => !cancel && setHidden(true));
    return () => {
      cancel = true;
    };
  }, [clientId]);
  if (hidden || !data) return null;

  const latest = data.screenings[0];
  const open = data.referrals.filter((r) => r.status !== 'closed').length;
  const href = `/dashboard/sdoh?tab=screen&clientId=${encodeURIComponent(clientId)}`;

  return (
    <div className={cx(cardClasses, 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          <HeartHandshake size={16} className="text-blue-600" aria-hidden /> Social needs
        </h3>
        <Link href={href} className="text-sm font-semibold text-blue-700 hover:underline">
          {latest ? 'Open' : 'Screen now'}
        </Link>
      </div>
      {latest ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-slate-600">
            Screened {formatDate(latest.completedAt)}
            {data.rescreen && data.rescreen.state !== 'current' && (
              <span className={data.rescreen.state === 'overdue' ? 'font-semibold text-rose-700' : 'font-semibold text-amber-700'}>
                {' '}
                · rescreen {data.rescreen.state === 'overdue' ? 'overdue' : 'due'} {formatDate(data.rescreen.dueAt)}
              </span>
            )}
            {open > 0 && ` · ${open} open referral${open === 1 ? '' : 's'}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {latest.positiveDomains.length === 0 ? (
              <Pill tone="emerald">No needs identified</Pill>
            ) : (
              latest.positiveDomains.map((d) => (
                <Pill key={d} tone={d === 'safety' ? 'rose' : 'amber'}>
                  {DOMAIN_LABEL[d]}
                </Pill>
              ))
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Not screened for social needs yet.</p>
      )}
    </div>
  );
}
