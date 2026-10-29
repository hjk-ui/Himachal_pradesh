'use client';

/**
 * One-click "Start session" for an appointment: opens the visit's note with the right template, the
 * Visit Guide and the AI Scribe panel docked in the editor (src/lib/scribe/sessionStart.ts). Place it
 * next to an appointment anywhere (scheduler, Today home, command palette). Hidden for roles that
 * cannot use the AI Scribe or write the note.
 *
 *   <StartSessionButton appointmentId={appt.id} clientId={appt.clientId} />
 */
import Link from 'next/link';
import { Mic } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { startSessionHref } from '@/lib/scribe/sessionStart';

export function StartSessionButton({
  appointmentId,
  clientId,
  date,
  isVirtual,
  groupSessionId,
  size = 'sm',
  label = 'Start session',
  className = '',
}: {
  appointmentId: string;
  clientId: string;
  /** Practice wall date (YYYY-MM-DD) of the visit (date of service) */
  date?: string | null;
  isVirtual?: boolean;
  /** Group occurrence: opens the group session with the group scribe */
  groupSessionId?: string | null;
  size?: 'xs' | 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const role = String(user?.role || '');
  if (!appointmentId || !clientId || !role) return null;
  if (!canAccessPath(role, '/dashboard/scribe')) return null;
  const href = startSessionHref({ appointmentId, clientId, date, isVirtual, groupSessionId });
  if (!canAccessPath(role, href.split('?')[0])) return null;
  const pad = size === 'xs' ? 'px-2 py-1 text-[11px]' : size === 'md' ? 'px-3.5 py-2 text-sm' : 'px-2.5 py-1.5 text-xs';
  return (
    <Link
      href={href}
      aria-label={`${label}: open the note with AI Scribe ready to record`}
      title="Opens the note for this visit with the Visit Guide and AI Scribe ready: one click to record"
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#5C2D91]/40 bg-white font-semibold text-[#5C2D91] shadow-xs transition hover:bg-[#F5F3FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]/40 ${pad} ${className}`}
    >
      <Mic size={size === 'md' ? 15 : 13} aria-hidden />
      {label}
    </Link>
  );
}
