'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, Search } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  Alert,
  Card,
  CardHeader,
  cx,
  EmptyState,
  FOCUS_RING,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { DATA_TYPE_LABEL, unitsDisplay, isVitalLike, type MeasurementDataType } from '@/lib/migration/valantMeasurementTypes';

type Row = {
  id: string;
  name: string;
  documentationCode: string | null;
  category: string;
  dataType: string;
  defaultUnits: string | null;
  active: boolean;
  source: string;
  parentInstrument: string | null;
  isSubscore: boolean;
  instrumentKey: string | null;
  instrumentName: string | null;
  vitalField: string | null;
};

const VITAL_FIELD_LABEL: Record<string, string> = {
  bloodPressure: 'Vitals: blood pressure',
  bpSystolic: 'Vitals: systolic',
  bpDiastolic: 'Vitals: diastolic',
  heartRate: 'Vitals: heart rate',
  respiratoryRate: 'Vitals: respiration',
  heightInches: 'Vitals: height',
  weightLbs: 'Vitals: weight',
  bmi: 'Vitals: BMI',
};

/** Admin › Clinical content › Measurement types — the catalog behind "Record a measure". */
export default function MeasurementTypesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiJson<{ data: Row[]; canEdit: boolean }>('/api/admin/measurement-types');
      setRows(d.data || []);
      setCanEdit(Boolean(d.canEdit));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load measurement types');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (showInactive || r.active) &&
        (!q || [r.name, r.documentationCode, r.parentInstrument, r.instrumentName].some((v) => v?.toLowerCase().includes(q)))
    );
    const map = new Map<string, Row[]>();
    for (const r of list) {
      const g = r.parentInstrument ?? (isVitalLike(r) ? 'Vital signs' : 'Standalone measures');
      map.set(g, [...(map.get(g) ?? []), r]);
    }
    const order = (g: string) => (g === 'Vital signs' ? 0 : g === 'Standalone measures' ? 2 : 1);
    return [...map.entries()].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  }, [rows, query, showInactive]);

  const toggle = async (r: Row) => {
    setSavingId(r.id);
    try {
      await apiJson(`/api/admin/measurement-types/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ active: !r.active }) });
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !r.active } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setSavingId(null);
    }
  };

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <Page>
      <PageHeader
        eyebrow="Admin › Clinical content"
        title="Measurement types"
        description={
          <>
            Scores, subscores and vitals clinicians can record with &quot;Record a measure&quot; in the chart&apos;s Assessments &amp; outcomes tab. Measures
            linked to a built-in Altrixs instrument as its total are entered on the{' '}
            <Link href="/dashboard/ehr/assessments" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
              Assessments
            </Link>{' '}
            page instead. Import or refresh the list from Valant in{' '}
            <Link href="/dashboard/admin/migration" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
              Data import
            </Link>
            .
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full min-w-0 sm:min-w-[16rem] sm:flex-[1_1_20rem]">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Search measurement types"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code or instrument"
            className={cx(inputClasses, 'pl-9')}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />{' '}
          Show inactive
        </label>
        <p className="text-xs text-slate-500">
          {rows.length} types · {activeCount} active
        </p>
      </div>

      {loading ? (
        <Card>
          <LoadingState label="Loading measurement types…" />
        </Card>
      ) : null}
      {!loading && !rows.length && !error ? (
        <Card>
          <EmptyState
            icon={<Activity />}
            title="No measurement types yet"
            description="Import them from Valant in Data import › Import Measurement Types."
          />
        </Card>
      ) : null}

      {groups.map(([group, list]) => {
        const instrumentName = list.find((r) => r.instrumentName)?.instrumentName;
        return (
          <Card key={group} className="overflow-hidden">
            <CardHeader
              title={group}
              actions={
                <p className="text-xs text-slate-500">
                  {list.length} {list.length === 1 ? 'measure' : 'measures'}
                  {instrumentName ? ` · Altrixs ${instrumentName}` : ''}
                </p>
              }
            />
            <div className="clinic-scroll-x overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Name</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Code</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Data type</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Units</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Altrixs</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold text-slate-600">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((r) => (
                    <tr key={r.id} className={cx('hover:bg-slate-50', r.active ? 'text-slate-700' : 'text-slate-500')}>
                      <td className="px-4 py-3 font-medium">
                        {r.name}
                        {r.isSubscore ? (
                          <StatusBadge size="sm" className="ml-1.5">
                            subscore
                          </StatusBadge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.documentationCode ?? ''}</td>
                      <td className="px-4 py-3">{DATA_TYPE_LABEL[r.dataType as MeasurementDataType] ?? r.dataType}</td>
                      <td className="px-4 py-3">{unitsDisplay(r.defaultUnits, r.vitalField)}</td>
                      <td className="px-4 py-3">
                        {r.instrumentName
                          ? r.isSubscore
                            ? `${r.instrumentName} subscore`
                            : `${r.instrumentName} (enter on Assessments)`
                          : r.vitalField
                            ? VITAL_FIELD_LABEL[r.vitalField] ?? r.vitalField
                            : 'Score entry only'}
                      </td>
                      <td className="px-4 py-3">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                            aria-label={`${r.name} active`}
                            checked={r.active}
                            disabled={!canEdit || savingId === r.id}
                            onChange={() => void toggle(r)}
                          />
                          {r.active ? 'Active' : 'Inactive'}
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </Page>
  );
}
