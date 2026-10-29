/**
 * Cost estimator for chart history digests. Pure.
 *
 * Bedrock (Haiku-class) is priced per million input / output tokens; Textract DetectDocumentText
 * per page, only for scanned pages (PDF text layers are read locally for free). Prices default to
 * the published on-demand list prices and can be overridden per environment:
 *   CHART_DIGEST_PRICE_IN_PER_M, CHART_DIGEST_PRICE_OUT_PER_M, CHART_DIGEST_TEXTRACT_PER_PAGE.
 * Tokens ≈ characters / 4. An unextracted page is assumed to hold ASSUMED_CHARS_PER_PAGE.
 */
import { chunkSources, CHUNK_CHAR_BUDGET, type SizedSource } from '@/lib/ai/chartDigest/chunk';
import { SYSTEM_PROMPT_TOKENS } from '@/lib/ai/chartDigest/prompt';

export const CHARS_PER_TOKEN = 4;
export const ASSUMED_CHARS_PER_PAGE = 2_500;
/** Expected map reply size per chunk (JSON with citations) */
export const EST_OUTPUT_TOKENS_PER_CHUNK = 900;

export type Prices = { inPerM: number; outPerM: number; textractPerPage: number };

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name]?.trim() ? v : fallback;
}

export function digestPrices(): Prices {
  return {
    inPerM: envNum('CHART_DIGEST_PRICE_IN_PER_M', 1.0),
    outPerM: envNum('CHART_DIGEST_PRICE_OUT_PER_M', 5.0),
    textractPerPage: envNum('CHART_DIGEST_TEXTRACT_PER_PAGE', 0.0015),
  };
}

export function tokenCost(tokensIn: number, tokensOut: number, p: Prices): number {
  return (tokensIn / 1_000_000) * p.inPerM + (tokensOut / 1_000_000) * p.outPerM;
}

/** One source for estimation: known page texts (chars) or just a page count */
export type EstimateSource = {
  key: string;
  date: string;
  version: string;
  pageCount: number;
  /** chars per page when the text is already known (cached / text layer); else null */
  pageChars: number[] | null;
  /** pages with no text layer that would go to Textract (0 when text is cached) */
  scannedPages: number;
};

export type ClientEstimate = {
  documents: number;
  pages: number;
  textPages: number;
  scannedPages: number;
  chunks: number;
  tokensIn: number;
  tokensOut: number;
  bedrockUsd: number;
  textractUsd: number;
  totalUsd: number;
};

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function estimateClient(sources: EstimateSource[], prices: Prices = digestPrices(), budget = CHUNK_CHAR_BUDGET): ClientEstimate {
  const sized: SizedSource[] = sources.map((s) => ({
    key: s.key,
    date: s.date,
    version: s.version,
    pageChars: s.pageChars ?? Array.from({ length: Math.max(1, s.pageCount) }, () => ASSUMED_CHARS_PER_PAGE),
  }));
  const { chunks } = chunkSources(sized, budget);
  const chars = chunks.reduce((n, c) => n + c.chars, 0);
  const tokensIn = Math.ceil(chars / CHARS_PER_TOKEN) + chunks.length * SYSTEM_PROMPT_TOKENS;
  const tokensOut = chunks.length * EST_OUTPUT_TOKENS_PER_CHUNK;
  const pages = sources.reduce((n, s) => n + Math.max(s.pageCount, s.pageChars?.length ?? 0), 0);
  const scannedPages = sources.reduce((n, s) => n + s.scannedPages, 0);
  const bedrockUsd = tokenCost(tokensIn, tokensOut, prices);
  const textractUsd = scannedPages * prices.textractPerPage;
  return {
    documents: sources.length,
    pages,
    textPages: pages - scannedPages,
    scannedPages,
    chunks: chunks.length,
    tokensIn,
    tokensOut,
    bedrockUsd: round(bedrockUsd),
    textractUsd: round(textractUsd),
    totalUsd: round(bedrockUsd + textractUsd),
  };
}

export function sumEstimates(list: ClientEstimate[]): ClientEstimate {
  const z: ClientEstimate = { documents: 0, pages: 0, textPages: 0, scannedPages: 0, chunks: 0, tokensIn: 0, tokensOut: 0, bedrockUsd: 0, textractUsd: 0, totalUsd: 0 };
  for (const e of list) for (const k of Object.keys(z) as (keyof ClientEstimate)[]) z[k] += e[k];
  return { ...z, bedrockUsd: round(z.bedrockUsd), textractUsd: round(z.textractUsd), totalUsd: round(z.totalUsd) };
}

/** Extrapolate a sample to the full roster (clients without sampling get the sample mean) */
export function extrapolate(sample: ClientEstimate[], rosterSize: number): ClientEstimate {
  const total = sumEstimates(sample);
  if (!sample.length || rosterSize <= sample.length) return total;
  const f = rosterSize / sample.length;
  const z = { ...total };
  for (const k of Object.keys(z) as (keyof ClientEstimate)[]) z[k] = k.endsWith('Usd') ? round(z[k] * f) : Math.round(z[k] * f);
  return z;
}
