'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { StaffRole } from '@/types/roles';
import { FrontDeskHome } from './FrontDeskHome';
import type { DashboardOverview as OverviewData } from '../types';
import { RoleHomeFeedProvider } from '../hooks/useRoleHomeFeed';
import {
  AdminRoleHome,
  BillingRoleHome,
  ClinicalSupportRoleHome,
  HRRoleHome,
  OfficeRoleHome,
  PRPRoleHome,
  PsychRoleHome,
  TherapistRoleHome,
} from './RoleHomes';

type Props = {
  role: StaffRole;
  firstName: string | null;
  overview: OverviewData | null;
  overviewError?: string | null;
};

export function RoleHomeRouter({ role, firstName, overview: _overview, overviewError }: Props) {
  const [greeting, setGreeting] = useState('Hello');
  const roleStr = String(role || '').toLowerCase();
  const defaultName = 'there';
  const name = firstName || defaultName;

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  const wrap = (node: ReactNode) => (
    <RoleHomeFeedProvider key={role}>{node}</RoleHomeFeedProvider>
  );

  const attentionHome = (
    <>
      {overviewError ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {overviewError}
        </div>
      ) : null}
      <TherapistRoleHome greeting={greeting} name={name} />
    </>
  );

  // Practice Director / Clinic Admin — same attention layout, org-wide data
  if (role === 'ADMIN' || role === 'DIRECTOR' || role === 'PRACTICE_DIRECTOR') {
    return wrap(<AdminRoleHome greeting={greeting} name={name} />);
  }

  if (role === 'THERAPIST' || role === 'CLINICIAN') {
    return wrap(attentionHome);
  }
  if (role === 'PSYCHIATRIST' || role === 'NP') {
    return wrap(<PsychRoleHome greeting={greeting} name={name} role={role} />);
  }
  if (role === 'PRP_SPECIALIST') {
    return wrap(<PRPRoleHome greeting={greeting} name={name} />);
  }
  if (role === 'CASE_MANAGER' || role === 'PEER_SUPPORT') {
    return wrap(<ClinicalSupportRoleHome greeting={greeting} name={name} role={role} />);
  }

  if (role === 'OFFICE_MANAGER' || roleStr === 'office_manager') {
    return wrap(<OfficeRoleHome greeting={greeting} name={name} />);
  }
  if (role === 'FRONT_DESK') {
    return <FrontDeskHome firstName={firstName} />;
  }
  if (role === 'BILLING' || roleStr === 'billing_specialist') {
    return wrap(<BillingRoleHome greeting={greeting} name={name} />);
  }
  if (role === 'HR') {
    return wrap(<HRRoleHome greeting={greeting} name={name} />);
  }

  return wrap(attentionHome);
}
