/**
 * X12 005010 reading and envelope helpers shared by the Waystar inbound / 270 / 276 code.
 * Pure: no DB, no AWS, no env reads (callers pass config), so tests can import it directly.
 *
 * Delimiters come from the ISA segment (fixed width, 106 chars): ISA[3] element separator,
 * ISA11 repetition separator (5010), ISA16 component separator, char 106 segment terminator.
 */

export type X12Doc = {
  segments: string[][];
  element: string;
  component: string;
  repetition: string;
  terminator: string;
};

export function parseX12(content: string): X12Doc {
  const text = content.replace(/^﻿/, '').trimStart();
  let element = '*';
  let terminator = '~';
  let component = ':';
  let repetition = '^';
  if (text.startsWith('ISA') && text.length >= 106) {
    element = text[3];
    const isa = text.slice(0, 106).split(element);
    if (isa.length >= 17) {
      repetition = isa[11] && isa[11].length === 1 && !/[A-Za-z0-9]/.test(isa[11]) ? isa[11] : '^';
      component = isa[16]?.[0] || ':';
      terminator = isa[16]?.[1] || text[105] || '~';
    } else {
      component = text[104];
      terminator = text[105];
    }
  }
  const segments = text
    .split(terminator)
    .map((s) => s.replace(/[\r\n]+/g, '').trim())
    .filter(Boolean)
    .map((s) => s.split(element));
  return { segments, element, component, repetition, terminator };
}

/** Transaction sets in a file, by ST01 (and GS08 implementation guide for the 277 split). */
export type X12Kind = '999' | '277CA' | '277' | '835' | '271' | 'TA1' | 'unknown';

/**
 * Detects the kind of an inbound file. The 277 claim acknowledgment (005010X214, BHT06 = TH)
 * and the 277 claim status response to a 276 (005010X212, BHT06 = DG) share ST01 = 277.
 */
export function detectX12Kind(content: string): X12Kind {
  const { segments } = parseX12(content);
  const st = segments.find((s) => s[0] === 'ST');
  if (!st) return segments.some((s) => s[0] === 'TA1') ? 'TA1' : 'unknown';
  switch (st[1]) {
    case '999': return '999';
    case '835': return '835';
    case '271': return '271';
    case '277': {
      const gs = segments.find((s) => s[0] === 'GS');
      const version = (st[3] || gs?.[8] || '').toUpperCase();
      if (version.includes('X212')) return '277';
      if (version.includes('X214')) return '277CA';
      const bht = segments.find((s) => s[0] === 'BHT');
      if (bht?.[6] === 'DG') return '277';
      return '277CA';
    }
    default: return 'unknown';
  }
}

/** Splits a file into its ST..SE transaction sets (segments only, envelope dropped). */
export function transactionSets(doc: X12Doc): string[][][] {
  const sets: string[][][] = [];
  let cur: string[][] | null = null;
  for (const s of doc.segments) {
    if (s[0] === 'ST') { cur = [s]; sets.push(cur); continue; }
    if (!cur) continue;
    cur.push(s);
    if (s[0] === 'SE') cur = null;
  }
  return sets;
}

export function money(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function cents(value: number): number {
  return Math.round(value * 100);
}

/** CCYYMMDD -> YYYY-MM-DD (or null). */
export function x12DateToIso(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** D8 / RD8 value -> [from, to] ISO dates. */
export function x12Period(format: string | undefined, value: string | undefined): { from: string | null; to: string | null } {
  if (!value) return { from: null, to: null };
  if (format === 'RD8' && value.includes('-')) {
    const [a, b] = value.split('-');
    return { from: x12DateToIso(a), to: x12DateToIso(b) };
  }
  const d = x12DateToIso(value);
  return { from: d, to: d };
}

// ─── Outbound envelope (270 / 276) ───────────────────────────────────────────

export type EnvelopeConfig = {
  submitterId: string;
  submitterName: string;
  receiverId: string;
  usageIndicator: 'T' | 'P';
};

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}

export function x12Date(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

export function x12Time(d: Date) {
  return `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
}

/** Strips characters that would break the segment (delimiters) and upper-cases. */
export function x12Text(value: string | null | undefined, max = 60): string {
  return (value || '')
    .replace(/[*~:^|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

/**
 * ISA/GS..GE/IEA around already-built ST..SE sets. ISA11 '^' repetition, ISA16 ':' component.
 * functionalId: HS (270), HR (276). version: 005010X279A1 / 005010X212.
 */
export function wrapEnvelope(
  sets: string[][],
  opts: { functionalId: string; version: string; controlNumber: number; now: Date; cfg: EnvelopeConfig }
): string {
  const { now, cfg, controlNumber } = opts;
  const isaCtrl = pad(controlNumber % 1_000_000_000, 9);
  const segs: string[] = [];
  segs.push(
    `ISA*00*          *00*          *ZZ*${cfg.submitterId.padEnd(15).slice(0, 15)}*ZZ*${cfg.receiverId.padEnd(15).slice(0, 15)}*${x12Date(now).slice(2)}*${x12Time(now)}*^*00501*${isaCtrl}*0*${cfg.usageIndicator}*:`
  );
  segs.push(`GS*${opts.functionalId}*${cfg.submitterId}*${cfg.receiverId}*${x12Date(now)}*${x12Time(now)}*${controlNumber}*X*${opts.version}`);
  for (const set of sets) segs.push(...set);
  segs.push(`GE*${sets.length}*${controlNumber}`);
  segs.push(`IEA*1*${isaCtrl}`);
  return segs.join('~\n') + '~';
}

/** Adds SE with the segment count (ST..SE inclusive). */
export function closeSet(st: string[], stCtrl: string): string[] {
  return [...st, `SE*${st.length + 1}*${stCtrl}`];
}

export function genderCode(raw: string | null | undefined): 'M' | 'F' | 'U' {
  const g = (raw || '').trim().toLowerCase();
  if (g === 'm' || g === 'male' || g === 'man') return 'M';
  if (g === 'f' || g === 'female' || g === 'woman') return 'F';
  return 'U';
}
