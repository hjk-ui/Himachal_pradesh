import 'server-only';
import { getFdbConfig } from '../config';
import { requireFdbSettings } from './settings';
import { FdbClient } from './client';
import type { DrugAllergySearchResponse } from './types';

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, { expiresAt: number; value: DrugAllergySearchResponse }>();

export function normalizeDrugSearch(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export async function searchDrugAllergies(searchString: string, maximum?: number) {
  const normalized = normalizeDrugSearch(searchString);
  const key = `${normalized.toLocaleLowerCase('en-US')}:${maximum ?? ''}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cache.delete(key);
  const result = await new FdbClient(requireFdbSettings(getFdbConfig())).searchDrugAllergy(normalized, maximum);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}
