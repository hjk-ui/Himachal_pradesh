'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  ASSIGN_DIALOG_CTA,
  ASSIGN_DIALOG_HELP,
  ASSIGN_DIALOG_TITLE,
  SUD_MEASURES,
  SUD_PENDING_BANNER,
  type SudMeasureKey,
} from '@/lib/sud/measures';
import toast from 'react-hot-toast';

export function AssignSudMeasuresDialog({
  open,
  clientIds,
  onClose,
}: {
  open: boolean;
  clientIds: string[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<SudMeasureKey[]>(['AUDIT', 'CAGE-AID']);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setSelected(['AUDIT', 'CAGE-AID']);
  }, [open]);

  if (!open) return null;

  async function assign() {
    setBusy(true);
    try {
      const res = await fetch('/api/ehr/scanner/sud-radar/measures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds, measures: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not assign measures');
        return;
      }
      toast.success(`Assigned ${data.assigned || 0} measure(s)${data.skipped ? ` (${data.skipped} already active)` : ''}`);
      onClose();
    } catch {
      toast.error('Could not assign measures');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">{ASSIGN_DIALOG_TITLE}</h2>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs text-slate-500">{ASSIGN_DIALOG_HELP}</p>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {SUD_PENDING_BANNER}
          </p>
          <ul className="space-y-2">
            {SUD_MEASURES.map((m) => {
              const checked = selected.includes(m.key);
              return (
                <li key={m.key}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      checked={checked}
                      onChange={() =>
                        setSelected((prev) =>
                          checked ? prev.filter((k) => k !== m.key) : [...prev, m.key]
                        )
                      }
                    />
                    <span>
                      {m.label}
                      {m.itemContentPending ? (
                        <span className="ml-1 text-[11px] text-slate-500">(content pending)</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={selected.length === 0 || clientIds.length === 0}
            onClick={() => void assign()}
          >
            {ASSIGN_DIALOG_CTA}
          </Button>
        </div>
      </div>
    </div>
  );
}
