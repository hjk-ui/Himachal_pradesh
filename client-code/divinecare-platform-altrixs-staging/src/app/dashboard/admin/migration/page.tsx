'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  FileArchive,
  FileSpreadsheet,
  FlaskConical,
  History,
  MapPin,
  Shield,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import {
  Alert,
  Button,
  buttonClasses,
  cx,
  EmptyState,
  FOCUS_RING,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  Tabs,
} from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { PLATFORMS, type MigrationPlatform } from '@/lib/migration/platforms';
import { valantDiagnosisPatientId } from '@/lib/migration/valantDiagnoses';
import { ValantReferenceImport, type ReferenceReport } from './ValantReferenceImport';
import { ValantTransactionsImport } from './ValantTransactionsImport';
import { ValantFeeScheduleImport } from './ValantFeeScheduleImport';
import { ValantLabRequestTypesImport } from './ValantLabRequestTypesImport';
import { ValantMeasurementTypesImport } from './ValantMeasurementTypesImport';
import { ValantPayersImport } from './ValantPayersImport';
import { ValantFacilitiesImport } from './ValantFacilitiesImport';
import { ValantProviderMap } from './ValantProviderMap';
import { ValantDocumentsImport } from './ValantDocumentsImport';

type Tab =
  | 'clients'
  | 'appointments'
  | 'diagnoses'
  | 'autopay'
  | 'treatment-plans'
  | ReferenceReport
  | 'transactions'
  | 'provider-codes'
  | 'fee-schedule'
  | 'measurement-types'
  | 'insurance-companies'
  | 'facilities'
  | 'lab-request-types'
  | 'documents'
  | 'staff'
  | 'history';

const REFERENCE_TABS: ReferenceReport[] = ['aging', 'insurance-aging', 'combined-aging', 'prepayments', 'copays', 'authorizations'];

type HistoryJob = {
  id: string;
  type?: string;
  kind?: string;
  status?: string;
  platform?: string | null;
  sourcePlatform?: string | null;
  dryRun?: boolean;
  total?: number;
  imported?: number;
  errors?: number;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  createdAt?: string;
  summary?: string | null;
  errorJson?: unknown;
};

const STEPS = ['Select platform', 'Upload CSV', 'Preview & dry-run', 'Import'] as const;

function canMigrate(role?: string | null) {
  return role === 'PRACTICE_DIRECTOR' || role === 'ADMIN';
}

/** Rows of cells. Quoted cells may contain commas, quotes ("") and line breaks (Valant notes do). */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((c) => c.trim())) records.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some((c) => c.trim())) records.push(row);
  return records;
}

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...records] = parseCsvRecords(text);
  if (!header || !records.length) return [];
  const headers = header.map((h) => h.trim());
  return records.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

/** Raw cells per row (Valant reports reuse column names, so header-keyed rows would drop data) */
function parseCsvCells(text: string): string[][] {
  return parseCsvRecords(text)
    .slice(1)
    .map((cells) => cells.map((c) => c.trim()));
}

