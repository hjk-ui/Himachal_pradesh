/**
 * Valant billing archive (practice billing records from the Valant documents import: ERA exceptions,
 * claims, remittance, EOB). Pure helpers for the list API (src/app/api/billing/valant-archive).
 */

export type BillingArchiveRow = {
  id: string;
  fileName: string;
  payer: string | null;
  documentDate: string | null;
  folder: string | null;
  size: number | null;
  importedAt: string;
  url: string | null;
};

type Field = { label?: unknown; value?: unknown };

export function toBillingArchiveRow(d: {
  id: string; fileName: string | null; fileSize: number | null; s3RawKey: string; extractedFields: unknown; createdAt: Date;
}): BillingArchiveRow {
  const fields = Array.isArray(d.extractedFields) ? (d.extractedFields as Field[]) : [];
  const field = (label: string) => {
    const v = fields.find((f) => f && f.label === label)?.value;
    return typeof v === 'string' && v ? v : null;
  };
  return {
    id: d.id,
    fileName: d.fileName || '(no name)',
    payer: field('Payer'),
    documentDate: field('Document date'),
    folder: field('Valant folder'),
    size: d.fileSize,
    importedAt: d.createdAt.toISOString().slice(0, 10),
    url: d.s3RawKey && d.s3RawKey !== 'pending' ? `/api/files/intake-docs/${d.s3RawKey}` : null,
  };
}

/**
 * Filter by payer / file-name text (case-insensitive) and document date range (YYYY-MM-DD,
 * inclusive). A date filter leaves out rows without a document date. Newest document date first.
 */
export function filterBillingArchive(rows: BillingArchiveRow[], f: { q?: string | null; from?: string | null; to?: string | null }): BillingArchiveRow[] {
  const q = (f.q || '').trim().toLowerCase();
  const out = rows.filter((r) => {
    if (q && !`${r.fileName} ${r.payer ?? ''}`.toLowerCase().includes(q)) return false;
    if (f.from && (!r.documentDate || r.documentDate < f.from)) return false;
    if (f.to && (!r.documentDate || r.documentDate > f.to)) return false;
    return true;
  });
  return out.sort((a, b) => (b.documentDate ?? '').localeCompare(a.documentDate ?? '') || a.fileName.localeCompare(b.fileName));
}
