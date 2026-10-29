'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** JSON fetch for /api/hr/*: throws Error(message) on { success: false } or non-2xx. */
export async function hrFetch<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  let data: (T & { success?: boolean; error?: string }) | null = null;
  try {
    data = (await res.json()) as T & { success?: boolean; error?: string };
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.success === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

/** Load-on-mount data hook with reload(); keeps the last good data while reloading. */
export function useHrData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await hrFetch<T>(url);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function fmtDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtMoneyCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return '—';
  return s
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function roleLabel(role: string | null | undefined): string {
  const map: Record<string, string> = {
    ADMIN: 'Administrator',
    DIRECTOR: 'Director',
    PRACTICE_DIRECTOR: 'Practice director',
    OFFICE_MANAGER: 'Office manager',
    FRONT_DESK: 'Front desk',
    BILLING: 'Billing',
    HR: 'HR',
    THERAPIST: 'Therapist',
    CLINICIAN: 'Clinician',
    PSYCHIATRIST: 'Psychiatrist',
    NP: 'Psychiatric NP',
    PRP_SPECIALIST: 'PRP specialist',
    CASE_MANAGER: 'Case manager',
    PEER_SUPPORT: 'Peer support',
    CRISIS_RESPONDER: 'Crisis responder',
    PHYSICIAN: 'Physician',
    MEDICAL_NP: 'Medical NP',
    MEDICAL_ASSISTANT: 'Medical assistant',
  };
  return role ? map[role.toUpperCase()] ?? titleCase(role) : '—';
}

export const STAFF_ROLE_OPTIONS = [
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'CRISIS_RESPONDER',
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
  'FRONT_DESK',
  'BILLING',
  'OFFICE_MANAGER',
  'HR',
  'PRACTICE_DIRECTOR',
  'ADMIN',
] as const;

export const PROGRAM_OPTIONS = ['OMHC', 'PRP', 'Primary care', 'Crisis', 'Residential', 'IOP / PHP', 'Case management', 'Administration'] as const;
