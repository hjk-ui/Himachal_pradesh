import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { OfflineCryptoProvider } from '@/components/layout/OfflineCryptoProvider';
import { homePathForRole, shouldBlockDashboardPath } from '@/lib/auth/roleAccess';
import { requireSession } from '@/lib/auth/requireSession';
import type { StaffRole } from '@/types/roles';

import { LocationProvider } from '@/context/LocationContext';
import { ChunkReload } from '@/components/system/ChunkReload';
import { SessionGapNotice } from '@/components/dashboard/OpenCheckNotices';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gate = await requireSession();
  if (!gate.ok) {
    // Do NOT call signOut() here — layouts cannot modify cookies in Next.js.
    // Redirect with ?error= so proxy clears the stale session cookie and stops
    // login ↔ dashboard redirect loops.
    redirect('/login?error=SessionExpired');
  }
  if (gate.role === 'SUPER_ADMIN') {
    redirect('/platform');
  }

  const pathname = (await headers()).get('x-pathname') || '/dashboard';
  const role = gate.role as StaffRole | undefined;
  const home = homePathForRole(role);
  if ((pathname === '/dashboard' || pathname === '/dashboard/') && home !== '/dashboard') {
    redirect(home);
  }
  if (shouldBlockDashboardPath(role, pathname)) {
    redirect(home);
  }

  return (
    <LocationProvider>
      <OfflineCryptoProvider>
        <ChunkReload />
        <OfflineBanner />
        <DashboardShell>
          <SessionGapNotice />
          {children}
        </DashboardShell>
      </OfflineCryptoProvider>
    </LocationProvider>
  );
}
