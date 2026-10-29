'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { persistenceSnapshot, persistenceServerSnapshot, subscribePersistence } from '@/lib/modules/persistenceStatus';

export function ModulePersistenceNotice() {
  const notices = useSyncExternalStore(subscribePersistence, persistenceSnapshot, persistenceServerSnapshot);
  useEffect(() => {
    if (!notices.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [notices.length]);
  if (!notices.length) return null;
  return <div className="sticky top-0 z-40 space-y-2" aria-live="polite">
    {notices.map((notice) => <div key={notice.id} role={notice.error ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${notice.error ? 'border-red-300 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
      {notice.error ? `Changes not saved (${notice.module}): ${notice.error}. Keep this page open.` : 'Saving changes. Please keep this page open.'}
      {notice.error && notice.retry && <button type="button" className="ml-3 underline font-semibold" onClick={notice.retry}>Retry save</button>}
    </div>)}
  </div>;
}
