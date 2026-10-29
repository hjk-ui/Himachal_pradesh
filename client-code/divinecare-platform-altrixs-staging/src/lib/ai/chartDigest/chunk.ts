/**
 * Chronological chunking for the map step. Pure.
 *
 * Sources are sorted oldest first (date, then key) and grouped by calendar month so a new note in
 * October only changes October's chunk: unchanged chunks keep their key and their cached facts
 * (incremental regeneration). A month over the budget is split; a source over the budget is split
 * by pages. Each chunk's text carries page markers the model cites:
 *   <<<SOURCE S3 | 2024-01-05 | Progress Note | page 2>>>
 */
import { createHash } from 'crypto';
import type { ChartSource } from '@/lib/ai/chartDigest/types';

/** ~6k tokens of source text per map call */
export const CHUNK_CHAR_BUDGET = 24_000;
/** Most recent chunks kept when a chart is very large (oldest dropped, recorded as an error) */
export const MAX_CHUNKS = 80;
/** Per-page cap (a runaway OCR page cannot blow the budget) */
export const PAGE_CHAR_CAP = 12_000;

export type ChunkPart = { source: string; pages: number[] };
export type Chunk = {
  /** sha256 of month + source keys / versions / pages: stable while sources are unchanged */
  key: string;
  month: string;
  parts: ChunkPart[];
  chars: number;
};

export type SizedSource = Pick<ChartSource, 'key' | 'date' | 'version'> & { pageChars: number[] };

export function sizeOf(s: ChartSource): SizedSource {
  return { key: s.key, date: s.date, version: s.version, pageChars: s.pages.map((p) => Math.min(p.length, PAGE_CHAR_CAP)) };
}

export function sortChronological<T extends { date: string; key: string }>(sources: T[]): T[] {
  return [...sources].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function chunkKey(month: string, parts: ChunkPart[], versions: Map<string, string>): string {
  const h = createHash('sha256').update(month);
  for (const p of parts) h.update(`|${p.source}@${versions.get(p.source) ?? ''}:${p.pages.join(',')}`);
  return h.digest('hex').slice(0, 32);
}

/** Group sized sources into chunks (oldest first). Only sizes are needed, so the estimator reuses it. */
export function chunkSources(sources: SizedSource[], budget = CHUNK_CHAR_BUDGET): { chunks: Chunk[]; truncated: number } {
  const versions = new Map(sources.map((s) => [s.key, s.version]));
  const chunks: Chunk[] = [];
  type Open = { month: string; parts: ChunkPart[]; chars: number };
  const st: { cur: Open | null } = { cur: null };
  const flush = () => {
    const c = st.cur;
    if (c && c.parts.length) chunks.push({ key: chunkKey(c.month, c.parts, versions), month: c.month, parts: c.parts, chars: c.chars });
    st.cur = null;
  };
  for (const s of sortChronological(sources)) {
    const month = (s.date || '0000-00').slice(0, 7);
    const pages = s.pageChars.map((c, i) => ({ n: i + 1, c })).filter((p) => p.c > 0);
    if (!pages.length) continue;
    if (st.cur && st.cur.month !== month) flush();
    for (const p of pages) {
      if (st.cur && st.cur.chars > 0 && st.cur.chars + p.c > budget) flush();
      const cur: Open = (st.cur ??= { month, parts: [], chars: 0 });
      const last: ChunkPart | undefined = cur.parts[cur.parts.length - 1];
      if (last && last.source === s.key) last.pages.push(p.n);
      else cur.parts.push({ source: s.key, pages: [p.n] });
      cur.chars += p.c;
    }
  }
  flush();
  const truncated = Math.max(0, chunks.length - MAX_CHUNKS);
  return { chunks: truncated ? chunks.slice(truncated) : chunks, truncated };
}

/** Short aliases (S1, S2, ...) for the prompt, stable per digest run (chronological) */
export function sourceAliases(sources: Array<{ key: string; date: string }>): Map<string, string> {
  const m = new Map<string, string>();
  sortChronological(sources).forEach((s, i) => m.set(s.key, `S${i + 1}`));
  return m;
}

/** The chunk text sent to the model: page markers + page text (names already redacted by the caller) */
export function renderChunk(chunk: Chunk, byKey: Map<string, ChartSource>, aliases: Map<string, string>, pageText: (s: ChartSource, page: number) => string): string {
  const out: string[] = [];
  for (const part of chunk.parts) {
    const s = byKey.get(part.source);
    if (!s) continue;
    for (const n of part.pages) {
      out.push(`<<<SOURCE ${aliases.get(s.key)} | ${s.date} | ${s.label}${s.pages.length > 1 ? ` | page ${n}` : ''}>>>`);
      out.push(pageText(s, n).slice(0, PAGE_CHAR_CAP));
    }
  }
  return out.join('\n');
}
