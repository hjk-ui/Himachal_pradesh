'use client';

import { ClipboardList } from 'lucide-react';

export type MyNotesQueueItem = {
  id: string;
  clientName: string;
  noteType?: string | null;
  createdAt: string;
  workflowStatus?: string | null;
};

type Props = {
  notes: MyNotesQueueItem[];
  onOpen?: (noteId: string) => void;
  title?: string;
};

export function MyNotesQueue({
  notes,
  onOpen,
  title = 'My notes queue',
}: Props) {
  const draft = notes
    .filter((n) => !n.workflowStatus || n.workflowStatus === 'Draft')
    .slice(0, 8);

  return (
    <section
      className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
      data-testid="my-notes-queue"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
          <ClipboardList size={18} className="text-violet-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">
            Unsigned drafts ready for review · {draft.length} shown
          </p>
        </div>
      </div>

      {draft.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No unsigned notes in this list.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {draft.map((note) => (
            <li key={note.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{note.clientName}</p>
                <p className="text-xs text-slate-500">
                  {note.noteType || 'Progress note'} ·{' '}
                  {new Date(note.createdAt).toLocaleDateString()}
                </p>
              </div>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(note.id)}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200 hover:bg-violet-50"
                >
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
