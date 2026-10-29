import { randomUUID } from 'crypto';
import { getModuleData, saveModuleData } from '@/lib/modules/manage';
import type { DiagnosisSuggestion } from './types';

/**
 * Suggested diagnoses (e.g. from the AI scribe or coding agent) wait here until a clinician accepts or
 * dismisses them. Nothing is added to the diagnosis list automatically.
 */
const moduleKey = (clientId: string) => `diagnosis-suggestions:${clientId}`;

type Stored = { items: DiagnosisSuggestion[] };

async function load(organizationId: string, clientId: string): Promise<DiagnosisSuggestion[]> {
  const data = await getModuleData<Stored>(organizationId, moduleKey(clientId));
  return Array.isArray(data?.items) ? data.items : [];
}

export async function listPendingSuggestions(organizationId: string, clientId: string) {
  return (await load(organizationId, clientId)).filter((s) => s.status === 'PENDING');
}

export async function addSuggestion(
  organizationId: string,
  clientId: string,
  input: { code: string; description: string; source: string }
): Promise<DiagnosisSuggestion> {
  const items = await load(organizationId, clientId);
  const existing = items.find((s) => s.code === input.code && s.status === 'PENDING');
  if (existing) return existing;
  const created: DiagnosisSuggestion = {
    id: randomUUID(),
    code: input.code,
    description: input.description,
    source: input.source,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
  await saveModuleData<Stored>(organizationId, moduleKey(clientId), { items: [...items, created] });
  return created;
}

export async function resolveSuggestion(
  organizationId: string,
  clientId: string,
  id: string,
  status: 'ACCEPTED' | 'DISMISSED'
): Promise<DiagnosisSuggestion | null> {
  const items = await load(organizationId, clientId);
  const target = items.find((s) => s.id === id && s.status === 'PENDING');
  if (!target) return null;
  const next = { ...target, status };
  await saveModuleData<Stored>(organizationId, moduleKey(clientId), {
    items: items.map((s) => (s.id === id ? next : s)),
  });
  return next;
}
