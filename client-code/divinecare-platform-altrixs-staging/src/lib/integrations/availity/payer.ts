import 'server-only';

import { AvailityEligibilityError } from './errors';
import { namesMatch } from './mapping';
import {
  availityFetch,
  fetchPayerList,
  logAvailityHttp,
  payerListUrl,
  readAvailityJson,
} from './http';

export type ConfigElement = {
  allowed?: boolean;
  required?: boolean;
  defaultValue?: string;
  pattern?: string;
  maxLength?: number;
  errorMessage?: string;
};

export type CoveragesPayerConfig = {
  payerId: string;
  payerName?: string;
  elements: Record<string, ConfigElement>;
};

const PAGE_LIMIT = 50;
const MAX_PAGES = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseElements(raw: unknown): Record<string, ConfigElement> {
  const record = asRecord(raw);
  if (!record) return {};
  const elements: Record<string, ConfigElement> = {};
  for (const [name, value] of Object.entries(record)) {
    const el = asRecord(value);
    if (!el) continue;
    elements[name] = {
      allowed: typeof el.allowed === 'boolean' ? el.allowed : undefined,
      required: typeof el.required === 'boolean' ? el.required : undefined,
      defaultValue: typeof el.defaultValue === 'string' ? el.defaultValue : undefined,
      pattern: typeof el.pattern === 'string' ? el.pattern : undefined,
      maxLength: typeof el.maxLength === 'number' ? el.maxLength : undefined,
      errorMessage: typeof el.errorMessage === 'string' ? el.errorMessage : undefined,
    };
  }
  return elements;
}

function parseConfiguration(raw: unknown): CoveragesPayerConfig | null {
  const row = asRecord(raw);
  if (!row) return null;
  const payerId = typeof row.payerId === 'string' ? row.payerId.trim() : '';
  if (!payerId) return null;
  return {
    payerId,
    payerName: typeof row.payerName === 'string' ? row.payerName : undefined,
    elements: parseElements(row.elements),
  };
}

async function fetchPayerListPage(offset: number, limit: number): Promise<unknown> {
  const search = `transactionType=270&offset=${offset}&limit=${limit}`;
  const url = payerListUrl(`?${search}`);
  const response = await fetchPayerList(`?${search}`);
  const payload = await readAvailityJson(response);
  logAvailityHttp('payer-list', url, response.status, response.ok ? { count: (payload as { count?: unknown })?.count, totalCount: (payload as { totalCount?: unknown })?.totalCount } : payload);
  if (response.status === 429) {
    throw new AvailityEligibilityError('Availity rate limit exceeded', 429, 'rate_limited');
  }
  if (!response.ok) {
    throw new AvailityEligibilityError('Could not load Availity payer directory', 502, 'network');
  }
  return payload;
}

type ListedPayer = { payerId: string; labels: string[] };

function collectPayersFromListPayload(payload: unknown): { payers: ListedPayer[]; totalCount?: number } {
  const payers: ListedPayer[] = [];
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.payers)
      ? root.payers
      : [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const payerId =
      (typeof row.payerId === 'string' && row.payerId.trim()) ||
      (typeof row.payerID === 'string' && row.payerID.trim()) ||
      '';
    if (!payerId) continue;
    const labels = [payerId, row.name, row.displayName, row.shortName, row.payerName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    payers.push({ payerId, labels });
  }
  return {
    payers,
    totalCount: typeof root?.totalCount === 'number' ? root.totalCount : undefined,
  };
}

function collectPayersFromConfigurations(payload: unknown): {
  payers: ListedPayer[];
  configs: CoveragesPayerConfig[];
  totalCount?: number;
} {
  const root = asRecord(payload);
  const list = Array.isArray(root?.configurations) ? root.configurations : [];
  const configs: CoveragesPayerConfig[] = [];
  const payers: ListedPayer[] = [];
  for (const item of list) {
    const config = parseConfiguration(item);
    if (!config) continue;
    configs.push(config);
    payers.push({
      payerId: config.payerId,
      labels: [config.payerId, ...(config.payerName ? [config.payerName] : [])],
    });
  }
  return {
    payers,
    configs,
    totalCount: typeof root?.totalCount === 'number' ? root.totalCount : undefined,
  };
}

function matchPayer(insurancePayer: string, listed: ListedPayer[]): ListedPayer | null {
  const exactId = listed.find((row) => namesMatch(row.payerId, insurancePayer));
  if (exactId) return exactId;
  const label = listed.find((row) => row.labels.some((item) => namesMatch(item, insurancePayer)));
  return label ?? null;
}

async function searchPayerList(insurancePayer: string): Promise<string | null> {
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_LIMIT;
    const payload = await fetchPayerListPage(offset, PAGE_LIMIT);
    const { payers, totalCount } = collectPayersFromListPayload(payload);
    const hit = matchPayer(insurancePayer, payers);
    if (hit) return hit.payerId;
    if (payers.length < PAGE_LIMIT) break;
    if (typeof totalCount === 'number' && offset + payers.length >= totalCount) break;
  }
  return null;
}

export async function fetchPayerCoveragesConfig(payerId: string): Promise<CoveragesPayerConfig> {
  const response = await availityFetch(
    `/configurations?type=270&payerId=${encodeURIComponent(payerId)}`
  );
  if (response.status === 429) {
    throw new AvailityEligibilityError('Availity rate limit exceeded', 429, 'rate_limited');
  }
  if (!response.ok) {
    console.error('[availity-eligibility] configurations failed', { status: response.status });
    throw new AvailityEligibilityError('Could not load payer configuration', 502, 'network');
  }
  const payload = await readAvailityJson(response);
  const { configs } = collectPayersFromConfigurations(payload);
  const config = configs.find((row) => namesMatch(row.payerId, payerId)) ?? configs[0];
  if (!config) {
    throw new AvailityEligibilityError(
      'No Coverages configuration was returned for this payer',
      400,
      'missing_payer'
    );
  }
  return config;
}

export async function resolveCoveragesPayer(insurancePayer: string): Promise<CoveragesPayerConfig> {
  const query = insurancePayer.trim();
  if (!query) {
    throw new AvailityEligibilityError(
      'Client insurance payer is missing. Store the Availity payer name or payer ID.',
      400,
      'missing_payer'
    );
  }

  const payerId = await searchPayerList(query);

  if (!payerId) {
    throw new AvailityEligibilityError(
      'Could not resolve insurance payer to an Availity payerId. Use the exact Availity payer name or payer ID from the Payer List.',
      400,
      'missing_payer'
    );
  }

  console.error('[availity-eligibility] payer resolved', { payerId });
  return fetchPayerCoveragesConfig(payerId);
}
