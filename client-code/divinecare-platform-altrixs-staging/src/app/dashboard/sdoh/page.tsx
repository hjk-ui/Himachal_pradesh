'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, BookMarked, ClipboardList, ListChecks } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { sdohApi, type SdohResourceDto } from '@/features/sdoh/api';
import { ScreenTab } from '@/features/sdoh/components/ScreenTab';
import { WorklistTab } from '@/features/sdoh/components/WorklistTab';
import { DirectoryTab } from '@/features/sdoh/components/DirectoryTab';
import { SummaryTab } from '@/features/sdoh/components/SummaryTab';
import { AHC_SOURCE } from '@/lib/sdoh/ahcHrsn';

const TABS = [
  { key: 'screen', label: 'Screen a client', icon: ClipboardList },
  { key: 'needs', label: 'Needs & referrals', icon: ListChecks },
  { key: 'directory', label: 'Resource directory', icon: BookMarked },
  { key: 'summary', label: 'Summary', icon: BarChart3 },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function SdohInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const tabParam = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'screen';
  const clientId = params.get('clientId');
  const [pickedName, setPickedName] = useState<string | undefined>(undefined);
  const [resources, setResources] = useState<SdohResourceDto[]>([]);
  const [legacyAvailable, setLegacyAvailable] = useState(0);

  const loadResources = useCallback(async () => {
    try {
      const r = await sdohApi.resources();
      setResources(r.resources);
      setLegacyAvailable(r.legacyAvailable);
    } catch {
      setResources([]);
    }
  }, []);
  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const go = useCallback(
    (next: { tab?: TabKey; clientId?: string | null }) => {
      const q = new URLSearchParams(params.toString());
      if (next.tab) q.set('tab', next.tab);
      if (next.clientId !== undefined) {
        if (next.clientId) q.set('clientId', next.clientId);
        else q.delete('clientId');
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">Social care</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Social Needs (SDOH)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Screen with the CMS AHC Health-Related Social Needs tool, refer to community resources, and follow each need to closure.
        </p>
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => go({ tab: t.key })}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                active ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'screen' && (
        <ScreenTab
          key={clientId ?? 'none'}
          initialClient={clientId ? { id: clientId, name: pickedName } : null}
          resources={resources}
          onClientChange={(id) => go({ clientId: id })}
        />
      )}
      {tab === 'needs' && (
        <WorklistTab
          myUserId={user?.id ?? null}
          onScreenClient={(id, name) => {
            setPickedName(name);
            go({ tab: 'screen', clientId: id });
          }}
        />
      )}
      {tab === 'directory' && <DirectoryTab resources={resources} legacyAvailable={legacyAvailable} onChanged={loadResources} />}
      {tab === 'summary' && <SummaryTab />}

      <p className="border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500">
        Screening questions from {AHC_SOURCE.tool} Item citations:{' '}
        <a href={AHC_SOURCE.citationTableUrl} target="_blank" rel="noreferrer" className="underline">
          CMS citation and notification table
        </a>
        .
      </p>
    </div>
  );
}

export default function SdohPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <SdohInner />
    </Suspense>
  );
}
