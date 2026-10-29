'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Loader2, Plus, Save, Tag } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, Button, Card, CardHeader, cx, EmptyState, FOCUS_RING, IconButton, LoadingState } from '@/components/ui';
import {
  AVAILABILITY_TEXT,
  contrastRatio,
  isHexColor,
  LABEL_AVAILABILITY,
  LABEL_MEANINGS,
  LABEL_MEANING_TEXT,
  labelTextColor,
  VALANT_APPOINTMENT_LABELS,
  type AppointmentLabelDto,
  type LabelAvailability,
  type LabelMeaning,
} from '@/lib/scheduling/appointmentLabels';

type ListResponse = {
  ready: boolean;
  labels: AppointmentLabelDto[];
  autoApplySuggested: boolean;
  canManage: boolean;
};

type AppliedResult = { scanned: number; labelled: number; byLabel: Record<string, number> };

type Draft = {
  displayName: string;
  color: string;
  availability: LabelAvailability;
  meaning: LabelMeaning | null;
  active: boolean;
};

const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
const TH = 'px-3 py-3 text-xs font-semibold text-slate-600';

function toDraft(l: AppointmentLabelDto): Draft {
  return { displayName: l.displayName, color: l.color, availability: l.availability, meaning: l.meaning, active: l.active };
}

