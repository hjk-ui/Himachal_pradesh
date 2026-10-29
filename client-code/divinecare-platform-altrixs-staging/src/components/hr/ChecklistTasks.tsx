'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, MinusCircle } from 'lucide-react';
import { Alert, Button, StatusBadge, cx } from '@/components/ui';
import { ProgressBar, TextInput } from './HrBits';
import { fmtDate, hrFetch, titleCase } from './hrClient';

export type ChecklistTask = {
  id: string;
  key: string;
  label: string;
  category: string;
  ownerType: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  status: string;
  completedAt: string | null;
  completedByName: string | null;
  note: string | null;
  requiresAck: boolean;
  acknowledgedAt: string | null;
  requiresUpload: boolean;
  documentId: string | null;
  systemAction: string | null;
};
export type Checklist = {
  id: string;
  userId: string;
  staffName: string;
  jobTitle: string;
  kind: string;
  templateName: string;
  status: string;
  startOn: string;
  meta: Record<string, unknown> | null;
  progress: { done: number; total: number; pct: number };
  overdue: number;
  tasks: ChecklistTask[];
  accountStatus: string;
  liveAssignedClientCount?: number;
};

const OWNER: Record<string, string> = { hr: 'HR', manager: 'Manager', employee: 'Employee', admin: 'Administrator', clinical_director: 'Clinical director', it: 'IT' };

/**
 * Tasks of one checklist grouped by category. `viewer` decides which tasks show action buttons:
 * HR any task; the employee their employee tasks; an assignee theirs.
 */
export function ChecklistTasks({
  checklist,
  viewer,
  today,
  onChanged,
}: {
  checklist: Checklist;
  viewer: { userId: string; role: string; hrAdmin: boolean };
  today: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const groups = [...new Set(checklist.tasks.map((t) => t.category))];
  const canAct = (t: ChecklistTask) => viewer.hrAdmin || t.assigneeUserId === viewer.userId || (t.ownerType === 'employee' && checklist.userId === viewer.userId);
  const canDeactivate = ['ADMIN', 'PRACTICE_DIRECTOR'].includes(viewer.role);

  async function update(t: ChecklistTask, body: Record<string, unknown>) {
    setBusy(t.id);
    setError(null);
    try {
      await hrFetch(`/api/hr/checklist-tasks/${t.id}`, { method: 'PATCH', json: body });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the task');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <ProgressBar pct={checklist.progress.pct} label="Checklist progress" tone={checklist.overdue ? 'warning' : checklist.progress.pct === 100 ? 'success' : 'brand'} />
      {checklist.kind === 'offboarding' && checklist.liveAssignedClientCount != null ? (
        <Alert tone={checklist.liveAssignedClientCount ? 'warning' : 'success'}>
          {checklist.liveAssignedClientCount
            ? `${checklist.liveAssignedClientCount} active client${checklist.liveAssignedClientCount === 1 ? ' is' : 's are'} still assigned. The clinical director reassigns them from the client list (count only shown here).`
            : 'No active clients are assigned.'}
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {groups.map((g) => (
        <section key={g} aria-label={g}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</h4>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {checklist.tasks
              .filter((t) => t.category === g)
              .map((t) => {
                const overdue = t.status === 'open' && t.dueOn && t.dueOn < today;
                const actionable = canAct(t) && checklist.status !== 'cancelled';
                const mine = t.ownerType === 'employee' && checklist.userId === viewer.userId;
                return (
                  <li key={t.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {t.status === 'done' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Done" />
                      ) : t.status === 'skipped' ? (
                        <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label="Skipped" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-label="Open" />
                      )}
                      <div className="min-w-0">
                        <p className={cx('text-sm', t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900')}>{t.label}</p>
                        <p className="text-xs text-slate-500">
                          {OWNER[t.ownerType] ?? titleCase(t.ownerType)}
                          {t.assigneeName ? ` (${t.assigneeName})` : ''} · due {fmtDate(t.dueOn)}
                          {t.completedByName ? ` · done by ${t.completedByName}` : ''}
                          {t.acknowledgedAt ? ' · acknowledged' : ''}
                        </p>
                        {t.note ? <p className="mt-0.5 text-xs text-slate-600">{t.note}</p> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {overdue ? <StatusBadge size="sm" tone="danger">Overdue</StatusBadge> : null}
                      {actionable && t.status === 'open' ? (
                        <>
                          {t.systemAction === 'caseload_reassign' ? (
                            <TextInput
                              aria-label="Handoff note"
                              placeholder="Handoff note (if clients remain)"
                              value={notes[t.id] ?? ''}
                              onChange={(e) => setNotes((n) => ({ ...n, [t.id]: e.target.value }))}
                              className="h-10 w-full py-1 text-xs md:h-8 md:w-56"
                            />
                          ) : null}
                          {t.requiresAck && mine ? (
                            <label className="flex items-center gap-1.5 text-xs">
                              <input type="checkbox" checked={Boolean(ack[t.id])} onChange={(e) => setAck((a) => ({ ...a, [t.id]: e.target.checked }))} />
                              I have read and agree
                            </label>
                          ) : null}
                          {t.systemAction === 'deactivate_user' && checklist.accountStatus !== 'DEACTIVATED' && canDeactivate ? (
                            <Button size="sm" variant="danger" loading={busy === t.id} onClick={() => update(t, { status: 'done', performAction: true })}>
                              Deactivate account now
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === t.id}
                              disabled={t.requiresAck && mine && !ack[t.id]}
                              onClick={() => update(t, { status: 'done', acknowledge: t.requiresAck && mine ? true : undefined, note: notes[t.id] || undefined })}
                            >
                              {t.requiresAck && mine ? 'Acknowledge' : 'Mark done'}
                            </Button>
                          )}
                          {viewer.hrAdmin ? (
                            <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => update(t, { status: 'skipped' })}>Not needed</Button>
                          ) : null}
                        </>
                      ) : null}
                      {actionable && t.status !== 'open' && viewer.hrAdmin ? (
                        <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => update(t, { status: 'open' })}>Reopen</Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
