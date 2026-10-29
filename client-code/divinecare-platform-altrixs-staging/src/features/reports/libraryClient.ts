'use client';

/**
 * Report library browser helpers: the library fetch and per-browser favorites / recently run.
 * localStorage holds report ids and run times only (never parameters or results), so nothing
 * patient-related is stored on the device. Favorites do not follow the user to another browser.
 */
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { DATE_PRESETS, LibraryLink, REPORT_CATEGORIES, ReportMeta, ReportOptions } from '@/lib/reports/library/types';

export type LibraryResponse = {
  success: boolean;
  categories: typeof REPORT_CATEGORIES;
  presets: typeof DATE_PRESETS;
  timeZone: string;
  options: ReportOptions;
  reports: ReportMeta[];
  links: LibraryLink[];
};

export function useReportLibrary() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiJson<LibraryResponse>('/api/reports/library')
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load the report library'));
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

const FAV_KEY = 'altrixs.reports.favorites.v1';
const RECENT_KEY = 'altrixs.reports.recent.v1';
const RECENT_MAX = 8;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: favorites simply do not persist */
  }
}

export function readFavorites(): string[] {
  const v = read<unknown>(FAV_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
}

export function toggleFavorite(id: string): string[] {
  const cur = readFavorites();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  write(FAV_KEY, next);
  return next;
}

export type RecentRun = { id: string; at: string };

export function readRecent(): RecentRun[] {
  const v = read<unknown>(RECENT_KEY, []);
  return Array.isArray(v)
    ? v.filter((x): x is RecentRun => Boolean(x) && typeof (x as RecentRun).id === 'string' && typeof (x as RecentRun).at === 'string').slice(0, RECENT_MAX)
    : [];
}

export function recordRecent(id: string): void {
  const next = [{ id, at: new Date().toISOString() }, ...readRecent().filter((r) => r.id !== id)].slice(0, RECENT_MAX);
  write(RECENT_KEY, next);
}
