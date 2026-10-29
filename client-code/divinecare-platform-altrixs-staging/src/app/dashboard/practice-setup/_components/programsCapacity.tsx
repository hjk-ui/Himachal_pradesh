'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BedDouble } from 'lucide-react';
import { Alert, EmptyState, LoadingState, StatusBadge } from '@/components/ui';
import {
  ASAM_LEVEL_LABELS,
  BEDS_NOT_CONFIGURED,
  RESIDENTIAL_ASAM_LEVELS,
  type ResidentialAsamLevel,
} from '@/lib/residential/capacity';
import { Card, SaveBar, inputClass, type Overview } from './ui';

// Practice settings > Programs & capacity. Residential beds per location and ASAM level, stored in
// residential_capacity through /api/residential/capacity (leadership writes, audited). Empty = not configured.

type Row = { locationId: string; asamLevel: string; beds: number; rooms: string[]; note: string | null };
type Loc = { id: string; name: string; active: boolean };
type Draft = Record<string, { beds: string; rooms: string }>;
type CapacityResponse = { success: boolean; error?: string; rows: Row[]; locations: Loc[]; canEdit: boolean; migrationPending: boolean };

const key = (locationId: string, level: string) => `${locationId}|${level}`;

function toDraft(rows: Row[]): Draft {
  const d: Draft = {};
  for (const r of rows) d[key(r.locationId, r.asamLevel)] = { beds: String(r.beds), rooms: r.rooms.join(', ') };
  return d;
}

export function ProgramsCapacitySection({ overview }: { overview: Overview; onSaved: (o: Overview) => void; refresh?: () => void }) {
  const [data, setData] = useState<CapacityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/residential/capacity');
      const json = (await res.json().catch(() => null)) as CapacityResponse | null;
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not load capacity (${res.status})`);
      setData(json);
      setDraft(toDraft(json.rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load capacity');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = Boolean(data?.canEdit && overview.canEdit);
  const saved = useMemo(() => toDraft(data?.rows ?? []), [data]);

  const save = async () => {
    if (!data) return;
    const entries: { locationId: string; asamLevel: ResidentialAsamLevel; beds: number | null; rooms: string }[] = [];
    for (const l of data.locations) {
      for (const level of RESIDENTIAL_ASAM_LEVELS) {
        const k = key(l.id, level);
        const cur = draft[k] ?? { beds: '', rooms: '' };
        const was = saved[k] ?? { beds: '', rooms: '' };
        if (cur.beds.trim() === was.beds && cur.rooms.trim() === was.rooms) continue;
        const beds = cur.beds.trim() === '' ? null : Number(cur.beds);
        if (beds !== null && (!Number.isInteger(beds) || beds < 0)) {
          setMessage({ tone: 'error', text: `${l.name} ${level}: beds must be a whole number` });
          return;
        }
        entries.push({ locationId: l.id, asamLevel: level, beds, rooms: beds === null ? '' : cur.rooms });
      }
    }
    if (!entries.length) {
      setMessage({ tone: 'ok', text: 'Saved (no changes)' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/residential/capacity', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
      const json = (await res.json().catch(() => null)) as CapacityResponse | null;
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not save (${res.status})`);
      setData(json);
      setDraft(toDraft(json.rows));
      setMessage({ tone: 'ok', text: 'Saved' });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) {
    return (
      <LoadingState label="Loading residential capacity…" />
    );
  }

  return (
    <Card
      title="Residential beds"
      description={
        <>
          Beds per location and ASAM level. Used by the{' '}
          <Link href="/dashboard/residential" className="font-semibold text-blue-700 hover:underline">residential bed board</Link> and the{' '}
          <Link href="/dashboard/enterprise?tab=census" className="font-semibold text-blue-700 hover:underline">practice census</Link>. Leave a level empty when the
          location does not run it; screens then show &quot;{BEDS_NOT_CONFIGURED}&quot;. Room labels are optional (comma separated, one per bed).
        </>
      }
    >
      {data.migrationPending ? (
        <Alert tone="warning" className="mb-3">
          The residential_capacity table is not in this database yet — run prisma/migrations/20261018_residential_capacity.sql before saving.
        </Alert>
      ) : null}
      {data.locations.length === 0 ? (
        <EmptyState compact icon={<BedDouble />} title="Add a service location first." description="Bed counts are set per location and ASAM level. Add a location under Service locations, then return here." />
      ) : null}
      <div className="space-y-4">
        {data.locations.map((l) => (
          <div key={l.id} className="rounded-lg bg-slate-50 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BedDouble className="h-4 w-4 text-blue-600" aria-hidden /> {l.name}
              {!l.active ? <StatusBadge tone="neutral" size="sm">Inactive</StatusBadge> : null}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {RESIDENTIAL_ASAM_LEVELS.map((level) => {
                const k = key(l.id, level);
                const cur = draft[k] ?? { beds: '', rooms: '' };
                return (
                  <div key={level} className="space-y-1.5">
                    <p className="text-sm font-medium text-slate-700" title={ASAM_LEVEL_LABELS[level]}>
                      ASAM {level} beds
                    </p>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      className={inputClass()}
                      value={cur.beds}
                      placeholder="Not configured"
                      disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, [k]: { ...cur, beds: e.target.value } }))}
                    />
                    <input
                      type="text"
                      className={inputClass()}
                      value={cur.rooms}
                      placeholder="Rooms (optional): B-201, B-202"
                      disabled={!canEdit || cur.beds.trim() === ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [k]: { ...cur, rooms: e.target.value } }))}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {canEdit ? <SaveBar busy={busy} message={message} onSave={() => void save()} label="Save capacity" /> : null}
    </Card>
  );
}