function Preview({ color, text }: { color: string; text: string }) {
  const ok = isHexColor(color);
  const fg = ok ? labelTextColor(color) : null;
  const ratio = ok && fg ? contrastRatio(color, fg) : 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cx(
          'inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-semibold',
          ok ? '' : 'bg-slate-200 text-slate-900',
        )}
        style={ok && fg ? { backgroundColor: color, color: fg } : undefined}
      >
        <Tag className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{text || 'Label'}</span>
      </span>
      <span className={`text-[11px] font-semibold ${ratio >= 4.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
        {ok ? `${ratio.toFixed(1)}:1${ratio >= 4.5 ? ' AA' : ' low contrast'}` : 'Invalid color'}
      </span>
    </div>
  );
}

function MeaningSelect({ value, onChange }: { value: LabelMeaning | null; onChange: (v: LabelMeaning | null) => void }) {
  return (
    <select
      className={INPUT}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as LabelMeaning | null)}
      aria-label="Suggestion meaning"
    >
      <option value="">None</option>
      {LABEL_MEANINGS.map((m) => (
        <option key={m} value={m}>
          {LABEL_MEANING_TEXT[m]}
        </option>
      ))}
    </select>
  );
}

/** Admin › Scheduling settings › Calendar labels (Valant-style appointment color labels). */
export function CalendarLabelsSection() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState({ name: '', displayName: '', color: '#5C2D91', availability: 'free' as LabelAvailability, meaning: null as LabelMeaning | null });

  const apply = (r: Pick<ListResponse, 'labels'> & Partial<ListResponse>) => {
    setData((prev) => ({ ready: true, autoApplySuggested: false, canManage: true, ...prev, ...r }));
    setDrafts(Object.fromEntries(r.labels.map((l) => [l.id, toDraft(l)])));
  };

  const load = useCallback(async () => {
    try {
      const r = await apiJson<ListResponse>('/api/scheduling/appointment-labels?all=1');
      setData(r);
      setDrafts(Object.fromEntries(r.labels.map((l) => [l.id, toDraft(l)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load calendar labels');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const loadValant = () =>
    run('valant', async () => {
      const r = await apiJson<{ created: string[]; skipped: number; labels: AppointmentLabelDto[] }>(
        '/api/scheduling/appointment-labels/load-valant',
        { method: 'POST' }
      );
      apply({ labels: r.labels });
      setNotice(
        r.created.length
          ? `Added ${r.created.length} Valant label${r.created.length === 1 ? '' : 's'}: ${r.created.join(', ')}.`
          : 'All 12 Valant labels were already here; nothing changed.'
      );
    });

  const saveRow = (l: AppointmentLabelDto) =>
    run(l.id, async () => {
      const d = drafts[l.id];
      const r = await apiJson<{ label: AppointmentLabelDto }>(`/api/scheduling/appointment-labels/${l.id}`, {
        method: 'PATCH',
        body: JSON.stringify(d),
      });
      const labels = (data?.labels ?? []).map((x) => (x.id === l.id ? r.label : x));
      setData((prev) => (prev ? { ...prev, labels } : prev));
      setDrafts((prev) => ({ ...prev, [l.id]: toDraft(r.label) }));
      setNotice(`Saved ${r.label.displayName}.`);
    });

  const move = (idx: number, dir: -1 | 1) =>
    run('order', async () => {
      const ids = (data?.labels ?? []).map((l) => l.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[idx], ids[j]] = [ids[j], ids[idx]];
      const r = await apiJson<{ labels: AppointmentLabelDto[]; autoApplySuggested: boolean }>(
        '/api/scheduling/appointment-labels',
        { method: 'PUT', body: JSON.stringify({ order: ids }) }
      );
      apply(r);
    });

  const appliedNotice = (r: AppliedResult) =>
    r.labelled === 0
      ? `No unlabeled appointments needed a label (${r.scanned} checked).`
      : `Labeled ${r.labelled} existing appointment${r.labelled === 1 ? '' : 's'}: ${Object.entries(r.byLabel)
          .map(([name, n]) => `${name} ${n}`)
          .join(', ')}.`;

  const setAutoApply = (v: boolean) =>
    run('auto', async () => {
      const r = await apiJson<{ labels: AppointmentLabelDto[]; autoApplySuggested: boolean; applied: AppliedResult | null }>(
        '/api/scheduling/appointment-labels',
        { method: 'PUT', body: JSON.stringify({ autoApplySuggested: v }) }
      );
      apply(r);
      if (r.applied) setNotice(appliedNotice(r.applied));
    });

  const applyExisting = () =>
    run('existing', async () => {
      const r = await apiJson<AppliedResult>('/api/scheduling/appointment-labels/apply-existing', { method: 'POST' });
      setNotice(appliedNotice(r));
    });

  const addLabel = () =>
    run('add', async () => {
      await apiJson('/api/scheduling/appointment-labels', {
        method: 'POST',
        body: JSON.stringify({ ...newLabel, displayName: newLabel.displayName || newLabel.name }),
      });
      setAdding(false);
      setNewLabel({ name: '', displayName: '', color: '#5C2D91', availability: 'free', meaning: null });
      await load();
    });

  const labels = data?.labels ?? [];
  const haveNames = new Set(labels.map((l) => l.name.toLowerCase()));
  const missingValant = VALANT_APPOINTMENT_LABELS.filter((v) => !haveNames.has(v.name.toLowerCase())).length;

  return (
    <Card id="calendar-labels" className="overflow-hidden">
      <CardHeader
        title="Calendar labels"
        icon={<Tag />}
        description="Color labels on the appointment calendar, like Valant's. Saved as you change them."
        actions={
          data?.ready ? (
            <Button
              variant="secondary"
              size="sm"
              icon={busy === 'valant' ? <Loader2 className="animate-spin" /> : <Download />}
              onClick={() => void loadValant()}
              disabled={busy !== null || missingValant === 0}
              title={missingValant === 0 ? 'All 12 Valant labels are loaded' : 'Adds the Valant labels you do not have yet'}
            >
              {missingValant === 0 ? 'Valant labels loaded' : `Load Valant labels (${missingValant})`}
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {!data ? (
          error ? null : <LoadingState label="Loading labels…" rows={3} className="p-0" />
        ) : !data.ready ? (
          <Alert tone="warning">
            Calendar labels need the database update <code>20261018_appointment_labels</code> on this server before they can be set up.
          </Alert>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">Auto-apply suggested labels</p>
                <p className="text-xs text-slate-500">
                  Off: Altrixs shows a one-click suggestion (Tele for video visits, In Person otherwise, New for a
                  client&apos;s first visit, Rescheduled, Cancelled). On: the suggestion is applied when an appointment has
                  no label yet, including the unlabeled appointments already on the calendar (last 90 days and upcoming).
                  Labels someone chose are never changed.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  icon={busy === 'existing' ? <Loader2 className="animate-spin" /> : <Tag />}
                  onClick={() => void applyExisting()}
                  disabled={busy !== null || labels.length === 0}
                >
                  Apply to existing appointments
                </Button>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={data.autoApplySuggested}
                aria-label="Auto-apply suggested labels"
                disabled={busy !== null}
                onClick={() => void setAutoApply(!data.autoApplySuggested)}
                className={cx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60', FOCUS_RING, data.autoApplySuggested ? 'bg-blue-600' : 'bg-slate-300')}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition ${data.autoApplySuggested ? 'translate-x-5' : ''}`}
                />
              </button>
            </div>

            {labels.length === 0 ? (
              <EmptyState
                compact
                icon={<Tag />}
                title="No calendar labels yet"
                description={
                  <>
                    Use <span className="font-semibold">Load Valant labels</span> to add the 12 labels from Valant, or add your own.
                  </>
                }
                className="rounded-lg border border-dashed border-slate-300"
              />
            ) : (
              <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[860px] text-left text-sm text-slate-700">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th scope="col" className={TH}>Order</th>
                      <th scope="col" className={TH}>Name</th>
                      <th scope="col" className={TH}>Display name</th>
                      <th scope="col" className={TH}>Color</th>
                      <th scope="col" className={TH}>Availability</th>
                      <th scope="col" className={TH}>Suggest for</th>
                      <th scope="col" className={TH}>Active</th>
                      <th scope="col" className={TH}><span className="sr-only">Save</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labels.map((l, i) => {
                      const d = drafts[l.id] ?? toDraft(l);
                      const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(l));
                      const set = (p: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [l.id]: { ...d, ...p } }));
                      return (
                        <tr key={l.id} className={`align-top ${d.active ? '' : 'bg-slate-50/70'}`}>
                          <td className="px-3 py-2.5">
                            <div className="flex gap-1">
                              <IconButton
                                label={`Move ${l.displayName} up`}
                                showTooltip={false}
                                disabled={i === 0 || busy !== null}
                                onClick={() => void move(i, -1)}
                                icon={<ArrowUp className="h-3.5 w-3.5" />}
                                className="h-10 w-10 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 md:h-7 md:w-7"
                              />
                              <IconButton
                                label={`Move ${l.displayName} down`}
                                showTooltip={false}
                                disabled={i === labels.length - 1 || busy !== null}
                                onClick={() => void move(i, 1)}
                                icon={<ArrowDown className="h-3.5 w-3.5" />}
                                className="h-10 w-10 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 md:h-7 md:w-7"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-semibold text-slate-800">{l.name}</p>
                            <p className="text-[11px] text-slate-500">{l.source === 'valant' ? 'From Valant' : 'Added here'}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              className={INPUT}
                              value={d.displayName}
                              maxLength={80}
                              aria-label={`Display name for ${l.name}`}
                              onChange={(e) => set({ displayName: e.target.value })}
                            />
                            <div className="mt-1.5">
                              <Preview color={d.color} text={d.displayName} />
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={isHexColor(d.color) ? d.color : '#000000'}
                                aria-label={`Color for ${l.name}`}
                                onChange={(e) => set({ color: e.target.value.toUpperCase() })}
                                className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-slate-300"
                              />
                              <input
                                className={`${INPUT} w-24 font-mono uppercase`}
                                value={d.color}
                                maxLength={7}
                                aria-label={`Hex color for ${l.name}`}
                                onChange={(e) => set({ color: e.target.value.toUpperCase() })}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <select
                              className={INPUT}
                              value={d.availability}
                              aria-label={`Availability for ${l.name}`}
                              onChange={(e) => set({ availability: e.target.value as LabelAvailability })}
                            >
                              {LABEL_AVAILABILITY.map((a) => (
                                <option key={a} value={a}>
                                  {AVAILABILITY_TEXT[a]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2.5">
                            <MeaningSelect value={d.meaning} onChange={(meaning) => set({ meaning })} />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={d.active}
                              aria-label={`${l.name} active`}
                              onChange={(e) => set({ active: e.target.checked })}
                              className="mt-2 h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <Button
                              size="sm"
                              icon={busy === l.id ? <Loader2 className="animate-spin" /> : <Save />}
                              disabled={!dirty || busy !== null || !isHexColor(d.color) || !d.displayName.trim()}
                              onClick={() => void saveRow(l)}
                            >
                              Save
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-slate-500">
              Availability is whether a label marks the provider&apos;s time as Free, Busy or Tentative (Valant has all 12 as
              Free). It does not change the appointment itself. Turn a label off instead of deleting it so past appointments
              keep their color.
            </p>

            {adding ? (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-xs font-medium text-slate-700">
                  Name
                  <input className={`${INPUT} mt-1`} value={newLabel.name} maxLength={40} onChange={(e) => setNewLabel((n) => ({ ...n, name: e.target.value }))} />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Display name
                  <input
                    className={`${INPUT} mt-1`}
                    value={newLabel.displayName}
                    maxLength={80}
                    placeholder={newLabel.name}
                    onChange={(e) => setNewLabel((n) => ({ ...n, displayName: e.target.value }))}
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Color
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      type="color"
                      value={isHexColor(newLabel.color) ? newLabel.color : '#000000'}
                      onChange={(e) => setNewLabel((n) => ({ ...n, color: e.target.value.toUpperCase() }))}
                      className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-slate-300"
                    />
                    <input
                      className={`${INPUT} font-mono uppercase`}
                      value={newLabel.color}
                      maxLength={7}
                      onChange={(e) => setNewLabel((n) => ({ ...n, color: e.target.value.toUpperCase() }))}
                    />
                  </div>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Availability
                  <select
                    className={`${INPUT} mt-1`}
                    value={newLabel.availability}
                    onChange={(e) => setNewLabel((n) => ({ ...n, availability: e.target.value as LabelAvailability }))}
                  >
                    {LABEL_AVAILABILITY.map((a) => (
                      <option key={a} value={a}>
                        {AVAILABILITY_TEXT[a]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Suggest for
                  <div className="mt-1">
                    <MeaningSelect value={newLabel.meaning} onChange={(meaning) => setNewLabel((n) => ({ ...n, meaning }))} />
                  </div>
                </label>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
                  <Preview color={newLabel.color} text={newLabel.displayName || newLabel.name} />
                  <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    icon={busy === 'add' ? <Loader2 className="animate-spin" /> : <Plus />}
                    disabled={busy !== null || !newLabel.name.trim() || !isHexColor(newLabel.color)}
                    onClick={() => void addLabel()}
                  >
                    Add label
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>
                Add a label
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
