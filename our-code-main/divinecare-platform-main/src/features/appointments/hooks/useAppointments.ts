'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createAppointment,
  fetchAppointments,
  generateAppointmentAiDraft,
  updateAppointment,
  confirmAppointment,
  declineAppointment,
} from '../api/appointmentsApi';
import type {
  Appointment,
  AppointmentStatus,
  CreateAppointmentInput,
  NoteStatus,
} from '../types';

export function useAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAppointments(await fetchAppointments());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const confirm = async (id: string) => {
    const updated = await confirmAppointment(id);
    setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  };

  const decline = async (id: string, reason?: string) => {
    const updated = await declineAppointment(id, reason);
    setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  };

  return {
    appointments,
    loading,
    error,
    reload,
    addAppointment,
    setStatus,
    setNoteStatus,
    generateAiDraft,
    confirm,
    decline,
    setAppointments,
  };
}
