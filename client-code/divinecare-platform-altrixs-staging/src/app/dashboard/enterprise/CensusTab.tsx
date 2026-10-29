'use client';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight, Download, Info, Siren, UserCheck, Users } from 'lucide-react';
import { Alert, Button, Card, CardHeader, ErrorState, IconButton, LoadingState, StatCard, buttonClasses, cx, inputClasses, type Tone } from '@/components/ui';
import type { CensusGroup, PracticeCensus, StatusCounts } from '@/lib/locations/census';
import { BEDS_NOT_CONFIGURED, CAPACITY_SETTINGS_HREF } from '@/lib/residential/capacity';
import { addDaysYmd } from '@/lib/dashboard/practiceDay';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';

// Daily census. Every figure comes from GET /api/locations/census (leadership only, audited). Counts only:
// no client names. The location filter is the page's location chip (or the sidebar location switcher).
// grouping 'facility' (page default): rows are the practice's Valant facilities; filter = the facility chip.

const fmtN = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));
const dayLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

const COLS: { key: keyof StatusCounts; label: string }[] = [
  { key: 'booked', label: 'Booked' },
  { key: 'notArrived', label: 'Not arrived' },
  { key: 'checkedIn', label: 'Checked in' },
  { key: 'inSession', label: 'In session' },
  { key: 'completed', label: 'Completed' },
  { key: 'noShow', label: 'No-show' },
  { key: 'lateCancel', label: 'Late cancel' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'remaining', label: 'Remaining' },
];

const TH = 'whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600';
// First column stays pinned while the wide census tables scroll sideways on tablets and phones.
const THL = cx(TH, 'sticky left-0 z-10 bg-slate-50 text-left');
const THR = cx(TH, 'text-right');
const TD = 'whitespace-nowrap px-4 py-2 text-right tabular-nums';
const TDL_BASE = 'sticky left-0 z-10 whitespace-nowrap px-4 py-2';
const TDL = cx(TDL_BASE, 'bg-white group-hover:bg-slate-50');
const TDL_TOTAL = cx(TDL_BASE, 'bg-slate-50');
const HEAD_ROW = 'border-b border-slate-200 bg-slate-50';
const TOTAL_ROW = 'bg-slate-50 font-semibold text-slate-900';

function Tile({ label, value, sub, Icon, tone = 'brand' }: { label: string; value: string; sub?: string; Icon: React.ElementType; tone?: Tone }) {
  return <StatCard label={label} value={value} hint={sub} icon={<Icon />} tone={tone} />;
}

function GroupCells({ g }: { g: CensusGroup }) {
  return (
    <>
      {COLS.map((c) => (
        <td key={c.key} className={TD}>{fmtN(g.counts[c.key])}</td>
      ))}
      <td className={TD}>{fmtN(g.telehealth)}</td>
      <td className={TD}>{fmtN(g.inPerson)}</td>
      <td className={cx(TD, 'font-semibold')}>{fmtN(g.clientsSeen)}</td>
    </>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 8;
  const h = 32;
  return (
    <svg width={values.length * (w + 2)} height={h} role="img" aria-label="Daily clients seen, last 14 days">
      {values.map((v, i) => {
        const bh = Math.max(v > 0 ? 2 : 0, Math.round((v / max) * h));
        return <rect key={i} x={i * (w + 2)} y={h - bh} width={w} height={bh} rx={1.5} className={i === values.length - 1 ? 'fill-blue-600' : 'fill-blue-200'} />;
      })}
    </svg>
  );
}

const Section = ({ title, sub, children, actions }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode }) => (
  <Card className="overflow-hidden">
    <CardHeader title={title} titleAs="h3" description={sub} actions={actions} />
    <div className="clinic-scroll-x">{children}</div>
  </Card>
);

