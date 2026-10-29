'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';
import { RoleHomeRouter } from '@/features/dashboard/components/RoleHomeRouter';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const role = user?.role;

  useEffect(() => {
    if (!role) return;
    const norm = normalizeStaffRole(role);
    if (norm === 'PHYSICIAN' || norm === 'MEDICAL_NP') {
      router.replace('/dashboard/medical');
    }
  }, [role, router]);

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading...
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        No role assigned.
      </div>
    );
  }

  const norm = normalizeStaffRole(role);
  if (norm === 'PHYSICIAN' || norm === 'MEDICAL_NP') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Redirecting to Medical EHR...
      </div>
    );
  }

  // Full staff name for greeting ("Dr. Sarah Smith"), not first token only ("Dr.")
  const displayName = (user?.displayName || user?.name || '').trim();
  const nameForGreeting = displayName || 'there';

  return (
    <div className="mx-auto -mt-1 max-w-[1560px] space-y-3">
      <RoleHomeRouter role={role} firstName={nameForGreeting} overview={null} />
    </div>
  );
}
