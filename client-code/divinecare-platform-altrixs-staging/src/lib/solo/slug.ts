export function slugifyPracticeName(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'practice';
}

export function uniqueSlugCandidate(base: string, taken: Set<string> | string[]) {
  const used = taken instanceof Set ? taken : new Set(taken);
  if (!used.has(base)) return base;
  let n = 1;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export function confirmationCode() {
  return `BC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
