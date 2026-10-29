'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';
import { RoleHomeRouter } from '@/features/dashboard/components/RoleHomeRouter';
import { homePathForRole } from '@/lib/auth/roleAccess';
import { EmptyState, LoadingState } from '@/components/ui';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const role = user?.role;
  // Roles with their own landing page (homePathForRole: primary care -> /dashboard/medical,
  // crisis responder -> /dashboard/crisis). The proxy redirects /dashboard server-side; this
  // covers a client-side navigation that renders this page without a new request.
  const home = role ? homePathForRole(role) : '/dashboard';
  const hasOwnHome = home !== '/dashboard';

  useEffect(() => {
    if (hasOwnHome) router.replace(home);
  }, [hasOwnHome, home, router]);

  if (authLoading) {
    return (
      <LoadingState className="min-h-[40vh]" />
    );
  }

  if (!role) {
    return (
      <EmptyState title="No role assigned." description="Ask a practice administrator to assign your staff role." className="min-h-[40vh] justify-center" />
    );
  }

  if (hasOwnHome) {
    return (
      <LoadingState label="Opening your home page…" className="min-h-[40vh]" />
    );
  }

  // Full staff name for greeting ("Dr. Sarah Smith"), not first token only ("Dr.")
  const displayName = (user?.displayName || user?.name || '').trim();
  const nameForGreeting = displayName || 'there';

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1560px] space-y-6">
      <RoleHomeRouter role={role} firstName={nameForGreeting} overview={null} />
    </div>
  );
}
