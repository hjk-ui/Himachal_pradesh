'use client';

/**
 * Measure guide (Reports > Measure guide; also linked from the chart Measures card and Outcome
 * measures): one entry per instrument in the catalog. What it measures, item count and score
 * range, severity bands / cutoffs, clinically meaningful change, frequency, critical items and the
 * source. Built from src/lib/measures/guide.ts, which derives the bands from the same scoring the
 * chart uses, so the guide and the scores cannot disagree. Cutoffs not verified against the
 * published manual say "See the instrument manual". No patient data on this page.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, Page, PageHeader, StatusBadge, Tabs, cx, inputClasses } from '@/components/ui';
import { measureGuide } from '@/lib/measures/guide';
import { MeasureGuidePanel } from '@/components/measures/MeasureGuidePanel';

export default function MeasureGuidePage() {
  const all = useMemo(() => measureGuide(), []);
  const categories = useMemo(() => [...new Set(all.map((e) => e.category))], [all]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Deep link from the chart: /dashboard/mbc/guide#phq-9 opens and scrolls to that entry
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!id || !all.some((e) => e.id === id)) return;
    setOpen(new Set([id]));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, [all]);

  const term = q.trim().toLowerCase();
  const shown = all.filter((e) => (cat === 'all' || e.category === cat) && (!term || `${e.name} ${e.fullName} ${e.category}`.toLowerCase().includes(term)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Page>
      <PageHeader
        eyebrow="Outcome measures"
        title="Measure guide"
        description="How to read each measure: what it measures, score range, severity bands, meaningful change, how often to give it, and critical items. Bands come from the same scoring Altrixs uses on the chart."
        actions={
          <Link href="/dashboard/mbc" className="text-sm font-semibold text-blue-700 hover:underline">
            Outcome measures
          </Link>
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (e.g. PHQ-9, PTSD)" aria-label="Search measures" className={cx(inputClasses, 'sm:max-w-xs')} />
        <span className="text-xs text-slate-500">{shown.length} of {all.length} measures</span>
      </div>
      <div className="mb-4 max-w-full overflow-x-auto">
        <Tabs value={cat} onChange={setCat} variant="pill" controlsPanels={false} label="Filter by category" items={[{ key: 'all', label: 'All' }, ...categories.map((c) => ({ key: c, label: c }))]} />
      </div>
      <ul className="space-y-2">
        {shown.map((e) => {
          const isOpen = open.has(e.id);
          return (
            <li key={e.id} id={e.id} className="scroll-mt-20">
              <Card className="p-0">
                <button
                  type="button"
                  onClick={() => toggle(e.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-900">{e.name}</span> <span className="text-sm text-slate-600">{e.fullName}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <StatusBadge size="sm" tone="neutral">{e.category}</StatusBadge>
                      <StatusBadge size="sm" tone="neutral">{e.adminType}</StatusBadge>
                      {e.sendable ? <StatusBadge size="sm" tone="info">Can send to patient</StatusBadge> : null}
                      {e.blankPrint.ok ? <StatusBadge size="sm" tone="success">Blank form</StatusBadge> : null}
                      {e.bands || e.verified ? null : <StatusBadge size="sm" tone="warning">See manual for cutoffs</StatusBadge>}
                    </span>
                  </span>
                  {isOpen ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden />}
                </button>
                {isOpen ? (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <MeasureGuidePanel entry={e} />
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {!shown.length ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <BookOpen className="h-4 w-4" aria-hidden /> No measures match.
        </p>
      ) : null}
    </Page>
  );
}
