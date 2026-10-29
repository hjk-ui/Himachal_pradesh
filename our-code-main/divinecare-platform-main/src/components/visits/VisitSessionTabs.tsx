'use client';

import { useState, type ReactNode } from 'react';
import { ChartHistoryCard } from '@/components/chart/ChartHistoryCard';
import {
  SESSION_TAB_BH_HISTORY,
  SESSION_TAB_CHART_HISTORY,
  SESSION_TAB_MEDICAL_HISTORY,
  SESSION_TAB_VISIT_GUIDE,
} from '@/lib/chart-digest/copy';
import { canViewDigestKind, type ChartDigestKind } from '@/lib/chart-digest/kinds';

type TabId = 'guide' | 'chart' | 'medical' | 'bh';

type Props = {
  clientId?: string | null;
  /** Staff role, used to hide history tabs the role cannot open */
  role?: string | null;
  /** Medical visits show Medical history + Behavioral health history instead of one Chart history tab */
  variant?: 'bh' | 'medical';
  /** The Visit guide panel */
  children: ReactNode;
  className?: string;
};

type TabDef = { id: TabId; label: string; kind?: ChartDigestKind; title?: string };

export function VisitSessionTabs({ clientId, role, variant = 'bh', children, className = '' }: Props) {
  const [tab, setTab] = useState<TabId>('guide');

  const history: TabDef[] =
    variant === 'medical'
      ? [
          { id: 'medical', label: SESSION_TAB_MEDICAL_HISTORY, kind: 'medical', title: SESSION_TAB_MEDICAL_HISTORY },
          { id: 'bh', label: SESSION_TAB_BH_HISTORY, kind: 'bh', title: SESSION_TAB_BH_HISTORY },
        ]
      : [{ id: 'chart', label: SESSION_TAB_CHART_HISTORY, kind: 'bh' }];

  const tabs: TabDef[] = [
    { id: 'guide', label: SESSION_TAB_VISIT_GUIDE },
    ...(clientId ? history.filter((t) => !t.kind || canViewDigestKind(role, t.kind)) : []),
  ];

  // Only one tab (Visit guide): render it bare.
  if (tabs.length === 1) return <>{children}</>;

  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className={className} data-testid="visit-session-tabs">
      <div role="tablist" className="mb-2 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active.id === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition ${
              active.id === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active.id === 'guide' || !active.kind || !clientId ? (
        children
      ) : (
        <ChartHistoryCard clientId={clientId} kind={active.kind} title={active.title} />
      )}
    </div>
  );
}