export default function MigrationPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = canMigrate(user?.role);

  const [tab, setTab] = useState<Tab>('clients');
  // ?tab=facilities (links from the Practice overview) opens that import directly
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'facilities' || t === 'clients' || t === 'transactions' || t === 'provider-codes') setTab(t);
  }, []);
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<MigrationPlatform | null>(null);
  const [showAllPlatforms, setShowAllPlatforms] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [dryResult, setDryResult] = useState<Record<string, unknown> | null>(null);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  // Valant re-import that only updates one group of fields on clients already in Altrixs (never creates):
  // 'facility' = assigned facility (Client.valantFacility); 'contact' = contact & demographics, empty fields only
  const [updateScope, setUpdateScope] = useState<'' | 'facility' | 'contact'>('');
  const [progress, setProgress] = useState<{ dryRun: boolean; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [apptRows, setApptRows] = useState<string[][]>([]);
  const [apptFile, setApptFile] = useState('');
  const [apptDry, setApptDry] = useState<Record<string, unknown> | null>(null);
  const [apptResult, setApptResult] = useState<Record<string, unknown> | null>(null);

  const [dxRows, setDxRows] = useState<string[][]>([]);
  const [dxFile, setDxFile] = useState('');
  const [dxDry, setDxDry] = useState<Record<string, unknown> | null>(null);
  const [dxResult, setDxResult] = useState<Record<string, unknown> | null>(null);

  const [apRows, setApRows] = useState<Record<string, string>[]>([]);
  const [apFile, setApFile] = useState('');
  const [apDry, setApDry] = useState<Record<string, unknown> | null>(null);
  const [apResult, setApResult] = useState<Record<string, unknown> | null>(null);

  const [tpRows, setTpRows] = useState<Record<string, string>[]>([]);
  const [tpFile, setTpFile] = useState('');
  const [tpDry, setTpDry] = useState<Record<string, unknown> | null>(null);
  const [tpResult, setTpResult] = useState<Record<string, unknown> | null>(null);

  const [staffRows, setStaffRows] = useState<Record<string, string>[]>([]);
  const [staffFile, setStaffFile] = useState('');
  const [staffResult, setStaffResult] = useState<Record<string, unknown> | null>(null);

  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const data = await apiJson<{ success: true; jobs?: HistoryJob[]; history?: HistoryJob[] }>(
        '/api/migration/history'
      );
      setHistory(data.jobs || data.history || []);
    } catch (err: unknown) {
      setHistory([]);
      setHistoryError(
        err instanceof Error
          ? err.message
          : 'Migration history API not available yet'
      );
    }
  }, []);

  useEffect(() => {
    if (tab === 'history' && allowed) void loadHistory();
  }, [tab, allowed, loadHistory]);

  const previewRows = useMemo(() => rows.slice(0, 8), [rows]);

  const onClientFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setDryResult(null);
    setImportResult(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setFileName(file.name);
    if (parsed.length) setStep(2);
  };

  // Large exports (Valant is ~15k rows) go up in chunks so each request stays small and fast
  const postClientRows = async (dryRun: boolean) => {
    if (!platform) throw new Error('Choose a platform first');
    const CHUNK = 500;
    const sum = { totalRows: 0, skippedRows: 0, validClients: 0, errorClients: 0, imported: 0, updated: 0, teamsSet: 0, warningCount: 0, facilitySet: 0, unchanged: 0, notFound: 0, noFacility: 0, ambiguous: 0, matched: 0, clientsToUpdate: 0, clientsUpdated: 0, changedSinceRead: 0, noSourceId: 0, emailInUse: 0 };
    const scope = platform.id === 'valant' ? updateScope : '';
    // Contact & demographics: per-field counts summed across chunks
    const perField: Record<'filled' | 'formatFixed' | 'conflictsByField' | 'invalid', Record<string, number>> = {
      filled: {}, formatFixed: {}, conflictsByField: {}, invalid: {},
    };
    const conflicts: unknown[] = [];
    const unmatchedIds: string[] = [];
    let columns: unknown = null;
    const unlinkedProviders: Record<string, number> = {};
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    const preview: unknown[] = [];
    const unmatchedLocations = new Set<string>();
    let jobId: string | undefined;
    setProgress({ dryRun, done: 0, total: rows.length });
    for (let offset = 0; offset < rows.length; offset += CHUNK) {
      const data = await apiJson<Record<string, unknown>>('/api/migration/clients', {
        method: 'POST',
        body: JSON.stringify({
          platform: platform.id,
          sourcePlatform: platform.id,
          dryRun,
          rows: rows.slice(offset, offset + CHUNK),
          rowOffset: offset,
          jobId,
          updateExisting: scope ? false : updateExisting,
          ...(scope ? { updateScope: scope } : {}),
        }),
      });
      if (!columns && data.columns) columns = data.columns;
      for (const k of Object.keys(perField) as (keyof typeof perField)[]) {
        for (const [f, n] of Object.entries((data[k] as Record<string, number>) || {})) perField[k][f] = (perField[k][f] || 0) + Number(n);
      }
      if (Array.isArray(data.conflicts) && conflicts.length < 500) conflicts.push(...data.conflicts);
      if (Array.isArray(data.unmatchedIds) && unmatchedIds.length < 200) unmatchedIds.push(...data.unmatchedIds.map(String));
      if (Array.isArray(data.warnings)) warnings.push(...data.warnings);
      for (const [name, n] of Object.entries((data.unlinkedProviders as Record<string, number>) || {})) {
        unlinkedProviders[name] = (unlinkedProviders[name] || 0) + n;
      }
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += Number(data[k] ?? 0);
      if (Array.isArray(data.errors)) errors.push(...data.errors);
      if (Array.isArray(data.preview) && preview.length < 10) preview.push(...data.preview);
      if (Array.isArray(data.unmatchedLocations)) data.unmatchedLocations.forEach((l) => unmatchedLocations.add(String(l)));
      if (typeof data.jobId === 'string') jobId = data.jobId;
      setProgress({ dryRun, done: Math.min(offset + CHUNK, rows.length), total: rows.length });
    }
    return {
      platform: platform.id,
      dryRun,
      ...(scope ? { updateScope: scope } : {}),
      ...sum,
      ...(scope === 'contact' ? { ...perField, conflicts: conflicts.slice(0, 500), unmatchedIds: unmatchedIds.slice(0, 200) } : {}),
      columns,
      unmatchedLocations: [...unmatchedLocations],
      // Providers recorded by name only (no Altrixs staff account matched)
      unlinkedProviders,
      preview: preview.slice(0, 10),
      errors: errors.slice(0, 50),
      warnings: warnings.slice(0, 50),
      jobId: jobId ?? null,
      status: dryRun ? 'dry_run' : sum.errorClients === 0 ? 'success' : sum.imported > 0 ? 'partial' : 'failed',
    };
  };

  const runClientDry = async () => {
    if (!platform || !rows.length) return;
    setBusy(true);
    setError(null);
    try {
      setDryResult(await postClientRows(true));
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dry-run failed (API may still be deploying)');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runClientImport = async () => {
    if (!platform || !rows.length) return;
    const scoped = platform.id === 'valant' && updateScope;
    const what = updateScope === 'contact' ? 'contact & demographic fields' : 'the assigned facility';
    if (!confirm(scoped ? `Update ${what} on patients already in Altrixs from ${rows.length} rows?${updateScope === 'contact' ? ' Only empty fields are filled.' : ''}` : `Import ${rows.length} client rows from ${platform.label}?`)) return;
    setBusy(true);
    setError(null);
    try {
      setImportResult(await postClientRows(false));
    } catch (err: unknown) {
      // Already-imported patients are skipped by source id, so running the import again resumes it
      setError(
        `${err instanceof Error ? err.message : 'Import failed'}. Patients already imported are skipped, so you can run the import again to continue.`
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onStaffFile = async (file: File | null) => {
    if (!file) return;
    setStaffResult(null);
    setError(null);
    const text = await file.text();
    setStaffRows(parseCsv(text));
    setStaffFile(file.name);
  };

  const onApptFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setApptDry(null);
    setApptResult(null);
    setApptRows(parseCsvCells(await file.text()));
    setApptFile(file.name);
  };

  const runApptImport = async (dryRun: boolean) => {
    if (!apptRows.length) return;
    if (!dryRun && !confirm(`Import appointments from ${apptRows.length} rows?`)) return;
    setBusy(true);
    setError(null);
    const CHUNK = 500;
    const counts: Record<string, number> = {};
    const unmatchedProviders: Record<string, number> = {};
    const errors: unknown[] = [];
    const preview: unknown[] = [];
    let jobId: string | undefined;
    try {
      setProgress({ dryRun, done: 0, total: apptRows.length });
      for (let offset = 0; offset < apptRows.length; offset += CHUNK) {
        const data = await apiJson<Record<string, unknown>>('/api/migration/appointments', {
          method: 'POST',
          body: JSON.stringify({ platform: 'valant', dryRun, rows: apptRows.slice(offset, offset + CHUNK), rowOffset: offset, jobId }),
        });
        for (const k of ['totalRows', 'appointments', 'imported', 'cancelled', 'skippedBlockedTime', 'skippedDuplicates', 'errorRows']) {
          counts[k] = (counts[k] || 0) + Number(data[k] ?? 0);
        }
        for (const [name, n] of Object.entries((data.unmatchedProviders as Record<string, number>) || {})) {
          unmatchedProviders[name] = (unmatchedProviders[name] || 0) + n;
        }
        if (Array.isArray(data.errors)) errors.push(...data.errors);
        if (Array.isArray(data.preview) && preview.length < 10) preview.push(...data.preview);
        if (typeof data.jobId === 'string') jobId = data.jobId;
        setProgress({ dryRun, done: Math.min(offset + CHUNK, apptRows.length), total: apptRows.length });
      }
      const result = { dryRun, ...counts, unmatchedProviders, preview: preview.slice(0, 10), errors: errors.slice(0, 50), jobId: jobId ?? null };
      if (dryRun) setApptDry(result);
      else setApptResult(result);
    } catch (err: unknown) {
      setError(
        `${err instanceof Error ? err.message : 'Appointment import failed'}${dryRun ? '' : '. Appointments already imported are skipped, so you can run the import again to continue.'}`
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onDxFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setDxDry(null);
    setDxResult(null);
    setDxRows(parseCsvCells(await file.text()));
    setDxFile(file.name);
  };

  // A patient's primary diagnosis depends on all of their rows, so chunks never split a patient
  const dxChunks = useMemo(() => {
    const groups = new Map<string, { offset: number; rows: string[][] }>();
    dxRows.forEach((cells, i) => {
      const key = valantDiagnosisPatientId(cells) ?? `row-${i}`;
      const g = groups.get(key) ?? { offset: i, rows: [] };
      g.rows.push(cells);
      groups.set(key, g);
    });
    const chunks: { offset: number; rows: string[][] }[] = [];
    for (const g of groups.values()) {
      const last = chunks[chunks.length - 1];
      if (last && last.rows.length + g.rows.length <= 1500) last.rows.push(...g.rows);
      else chunks.push({ offset: g.offset, rows: [...g.rows] });
    }
    return chunks;
  }, [dxRows]);

  const runDxImport = async (dryRun: boolean) => {
    if (!dxRows.length) return;
    if (!dryRun && !confirm(`Replace diagnoses for the patients in ${dxFile}?`)) return;
    setBusy(true);
    setError(null);
    const counts: Record<string, number> = {};
    const errors: unknown[] = [];
    const preview: unknown[] = [];
    let jobId: string | undefined;
    let done = 0;
    try {
      setProgress({ dryRun, done: 0, total: dxRows.length });
      for (const chunk of dxChunks) {
        const data = await apiJson<Record<string, unknown>>('/api/migration/diagnoses', {
          method: 'POST',
          body: JSON.stringify({ platform: 'valant', dryRun, rows: chunk.rows, rowOffset: chunk.offset, jobId }),
        });
        for (const k of ['totalRows', 'diagnoses', 'patients', 'updated', 'wouldUpdate', 'unchanged', 'replacedExisting', 'patientsNotFound', 'errorRows']) {
          counts[k] = (counts[k] || 0) + Number(data[k] ?? 0);
        }
        if (Array.isArray(data.errors)) errors.push(...data.errors);
        if (Array.isArray(data.preview) && preview.length < 10) preview.push(...data.preview);
        if (typeof data.jobId === 'string') jobId = data.jobId;
        done += chunk.rows.length;
        setProgress({ dryRun, done, total: dxRows.length });
      }
      const result = { dryRun, ...counts, preview: preview.slice(0, 10), errors: errors.slice(0, 50), jobId: jobId ?? null };
      if (dryRun) setDxDry(result);
      else setDxResult(result);
    } catch (err: unknown) {
      setError(
        `${err instanceof Error ? err.message : 'Diagnosis import failed'}${dryRun ? '' : '. Running the import again is safe: patients already up to date are left unchanged.'}`
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Valant's payment plan grid downloads as Excel; CSV works too
  const onApFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setApDry(null);
    setApResult(null);
    let records: string[][];
    if (/\.xlsx?$/i.test(file.name)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      records = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } else {
      records = parseCsvRecords(await file.text());
    }
    const headerAt = records.findIndex((r) => r.some((c) => /^patient id$/i.test(String(c).trim())));
    if (headerAt < 0) {
      setApRows([]);
      setApFile('');
      setError('No "Patient ID" column found. Export the Valant payment plan grid.');
      return;
    }
    const header = records[headerAt].map((h) => String(h).trim());
    setApRows(
      records
        .slice(headerAt + 1)
        .filter((r) => r.some((c) => String(c).trim()))
        .map((r) => Object.fromEntries(header.map((h, i) => [h, String(r[i] ?? '').trim()])))
    );
    setApFile(file.name);
  };

  const runApImport = async (dryRun: boolean) => {
    if (!apRows.length) return;
    if (!dryRun && !confirm(`Import the autopay plans in ${apFile}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Record<string, unknown>>('/api/migration/autopay', {
        method: 'POST',
        body: JSON.stringify({ platform: 'valant', dryRun, rows: apRows }),
      });
      if (dryRun) setApDry(data);
      else setApResult(data);
    } catch (err: unknown) {
      setError(
        `${err instanceof Error ? err.message : 'Autopay import failed'}${dryRun ? '' : '. Running the import again is safe: each patient keeps one plan.'}`
      );
    } finally {
      setBusy(false);
    }
  };

  // Valant's treatment plan grid downloads as Excel; CSV works too
  const onTpFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setTpDry(null);
    setTpResult(null);
    let records: string[][];
    if (/\.xlsx?$/i.test(file.name)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      records = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } else {
      records = parseCsvRecords(await file.text());
    }
    const headerAt = records.findIndex((r) => r.some((c) => /^patient id$/i.test(String(c).trim())));
    if (headerAt < 0 || !records[headerAt].some((c) => /^next review$/i.test(String(c).trim()))) {
      setTpRows([]);
      setTpFile('');
      setError('No "Patient ID" and "Next Review" columns found. Export the Valant treatment plan grid.');
      return;
    }
    const header = records[headerAt].map((h) => String(h).trim());
    setTpRows(
      records
        .slice(headerAt + 1)
        .filter((r) => r.some((c) => String(c).trim()))
        .map((r) => Object.fromEntries(header.map((h, i) => [h, String(r[i] ?? '').trim()])))
    );
    setTpFile(file.name);
  };

  const runTpImport = async (dryRun: boolean) => {
    if (!tpRows.length) return;
    if (!dryRun && !confirm(`Import the treatment plans in ${tpFile}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Record<string, unknown>>('/api/migration/treatment-plans', {
        method: 'POST',
        body: JSON.stringify({ platform: 'valant', dryRun, rows: tpRows }),
      });
      if (dryRun) setTpDry(data);
      else setTpResult(data);
    } catch (err: unknown) {
      setError(
        `${err instanceof Error ? err.message : 'Treatment plan import failed'}${dryRun ? '' : '. Running the import again is safe: each patient keeps one imported plan.'}`
      );
    } finally {
      setBusy(false);
    }
  };

  const runStaffImport = async (dryRun: boolean) => {
    if (!staffRows.length) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<Record<string, unknown>>('/api/migration/staff', {
        method: 'POST',
        body: JSON.stringify({ dryRun, rows: staffRows }),
      });
      setStaffResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Staff import failed');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <LoadingState className="min-h-[40vh]" label="Loading…" />
    );
  }

  if (!allowed) {
    return (
      <Page width="narrow">
        <PageHeader title="Admin access required" />
        <Alert tone="danger" icon={<Shield />}>
          EHR data migration is limited to Practice Director and Clinic Admin.
        </Alert>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Data import"
        badges={
          <StatusBadge tone="success" icon={<Shield />}>
            HIPAA
          </StatusBadge>
        }
        description="Import clients and staff from your previous EHR. Dry-run first, then commit to Postgres."
      />

      <Alert tone="brand" title="Business Associate Agreement (BAA)">
        Uploaded CSV files may contain PHI. Use only on a secure clinic workstation. Altrixs processes
        migration data under your organization&apos;s BAA. Do not email PHI exports. Prefer dry-run
        before a live import. Temporary staff passwords are issued as INVITED accounts.
      </Alert>

      <Tabs
        variant="pill"
        label="Import type"
        controlsPanels={false}
        className="flex-wrap"
        value={tab}
        onChange={setTab}
        items={(
          [
            { id: 'clients' as const, label: 'Import Clients', icon: Users },
            { id: 'appointments' as const, label: 'Import Appointments', icon: CalendarDays },
            { id: 'diagnoses' as const, label: 'Import Diagnoses', icon: ClipboardList },
            { id: 'autopay' as const, label: 'Import Autopay', icon: CreditCard },
            { id: 'treatment-plans' as const, label: 'Import Treatment Plans', icon: ClipboardCheck },
            { id: 'aging' as const, label: 'Import Aging Summary', icon: FileSpreadsheet },
            { id: 'insurance-aging' as const, label: 'Import Insurance Aging', icon: FileSpreadsheet },
            { id: 'combined-aging' as const, label: 'Import Combined Aging', icon: FileSpreadsheet },
            { id: 'prepayments' as const, label: 'Import Prepayments', icon: Wallet },
            { id: 'copays' as const, label: 'Import Copays', icon: CreditCard },
            { id: 'transactions' as const, label: 'Import Transactions', icon: FileSpreadsheet },
            { id: 'provider-codes' as const, label: 'Valant Provider Codes', icon: Users },
            { id: 'authorizations' as const, label: 'Import Authorizations', icon: Shield },
            { id: 'fee-schedule' as const, label: 'Import Fee Schedule', icon: Wallet },
            { id: 'measurement-types' as const, label: 'Import Measurement Types', icon: Activity },
            { id: 'insurance-companies' as const, label: 'Import Insurance Companies', icon: ClipboardList },
            { id: 'facilities' as const, label: 'Import Facilities', icon: MapPin },
            { id: 'lab-request-types' as const, label: 'Import Lab Request Types', icon: FlaskConical },
            { id: 'documents' as const, label: 'Valant documents (ZIP)', icon: FileArchive },
            { id: 'staff' as const, label: 'Import Staff', icon: Upload },
            { id: 'history' as const, label: 'Import History', icon: History },
          ] as const
        ).map((t) => ({ key: t.id, label: t.label, icon: <t.icon /> }))}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {tab === 'clients' ? (
        <div className="space-y-5">
          <ol className="flex flex-wrap gap-2">
            {STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? 'step' : undefined}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  i === step
                    ? 'bg-blue-600 text-white'
                    : i < step
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px]">
                  {i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>

          {step === 0 || !platform ? (
            <div>
              <p className="mb-3 text-sm font-semibold text-slate-700">
                Choose your previous EHR platform
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(showAllPlatforms
                  ? PLATFORMS
                  : PLATFORMS.filter((p) => p.popular)
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPlatform(p);
                      setStep(1);
                      setRows([]);
                      setDryResult(null);
                      setImportResult(null);
                    }}
                    className={cx(
                      'rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-blue-300 hover:shadow-sm',
                      FOCUS_RING,
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{p.label}</span>
                      {p.popular ? (
                        <StatusBadge tone="success" size="sm">
                          Popular
                        </StatusBadge>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">{p.note}</p>
                    <p className="mt-2 text-[11px] font-medium text-slate-500">{p.exportHint}</p>
                  </button>
                ))}
              </div>
              {!showAllPlatforms ? (
                <Button variant="ghost" className="mt-4" onClick={() => setShowAllPlatforms(true)}>
                  Show all 10 platforms
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button variant="ghost" className="mt-4" onClick={() => setShowAllPlatforms(false)}>
                  Show popular only
                </Button>
              )}
            </div>
          ) : null}

          {platform && step >= 1 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {platform.label}
                    <button
                      type="button"
                      className={cx('ml-2 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                      onClick={() => {
                        setPlatform(null);
                        setStep(0);
                      }}
                    >
                      Change
                    </button>
                  </p>
                  <p className="text-xs text-slate-500">{platform.exportHint}</p>
                </div>
              </div>

              {step === 1 || (step >= 1 && !rows.length) ? (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
                  <FileSpreadsheet className="mb-2 text-slate-500" size={28} />
                  <p className="text-sm font-semibold text-slate-900">Upload client CSV</p>
                  <p className="mt-1 text-xs text-slate-500">Parsed in your browser — PHI stays local until import</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(e) => void onClientFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              ) : null}

              {rows.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-900">{rows.length}</span> rows from{' '}
                    <span className="font-semibold">{fileName}</span>
                  </p>
                  <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                        <tr>
                          {Object.keys(previewRows[0] || {})
                            .slice(0, 8)
                            .map((h) => (
                              <th key={h} scope="col" className="whitespace-nowrap px-4 py-3">
                                {h}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewRows.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {Object.keys(previewRows[0] || {})
                              .slice(0, 8)
                              .map((h) => (
                                <td key={h} className="max-w-[140px] truncate px-4 py-3 text-slate-700">
                                  {row[h]}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      checked={updateExisting && !(platform?.id === 'valant' && updateScope)}
                      disabled={platform?.id === 'valant' && !!updateScope}
                      onChange={(e) => {
                        setUpdateExisting(e.target.checked);
                        setDryResult(null);
                      }}
                    />
                    <span>
                      Update patients already imported from {platform?.label ?? 'this platform'} (matched by their ID
                      there). Overwrites demographics, status and clinic with the file&apos;s values and leaves blank
                      fields alone.
                    </span>
                  </label>
                  {platform?.id === 'valant' ? (
                    <fieldset className="space-y-2 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
                      <legend className="px-1 text-xs font-semibold text-slate-600">Update scope</legend>
                      {(
                        [
                          ['', 'Full import: create new patients (and update existing ones if the box above is checked).'],
                          [
                            'facility',
                            "Facility only: record each patient's Valant assigned facility (Assigned Fac Id / Assigned Fac Name) on patients already in Altrixs. Nothing else changes. Used by the Practice overview \"By facility\".",
                          ],
                          [
                            'contact',
                            'Contact & demographics only: fill address (incl. ZIP), phones, email, sex / SOGI, race, ethnicity, language, marital status, emergency contact, guardian, guarantor, Medicaid ID, middle name and suffix on patients already in Altrixs. Only empty fields are filled; a different value already on the chart is listed as a conflict for review, never overwritten. Legal name and date of birth are never changed.',
                          ],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value || 'full'} className="flex items-start gap-2">
                          <input
                            type="radio"
                            name="clientUpdateScope"
                            className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-blue-600 focus:ring-blue-600"
                            checked={updateScope === value}
                            onChange={() => {
                              setUpdateScope(value);
                              setDryResult(null);
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                      {updateScope ? (
                        <p className="text-xs text-slate-500">
                          Matched by Valant patient ID. No patient is created; blank cells never clear a value; running it again changes nothing.
                        </p>
                      ) : null}
                    </fieldset>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runClientDry()}
                      className={buttonClasses({ variant: 'secondary' })}
                    >
                      {progress?.dryRun ? `Checking ${progress.done} / ${progress.total}…` : 'Run dry-run'}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !dryResult}
                      onClick={() => void runClientImport()}
                      className={buttonClasses()}
                    >
                      {progress && !progress.dryRun ? `Importing ${progress.done} / ${progress.total}…` : platform?.id === 'valant' && updateScope ? 'Update patients' : 'Import clients'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRows([]);
                        setFileName('');
                        setDryResult(null);
                        setImportResult(null);
                        setStep(1);
                      }}
                      className={buttonClasses({ variant: 'ghost' })}
                    >
                      Clear file
                    </button>
                  </div>

                  {dryResult ? (
                    <>
                      <ColumnsPanel data={dryResult} />
                      {dryResult.updateScope === 'contact' ? <ContactSummary data={dryResult} dryRun /> : null}
                      <ResultBox title="Dry-run result" data={dryResult} />
                    </>
                  ) : null}
                  {importResult ? (
                    <>
                      {importResult.updateScope === 'contact' ? <ContactSummary data={importResult} /> : null}
                      <ResultBox title="Import result" data={importResult} success />
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'appointments' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Valant appointments</h2>
            <p className="text-xs text-slate-500">
              Upload the Valant &quot;Appointments between …&quot; report exported as CSV. Import Valant clients first:
              patients are matched by their Valant ID. Provider blocked time (NON-PATIENT) is skipped, and no
              reminders or booking messages are sent.
            </p>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
            <Upload className="mb-2 text-slate-500" size={24} />
            <p className="text-sm font-semibold text-slate-900">Upload appointments CSV</p>
            {apptFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {apptFile} · {apptRows.length} rows
              </p>
            ) : null}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void onApptFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {apptRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runApptImport(true)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                {progress?.dryRun ? `Checking ${progress.done} / ${progress.total}…` : 'Run dry-run'}
              </button>
              <button
                type="button"
                disabled={busy || !apptDry}
                onClick={() => void runApptImport(false)}
                className={buttonClasses()}
              >
                {progress && !progress.dryRun ? `Importing ${progress.done} / ${progress.total}…` : 'Import appointments'}
              </button>
            </div>
          ) : null}

          {apptDry ? <ResultBox title="Dry-run result" data={apptDry} /> : null}
          {apptResult ? <ResultBox title="Import result" data={apptResult} success /> : null}
        </div>
      ) : null}

      {tab === 'diagnoses' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Valant diagnoses</h2>
            <p className="text-xs text-slate-500">
              Upload the Valant &quot;Diagnoses - Patient&quot; report exported as CSV. Import Valant clients first:
              patients are matched by their Valant ID. Each patient&apos;s diagnoses replace what the chart has. The
              first F code becomes the primary diagnosis (the first code listed when there is no F code), and the
              other codes become secondary diagnoses.
            </p>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
            <Upload className="mb-2 text-slate-500" size={24} />
            <p className="text-sm font-semibold text-slate-900">Upload diagnoses CSV</p>
            {dxFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {dxFile} · {dxRows.length} rows
              </p>
            ) : null}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void onDxFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {dxRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runDxImport(true)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                {progress?.dryRun ? `Checking ${progress.done} / ${progress.total}…` : 'Run dry-run'}
              </button>
              <button
                type="button"
                disabled={busy || !dxDry}
                onClick={() => void runDxImport(false)}
                className={buttonClasses()}
              >
                {progress && !progress.dryRun ? `Importing ${progress.done} / ${progress.total}…` : 'Import diagnoses'}
              </button>
            </div>
          ) : null}

          {dxDry ? <ResultBox title="Dry-run result" data={dxDry} /> : null}
          {dxResult ? <ResultBox title="Import result" data={dxResult} success /> : null}
        </div>
      ) : null}

      {tab === 'autopay' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Valant autopay plans</h2>
            <p className="text-xs text-slate-500">
              Upload the Valant payment plan grid (Excel or CSV). Import Valant clients first: patients are matched by
              their Valant ID. Active and Paused plans are imported; Ended plans and rows without a plan are skipped.
              Balances are kept for reference only and are not posted to the ledger.
            </p>
            <Alert tone="warning" className="mt-3">
              Valant keeps the card numbers with its payment processor, so imported plans cannot charge until each
              patient&apos;s card is captured again in Altrixs.
            </Alert>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
            <Upload className="mb-2 text-slate-500" size={24} />
            <p className="text-sm font-semibold text-slate-900">Upload payment plan file</p>
            {apFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {apFile} · {apRows.length} rows
              </p>
            ) : null}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="sr-only"
              onChange={(e) => void onApFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {apRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runApImport(true)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                {busy ? 'Working…' : 'Run dry-run'}
              </button>
              <button
                type="button"
                disabled={busy || !apDry}
                onClick={() => void runApImport(false)}
                className={buttonClasses()}
              >
                Import autopay plans
              </button>
            </div>
          ) : null}

          {apDry ? <ResultBox title="Dry-run result" data={apDry} /> : null}
          {apResult ? <ResultBox title="Import result" data={apResult} success /> : null}
        </div>
      ) : null}

      {tab === 'treatment-plans' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Valant treatment plans</h2>
            <p className="text-xs text-slate-500">
              Upload the Valant treatment plan grid (Excel or CSV). Import Valant clients and staff first: patients are
              matched by their Valant ID and plan owners by name. Each patient gets one imported plan with its status,
              next review date and owner; running the import again updates that plan. Plans written in Altrixs are not
              changed. Supervisors and other providers who are staff join the patient&apos;s treatment team.
            </p>
            <Alert tone="warning" className="mt-3">
              Valant&apos;s grid has no goals, objectives, interventions or diagnoses. Imported plans say their content
              is in Valant; clinicians rewrite the plan in Altrixs at its next review.
            </Alert>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
            <Upload className="mb-2 text-slate-500" size={24} />
            <p className="text-sm font-semibold text-slate-900">Upload treatment plan file</p>
            {tpFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {tpFile} · {tpRows.length} rows
              </p>
            ) : null}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="sr-only"
              onChange={(e) => void onTpFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {tpRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runTpImport(true)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                {busy ? 'Working…' : 'Run dry-run'}
              </button>
              <button
                type="button"
                disabled={busy || !tpDry}
                onClick={() => void runTpImport(false)}
                className={buttonClasses()}
              >
                Import treatment plans
              </button>
            </div>
          ) : null}

          {tpDry ? <TreatmentPlanCounts data={tpDry} dryRun /> : null}
          {tpDry ? <ResultBox title="Dry-run result" data={tpDry} /> : null}
          {tpResult ? <TreatmentPlanCounts data={tpResult} /> : null}
          {tpResult ? <ResultBox title="Import result" data={tpResult} success /> : null}
        </div>
      ) : null}

      {REFERENCE_TABS.includes(tab as ReferenceReport) ? (
        <ValantReferenceImport key={tab} report={tab as ReferenceReport} />
      ) : null}

      {tab === 'transactions' ? <ValantTransactionsImport /> : null}

      {tab === 'provider-codes' ? <ValantProviderMap /> : null}

      {tab === 'fee-schedule' ? <ValantFeeScheduleImport /> : null}

      {tab === 'measurement-types' ? <ValantMeasurementTypesImport /> : null}
      {tab === 'insurance-companies' ? <ValantPayersImport /> : null}

      {tab === 'facilities' ? <ValantFacilitiesImport /> : null}

      {tab === 'lab-request-types' ? <ValantLabRequestTypesImport /> : null}

      {tab === 'documents' ? <ValantDocumentsImport /> : null}

      {tab === 'staff' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Bulk staff import</h2>
              <p className="text-xs text-slate-500">
                Creates INVITED users with temporary passwords. Download the CSV template first.
              </p>
            </div>
            <a
              href="/api/migration/template/staff"
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <Download size={16} aria-hidden />
              Staff template
            </a>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2">
            <Upload className="mb-2 text-slate-500" size={24} />
            <p className="text-sm font-semibold text-slate-900">Upload staff CSV</p>
            {staffFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {staffFile} · {staffRows.length} rows
              </p>
            ) : null}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void onStaffFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {staffRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runStaffImport(true)}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Dry-run
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runStaffImport(false)}
                className={buttonClasses()}
              >
                Import staff
              </button>
            </div>
          ) : null}

          {staffResult ? <ResultBox title="Staff import" data={staffResult} /> : null}
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Import history</h2>
            <Button variant="ghost" size="sm" onClick={() => void loadHistory()}>
              Refresh
            </Button>
          </div>
          {historyError ? (
            <Alert tone="warning">{historyError}</Alert>
          ) : null}
          {!history.length && !historyError ? (
            <EmptyState
              icon={<History />}
              title="No migration jobs yet"
              description="Dry-runs and imports from every tab are listed here once you run one."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {j.kind || j.type || 'Import'} · {j.sourcePlatform || j.platform || '—'}
                      {j.dryRun ? ' (dry-run)' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {j.createdAt ? new Date(j.createdAt).toLocaleString() : '—'} ·{' '}
                      {j.status || 'done'}
                      {j.summary ? ` · ${j.summary}` : ''}
                    </p>
                  </div>
                  <p className="text-xs font-medium text-slate-600">
                    {j.type === 'clients' ? 'imported or updated' : 'imported'} {j.imported ?? j.createdCount ?? 0} / total {j.total ?? 0} / errors{' '}
                    {j.errors ?? j.errorCount ?? 0}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Page>
  );
}

/** Headline counts for a treatment plan dry run or import */
function TreatmentPlanCounts({ data, dryRun }: { data: Record<string, unknown>; dryRun?: boolean }) {
  const n = (k: string) => (typeof data[k] === 'number' ? (data[k] as number) : 0);
  const unlinked = data.unlinkedOwners && typeof data.unlinkedOwners === 'object' ? Object.keys(data.unlinkedOwners) : [];
  const items = [
    { label: dryRun ? 'Plans to create' : 'Plans created', value: n(dryRun ? 'wouldCreate' : 'created') },
    { label: dryRun ? 'Plans to update' : 'Plans updated', value: n(dryRun ? 'wouldUpdate' : 'updated') },
    { label: 'Patients not found', value: n('patientsNotFound') },
    { label: 'Owners not linked', value: n('ownersNotLinked') },
    { label: dryRun ? 'Team members to add' : 'Team members added', value: n(dryRun ? 'wouldAddTeamMembers' : 'teamMembersAdded') },
    { label: 'Errors', value: n('errorRows') },
  ];
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <p className="mb-2 text-sm font-semibold text-slate-900">{dryRun ? 'Dry run (nothing written)' : 'Import complete'}</p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{i.label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{i.value}</dd>
          </div>
        ))}
      </dl>
      {unlinked.length ? (
        <p className="mt-2 text-xs text-slate-600">
          Owners with no matching staff account (plan saved without a clinician): {unlinked.join('; ')}
        </p>
      ) : null}
    </div>
  );
}

type ColumnReport = { recognized: { header: string; fields: string[] }[]; ignored: string[] };

/** Which spreadsheet columns the import recognized (and the fields they feed) vs. ignored */
function ColumnsPanel({ data }: { data: Record<string, unknown> }) {
  const cols = data.columns as ColumnReport | null | undefined;
  if (!cols) return null;
  const feeds = (f: string) => cols.recognized.filter((c) => c.fields.includes(f)).map((c) => c.header);
  const key: [string, string[]][] = [
    ['ZIP', feeds('postalCode')],
    ['Phone', [...new Set([...feeds('phone'), ...feeds('phoneMobile'), ...feeds('phoneHome'), ...feeds('phoneWork'), ...feeds('phoneSecondary')])]],
    ['Street address', feeds('addressLine1')],
    ['Patient ID', feeds('sourceId')],
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
      <p className="mb-2 text-sm font-semibold text-slate-900">Spreadsheet columns</p>
      <ul className="mb-2 space-y-0.5">
        {key.map(([label, headers]) => (
          <li key={label}>
            <span className="font-semibold">{label} column:</span>{' '}
            {headers.length ? (
              <span className="text-emerald-700">recognized ({headers.join(', ')})</span>
            ) : (
              <span className="font-semibold text-rose-700">not found in this file</span>
            )}
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Recognized ({cols.recognized.length})</summary>
        <ul className="mt-1 max-h-48 overflow-auto font-mono text-xs">
          {cols.recognized.map((c) => (
            <li key={c.header}>
              {c.header} &rarr; {c.fields.join(', ')}
            </li>
          ))}
        </ul>
      </details>
      <details open={cols.ignored.length > 0}>
        <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Ignored, not recognized ({cols.ignored.length})</summary>
        {cols.ignored.length ? (
          <>
            <p className="mt-1 text-xs text-slate-500">
              These headers match no field, so their data is not imported. Send the list to support to add an alias if one should be used.
            </p>
            <ul className="mt-1 max-h-48 overflow-auto font-mono text-xs">
              {cols.ignored.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </>
        ) : null}
      </details>
    </div>
  );
}

/** Contact & demographics re-import: per-field fills, format fixes, conflicts and invalid values */
function ContactSummary({ data, dryRun }: { data: Record<string, unknown>; dryRun?: boolean }) {
  const n = (k: string) => Number(data[k] ?? 0);
  const m = (k: string) => (data[k] as Record<string, number>) || {};
  const filled = m('filled');
  const fixed = m('formatFixed');
  const conflicts = m('conflictsByField');
  const invalid = m('invalid');
  const fields = [...new Set([...Object.keys(filled), ...Object.keys(fixed), ...Object.keys(conflicts), ...Object.keys(invalid)])].sort();
  const list = (data.conflicts as { clientId: string; mrn: string | null; field: string }[]) || [];
  const unmatched = (data.unmatchedIds as string[]) || [];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
      <p className="mb-2 text-sm font-semibold text-slate-900">{dryRun ? 'Contact & demographics: dry run (nothing written)' : 'Contact & demographics: update complete'}</p>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Patients matched', n('matched')],
          [dryRun ? 'Patients to update' : 'Patients updated', dryRun ? n('clientsToUpdate') : n('clientsUpdated')],
          ['Rows with nothing new', n('unchanged')],
          ['Valant IDs not in Altrixs', n('notFound')],
          ['IDs matching several patients', n('ambiguous')],
          ['Rows without a Valant ID', n('noSourceId')],
          ['Emails already on another patient', n('emailInUse')],
          ...(dryRun ? [] : [['Changed by someone else meanwhile (re-run)', n('changedSinceRead')] as [string, number]]),
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      {fields.length ? (
        <div className="clinic-scroll-x mb-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Field</th>
                <th scope="col" className="px-3 py-2 text-right">{dryRun ? 'Would fill' : 'Filled'}</th>
                <th scope="col" className="px-3 py-2 text-right">Format fixes</th>
                <th scope="col" className="px-3 py-2 text-right">Conflicts</th>
                <th scope="col" className="px-3 py-2 text-right">Invalid (not written)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map((f) => (
                <tr key={f} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono">{f}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{filled[f] ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fixed[f] ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{conflicts[f] ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{invalid[f] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-3 text-slate-500">No contact or demographic values to fill.</p>
      )}
      {list.length ? (
        <details className="mb-2">
          <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Conflicts for staff review ({list.length}{list.length >= 500 ? '+' : ''})</summary>
          <p className="mt-1 text-xs text-slate-500">The chart already has a different value; it was kept. Compare with Valant and correct the chart if needed.</p>
          <ul className="mt-1 max-h-48 overflow-auto font-mono text-xs">
            {list.map((c, i) => (
              <li key={i}>
                MRN {c.mrn ?? '(none)'} &middot; {c.field} &middot; client {c.clientId}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {unmatched.length ? (
        <details>
          <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Valant IDs not in Altrixs ({n('notFound')})</summary>
          <p className="mt-1 break-words font-mono text-xs">{unmatched.join(', ')}</p>
        </details>
      ) : null}
    </div>
  );
}

function ResultBox({
  title,
  data,
  success,
}: {
  title: string;
  data: Record<string, unknown>;
  success?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-xs ${
        success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        {success ? <CheckCircle2 size={16} aria-hidden /> : null}
        {title}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
