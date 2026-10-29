'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ChevronLeft, ChevronRight, FlaskConical, Lock, Search, UserPlus, Users } from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { apiJson } from '@/lib/api-client';
import { formatPracticeDate } from '@/lib/time/practiceTime';
import {
  PRIMARY_CARE_INTAKE_HREF,
  PRIMARY_CARE_PATIENTS_LABEL,
  ROSTER_PAGE_SIZE,
  type RosterResult,
  type RosterRow,
  type RosterSort,
  type RosterStatus,
} from '@/lib/medical/primaryCareRoster';
import { PCP_STATUS_LABEL, type PcpReviewDisplay, type PcpStatus } from '@/lib/medical/pcpAssignment';
import { buttonClasses } from '@/components/ui';

type Roster = RosterResult & { timeZone: string };

const STATUS_OPTIONS: { value: RosterStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'DISCHARGED', label: 'Discharged' },
  { value: 'all', label: 'All statuses' },
];

const shortDate = (iso: string | null | undefined, tz: string) =>
  iso ? formatPracticeDate(iso, tz, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** Primary care patients: the primary-care roster. Rows open the one client chart (Medical tabs). */
export default function PrimaryCarePatientsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [locationId, setLocationId] = useState('all');
  const [providerId, setProviderId] = useState('all');
  const [status, setStatus] = useState<RosterStatus>('ACTIVE');
  const [pcp, setPcp] = useState('all');
  const [pcpReview, setPcpReview] = useState(false);
  const [sort, setSort] = useState<RosterSort>('name');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unlinked, setUnlinked] = useState(false);

  useEffect(() => {
    // Old /dashboard/medical/patients/[id] links with no linked client land here (read once; no Suspense)
    try {
      setUnlinked(new URLSearchParams(window.location.search).get('unlinked') === '1');
    } catch {
      /* non-browser */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, locationId, providerId, status, pcp, pcpReview, sort]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ view: 'roster', page: String(page), pageSize: String(ROSTER_PAGE_SIZE), status });
    if (debouncedQ) params.set('q', debouncedQ);
    if (locationId !== 'all') params.set('locationId', locationId);
    if (providerId !== 'all') params.set('providerId', providerId);
    if (pcp !== 'all') params.set('pcp', pcp);
    if (pcpReview) params.set('pcpReview', '1');
    if (sort !== 'name') params.set('sort', sort);
    setLoading(true);
    setError('');
    apiJson<Roster>(`/api/medical/patients?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load primary care patients');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, debouncedQ, locationId, providerId, status, pcp, pcpReview, sort]);

  const cols = data?.columns;
  const tz = data?.timeZone || 'America/New_York';
  const rows = data?.rows ?? [];
  const first = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div className="mx-auto w-full max-w-7xl">
      <MedicalNavHeader
        title={PRIMARY_CARE_PATIENTS_LABEL}
        subtitle="Patients seen in primary care at Silver Spring and Bowie. Each patient has one chart: rows open the client chart on its Medical tabs."
        actionButton={
          <Link
            href={PRIMARY_CARE_INTAKE_HREF}
            className={buttonClasses()}
          >
            <UserPlus size={16} />
            New primary care patient
          </Link>
        }
      />

      {unlinked ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          That older medical record is not linked to a client chart, so it could not be opened. Find the patient below, or ask an administrator to link the record.
        </div>
      ) : null}

      <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <label className="relative block">
          <span className="sr-only">Search patients</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, MRN or DOB (MM/DD/YYYY)"
            className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>
        <select
          aria-label="Location"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-3 text-sm"
        >
          <option value="all">All locations</option>
          {(data?.filters.locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Seen by or on the care team"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-3 text-sm"
        >
          <option value="all">Seen by / care team: anyone</option>
          {(data?.filters.providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as RosterStatus)}
          className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-3 text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-xs">
        <select
          aria-label="Primary care provider (PCP)"
          value={pcp}
          onChange={(e) => setPcp(e.target.value)}
          className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-3 text-sm"
        >
          <option value="all">PCP: all</option>
          <option value="none">PCP: not set</option>
          {(data?.filters.providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              PCP: {p.name}
            </option>
          ))}
        </select>
        <label className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-slate-700">
          <input type="checkbox" checked={pcpReview} onChange={(e) => setPcpReview(e.target.checked)} />
          PCP needs review
        </label>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as RosterSort)}
          className="h-10 min-w-0 max-w-full rounded-lg border border-slate-200 px-3 text-sm"
        >
          <option value="name">Sort: patient name</option>
          <option value="pcp">Sort: PCP</option>
        </select>
        <span className="text-xs text-slate-500">
          Needs review = no PCP set, a PCP who differs from the provider seen most in the last 12 months, or two providers seen about equally.
        </span>
        {data?.truncated ? <span className="text-xs text-amber-700">Too many patients to sort; narrow the filters.</span> : null}
      </div>

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Patient</th>
                <th scope="col" className="px-4 py-3">Age / sex</th>
                <th scope="col" className="px-4 py-3">MRN</th>
                <th scope="col" className="px-4 py-3">Primary care provider</th>
                {cols?.visits ? <th scope="col" className="px-4 py-3">Last primary care visit</th> : null}
                <th scope="col" className="px-4 py-3">Next appointment</th>
                {cols?.problems ? <th scope="col" className="px-4 py-3">Active problems</th> : null}
                {cols?.vitals ? <th scope="col" className="px-4 py-3">Last vitals</th> : null}
                {cols?.labs ? <th scope="col" className="px-4 py-3">Labs</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Loading primary care patients…
                  </td>
                </tr>
              ) : null}
              {!loading && !error && !rows.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    <Users size={20} className="mx-auto mb-2 text-slate-500" />
                    No primary care patients match these filters.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <RosterTableRow key={r.clientId} row={r} cols={cols} tz={tz} onOpen={() => router.push(r.href)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
          <span>{data ? (data.total ? `${first}–${last} of ${data.total}` : '0 patients') : ''}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!data || data.page <= 1 || loading}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-2.5 font-semibold disabled:opacity-40 md:min-h-8"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span className="px-2">
              Page {data?.page ?? 1} of {data?.pageCount ?? 1}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data || data.page >= data.pageCount || loading}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-2.5 font-semibold disabled:opacity-40 md:min-h-8"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PCP_BADGE: Partial<Record<PcpStatus, string>> = {
  MISMATCH: 'bg-amber-100 text-amber-800',
  MISSING: 'bg-amber-100 text-amber-800',
  AMBIGUOUS: 'bg-sky-100 text-sky-800',
  UNMAPPED_PROVIDER: 'bg-slate-100 text-slate-700',
};

/** Only statuses that need attention are shown (MATCH / NO_EVIDENCE stay quiet) */
function PcpStatusBadge({ status }: { status: PcpStatus }) {
  const cls = PCP_BADGE[status];
  if (!cls) return null;
  return <div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{PCP_STATUS_LABEL[status]}</div>;
}

/** No staff PCP: "PCP: to confirm" with every contender (set one in the chart), or "PCP: not assigned" */
function PcpReviewCell({ review }: { review: PcpReviewDisplay }) {
  const title = review.contenders.map((c) => `${c.name}: ${c.inWindow} in the last 12 months, last ${c.lastDate}`).join('; ');
  return (
    <div className="min-w-0" title={title || undefined}>
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${review.state === 'to_confirm' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'}`}>
        {review.label}
      </span>
      {review.seenBy ? <div className="mt-0.5 break-words text-xs text-slate-600">{review.seenBy}</div> : null}
    </div>
  );
}

