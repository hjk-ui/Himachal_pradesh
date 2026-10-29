'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/features/auth';
import {
  canAccessDrFirstReturn,
  DRFIRST_RETURN_STATUS,
  drfirstThrottleCopy,
} from '@/lib/drfirst/returnAccess';

export default function DrFirstReturnPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState(DRFIRST_RETURN_STATUS);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!canAccessDrFirstReturn(user.role)) {
      router.replace('/dashboard/ehr/prescriptions');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/drfirst/sync/return', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (data?.reason === 'throttled' && data.retryAfterSeconds) {
          setDetail(drfirstThrottleCopy(Number(data.retryAfterSeconds)));
          setTimeout(() => {
            if (!cancelled) router.replace('/dashboard/ehr/prescriptions');
          }, 2500);
          return;
        }

        if (res.ok && data?.clientId) {
          router.replace(`/dashboard/clients/${data.clientId}?tab=medications`);
          return;
        }

        router.replace('/dashboard/ehr/prescriptions');
      } catch {
        if (!cancelled) {
          setStatus('Unable to update from DrFirst right now.');
          setTimeout(() => router.replace('/dashboard/ehr/prescriptions'), 2000);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-[#5C2D91]" />
      <p className="text-sm font-semibold text-[#141C34]">{status}</p>
      {detail ? <p className="max-w-md text-xs text-slate-600">{detail}</p> : null}
    </div>
  );
}
