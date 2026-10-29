'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createClient,
  fetchClientsPaged,
  updateClientStatus,
  uploadClientAvatar,
} from '../api/clientsApi';
import toast from 'react-hot-toast';
import type { Client, ClientStatus, CreateClientInput } from '../types';

export function useClients(options?: { page?: number; limit?: number; search?: string }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(options?.page || 1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const limit = options?.limit || 250;
  const search = options?.search?.trim() || '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // When search changes from outside, reset page to 1
  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchClientsPaged({
      page,
      limit,
      search: search || undefined,
    })
      .then((res) => {
        if (!cancelled) {
          setClients(res.clients);
          setTotal(res.total);
          setPage(res.page);
          setTotalPages(res.totalPages);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load clients');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, limit, search]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchClientsPaged({
        page,
        limit,
        search: search || undefined,
      });
      setClients(res.clients);
      setTotal(res.total);
      setPage(res.page);
      setTotalPages(res.totalPages);
    } catch (err: any) {
      setError(err.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, [page, limit, search]);

  const goToPage = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const addClient = async (input: CreateClientInput, avatarFile?: File | null) => {
    const created = await createClient(input);
    if (avatarFile && created.client.id) {
      await uploadClientAvatar(created.client.id, avatarFile);
    }
    if (created.appInvite?.invited && !created.appInvite.error) {
      toast.success(
        created.appInvite.emailMode === 'console'
          ? 'Client saved. Invite link is in the server console until SES email is set.'
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

  return {
    clients,
    total,
    page,
    totalPages,
    limit,
    goToPage,
    loading,
    error,
    reload,
    addClient,
    setClientStatus,
  };
}
