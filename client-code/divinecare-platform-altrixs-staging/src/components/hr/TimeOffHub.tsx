'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Scale } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, Modal, Page, PageHeader, StatusBadge, Tabs, cx } from '@/components/ui';
import { Labeled, PolicyConfirm, Select, TextArea, TextInput } from './HrBits';
import { fmtDate, hrFetch, titleCase, useHrData } from './hrClient';

export type TimeOffRequest = {
  id: string;
  userId: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number;
  note: string | null;
  status: string;
  approverName: string | null;
  decisionNote: string | null;
  scheduleConflicts: number | null;
  canDecide: boolean;
};
type TimeOffData = {
  viewer: { userId: string; admin: boolean; teamSize: number };
  requests: TimeOffRequest[];
  balances: Record<string, { pto: number; sick: number }>;
  people: Array<{ userId: string; name: string; role: string }>;
  types: Array<{ key: string; label: string; bucket: string | null }>;
  policy: { sickAccrualHoursWorked: number | null; sickAnnualAccrualCap: number | null; sickBalanceCap: number | null; ptoPolicy: { hoursPerPeriod?: number | null } | null; confirmed: boolean };
  scheduleIntegration: { mode: string; message: string };
};

const TYPE_TONE: Record<string, string> = { pto: 'bg-blue-100 text-blue-800', sick: 'bg-amber-100 text-amber-900', fmla: 'bg-rose-100 text-rose-800' };