export default function CensusTab({
  locationId,
  grouping = 'location',
  facility = null,
}: {
  locationId: string | null;
  grouping?: 'location' | 'facility';
  facility?: string | null;
}) {
  const byFacility = grouping === 'facility';
  const unit = byFacility ? 'Facility' : 'Location';
  const [date, setDate] = useState<string>('');
  const [census, setCensus] = useState<PracticeCensus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const canEditBeds = canAccessPath(user?.role ?? null, CAPACITY_SETTINGS_HREF);

  const query = useCallback(
    (format?: 'csv') => {
      const p = new URLSearchParams();
      if (date) p.set('date', date);
      if (byFacility) {
        p.set('group', 'facility');
        if (facility) p.set('facility', facility);
      } else if (locationId) p.set('location', locationId);
      if (format) p.set('format', format);
      const s = p.toString();
      return `/api/locations/census${s ? `?${s}` : ''}`;
    },
    [date, locationId, byFacility, facility]
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetch(query())
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `Could not load the census (${res.status})`);
        if (!live) return;
        const c = data.census as PracticeCensus;
        setCensus(c);
        if (!date) setDate(c.date);
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'Could not load the census'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const t = census?.totals;
  const past = census?.when === 'past';
  const remainingLabel = past ? 'Not closed out' : 'Remaining';
  const cols = COLS.map((c) => (c.key === 'remaining' ? { ...c, label: remainingLabel } : c));
  const head = (
    <thead>
      <tr className={HEAD_ROW}>
        <th scope="col" className={THL}>{unit} / service</th>
        {cols.map((c) => <th key={c.key} scope="col" className={THR}>{c.label}</th>)}
        <th scope="col" className={THR}>Telehealth</th>
        <th scope="col" className={THR}>In person</th>
        <th scope="col" className={THR}>Seen</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-5">
      {/* Date + export */}
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          label="Previous day"
          icon={<ChevronLeft size={16} />}
          disabled={!date}
          onClick={() => setDate((d) => addDaysYmd(d, -1))}
          className="h-10 w-10 border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50 md:h-9 md:w-9"
        />
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={cx(inputClasses, 'w-auto py-1.5')} aria-label="Census date" />
        <IconButton
          label="Next day"
          icon={<ChevronRight size={16} />}
          disabled={!date}
          onClick={() => setDate((d) => addDaysYmd(d, 1))}
          className="h-10 w-10 border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50 md:h-9 md:w-9"
        />
        <Button variant="secondary" size="sm" onClick={() => setDate('')}>
          Today
        </Button>
        <span className="text-sm text-slate-600">
          {census ? `${dayLabel(census.date)} · ${census.location ? census.location.name : byFacility ? 'All facilities' : 'All locations'} · practice time (${census.timeZone})` : null}
          {loading ? ' · loading…' : ''}
        </span>
        <a href={query('csv')} className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'ml-auto' })}>
          <Download size={16} aria-hidden /> Export CSV
        </a>
      </div>

      {error ? (
        <Card>
          <ErrorState title="Could not load the census" description={error} />
        </Card>
      ) : null}
      {loading && !census && !error ? (
        <Card>
          <LoadingState label="Loading the census…" />
        </Card>
      ) : null}

      {census && t ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile Icon={CalendarDays} label="Booked" value={fmtN(t.appointments.counts.booked)} sub={`${fmtN(t.appointments.telehealth)} telehealth · ${fmtN(t.appointments.inPerson)} in person`} />
            <Tile Icon={UserCheck} label="Checked in / in session" value={`${fmtN(t.appointments.counts.checkedIn)} / ${fmtN(t.appointments.counts.inSession)}`} tone="info" />
            <Tile Icon={UserCheck} label="Completed" value={fmtN(t.appointments.counts.completed)} tone="success" />
            <Tile Icon={Info} label="No-show / late cancel" value={`${fmtN(t.appointments.counts.noShow)} / ${fmtN(t.appointments.counts.lateCancel)}`} tone="danger" />
            <Tile Icon={Info} label="Cancelled" value={fmtN(t.appointments.counts.cancelled)} tone="neutral" />
            <Tile Icon={CalendarDays} label={remainingLabel} value={fmtN(t.appointments.counts.remaining)} sub={past ? 'still scheduled or checked in' : 'not arrived or checked in'} tone="warning" />
            <Tile Icon={Users} label="Unique clients seen" value={fmtN(t.uniqueClientsSeen)} sub="appointments + PRP + TMS + Spravato" />
            <Tile Icon={Siren} label="Crisis episodes opened" value={fmtN(census.crisis.opened)} sub={Object.keys(census.crisis.byPriority).length ? Object.entries(census.crisis.byPriority).map(([p, n]) => `P${p}: ${n}`).join(' · ') : undefined} tone="danger" />
          </div>

          <Section
            title={byFacility ? 'Appointments by facility and service' : 'Appointments by location and service'}
            sub={byFacility
              ? "Appointments carry no facility: each is counted at the client's Valant facility (inferred). Seen = checked in, in session or completed (distinct clients)."
              : "Location on the appointment, else the client's home location. Seen = checked in, in session or completed (distinct clients)."}
          >
            <table className="w-full min-w-full text-sm text-slate-700">
              {head}
              <tbody className="divide-y divide-slate-100">
                <tr className={TOTAL_ROW}>
                  <td className={TDL_TOTAL}>All{census.location ? ` (${census.location.name})` : byFacility ? ' facilities' : ' locations'}</td>
                  <GroupCells g={t.appointments} />
                </tr>
                {census.locations.map((l) => (
                  <Fragment key={l.locationId ?? 'none'}>
                    <tr className="font-semibold text-slate-900">
                      <td className={TDL}>
                        {l.name}
                        {l.inferredAppointments ? <span className="ml-1 text-[11px] font-normal text-slate-500">({fmtN(l.inferredAppointments)} inferred)</span> : null}
                      </td>
                      <GroupCells g={l.appointments} />
                    </tr>
                    {l.byService.map((g) => (
                      <tr key={`${l.locationId ?? 'none'}-${g.key}`} className="group hover:bg-slate-50">
                        <td className={cx(TDL, 'pl-8 text-slate-600')}>{g.label}</td>
                        <GroupCells g={g} />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Programs and visits seen" sub={`PRP attendance recorded for the day; TMS and Spravato sessions; walk-ins only when the appointment type says walk-in. ${byFacility ? "Client's Valant facility." : 'Client home location.'}`}>
            <table className="w-full min-w-full text-sm text-slate-700">
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={THL}>{unit}</th>
                  <th scope="col" className={THR}>Clients seen</th>
                  <th scope="col" className={THR}>PRP encounters</th>
                  <th scope="col" className={THR}>PRP clients</th>
                  <th scope="col" className={THR}>TMS sessions</th>
                  <th scope="col" className={THR}>Spravato sessions</th>
                  <th scope="col" className={THR}>Walk-ins</th>
                  <th scope="col" className={THR}>Crisis opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className={TOTAL_ROW}>
                  <td className={TDL_TOTAL}>All</td>
                  <td className={TD}>{fmtN(t.uniqueClientsSeen)}</td>
                  <td className={TD}>{fmtN(t.prp.encounters)}</td>
                  <td className={TD}>{fmtN(t.prp.clients)}</td>
                  <td className={TD}>{fmtN(t.tms.encounters)}</td>
                  <td className={TD}>{fmtN(t.spravato.encounters)}</td>
                  <td className={TD}>{fmtN(t.walkIns)}</td>
                  <td className={TD}>{fmtN(census.crisis.opened)}</td>
                </tr>
                {census.locations.map((l) => (
                  <tr key={l.locationId ?? 'none'} className="hover:bg-slate-50">
                    <td className={TDL}>{l.name}</td>
                    <td className={TD}>{fmtN(l.uniqueClientsSeen)}</td>
                    <td className={TD}>{fmtN(l.prp.encounters)}</td>
                    <td className={TD}>{fmtN(l.prp.clients)}</td>
                    <td className={TD}>{fmtN(l.tms.encounters)}</td>
                    <td className={TD}>{fmtN(l.spravato.encounters)}</td>
                    <td className={TD}>{fmtN(l.walkIns)}</td>
                    <td className={TD}>{fmtN(l.crisisOpened)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section
              title="Residential census"
              sub={`Current residents by ASAM level vs configured beds${census.residential.attribution === 'residential_site' ? ' (all residents at the configured residential site)' : ''}.`}
              actions={canEditBeds ? <Link href={CAPACITY_SETTINGS_HREF} className="text-xs font-semibold text-blue-700 hover:underline">Beds settings</Link> : undefined}
            >
              <div className="p-4">
                {census.residential.migrationPending ? (
                  <p className="mb-2 text-xs text-amber-800">The residential_capacity table is not in this database yet (20261018_residential_capacity.sql).</p>
                ) : null}
                {!census.residential.configured ? (
                  <Alert tone="warning" icon={<BedDouble />} className="mb-3">
                    <span>{BEDS_NOT_CONFIGURED}{census.location ? ` for ${census.location.name}` : ''}. Set beds in Practice settings › Programs &amp; capacity.</span>
                  </Alert>
                ) : null}
                <table className="w-full text-sm text-slate-700">
                  <caption className="sr-only">Residential census by ASAM level</caption>
                  <thead>
                    <tr className={HEAD_ROW}>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold text-slate-600">ASAM level</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Residents</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Beds</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Open</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Occupancy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {census.residential.levels.filter((l) => l.beds !== null || l.residents > 0).map((l) => (
                      <tr key={l.level}>
                        <td className="px-2 py-2">{l.level}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtN(l.residents)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{l.beds === null ? <span className="text-amber-800">Not configured</span> : fmtN(l.beds)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtN(l.open)}{l.overCapacity ? <span className="text-rose-700"> (+{l.overCapacity} over)</span> : null}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{l.occupancyPct === null ? '—' : `${l.occupancyPct}%`}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold text-slate-900">
                      <td className="px-2 py-2">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtN(census.residential.total.residents)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtN(census.residential.total.beds)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtN(census.residential.total.open)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{census.residential.total.occupancyPct === null ? '—' : `${census.residential.total.occupancyPct}%`}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-600">
                  Admissions on this day: <strong>{fmtN(census.residential.admissions)}</strong> · discharges: <strong>{fmtN(census.residential.discharges)}</strong>
                </p>
              </div>
            </Section>

            <Section title="Last 14 days" sub="Distinct clients seen per practice day (same rule as above).">
              <div className="p-4">
                <Sparkline values={census.trend.map((d) => d.clientsSeen)} />
                <table className="mt-3 w-full text-sm text-slate-700">
                  <caption className="sr-only">Clients seen per day, last 14 days</caption>
                  <thead>
                    <tr className={HEAD_ROW}>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold text-slate-600">Day</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Seen</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Completed</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">Booked</th>
                      <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-600">No-show</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...census.trend].reverse().map((d) => (
                      <tr key={d.date} className={d.date === census.date ? 'bg-blue-50 font-semibold text-blue-700' : ''}>
                        <td className="px-2 py-1.5">{shortDay(d.date)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(d.clientsSeen)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(d.completed)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(d.booked)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(d.noShow)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          <Section title="By clinician" sub="Appointments on this day by the appointment's clinician.">
            <table className="w-full min-w-full text-sm text-slate-700">
              {head}
              <tbody className="divide-y divide-slate-100">
                {census.clinicians.length === 0 ? (
                  <tr><td colSpan={13} className="px-4 py-8 text-center text-sm text-slate-500">No appointments on this day.</td></tr>
                ) : (
                  census.clinicians.map((g) => (
                    <tr key={g.key} className="hover:bg-slate-50">
                      <td className={TDL}>{g.label}</td>
                      <GroupCells g={g} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Section>

          <Section title="Active caseload" sub={`As of now, by ${byFacility ? "client's Valant facility" : 'client home location'}.`}>
            <p className="px-5 pt-3 pb-2 text-xs text-slate-500">Primary care = primary-care patient rule (intake flag, medical records or Valant Family Practice rows).</p>
            <table className="w-full min-w-full text-sm text-slate-700">
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={THL}>{unit}</th>
                  <th scope="col" className={THR}>Active clients</th>
                  <th scope="col" className={THR}>PRP enrolled</th>
                  <th scope="col" className={THR}>Residential</th>
                  <th scope="col" className={THR}>Primary care</th>
                  <th scope="col" className={THR}>TMS courses</th>
                  <th scope="col" className={THR}>Spravato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {census.caseload.rows.map((r) => (
                  <tr key={r.locationId ?? 'none'} className="hover:bg-slate-50">
                    <td className={TDL}>{r.name}</td>
                    <td className={TD}>{fmtN(r.activeClients)}</td>
                    <td className={TD}>{fmtN(r.prpActive)}</td>
                    <td className={TD}>{fmtN(r.residentialResidents)}</td>
                    <td className={TD}>{fmtN(r.primaryCareActive)}</td>
                    <td className={TD}>{fmtN(r.tmsActive)}</td>
                    <td className={TD}>{fmtN(r.spravatoActive)}</td>
                  </tr>
                ))}
                <tr className={TOTAL_ROW}>
                  <td className={TDL_TOTAL}>Total</td>
                  <td className={TD}>{fmtN(census.caseload.totals.activeClients)}</td>
                  <td className={TD}>{fmtN(census.caseload.totals.prpActive)}</td>
                  <td className={TD}>{fmtN(census.caseload.totals.residentialResidents)}</td>
                  <td className={TD}>{fmtN(census.caseload.totals.primaryCareActive)}</td>
                  <td className={TD}>{fmtN(census.caseload.totals.tmsActive)}</td>
                  <td className={TD}>{fmtN(census.caseload.totals.spravatoActive)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-1.5 text-xs font-semibold text-slate-700">How these numbers are counted</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              {census.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
