'use client';

export type PersistenceNotice = { id: string; module: string; pending: boolean; error: string | null; retry?: () => void };
let notices: PersistenceNotice[] = [];
const listeners = new Set<() => void>();
export const persistenceSnapshot = () => notices;
const empty: PersistenceNotice[] = [];
export const persistenceServerSnapshot = () => empty;
export function subscribePersistence(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishPersistence(notice: PersistenceNotice) {
  notices = notices.filter((item) => item.id !== notice.id);
  if (notice.pending || notice.error) notices = [...notices, notice];
  listeners.forEach((listener) => listener());
}
