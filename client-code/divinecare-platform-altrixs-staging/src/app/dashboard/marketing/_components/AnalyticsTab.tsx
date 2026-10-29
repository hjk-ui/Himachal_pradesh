'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, FormField, IconButton, LoadingState, StatusBadge } from '@/components/ui';
import { formatDuration } from '@/lib/marketing/leads';
import { leadStageLabel, LEAD_SOURCES } from '@/lib/marketing/constants';
import { Bar, Select, TextInput, fmtDate, money, pct, post, useApi } from './shared';

type Cell = { value: number; display: string; suppressed: boolean };
export type AnalyticsData = {
  periodDays: number;
  threshold: number;
  totals: { leads: number; converted: number; open: number; spendCents: number };
  funnel: { stage: string; count: number; rateFromPrev: number | null }[];
  sources: { source: string; label: string; leads: number; contacted: number; converted: Cell; firstAppointments: Cell; conversionRate: number | null; spendCents: number; costPerLeadCents: number | null; costPerConversionCents: number | null }[];
  speed: { responded: number; medianMinutes: number | null; averageMinutes: number | null; withinTargetRate: number | null; waiting: number };
  partners: { partnerId: string; name: string; leads: number; converted: Cell; lastTouchAt: string | null; quiet: boolean }[];
  events: { eventId: string; title: string; registrations: number; attended: number; leads: number; converted: Cell; costCents: number; costPerLeadCents: number | null }[];
  reviews: { average: number | null; trend: { month: string; count: number; average: number | null }[]; total: number; awaitingReply: number };
  spend: { id: string; channel: string; month: string; amountCents: number; note: string | null }[];
};

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th scope="col" className={`px-4 py-2 text-xs font-semibold text-slate-600 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-4 py-2.5 text-sm text-slate-700 ${right ? 'text-right tabular-nums' : ''}`}>{children}</td>;
}

export function AnalyticsTab() {
  const [days, setDays] = useState(90);
  const { data, error, loading, reload } = useApi<AnalyticsData>(`/api/marketing/analytics?days=${days}`);
  const [spend, setSpend] = useState({ channel: 'Social media', month: new Date().toISOString().slice(0, 7), amount: '' });
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={6} />;
  if (!data) return null;
  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.count));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Alert tone="info">Counts and rates only. Client-linked counts in a breakdown below {data.threshold} show as &quot;&lt;{data.threshold}&quot; (small-cell suppression). Nothing here is shared with ad or analytics tools.</Alert>
        <FormField label="Period">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-36">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">12 months</option>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Stage conversion funnel" description="Leads that reached each stage." />
          <CardBody className="space-y-3">
            {data.funnel.map((f) => (
              <div key={f.stage}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-slate-700">{leadStageLabel(f.stage)}</span><span className="tabular-nums text-slate-900">{f.count}{f.rateFromPrev != null ? ` (${f.rateFromPrev}%)` : ''}</span></div>
                <Bar value={f.count} max={maxFunnel} label={`${leadStageLabel(f.stage)}: ${f.count}`} />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Speed to lead" />
          <CardBody className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate-500">Median</p><p className="text-xl font-semibold tabular-nums text-slate-900">{data.speed.medianMinutes == null ? '—' : formatDuration(data.speed.medianMinutes)}</p></div>
            <div><p className="text-slate-500">Average</p><p className="text-xl font-semibold tabular-nums text-slate-900">{data.speed.averageMinutes == null ? '—' : formatDuration(data.speed.averageMinutes)}</p></div>
            <div><p className="text-slate-500">Within target</p><p className="text-xl font-semibold tabular-nums text-slate-900">{pct(data.speed.withinTargetRate)}</p></div>
            <div><p className="text-slate-500">Waiting now</p><p className="text-xl font-semibold tabular-nums text-slate-900">{data.speed.waiting}</p></div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Lead sources and cost per lead" description="Spend is entered by hand per channel and month." />
        <div className="clinic-scroll-x overflow-x-auto">
          <table className="w-full min-w-[860px] divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><Th>Source</Th><Th right>Leads</Th><Th right>Contacted</Th><Th right>Converted</Th><Th right>First appts</Th><Th right>Conv. rate</Th><Th right>Spend</Th><Th right>Cost / lead</Th><Th right>Cost / conversion</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.sources.map((s) => (
                <tr key={s.source}><Td>{s.label}</Td><Td right>{s.leads}</Td><Td right>{s.contacted}</Td><Td right>{s.converted.display}</Td><Td right>{s.firstAppointments.display}</Td><Td right>{pct(s.conversionRate)}</Td><Td right>{money(s.spendCents)}</Td><Td right>{money(s.costPerLeadCents)}</Td><Td right>{money(s.costPerConversionCents)}</Td></tr>
              ))}
              {!data.sources.length ? <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">No leads in this period.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-slate-100">
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Channel">
              <Select value={spend.channel} onChange={(e) => setSpend({ ...spend, channel: e.target.value })} className="w-full sm:w-48">
                {LEAD_SOURCES.map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Month"><TextInput type="month" value={spend.month} onChange={(e) => setSpend({ ...spend, month: e.target.value })} className="w-40" /></FormField>
            <FormField label="Amount (USD)"><TextInput inputMode="decimal" value={spend.amount} onChange={(e) => setSpend({ ...spend, amount: e.target.value })} className="w-32" /></FormField>
            <Button size="md" variant="secondary" disabled={!Number(spend.amount)} onClick={async () => {
              try {
                await post('/api/marketing/spend', { action: 'add', channel: spend.channel, month: spend.month, amountCents: Math.round(Number(spend.amount) * 100) });
                setSpend({ ...spend, amount: '' });
                await reload();
              } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
            }}>Add spend</Button>
          </div>
          {data.spend.length ? (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {data.spend.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5"><span className="text-slate-700">{s.month} · {s.channel}</span><span className="flex items-center gap-2 tabular-nums">{money(s.amountCents)}<IconButton label="Delete spend" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { await post('/api/marketing/spend', { action: 'delete', id: s.id }); await reload(); }} /></span></li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Referral partner leaderboard" description="Referred leads (counts only)." />
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50"><tr><Th>Partner</Th><Th right>Leads</Th><Th right>Converted</Th><Th>Last touch</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.partners.slice(0, 15).map((p) => (
                  <tr key={p.partnerId}><Td>{p.name} {p.quiet ? <StatusBadge tone="warning" size="sm">Going quiet</StatusBadge> : null}</Td><Td right>{p.leads}</Td><Td right>{p.converted.display}</Td><Td>{fmtDate(p.lastTouchAt)}</Td></tr>
                ))}
                {!data.partners.length ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">No partners yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Event ROI" />
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50"><tr><Th>Event</Th><Th right>Registered</Th><Th right>Attended</Th><Th right>Leads</Th><Th right>Cost / lead</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.events.map((e) => (
                  <tr key={e.eventId}><Td>{e.title}</Td><Td right>{e.registrations}</Td><Td right>{e.attended}</Td><Td right>{e.leads}</Td><Td right>{money(e.costPerLeadCents)}</Td></tr>
                ))}
                {!data.events.length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">No events in this period.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Review rating trend" description={`${data.reviews.total} reviews on file`} />
        <CardBody>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {data.reviews.trend.map((t) => (
              <li key={t.month} className="rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">{t.month}</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{t.average ?? '—'}</p>
                <p className="text-xs text-slate-500">{t.count} review{t.count === 1 ? '' : 's'}</p>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
