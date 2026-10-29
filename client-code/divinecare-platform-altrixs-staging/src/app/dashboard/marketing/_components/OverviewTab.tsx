'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, Clock, Sparkles, Star, TrendingUp, Users } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, ErrorState, LoadingState, StatCard, StatGrid } from '@/components/ui';
import { formatDuration } from '@/lib/marketing/leads';
import { DraftNotice, post, useApi } from './shared';
import type { AnalyticsData } from './AnalyticsTab';

type Calendar = { month: number; items: { title: string; note: string; ideas: string[] }[] };

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, error, loading, reload } = useApi<AnalyticsData>('/api/marketing/analytics?days=30');
  const [insights, setInsights] = useState<{ insights: string[]; engine: 'bedrock' | 'rules' } | null>(null);
  const [busy, setBusy] = useState(false);
  const thisMonth = new Date().getMonth() + 1;
  const [cal, setCal] = useState<Calendar[] | null>(null);

  const runInsights = async () => {
    setBusy(true);
    try {
      const r = await post<{ success: true; draft: { data: { insights: string[] }; engine: 'bedrock' | 'rules' } }>('/api/marketing/ai', { feature: 'growthInsights' });
      setInsights({ insights: r.draft.data.insights, engine: r.draft.engine });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate insights');
    } finally {
      setBusy(false);
    }
  };
  const loadCalendar = async () => {
    try {
      const months = [thisMonth, (thisMonth % 12) + 1];
      const res = await Promise.all(months.map((m) => post<{ success: true; draft: { data: Calendar } }>('/api/marketing/ai', { feature: 'contentCalendar', month: m })));
      setCal(res.map((r) => r.draft.data));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load suggestions');
    }
  };

  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const monthName = (m: number) => new Date(2026, m - 1, 1).toLocaleString('en-US', { month: 'long' });
  return (
    <div className="space-y-6">
      <StatGrid columns={4}>
        <StatCard label="Leads (30 days)" value={data.totals.leads} hint={`${data.totals.open} open`} icon={<Users aria-hidden />} tone="brand" />
        <StatCard label="Converted to clients" value={data.totals.converted} hint="Counts only" icon={<TrendingUp aria-hidden />} tone="success" />
        <StatCard label="Median speed to lead" value={data.speed.medianMinutes == null ? '—' : formatDuration(data.speed.medianMinutes)} hint={`${data.speed.waiting} waiting for first response`} icon={<Clock aria-hidden />} tone={data.speed.waiting ? 'warning' : 'success'} />
        <StatCard label="Average review rating" value={data.reviews.average ?? '—'} hint={`${data.reviews.awaitingReply} awaiting a reply`} icon={<Star aria-hidden />} tone="info" />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Weekly growth insights" description="From aggregate counts only. No client or lead details are sent to AI." icon={<Sparkles className="h-4 w-4" aria-hidden />} actions={<Button size="sm" variant="secondary" loading={busy} onClick={runInsights}>Generate</Button>} />
          <CardBody>
            {insights ? (
              <div className="space-y-2">
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {insights.insights.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                <DraftNotice engine={insights.engine} />
              </div>
            ) : (
              <p className="text-sm text-slate-500">Generate insights on best sources, stalled leads, quiet partners and reviews.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Content calendar ideas" description="Awareness months for this month and next." icon={<CalendarDays className="h-4 w-4" aria-hidden />} actions={<Button size="sm" variant="secondary" onClick={loadCalendar}>Suggest</Button>} />
          <CardBody>
            {cal ? (
              <div className="space-y-3">
                {cal.map((c) => (
                  <div key={c.month}>
                    <h3 className="text-sm font-semibold text-slate-900">{monthName(c.month)}</h3>
                    {c.items.map((it) => (
                      <div key={it.title} className="mt-1 text-sm text-slate-700">
                        <p className="font-medium">{it.title}</p>
                        <p className="text-xs text-slate-500">{it.note}</p>
                        <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{it.ideas.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    ))}
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => onNavigate('social')}>Plan posts in Social & content</Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Get awareness-month ideas (Mental Health Awareness Month, Suicide Prevention Month and more) for the social planner.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Lead sources (30 days)" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate('analytics')}>Full analytics</Button>} />
        <CardBody>
          {data.sources.length ? (
            <ul className="space-y-2">
              {data.sources.slice(0, 6).map((s) => (
                <li key={s.source} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{s.label}</span>
                  <span className="tabular-nums text-slate-900">{s.leads} leads · {s.converted.display} converted</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No leads in the last 30 days. Publish a web form and log phone inquiries as leads.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