function RosterTableRow({
  row,
  cols,
  tz,
  onOpen,
}: {
  row: RosterRow;
  cols: RosterResult['columns'] | undefined;
  tz: string;
  onOpen: () => void;
}) {
  const muted = <span className="text-slate-500">—</span>;
  const notDocumented = <span className="text-slate-500">Not documented</span>;
  const ageSex = row.locked
    ? muted
    : [row.age !== null ? String(row.age) : null, row.sex].filter(Boolean).join(' / ') || notDocumented;
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      tabIndex={0}
      className="cursor-pointer align-top hover:bg-blue-600/5 focus:bg-blue-600/5 focus:outline-none"
    >
      <td className="px-4 py-3">
        <Link href={row.href} onClick={(e) => e.stopPropagation()} className="font-semibold text-slate-900 hover:text-blue-600 hover:underline">
          {row.locked ? (
            <span className="inline-flex items-center gap-1">
              <Lock size={13} className="text-amber-700" />
              {row.name}
            </span>
          ) : (
            row.name
          )}
        </Link>
        {!row.locked && (row.location || (row.status && row.status !== 'ACTIVE')) ? (
          <div className="mt-0.5 text-xs text-slate-500">
            {[row.location, row.status && row.status !== 'ACTIVE' ? row.status.toLowerCase() : null].filter(Boolean).join(' · ')}
          </div>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{ageSex}</td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{row.mrn || muted}</td>
      <td className="px-4 py-3 text-slate-700">
        {row.pcp ? (
          <>
            {row.pcp.name}
            {row.pcp.source === 'assigned_pcp_text' ? <div className="text-xs text-slate-500">from intake text; confirm in the chart</div> : null}
          </>
        ) : row.locked ? (
          muted
        ) : row.pcpReview ? (
          <PcpReviewCell review={row.pcpReview} />
        ) : (
          <span className="text-slate-500">Not set</span>
        )}
        {row.pcpStatus && !row.pcpReview ? <PcpStatusBadge status={row.pcpStatus} /> : null}
      </td>
      {cols?.visits ? (
        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
          {row.lastVisit ? (
            <>
              {shortDate(row.lastVisit.date, tz)}
              <div className="text-xs text-slate-500">{row.lastVisit.type}</div>
            </>
          ) : (
            muted
          )}
        </td>
      ) : null}
      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
        {row.nextAppointment ? (
          <>
            {shortDate(row.nextAppointment.startsAt, tz)}
            <div className="text-xs text-slate-500">
              {[row.nextAppointment.type, row.nextAppointment.clinician].filter(Boolean).join(' · ')}
            </div>
          </>
        ) : (
          muted
        )}
      </td>
      {cols?.problems ? (
        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
          {row.problems ? (
            <span className="inline-flex items-center gap-1.5">
              {row.problems.active}
              {row.problems.needsCoding ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {row.problems.needsCoding} needs coding
                </span>
              ) : null}
            </span>
          ) : (
            muted
          )}
        </td>
      ) : null}
      {cols?.vitals ? (
        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.lastVitalsAt ? shortDate(row.lastVitalsAt, tz) : muted}</td>
      ) : null}
      {cols?.labs ? (
        <td className="px-4 py-3">
          {row.labs && (row.labs.unreviewed || row.labs.standingDue || row.labs.standingOverdue) ? (
            <div className="flex flex-wrap gap-1">
              {row.labs.unreviewed ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    row.labs.critical ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  <FlaskConical size={11} />
                  {row.labs.unreviewed} to review{row.labs.critical ? ` (${row.labs.critical} critical)` : ''}
                </span>
              ) : null}
              {row.labs.standingOverdue ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {row.labs.standingOverdue} standing lab overdue
                </span>
              ) : null}
              {row.labs.standingDue ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {row.labs.standingDue} standing lab due
                </span>
              ) : null}
            </div>
          ) : (
            muted
          )}
        </td>
      ) : null}
    </tr>
  );
}
