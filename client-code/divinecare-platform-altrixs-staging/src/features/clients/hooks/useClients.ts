'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createClient,
  fetchClientPage,
  fetchClients,
  type ClientPageQuery,
  updateClientStatus,
  uploadClientAvatar,
} from '../api/clientsApi';
import toast from 'react-hot-toast';
import type { Client, ClientStatus, CreateClientInput } from '../types';

/**
 * Without a query: the first 250 clients, as before. With one (clients page): a server-side
 * page with search/status/location filters and the matching total.
 */
export function useClients(query?: ClientPageQuery) {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const page = query?.page;
  const pageSize = query?.pageSize;
  const search = query?.search;
  const status = query?.status;
  const locationId = query?.locationId;
  const program = query?.program;
  const params = query?.params;
  const paged = query !== undefined;
  /** false = wait (e.g. until saved list filters are restored) */
  const enabled = query?.enabled ?? true;

  const load = useCallback(async (): Promise<{ clients: Client[]; total: number | null }> => {
    if (!paged) return { clients: await fetchClients(), total: null };
    const res = await fetchClientPage({ page: page ?? 0, pageSize: pageSize ?? 100, search, status, locationId, program, params });
    return { clients: res.clients, total: res.total };
  }, [paged, page, pageSize, search, status, locationId, program, params]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await load();
      setClients(res.clients);
      if (res.total !== null) setTotal(res.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((data) => {
        if (cancelled) return;
        setClients(data.clients);
        if (data.total !== null) setTotal(data.total);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Failed to load clients');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, enabled]);

  const addClient = async (input: CreateClientInput, avatarFile?: File | null) => {
    const created = await createClient(input);
    if (avatarFile && created.client.id) {
      await uploadClientAvatar(created.client.id, avatarFile);
    }
    if (created.appInvite?.invited && !created.appInvite.error) {
      toast.success(
        created.appInvite.emailMode === 'console'
          ? 'Client saved. The invite email could not be sent because email delivery is not set up yet.'
          : 'Client saved. Password email sent — they sign in on the website.'
      );
    } else if (input.email?.trim() && created.appInvite?.error === 'already_active') {
      toast.success('Client saved. Website login already active.');
    } else if (input.email?.trim() && created.appInvite?.error) {
      toast.error(`Client saved, but invite email failed: ${created.appInvite.error}`);
    }
    await reload();
  };

  const setClientStatus = async (id: string, status: ClientStatus) => {
    await updateClientStatus(id, status);
    await reload();
  };

  return { clients, total, loading, error, reload, addClient, setClientStatus };
}
