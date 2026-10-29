'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, AlertTriangle, Clock, Download, Eye, Users } from 'lucide-react';
import { Alert, buttonClasses, LoadingState, Page, PageHeader, StatCard } from '@/components/ui';
import { AuditLogPanel, type AuditFacet } from '../AuditLogPanel';
import { UnusualAccessPanel } from './UnusualAccessPanel';

type Summary = {
  total: number;
  last24h: number;
  failed30d: number;
  denied30d: number;
  uniqueUsers30d: number;
  phiReadsToday: number;
  exportsToday: number;
  facets: { actions: AuditFacet[]; resourceTypes: AuditFacet[] };
};

type Staff = { id: string; name: string | null; email?: string | null };

function AuditLogPage() {
  const params = useSearchParams();
  const initialPatientId = params.get('patientId')?.trim() || '';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [userFilter, setUserFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/audit-log/summary', { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as ({ success?: boolean; error?: string } & Partial<Summary>) | null;
        if (!r.ok || !d?.success) throw new Error(d?.error || 'Could not load audit summary');
        if (!cancelled) setSummary(d as Summary);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSummaryError(e instanceof Error ? e.message : 'Could not load audit summary');
      });
    fetch('/api/staff', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { success?: boolean; users?: Staff[] }) => {
        if (!cancelled && d?.success) setStaff(d.users ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const n = (v: number | undefined) => (summary ? (v ?? 0).toLocaleString() : '—');

  return (
    <Page>
      <PageHeader
        eyebrow="Altrixs · Admin › Compliance"
        title="HIPAA audit log"
        description="Who opened, changed or exported patient records — searchable, exportable, and reviewed for unusual access."
        actions={
          <Link href="/dashboard/admin" className={buttonClasses({ variant: 'secondary' })}>
            Admin & Compliance
          </Link>
        }
      />

      {summaryError ? <Alert tone="danger">{summaryError}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total events" value={n(summary?.total)} tone="brand" icon={<Activity />} hint="All time, this practice" />
        <StatCard label="Last 24 hours" value={n(summary?.last24h)} tone="info" icon={<Clock />} />
        <StatCard
          label="Failed / denied"
          value={summary ? `${summary.failed30d.toLocaleString()} / ${summary.denied30d.toLocaleString()}` : '—'}
          tone={summary && summary.denied30d > 0 ? 'danger' : 'neutral'}
          icon={<AlertTriangle />}
          hint="Last 30 days"
        />
        <StatCard label="Active users" value={n(summary?.uniqueUsers30d)} tone="neutral" icon={<Users />} hint="Last 30 days" />
        <StatCard label="PHI reads today" value={n(summary?.phiReadsToday)} tone="info" icon={<Eye />} hint="Since midnight Eastern" />
        <StatCard label="Exports today" value={n(summary?.exportsToday)} tone="warning" icon={<Download />} hint="Since midnight Eastern" />
      </div>

      <UnusualAccessPanel
        onFilterUser={(id) => {
          setUserFilter(id);
          document.getElementById('audit-trail')?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <div id="audit-trail">
        <AuditLogPanel
          key={`${initialPatientId}|${userFilter}`}
          staff={staff}
          facets={summary?.facets}
          initialPatientId={userFilter ? '' : initialPatientId}
          initialActorUserId={userFilter}
        />
      </div>
    </Page>
  );
}

export default function AuditLogRoute() {
  return (
    <Suspense fallback={<LoadingState label="Loading audit log…" />}>
      <AuditLogPage />
    </Suspense>
  );
}
