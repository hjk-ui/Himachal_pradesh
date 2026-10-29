/**
 * Normalize clinic phone strings to E.164. Default country is US (+1) for
 * 10-digit and 11-digit (leading 1) numbers — Maryland clinic default.
 */
export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withPlus = trimmed.replace(/[^\d+]/g, '');
  if (withPlus.startsWith('+')) {
    const n = withPlus.slice(1).replace(/\D/g, '');
    if (n.length < 8 || n.length > 15) return null;
    return `+${n}`;
  }

  const n = trimmed.replace(/\D/g, '');
  if (n.length === 10) return `+1${n}`;
  if (n.length === 11 && n.startsWith('1')) return `+${n}`;
  return null;
}
