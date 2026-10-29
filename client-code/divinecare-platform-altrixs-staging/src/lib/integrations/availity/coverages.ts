import 'server-only';

import { AvailityEligibilityError } from './errors';
import { availityFetch, parseAvailityFieldErrors, readAvailityJson } from './http';
import { extractCoverageRecord, normalizeCoverageResponse } from './normalize';
import { buildCoveragesFormBody, type EligibilitySource } from './inquiry';
import { resolveCoveragesPayer } from './payer';

const POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 2000;

const IN_PROGRESS_CODES = new Set(['0', 'R1']);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coverageIdFrom(payload: unknown): string | undefined {
  const record = extractCoverageRecord(payload);
  const id = record && typeof record.id === 'string' ? record.id.trim() : '';
  return id || undefined;
}

function statusCodeOf(payload: unknown): string | undefined {
  const record = extractCoverageRecord(payload);
  return record && typeof record.statusCode === 'string' ? record.statusCode : undefined;
}

function isInProgress(httpStatus: number, payload: unknown): boolean {
  if (httpStatus === 202) return true;
  const code = statusCodeOf(payload);
  return Boolean(code && IN_PROGRESS_CODES.has(code));
}

function throwFromAvailityHttp(status: number, payload: unknown): never {
  const fieldErrors = parseAvailityFieldErrors(payload);
  if (status === 401) {
    throw new AvailityEligibilityError('Availity authentication failed', 502, 'token_request_failed');
  }
  if (status === 429) {
    throw new AvailityEligibilityError('Availity rate limit exceeded', 429, 'rate_limited');
  }
  if (status === 400 || fieldErrors.length) {
    throw new AvailityEligibilityError(
      'Availity rejected the eligibility request',
      400,
      'availity_validation',
      fieldErrors
    );
  }
  console.error('[availity-eligibility] coverages HTTP error', { status });
  throw new AvailityEligibilityError('Availity eligibility request failed', 502, 'network');
}

async function getCoverageById(id: string): Promise<{ status: number; payload: unknown }> {
  const response = await availityFetch(`/coverages/${encodeURIComponent(id)}`);
  const payload = await readAvailityJson(response);
  return { status: response.status, payload };
}

async function waitForComplete(initial: { status: number; payload: unknown }): Promise<unknown> {
  let current = initial;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const id = coverageIdFrom(current.payload);
    const code = statusCodeOf(current.payload);

    if (code === '19') {
      throw new AvailityEligibilityError(
        'The health plan returned a request error',
        400,
        'availity_request_error',
        parseAvailityFieldErrors(current.payload)
      );
    }

    if (!isInProgress(current.status, current.payload) && current.status >= 200 && current.status < 300) {
      console.error('[availity-eligibility] coverage complete', {
        coverageId: id,
        statusCode: code,
        attempt,
      });
      return current.payload;
    }

    if (!id) {
      throw new AvailityEligibilityError(
        'Availity returned an in-progress eligibility request without an ID',
        502,
        'unexpected'
      );
    }

    if (attempt === POLL_ATTEMPTS - 1) break;

    console.error('[availity-eligibility] polling coverage', {
      coverageId: id,
      statusCode: code,
      attempt,
    });
    await sleep(POLL_DELAY_MS);
    current = await getCoverageById(id);
    if (current.status === 429) {
      throw new AvailityEligibilityError('Availity rate limit exceeded', 429, 'rate_limited');
    }
    if (current.status >= 400) {
      throwFromAvailityHttp(current.status, current.payload);
    }
  }

  throw new AvailityEligibilityError(
    'Timed out waiting for Availity coverage results',
    504,
    'timeout'
  );
}

export async function runCoveragesEligibility(source: Omit<EligibilitySource, 'payerId'> & { insurancePayer: string }) {
  const config = await resolveCoveragesPayer(source.insurancePayer);
  const body = buildCoveragesFormBody({ ...source, payerId: config.payerId }, config);

  console.error('[availity-eligibility] creating coverage', { payerId: config.payerId });

  const response = await availityFetch('/coverages/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await readAvailityJson(response);

  if (response.status === 202 || (response.ok && isInProgress(response.status, payload))) {
    const complete = await waitForComplete({ status: response.status, payload });
    return normalizeCoverageResponse(complete);
  }

  if (!response.ok) {
    throwFromAvailityHttp(response.status, payload);
  }

  const complete = await waitForComplete({ status: response.status, payload });
  return normalizeCoverageResponse(complete);
}
