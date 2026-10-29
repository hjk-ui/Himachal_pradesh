import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { BillingStatusBanner } from '@/components/subscription/BillingStatusBanner';
import { BaaNotice } from '@/components/legal/BaaNotice';
import { OfflineCryptoProvider } from '@/components/layout/OfflineCryptoProvider';
import { StaffIdleGuard } from '@/components/security/StaffIdleGuard';
import { shouldBlockDashboardPath } from '@/lib/auth/roleAccess';
import { requireSession } from '@/lib/auth/requireSession';
import type { StaffRole } from '@/types/roles';

import { LocationProvider } from '@/context/LocationContext';

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
  // Capabilities verified from the DB row (requireSession), not the JWT claim
  const capabilities = gate.capabilities;
  if (shouldBlockDashboardPath(role, pathname, capabilities)) {
    redirect('/dashboard');
  }

  return (
    <LocationProvider>
      <OfflineCryptoProvider>
        <OfflineBanner />
        <StaffIdleGuard />
        <BillingStatusBanner />
        {role === 'ADMIN' || role === 'PRACTICE_DIRECTOR' ? <BaaNotice /> : null}
        <DashboardShell verifiedMedicalDirector={Boolean(capabilities.medicalDirector)}>{children}</DashboardShell>
      </OfflineCryptoProvider>
    </LocationProvider>
  );
}
