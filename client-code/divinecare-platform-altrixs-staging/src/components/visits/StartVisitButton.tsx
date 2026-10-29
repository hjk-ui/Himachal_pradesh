'use client';

/**
 * One "Start visit" button for every visit type: opens the right note (an existing note for the
 * appointment is reopened by the notes page) with the Visit Guide beside it. Group occurrences go
 * to their group session page, primary care to the medical visit page. Hidden for roles that
 * cannot write the target note. `withSession` adds the one-click AI Scribe "Start session" beside it
 * (src/components/scribe/StartSessionButton.tsx; note visits only, not primary care).
 */
import Link from 'next/link';
import { PlayCircle } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canStartVisit,
  startVisitHref,
  startVisitLabel,
  type StartVisitAppointment,
} from '@/components/visits/visitGuideHelpers';
import { StartSessionButton } from '@/components/scribe/StartSessionButton';

export function StartVisitButton({
  appointment,
  target = 'note',
  size = 'sm',
  force = false,
  className = '',
  withSession = false,
}: {
  appointment: StartVisitAppointment;
  /** 'medical' for primary care visits (documented on the medical visit page) */
  target?: 'note' | 'medical';
  size?: 'xs' | 'sm' | 'md';
  /** Show regardless of visit / note status */
  force?: boolean;
  className?: string;
  /** Also show "Start session" (AI Scribe docked in the note, one click to record) */
  withSession?: boolean;
}) {
  const { user } = useAuth();
  const role = String(user?.role || '');
  const href = startVisitHref(appointment, { target });
  const path = href.split('?')[0];
  if (!appointment.clientId || !role || !canAccessPath(role, path)) return null;
  if (!force && !canStartVisit(appointment.status, appointment.noteStatus)) return null;
  const label = appointment.groupSessionId ? 'Open group session' : startVisitLabel(appointment.status, appointment.noteStatus);
  const pad = size === 'xs' ? 'px-2 py-1 text-[11px]' : size === 'md' ? 'px-3.5 py-2 text-sm' : 'px-2.5 py-1.5 text-xs';
  const button = (
    <Link
      href={href}
      aria-label={`${label}${appointment.type ? `: ${appointment.type}` : ''}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg font-semibold text-white shadow-xs transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40 ${pad} ${className}`}
      style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
    >
      <PlayCircle size={size === 'md' ? 15 : 13} aria-hidden />
      {label}
    </Link>
  );
  if (!withSession || target === 'medical' || !canStartVisit(appointment.status, appointment.noteStatus)) return button;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {button}
      <StartSessionButton
        appointmentId={appointment.id}
        clientId={appointment.clientId}
        date={appointment.date ?? null}
        isVirtual={appointment.isVirtual}
        groupSessionId={appointment.groupSessionId ?? null}
        size={size}
      />
    </span>
  );
}
