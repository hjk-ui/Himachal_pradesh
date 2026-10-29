'use client';

import { Modal } from '@/components/ui';
import { SHORTCUTS } from '@/components/layout/shortcuts';

/** "?" help: the global keyboard shortcuts (they never fire while typing in a field). */
export function KeyboardShortcutsDialog({ onClose, isMac }: { onClose: () => void; isMac: boolean }) {
  return (
    <Modal title="Keyboard shortcuts" size="sm" onClose={onClose}>
      <table className="w-full text-sm">
        <caption className="sr-only">Keyboard shortcuts</caption>
        <thead>
          <tr className="text-left text-xs font-semibold text-slate-600">
            <th scope="col" className="pb-2">Keys</th>
            <th scope="col" className="pb-2">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {SHORTCUTS.map((s) => (
            <tr key={s.label}>
              <td className="py-2 pr-4">
                <span className="inline-flex items-center gap-1">
                  {s.keys.map((k, i) => (
                    <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
                      {i > 0 ? <span className="text-xs text-slate-500">{s.keys[0] === 'Ctrl' ? '+' : 'then'}</span> : null}
                      <kbd className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-xs font-semibold text-slate-700">
                        {k === 'Ctrl' && isMac ? 'Cmd' : k}
                      </kbd>
                    </span>
                  ))}
                </span>
              </td>
              <td className="py-2 text-slate-700">{s.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">Shortcuts are paused while you type in a field or note editor.</p>
    </Modal>
  );
}
