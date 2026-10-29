'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createLocation,
  deactivateLocation,
  fetchLocations,
  updateLocation,
} from '../api/locationsApi';
import type { CreateLocationInput, LocationRecord, UpdateLocationInput } from '../types';

export function useLocations() {
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLocations(await fetchLocations(false));
    } catch (err: any) {
      setError(err.message || 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const add = async (input: CreateLocationInput) => {
    const loc = await createLocation(input);
    await reload();
    return loc;
  };

  const patch = async (id: string, input: UpdateLocationInput) => {
    const loc = await updateLocation(id, input);
    await reload();
    return loc;
  };

  const remove = async (id: string) => {
    const loc = await deactivateLocation(id);
    await reload();
    return loc;
  };

  return { locations, loading, error, reload, add, patch, remove };
}
