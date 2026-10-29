'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canViewHuddle } from '@/lib/huddle/access';
import type { HuddleSheet } from '@/lib/huddle/core';

/**
 * Compact "Today's huddle" entry for the Today panel: visit and flag counts, linking to the huddle
 * sheet. GET /api/huddle?date=today&compact=1 (no summaries; audited). Hidden for roles without
 * the huddle and when the request fails.
 */
export function HuddleEntry() {
  const { user } = useAuth();
  const allowed = canViewHuddle(user?.role);
  const [sheet, setSheet] = useState<HuddleSheet | null>(null);
  useEffect(() => {
    if (!allowed) return;
    apiJson<{ success: true; sheet: HuddleSheet }>('/api/huddle?date=today&compact=1')
      .then((r) => setSheet(r.sheet))
      .catch(() => setSheet(null));
  }, [allowed]);
  if (!allowed || !sheet) return null;
  const { visits, flags, flagged } = sheet.counts;
  return (
    <Link
      href={`/dashboard/huddle?date=${encodeURIComponent(sheet.date)}`}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-[#5C2D91] hover:bg-purple-100"
    >
      <ClipboardList size={16} aria-hidden className="shrink-0" />
      <span className="font-semibold">Today&apos;s huddle</span>
      <span className="text-slate-600">
        {visits} visit{visits === 1 ? '' : 's'} · {flags} flag{flags === 1 ? '' : 's'}
        {flags ? ` on ${flagged} client${flagged === 1 ? '' : 's'}` : ''}
      </span>
    </Link>
  );
}
