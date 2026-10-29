/** Trigger a client-side file download from a string payload. */
export function downloadTextFile(
  filename: string,
  contents: string,
  mime = 'text/plain;charset=utf-8'
) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function csvEscape(value: unknown) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Array<Array<unknown>>) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function slugFilename(title: string, ext: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || 'download'}.${ext.replace(/^\./, '')}`;
}
