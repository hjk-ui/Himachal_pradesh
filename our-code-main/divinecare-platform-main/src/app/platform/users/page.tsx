import { Suspense } from 'react';
import PlatformUsersPage from './UsersClient';

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <PlatformUsersPage />
    </Suspense>
  );
}
