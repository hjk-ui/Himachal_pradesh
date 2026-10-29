'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createAppointment,
  fetchAppointmentsWithZone,
  generateAppointmentAiDraft,
  updateAppointment,
} from '../api/appointmentsApi';
import { DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import type {
  Appointment,
  AppointmentStatus,
  CreateAppointmentInput,
  NoteStatus,
} from '../types';

/**
 * `range` = the visible calendar days (practice YYYY-MM-DD, inclusive). Changing it refetches.
 * Without a range the server default applies (90 days back .. 365 ahead).
 */
export function useAppointments(
  range?: { from: string; to: string } | null,
  options?: { facets?: boolean; enabled?: boolean }
) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_PRACTICE_TIME_ZONE);

  const facets = Boolean(options?.facets);
  // enabled=false holds the first fetch until the caller knows its range (no throwaway request)
  const enabled = options?.enabled !== false;
  const from = range?.from;
  const to = range?.to;
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAppointmentsWithZone({ ...(from && to ? { from, to } : {}), facets });
      setAppointments(res.appointments);
      setTimeZone(res.timeZone);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [from, to, facets]);

  useEffect(() => {
    if (enabled) void reload();
  }, [reload, enabled]);

  const addAppointment = async (input: CreateAppointmentInput) => {
    const created = await createAppointment(input);
    setAppointments((prev) =>
      [...prev, created].sort((a, b) =>
        `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)
      )
    );
    return created;
  };

  const setStatus = async (id: string, status: AppointmentStatus) => {
    const updated = await updateAppointment(id, { visitStatus: status });
    setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  };

  const setNoteStatus = async (id: string, noteStatus: NoteStatus) => {
    const updated = await updateAppointment(id, { noteStatus });
    setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  };

  const generateAiDraft = async (id: string) => {
    const updated = await generateAppointmentAiDraft(id);
    setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  };

  return {
    appointments,
    /** Practice time zone (book and display in this, not the browser's zone). */
    timeZone,
    loading,
    error,
    reload,
    addAppointment,
    setStatus,
    setNoteStatus,
    generateAiDraft,
    setAppointments,
  };
}
