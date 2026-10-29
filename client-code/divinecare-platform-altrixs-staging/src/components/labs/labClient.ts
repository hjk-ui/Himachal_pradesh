'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LabOrderDto, LabResultDto, LabTestLine } from '@/lib/labs/manage';
import type { StandingOrderDto } from '@/lib/labs/standingDb';
import type { LabTestDef } from '@/lib/labs/catalog';
import type { LabOrderSet } from '@/lib/labs/orderSets';
import type { LabPermissions } from '@/lib/labs/access';
import { apiJson } from '@/lib/api-client';

export type { LabOrderDto, LabResultDto, LabTestLine, StandingOrderDto, LabTestDef, LabOrderSet, LabPermissions };

export type OrderContext = {
  client: { id: string; name: string; dateOfBirth: string | null };
  diagnoses: { code: string; description: string; source: string }[];
  insurance: { payer: string | null; type: string | null; medicare: boolean };
  suggestedOrderSets: string[];
  documents: { id: string; type: string; name: string; filedAt: string | null }[];
};

export type CatalogPayload = { tests: LabTestDef[]; orderSets: LabOrderSet[]; orderSetSources: Record<string, string> };

let catalogCache: Promise<CatalogPayload> | null = null;

/** Org lab catalog + order sets (cached per page load) */
export function useLabCatalog() {
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!catalogCache) catalogCache = apiJson<CatalogPayload>('/api/labs/catalog');
    catalogCache
      .then((d) => live && setData(d))
      .catch((e) => {
        catalogCache = null;
        if (live) setError(e instanceof Error ? e.message : 'Could not load the lab catalog');
      });
    return () => {
      live = false;
    };
  }, []);
  return { catalog: data, catalogError: error };
}

/** Orders + standing orders + the viewer's lab permissions */
export function useLabOrders(params: { clientId?: string; program?: 'medical' }) {
  const [orders, setOrders] = useState<LabOrderDto[]>([]);
  const [standing, setStanding] = useState<StandingOrderDto[]>([]);
  const [permissions, setPermissions] = useState<LabPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams();
  if (params.clientId) qs.set('clientId', params.clientId);
  if (params.program) qs.set('program', params.program);
  const query = qs.toString();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiJson<{ orders: LabOrderDto[]; standingOrders: StandingOrderDto[]; permissions: LabPermissions }>(
        `/api/labs/orders${query ? `?${query}` : ''}`,
        { cache: 'no-store' }
      );
      setOrders(d.orders);
      setStanding(d.standingOrders);
      setPermissions(d.permissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load lab orders');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Replace one order in place after an action */
  const upsert = useCallback((o: LabOrderDto) => {
    setOrders((prev) => {
      const i = prev.findIndex((x) => x.id === o.id);
      if (i === -1) return [o, ...prev];
      const next = [...prev];
      next[i] = o;
      return next;
    });
  }, []);

  return { orders, standing, permissions, loading, error, reload, upsert };
}

export async function fetchOrderContext(clientId: string): Promise<OrderContext> {
  return apiJson<OrderContext>(`/api/labs/order-context?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
}

export function openRequisition(orderId: string) {
  window.open(`/api/labs/orders/${encodeURIComponent(orderId)}/requisition-html?format=raw`, '_blank', 'noopener,noreferrer,width=900,height=1000');
}

export const fmtDay = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtWhen = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const FLAG_STYLE: Record<string, string> = {
  N: 'text-slate-900',
  H: 'text-amber-700 font-bold',
  L: 'text-sky-700 font-bold',
  HH: 'text-rose-700 font-black',
  LL: 'text-rose-700 font-black',
  A: 'text-violet-700 font-bold',
};
