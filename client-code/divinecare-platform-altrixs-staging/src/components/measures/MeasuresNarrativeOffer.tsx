'use client';

/**
 * In the note editor: completed measures since the client's last note, offered as one line
 * ("PHQ-9 14 (moderate), down from 19 on 9/12; item 9 = 0. GAD-7 9 (mild).") to insert into the
 * template's assessment / measures section (measureSectionFor), never at the top of the note.
 * The inserted text is ordinary section text: edit or delete it like anything else. Inserting
 * marks the results reviewed (clears the inbox "Measures completed" items).
 */
import { useEffect, useState } from 'react';
import { ClipboardList, X } from 'lucide-react';
import { measureSectionFor } from '@/lib/measures/narrative';

export function MeasuresNarrativeOffer({
  clientId,
  noteType,
  noteId,
  headings,
  onInsert,
}: {
  clientId: string;
  noteType: string;
  noteId: string | null;
  /** Sections of the open template (the line only goes into a section the template has) */
  headings: readonly string[];
  onInsert: (section: string, text: string) => void;
}) {
  const [data, setData] = useState<{ text: string; requestIds: string[] } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [inserted, setInserted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setDismissed(false);
    setInserted(null);
    const qs = new URLSearchParams({ clientId, ...(noteId ? { noteId } : {}) });
    fetch(`/api/clinical/measure-requests/narrative?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live && body?.success && body.text) setData({ text: body.text, requestIds: body.requestIds ?? [] });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [clientId, noteId]);

  if (!data || dismissed) return null;
  const section = measureSectionFor(noteType, headings);

  const insert = () => {
    if (!section) return;
    onInsert(section, data.text);
    setInserted(section);
    if (data.requestIds.length) {
      void fetch('/api/clinical/measure-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, requestIds: data.requestIds }),
      }).catch(() => undefined);
    }
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1 font-semibold text-blue-800">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Measures since the last note
          </div>
          <p className="text-sm">{data.text}</p>
          {inserted ? (
            <p className="mt-1 text-emerald-700">Inserted into {inserted}. Edit or delete it there like any text.</p>
          ) : section ? null : (
            <p className="mt-1 text-slate-500">This template has no assessment / measures section: copy the line where it belongs.</p>
          )}
        </div>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss measures" className="rounded p-1 text-slate-500 hover:bg-white">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {!inserted ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {section ? (
            <button type="button" onClick={insert} className="rounded-lg bg-blue-700 px-2.5 py-1 font-semibold text-white hover:bg-blue-800">
              Insert into {section}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(data.text).then(() => setCopied(true)).catch(() => undefined);
            }}
            className="rounded-lg border border-blue-300 px-2.5 py-1 font-semibold text-blue-800 hover:bg-white"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
