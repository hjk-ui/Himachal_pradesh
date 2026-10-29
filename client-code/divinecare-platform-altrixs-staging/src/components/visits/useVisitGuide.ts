'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GuideStep, StepStatus, VisitGuide } from '@/lib/visits/types';
import { checklistMarkBody, checklistUnmarkBody, guideUrl } from '@/components/visits/visitGuideHelpers';

export type VisitGuideParams = {
  clientId: string;
  appointmentId?: string | null;
  kind?: string | null;
  noteId?: string | null;
};

export type VisitGuideController = {
  params: VisitGuideParams | null;
  guide: VisitGuide | null;
  loading: boolean;
  /** "Visit guide unavailable" (404 / 5xx / network) */
  error: string | null;
  /** Last checklist save error */
  actionError: string | null;
  /** step ids with a save in flight */
  pending: Record<string, boolean>;
  reload: () => void;
  mark: (stepId: string, status: Exclude<StepStatus, 'not_done'>, reason?: string) => Promise<boolean>;
  unmark: (stepId: string) => Promise<boolean>;
};

const UNAVAILABLE = 'Visit guide unavailable';
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; guide: VisitGuide }>();

/**
 * GET /api/visits/guide. A short cache lets the notes page resolve the note type and the panel
 * render the same guide without a second request.
 */
export async function loadVisitGuide(params: VisitGuideParams, opts: { force?: boolean } = {}): Promise<VisitGuide> {
  const url = guideUrl(params);
  const hit = cache.get(url);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_MS) return hit.guide;
  const res = await fetch(url, { cache: 'no-store' });
  const data = (await res.json().catch(() => null)) as { success?: boolean; data?: VisitGuide; error?: string } | null;
  if (!res.ok || !data?.success || !data.data) {
    const err = new Error(res.status === 403 ? 'Visit guide not available for your role' : UNAVAILABLE) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  cache.set(url, { at: Date.now(), guide: data.data });
  return data.data;
}

function patchStep(guide: VisitGuide, stepId: string, patch: Partial<GuideStep>): VisitGuide {
  return { ...guide, steps: guide.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) };
}

/** Loads a Visit Guide and saves checklist marks (optimistic, reverted on failure). Pass null to stay idle. */
export function useVisitGuide(params: VisitGuideParams | null): VisitGuideController {
  const key = params ? guideUrl(params) : '';
  const stable = useMemo(() => params, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [guide, setGuide] = useState<VisitGuide | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);
  const forceRef = useRef(false);
  /** Background refresh (window focus): keep the shown guide if it fails */
  const silentRef = useRef(false);
  const loadedAtRef = useRef(0);
  const guideRef = useRef<VisitGuide | null>(null);
  useEffect(() => {
    guideRef.current = guide;
  }, [guide]);

  useEffect(() => {
    if (!stable) {
      setGuide(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const force = forceRef.current;
    forceRef.current = false;
    const silent = silentRef.current;
    silentRef.current = false;
    loadVisitGuide(stable, { force })
      .then((g) => {
        loadedAtRef.current = Date.now();
        if (!cancelled) setGuide(g);
      })
      .catch((e) => {
        if (!cancelled && silent && guideRef.current) return;
        if (!cancelled) {
          setGuide(null);
          setError(e instanceof Error ? e.message : UNAVAILABLE);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stable, tick]);

  const reload = useCallback(() => {
    forceRef.current = true;
    setTick((t) => t + 1);
  }, []);

  // Back from a new tab (assessment, consent, safety plan, booking): refresh what the chart now shows
  useEffect(() => {
    if (!stable) return;
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || !guideRef.current) return;
      if (Date.now() - loadedAtRef.current < 10_000) return;
      silentRef.current = true;
      forceRef.current = true;
      setTick((t) => t + 1);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [stable]);

  const send = useCallback(
    async (stepId: string, method: 'POST' | 'DELETE', body: Record<string, string>, optimistic: Partial<GuideStep>) => {
      const before = guideRef.current?.steps.find((s) => s.id === stepId);
      if (!before) return false;
      setActionError(null);
      setPending((p) => ({ ...p, [stepId]: true }));
      setGuide((g) => (g ? patchStep(g, stepId, optimistic) : g));
      try {
        const res = await fetch('/api/visits/checklist', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || data?.success === false) throw new Error(data?.error || 'Could not save the checklist');
        if (stable) cache.delete(guideUrl(stable));
        return true;
      } catch (e) {
        setGuide((g) => (g ? patchStep(g, stepId, { status: before.status, detail: before.detail }) : g));
        setActionError(e instanceof Error ? e.message : 'Could not save the checklist');
        return false;
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[stepId];
          return next;
        });
      }
    },
    [stable]
  );

  const mark = useCallback(
    async (stepId: string, status: Exclude<StepStatus, 'not_done'>, reason?: string) => {
      const g = guideRef.current;
      if (!g || !stable) return false;
      const body = checklistMarkBody(
        { clientId: stable.clientId, appointmentId: stable.appointmentId, noteId: stable.noteId, kind: g.kind },
        stepId,
        status,
        reason
      );
      if (!body) {
        setActionError('A reason is required.');
        return false;
      }
      return send(stepId, 'POST', body, { status, detail: reason?.trim() || undefined });
    },
    [send, stable]
  );

  const unmark = useCallback(
    async (stepId: string) => {
      const g = guideRef.current;
      if (!g || !stable) return false;
      const body = checklistUnmarkBody(
        { clientId: stable.clientId, appointmentId: stable.appointmentId, noteId: stable.noteId, kind: g.kind },
        stepId
      );
      const ok = await send(stepId, 'DELETE', body, { status: 'not_done', detail: undefined });
      // An auto step may still be done from the chart: refresh instead of guessing
      if (ok && g.steps.find((s) => s.id === stepId)?.source === 'auto') reload();
      return ok;
    },
    [send, stable, reload]
  );

  return { params: stable, guide, loading, error, actionError, pending, reload, mark, unmark };
}
