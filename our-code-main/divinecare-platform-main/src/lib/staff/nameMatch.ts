/** Exact, case-insensitive staff name match. "Ann" must not match "Joanne". */
export function nameTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;|/]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function nameTokenMatches(
  haystack: string | null | undefined,
  needle: string | null | undefined
): boolean {
  const target = needle?.trim().toLowerCase();
  if (!target) return false;
  return nameTokens(haystack).some((part) => part === target);
}