export function TimeOffHub() {
  const { data, error, loading, reload } = useHrData<TimeOffData>('/api/hr/time-off');
  const [tab, setTab] = useState<'approvals' | 'calendar' | 'balances'>('approvals');
  const [requestOpen, setRequestOpen] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = (data?.requests ?? []).filter((r) => r.status === 'pending');

  return (
    <Page width="full">
      <PageHeader
        eyebrow="HR"
        title="Time off"
        description="PTO and sick leave requests, supervisor approval, balances and the team calendar."
        actions={<Button icon={<Plus />} onClick={() => setRequestOpen(true)}>Enter request</Button>}
      />
      {notice ? <Alert tone="warning" actions={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice}</Alert> : null}
      {loading && !data ? <LoadingState rows={6} /> : null}
      {error && !data ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <Alert tone="info" title="Scheduling">{data.scheduleIntegration.message}</Alert>
          <Tabs
            label="Time off views"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'approvals', label: 'Requests', count: pending.length },
              { key: 'calendar', label: 'Calendar' },
              { key: 'balances', label: 'Balances' },
            ]}
          />
          {tab === 'approvals' ? <RequestList requests={data.requests} onChanged={reload} onNotice={setNotice} /> : null}
          {tab === 'calendar' ? <TimeOffCalendar requests={data.requests.filter((r) => r.status === 'approved' || r.status === 'pending')} /> : null}
          {tab === 'balances' ? (
            <Card>
              <CardHeader
                title="Balances"
                description={
                  <>
                    Sick leave accrues {data.policy.sickAccrualHoursWorked ? `1 hour per ${data.policy.sickAccrualHoursWorked} hours worked` : '(rate not set)'} (Maryland Healthy Working Families Act).{' '}
                    {data.policy.confirmed ? null : <PolicyConfirm />}
                  </>
                }
              />
              <CardBody flush>
                <ul className="divide-y divide-slate-100">
                  {data.people.map((p) => {
                    const b = data.balances[p.userId] ?? { pto: 0, sick: 0 };
                    return (
                      <li key={p.userId} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-medium text-slate-900">{p.name}</span>
                        <span className="flex items-center gap-3 text-sm">
                          <span>PTO <strong className={cx('tabular-nums', b.pto < 0 && 'text-rose-700')}>{b.pto} h</strong></span>
                          <span>Sick <strong className={cx('tabular-nums', b.sick < 0 && 'text-rose-700')}>{b.sick} h</strong></span>
                          {data.viewer.admin ? <Button size="sm" variant="secondary" icon={<Scale />} onClick={() => setLedgerFor(p.userId)}>Accrue / adjust</Button> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ) : null}
          {requestOpen ? (
            <RequestTimeOffModal
              types={data.types}
              people={data.viewer.admin ? data.people : undefined}
              onClose={() => setRequestOpen(false)}
              onSaved={() => {
                setRequestOpen(false);
                reload();
              }}
            />
          ) : null}
          {ledgerFor ? (
            <LedgerEntryModal
              userId={ledgerFor}
              name={data.people.find((p) => p.userId === ledgerFor)?.name ?? ''}
              sickRate={data.policy.sickAccrualHoursWorked}
              onClose={() => setLedgerFor(null)}
              onSaved={() => {
                setLedgerFor(null);
                reload();
              }}
            />
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

export function RequestList({ requests, onChanged, onNotice, compact }: { requests: TimeOffRequest[]; onChanged: () => void; onNotice?: (m: string) => void; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(r: TimeOffRequest, decision: 'approved' | 'denied' | 'cancelled') {
    setBusy(r.id);
    setError(null);
    try {
      const res = await hrFetch<{ scheduleConflicts: number | null; negativeBalance: boolean; balance: number | null }>(`/api/hr/time-off/${r.id}`, { method: 'PATCH', json: { decision } });
      if (decision === 'approved') {
        const parts: string[] = [];
        if (res.scheduleConflicts) parts.push(`${r.name} has ${res.scheduleConflicts} booked appointment${res.scheduleConflicts === 1 ? '' : 's'} in this window. Ask the front desk to reschedule; the calendar is not blocked automatically.`);
        if (res.negativeBalance) parts.push(`The balance is now ${res.balance} h (negative).`);
        if (parts.length) onNotice?.(parts.join(' '));
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }
  if (!requests.length) return <EmptyState compact title="No time-off requests" icon={<CalendarDays />} />;
  return (
    <Card>
      {error ? <div className="p-4"><Alert tone="danger">{error}</Alert></div> : null}
      <ul className="divide-y divide-slate-100">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {compact ? '' : `${r.name} · `}
                {titleCase(r.type)} · {fmtDate(r.startDate)}
                {r.endDate !== r.startDate ? ` to ${fmtDate(r.endDate)}` : ''} · {r.hours} h
              </p>
              <p className="text-xs text-slate-500">
                {r.note ? `${r.note} · ` : ''}
                {r.approverName ? `${titleCase(r.status)} by ${r.approverName}` : ''}
                {r.scheduleConflicts ? ` · ${r.scheduleConflicts} appointment${r.scheduleConflicts === 1 ? '' : 's'} to reschedule` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : r.status === 'denied' ? 'danger' : 'neutral'}>{titleCase(r.status)}</StatusBadge>
              {r.canDecide ? (
                <>
                  <Button size="sm" loading={busy === r.id} onClick={() => decide(r, 'approved')}>Approve</Button>
                  <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide(r, 'denied')}>Deny</Button>
                </>
              ) : null}
              {(r.status === 'pending' || r.status === 'approved') && r.startDate >= new Date().toISOString().slice(0, 10) ? (
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => decide(r, 'cancelled')}>Cancel</Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TimeOffCalendar({ requests }: { requests: TimeOffRequest[] }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = first.getUTCDay();
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
    return cells;
  }, [month]);
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <Card>
      <CardHeader
        title={label}
        actions={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <CardBody>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((d, i) => {
            const items = d ? requests.filter((r) => r.startDate <= d && r.endDate >= d) : [];
            return (
              <div key={i} className={cx('min-h-[72px] rounded-lg border p-1 text-left', d ? 'border-slate-200 bg-white' : 'border-transparent')}>
                {d ? <div className="text-[11px] font-medium text-slate-500">{Number(d.slice(8))}</div> : null}
                {items.slice(0, 3).map((r) => (
                  <div key={r.id} className={cx('mt-0.5 truncate rounded px-1 text-[11px]', TYPE_TONE[r.type] ?? 'bg-slate-100 text-slate-700', r.status === 'pending' && 'opacity-60 ring-1 ring-dashed ring-slate-400')} title={`${r.name}: ${titleCase(r.type)} (${r.status})`}>
                    {r.name.split(' ')[0]}
                  </div>
                ))}
                {items.length > 3 ? <div className="text-[10px] text-slate-500">+{items.length - 3} more</div> : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">Faded entries are pending approval.</p>
      </CardBody>
    </Card>
  );
}

export function RequestTimeOffModal({
  types,
  people,
  onClose,
  onSaved,
}: {
  types: Array<{ key: string; label: string }>;
  people?: Array<{ userId: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ userId: '', type: 'pto', startDate: today, endDate: today, hours: '8', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) =>
    setF((x) => {
      const next = { ...x, [k]: v };
      if (k === 'startDate' || k === 'endDate') {
        // Weekday hours at 8 h/day; editable.
        let n = 0;
        for (let d = new Date(`${next.startDate}T12:00:00Z`); d <= new Date(`${next.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
          if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n += 1;
          if (n > 300) break;
        }
        next.hours = String(n * 8 || 8);
      }
      return next;
    });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await hrFetch('/api/hr/time-off', {
        method: 'POST',
        json: { userId: f.userId || undefined, type: f.type, startDate: f.startDate, endDate: f.endDate, hours: Number(f.hours), note: f.note || null },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Request time off"
      size="sm"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save}>Submit</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {people ? (
          <Labeled label="For">
            <Select value={f.userId} onChange={(e) => set('userId', e.target.value)}>
              <option value="">Myself</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          </Labeled>
        ) : null}
        <Labeled label="Type">
          <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
            {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </Labeled>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="First day"><TextInput type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Labeled>
          <Labeled label="Last day"><TextInput type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Labeled>
        </div>
        <Labeled label="Hours"><TextInput type="number" min={0.25} step={0.25} value={f.hours} onChange={(e) => set('hours', e.target.value)} /></Labeled>
        <Labeled label="Note" hint="Do not include medical details. HR coordinates FMLA paperwork separately.">
          <TextArea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Labeled>
      </div>
    </Modal>
  );
}

export function LedgerEntryModal({ userId, name, sickRate, onClose, onSaved }: { userId: string; name: string; sickRate: number | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ bucket: 'sick', entryType: 'accrual', hours: '', hoursWorked: '', effectiveOn: new Date().toISOString().slice(0, 10), note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const fromWorked = f.entryType === 'accrual' && f.bucket === 'sick';
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await hrFetch('/api/hr/time-off/ledger', {
        method: 'POST',
        json: {
          userId,
          bucket: f.bucket,
          entryType: f.entryType,
          hours: f.hours ? Number(f.hours) : null,
          hoursWorked: fromWorked && f.hoursWorked ? Number(f.hoursWorked) : null,
          effectiveOn: f.effectiveOn,
          note: f.note || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Balance entry: ${name}`}
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Balance">
            <Select value={f.bucket} onChange={(e) => set('bucket', e.target.value)}>
              <option value="sick">Sick & safe leave</option>
              <option value="pto">PTO</option>
            </Select>
          </Labeled>
          <Labeled label="Entry">
            <Select value={f.entryType} onChange={(e) => set('entryType', e.target.value)}>
              <option value="accrual">Accrual</option>
              <option value="adjustment">Adjustment (+/-)</option>
              <option value="carryover">Carryover</option>
            </Select>
          </Labeled>
        </div>
        {fromWorked ? (
          <Labeled label="Hours worked this period" hint={sickRate ? `Accrues 1 h per ${sickRate} h worked, capped by the HR settings (practice policy, confirm).` : 'Set the sick accrual rate in HR settings first.'}>
            <TextInput type="number" min={0} value={f.hoursWorked} onChange={(e) => set('hoursWorked', e.target.value)} />
          </Labeled>
        ) : (
          <Labeled label="Hours" hint={f.entryType === 'accrual' && f.bucket === 'pto' ? 'Blank: one pay period from the PTO policy x FTE.' : 'Negative to reduce the balance.'}>
            <TextInput type="number" step={0.25} value={f.hours} onChange={(e) => set('hours', e.target.value)} />
          </Labeled>
        )}
        <Labeled label="Effective"><TextInput type="date" value={f.effectiveOn} onChange={(e) => set('effectiveOn', e.target.value)} /></Labeled>
        <Labeled label="Note"><TextInput value={f.note} onChange={(e) => set('note', e.target.value)} /></Labeled>
      </div>
    </Modal>
  );
}
