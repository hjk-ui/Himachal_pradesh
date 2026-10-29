'use client';

import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

type ImportError = { row: number; field?: string; message: string };

export function PatientBulkTransfer({ onImported }: { onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);

  const exportPatients = async () => {
    setBusy('export');
    setErrors([]);
    try {
      const response = await fetch('/api/clients/bulk-transfer', { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not export patients');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'altrixs-patients.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Patient Excel export downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export patients');
    } finally {
      setBusy(null);
    }
  };

  const importPatients = async (file: File) => {
    if (!window.confirm('Import this workbook? Existing patients with matching Patient ID or Email will be updated.')) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy('import');
    setErrors([]);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/clients/bulk-transfer', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setErrors(Array.isArray(body.errors) ? body.errors : []);
        throw new Error(body.error || 'Could not import patients');
      }
      toast.success(`Imported ${body.total} patients: ${body.created} created, ${body.updated} updated`);
      await onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import patients');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#6868D0] shadow-sm">
            <FileSpreadsheet size={19} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Patient Excel import and export</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">Download all clinic patients, edit the same format, or upload a completed template. Admin only.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={exportPatients} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3.5 text-sm font-semibold text-[#5656B9] transition hover:bg-indigo-50 disabled:opacity-60">
            <Download size={15} />{busy === 'export' ? 'Exporting…' : 'Export Excel'}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => inputRef.current?.click()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#6868D0] px-3.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
            <Upload size={15} />{busy === 'import' ? 'Importing…' : 'Import Excel'}
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPatients(file); }} />
        </div>
      </div>
      {errors.length ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3 text-xs text-rose-700">
          <p className="font-semibold">Spreadsheet errors</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {errors.slice(0, 8).map((error, index) => <li key={`${error.row}-${error.field}-${index}`}>Row {error.row}{error.field ? `, ${error.field}` : ''}: {error.message}</li>)}
          </ul>
          {errors.length > 8 ? <p className="mt-2">Plus {errors.length - 8} more errors.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
