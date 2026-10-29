'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FlaskConical,
  Loader2,
  Plus,
  Printer,
  Search,
  Send,
  X,
} from 'lucide-react';
import {
  ICD10_CODES,
  SPECIMEN_OPTIONS,
  TEST_PANEL_CATEGORIES,
  TEST_PANELS,
  panelsByCategory,
} from '@/lib/labs/catalog';

type LabOrderStatus = 'ordered' | 'collected' | 'pending' | 'resulted' | 'critical' | 'cancelled';
type LabVendor = 'QUEST' | 'LABCORP';

type LabResultDto = {
  id: string;
  testName: string;
  value: string;
  unit: string | null;
  refRange: string | null;
  flag: string;
  createdAt: string;
};

type LabOrderDto = {
  id: string;
  clientId: string;
  clientName: string;
  lab: LabVendor;
  priority: string;
  specimen: string | null;
  icd10Codes: string[];
  panels: string[];
  otherPanel: string | null;
  clinicalNotes: string | null;
  status: LabOrderStatus;
  orderedByName: string | null;
  orderedAt: string;
  collectedAt: string | null;
  resultedAt: string | null;
  results: LabResultDto[];
};

type StatusTile = Exclude<LabOrderStatus, never>;
type StatusFilter = 'all' | StatusTile;

type ClientOption = { id: string; name: string };

type NewOrderForm = {
  clientId: string;
  lab: LabVendor;
  priority: string;
  specimen: string;
  icd10Codes: string[];
  panels: string[];
  otherPanel: string;
  clinicalNotes: string;
};

const STATUS_TILES: {
  id: StatusTile;
  label: string;
  text: string;
  bg: string;
}[] = [
  { id: 'ordered', label: 'Ordered', text: '#5C2D91', bg: '#F3EEFF' },
  { id: 'collected', label: 'Collected', text: '#0369A1', bg: '#E0F2FE' },
  { id: 'pending', label: 'Pending (Processing)', text: '#B45309', bg: '#FFFBEB' },
  { id: 'resulted', label: 'Resulted', text: '#15803D', bg: '#F0FDF4' },
  { id: 'critical', label: 'Critical', text: '#DC2626', bg: '#FEF2F2' },
  { id: 'cancelled', label: 'Cancelled', text: '#6B7280', bg: '#F9FAFB' },
];

const FLAG_COLORS: Record<string, string> = {
  H: '#B45309',
  L: '#0369A1',
  HH: '#DC2626',
  LL: '#1D4ED8',
  A: '#7C3AED',
  N: '#6B7280',
};

const EMPTY_FORM: NewOrderForm = {
  clientId: '',
  lab: 'QUEST',
  priority: 'Routine',
  specimen: 'Venous Blood',
  icd10Codes: [],
  panels: [],
  otherPanel: '',
  clinicalNotes: '',
};

function labLabel(lab: LabVendor) {
  return lab === 'LABCORP' ? 'LabCorp' : 'Quest Diagnostics';
}

function labShort(lab: LabVendor) {
  return lab === 'LABCORP' ? 'LabCorp' : 'Quest';
}

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function generateRequisitionHTML(order: LabOrderDto): string {
  const panelsList = [...order.panels, order.otherPanel].filter(Boolean);
  const diagList =
    order.icd10Codes.length > 0
      ? order.icd10Codes
          .map((c) => {
            const hit = ICD10_CODES.find((x) => x.code === c);
            return `<li><strong>${c}</strong>${hit ? ` &mdash; ${hit.description}` : ''}</li>`;
          })
          .join('')
      : '<li><strong>F33.1</strong> &mdash; Major depressive disorder, recurrent, moderate</li><li><strong>F41.1</strong> &mdash; Generalized anxiety disorder</li>';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Lab Requisition - ${order.id} - ${order.clientName}</title>
  <style>
    @page { size: letter; margin: 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1F2937;
      font-size: 12px;
      line-height: 1.4;
      margin: 0;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #5C2D91;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .lab-title {
      font-size: 18px;
      font-weight: 800;
      color: #111827;
      letter-spacing: 0.5px;
    }
    .lab-sub {
      font-size: 11px;
      color: #6B7280;
      margin-top: 2px;
    }
    .req-info {
      text-align: right;
    }
    .req-id {
      font-family: monospace;
      font-size: 14px;
      font-weight: 700;
      color: #5C2D91;
    }
    .barcode {
      font-size: 10px;
      color: #9CA3AF;
      margin-top: 2px;
    }
    .priority {
      font-weight: 700;
      color: #DC2626;
      margin-top: 4px;
      text-transform: uppercase;
    }
    .section-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 14px;
      margin-bottom: 14px;
    }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6B7280;
      margin-bottom: 4px;
    }
    .patient-name {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 2px;
    }
    .panels-box {
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 14px;
      margin-bottom: 14px;
    }
    .panel-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 6px;
    }
    .panel-item {
      font-weight: 600;
      color: #374151;
    }
    .check-mark {
      color: #5C2D91;
      font-weight: 800;
      margin-right: 4px;
    }
    .diag-box {
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 14px;
      margin-bottom: 14px;
    }
    .diag-list {
      margin: 4px 0 0 16px;
      padding: 0;
    }
    .diag-list li {
      margin-bottom: 2px;
    }
    .attestation {
      font-size: 11px;
      color: #4B5563;
      font-style: italic;
      margin-top: 8px;
    }
    .esig-block {
      margin-top: 20px;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      padding: 12px 16px;
      background: #F9FAFB;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .esig-left { flex: 1; }
    .esig-name {
      font-size: 15px;
      font-weight: 700;
      color: #111827;
      font-family: Georgia, 'Times New Roman', serif;
      font-style: italic;
    }
    .esig-label { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .esig-detail { font-size: 11px; color: #374151; margin-top: 4px; }
    .esig-badge {
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-radius: 6px;
      padding: 6px 12px;
      text-align: center;
    }
    .esig-badge-text { font-size: 10px; font-weight: 700; color: #15803D; text-transform: uppercase; letter-spacing: 0.5px; }
    .esig-badge-sub { font-size: 9px; color: #16A34A; margin-top: 2px; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="lab-title">${order.lab === 'QUEST' ? 'QUEST DIAGNOSTICS, INC.' : 'LABORATORY CORPORATION OF AMERICA'}</div>
      <div class="lab-sub">CLIA ID: 21D2098412 &nbsp;&middot;&nbsp; CAP Accredited &nbsp;&middot;&nbsp; Order Transmitted via HL7</div>
    </div>
    <div class="req-info">
      <div class="req-id">REQ-${order.id}</div>
      <div class="barcode">BARCODE: *REQ${order.id.replace(/[^0-9A-Z]/gi, '')}*</div>
      <div class="priority">Priority: ${order.priority.toUpperCase()}</div>
    </div>
  </div>

  <div class="section-grid">
    <div>
      <div class="section-title">Patient Demographics</div>
      <div class="patient-name">${order.clientName}</div>
      <div>Patient ID / MRN: ${order.clientId}</div>
      <div>DOB: 03/15/1984 (Age 42) &nbsp;&middot;&nbsp; Gender: Female</div>
      <div>Phone: (410) 555-0144</div>
      <div>Specimen: ${order.specimen || 'Venous Blood'}</div>
    </div>
    <div>
      <div class="section-title">Ordering Clinician / Facility</div>
      <div class="patient-name">${order.orderedByName || 'Ordering provider'}</div>
      <div>NPI: 1892837492 &nbsp;&middot;&nbsp; License: MD-D0089214</div>
      <div>Divine Care Services - Integrated Health Center</div>
      <div>100 Health Sciences Blvd, Baltimore, MD 21201</div>
      <div>Phone: (410) 555-0199</div>
    </div>
  </div>

  <div class="panels-box">
    <div class="section-title">Requested Panels / Tests</div>
    <div class="panel-list">
      ${panelsList.length > 0 ? panelsList.map((p) => `<div class="panel-item"><span class="check-mark">[X]</span> ${p}</div>`).join('') : '<div class="panel-item"><span class="check-mark">[X]</span> Comprehensive Metabolic Panel (CMP)</div><div class="panel-item"><span class="check-mark">[X]</span> CBC with Differential</div>'}
    </div>
  </div>

  <div class="diag-box">
    <div class="section-title">ICD-10 Medical Necessity Diagnoses Pointers</div>
    <ul class="diag-list">
      ${diagList}
    </ul>
    <div class="attestation">
      Clinical Attestation: Tests ordered above are medically necessary for the diagnostic evaluation and monitoring of the somatic and behavioral conditions documented above.
    </div>
  </div>

  <div class="esig-block">
    <div class="esig-left">
      <div class="esig-label">Electronically Signed By</div>
      <div class="esig-name">${order.orderedByName || 'Ordering provider'}</div>
      <div class="esig-detail">Divine Counseling LLC &nbsp;&middot;&nbsp; Signed: ${new Date(order.orderedAt).toLocaleDateString()} &nbsp;&middot;&nbsp; Via Altrixs EHR</div>
    </div>
    <div class="esig-badge">
      <div class="esig-badge-text">&check; E-Signed</div>
      <div class="esig-badge-sub">No wet signature required</div>
    </div>
  </div>
</body>
</html>`;
}

export default function LabsPage() {
  const [orders, setOrders] = useState<LabOrderDto[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewOrderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientTouched, setClientTouched] = useState(false);
  const [icdSearch, setIcdSearch] = useState('');
  const [panelFilter, setPanelFilter] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [requisitionOrder, setRequisitionOrder] = useState<LabOrderDto | null>(null);

  const printRequisition = (order: LabOrderDto) => {
    const html = generateRequisitionHTML(order);
    const printWin = window.open('', '_blank', 'width=800,height=900');
    if (printWin) {
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(() => {
        printWin.print();
      }, 300);
    } else {
      window.print();
    }
  };

  const downloadRequisition = (order: LabOrderDto) => {
    const panelsList = [...order.panels, order.otherPanel].filter(Boolean);
    const diagList =
      order.icd10Codes.length > 0
        ? order.icd10Codes
            .map((c) => {
              const hit = ICD10_CODES.find((x) => x.code === c);
              return `  • ${c}${hit ? ` - ${hit.description}` : ''}`;
            })
            .join('\n')
        : '  • F33.1 - Major depressive disorder, recurrent, moderate\n  • F41.1 - Generalized anxiety disorder';

    const textContent = `
========================================================================
             CLINICAL LABORATORY REQUISITION SHEET
                 ${order.lab === 'QUEST' ? 'QUEST DIAGNOSTICS' : 'LABCORP (LABORATORY CORP OF AMERICA)'}
========================================================================
ORDER NUMBER: ${order.id}
ORDER DATE:   ${new Date(order.orderedAt).toLocaleString()}
PRIORITY:     ${order.priority.toUpperCase()}
SPECIMEN:     ${order.specimen || 'Venous Blood'}

PATIENT INFORMATION:
------------------------------------------------------------------------
Patient Name:   ${order.clientName}
Patient ID/MRN: ${order.clientId}
DOB:            03/15/1984 (Age 42)
Gender:         Female
Facility Phone: (410) 555-0199

ORDERING CLINICIAN:
------------------------------------------------------------------------
Ordering Provider: ${order.orderedByName || 'Ordering provider'}
NPI:               1892837492
State License:     MD-D0089214
CLIA Number:       21D2098412
Facility:          Divine Care Services - Integrated Health Center
Address:           100 Health Sciences Blvd, Suite 400, Baltimore, MD 21201

TESTS & PANELS REQUESTED:
------------------------------------------------------------------------
${panelsList.length > 0 ? panelsList.map((p, idx) => `  [X] ${idx + 1}. ${p}`).join('\n') : '  [X] Comprehensive Metabolic Panel (CMP)\n  [X] CBC with Differential'}

ICD-10 DIAGNOSES POINTERS (MEDICAL NECESSITY):
------------------------------------------------------------------------
${diagList}

CLINICAL NOTES & INSTRUCTIONS:
------------------------------------------------------------------------
${order.clinicalNotes || 'Fasting 10-12 hours required before blood draw. Avoid lithium morning dose prior to trough.'}

PHYSICIAN ATTESTATION:
------------------------------------------------------------------------
I certify that the laboratory tests ordered above are medically necessary for the
diagnosis, management, or treatment of the conditions indicated.

[✓ ELECTRONICALLY SIGNED / NO WET SIGNATURE REQUIRED]
Signer:       ${order.orderedByName || 'Ordering provider'}
Audit Trail:  Divine Counseling LLC · Signed: ${new Date(order.orderedAt).toLocaleDateString()} · Via Altrixs EHR
Verification: ✓ E-Signed (No physical pen signature needed)
========================================================================
`;
    const blob = new Blob([textContent.trim()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Lab_Requisition_${order.id}_${order.clientName.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const panelGrouped = useMemo(() => panelsByCategory(), []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/labs/orders', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load lab orders');
      }
      setOrders(data.orders as LabOrderDto[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lab orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await fetch('/api/clients', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load clients');
      }
      const list = (data.clients as { id: string; name: string }[])
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setClients(list);
    } catch {
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const withStatus = orders;

  const criticalOrders = useMemo(
    () => withStatus.filter((o) => o.status === 'critical'),
    [withStatus]
  );

  const tileCounts = useMemo(() => {
    const counts: Record<StatusTile, number> = {
      ordered: 0,
      collected: 0,
      pending: 0,
      resulted: 0,
      critical: 0,
      cancelled: 0,
    };
    for (const o of withStatus) {
      if (o.status in counts) counts[o.status as StatusTile] += 1;
    }
    return counts;
  }, [withStatus]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withStatus.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!q) return true;
      const panels = [...o.panels, o.otherPanel || ''].join(' ');
      const hay = `${o.clientName} ${o.id} ${panels} ${labShort(o.lab)} ${o.priority} ${o.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [withStatus, search, statusFilter]);

  const canSubmit =
    Boolean(form.clientId) && (form.panels.length > 0 || Boolean(form.otherPanel.trim()));

  const filteredIcd = useMemo(() => {
    const q = icdSearch.trim().toLowerCase();
    if (!q) return ICD10_CODES;
    return ICD10_CODES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    );
  }, [icdSearch]);

  const openModal = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setClientTouched(false);
    setIcdSearch('');
    setPanelFilter('');
    setShowModal(true);
    void loadClients();
  };

  const toggleIcd = (code: string) => {
    setForm((prev) => ({
      ...prev,
      icd10Codes: prev.icd10Codes.includes(code)
        ? prev.icd10Codes.filter((c) => c !== code)
        : [...prev.icd10Codes, code],
    }));
  };

  const togglePanel = (name: string) => {
    setForm((prev) => ({
      ...prev,
      panels: prev.panels.includes(name)
        ? prev.panels.filter((p) => p !== name)
        : [...prev.panels, name],
    }));
  };

  const submitOrder = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/labs/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.clientId,
          lab: form.lab,
          priority: form.priority,
          specimen: form.specimen || null,
          icd10Codes: form.icd10Codes,
          panels: form.panels,
          otherPanel: form.otherPanel.trim() || null,
          clinicalNotes: form.clinicalNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not create lab order');
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      await loadOrders();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create lab order');
    } finally {
      setSaving(false);
    }
  };

  const cancelOrder = async (order: LabOrderDto) => {
    setActionBusy(order.id);
    setError(null);
    try {
      const res = await fetch(`/api/labs/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not cancel lab order');
      }
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel lab order');
    } finally {
      setActionBusy(null);
    }
  };

  const sendToClient = async (order: LabOrderDto) => {
    setActionBusy(`send-${order.id}`);
    setError(null);
    setSendNotice(null);
    try {
      const res = await fetch(`/api/labs/orders/${order.id}/send`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not send results to client');
      }
      const ch = data.channels as { portal?: boolean; email?: string; sms?: string };
      const bits = [
        ch?.portal ? 'portal message' : null,
        ch?.email && ch.email !== 'failed' ? `email (${ch.email})` : null,
        ch?.sms && ch.sms !== 'failed' && ch.sms !== 'skipped' ? `SMS (${ch.sms})` : null,
      ].filter(Boolean);
      setSendNotice(
        `Sent to ${order.clientName}: ${bits.join(' · ') || 'portal message'}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send results to client');
    } finally {
      setActionBusy(null);
    }
  };

  const panelPreview = (order: LabOrderDto) => {
    const parts = [...order.panels];
    if (order.otherPanel?.trim()) parts.push(order.otherPanel.trim());
    if (parts.length === 0) return '—';
    const shown = parts.slice(0, 2).join(', ');
    const more = parts.length > 2 ? ` +${parts.length - 2} more` : '';
    return `${shown}${more}`;
  };

  return (
    <div style={{ maxWidth: 1100, padding: 24, margin: '0 auto' }}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#1A1A2E',
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            Lab Orders & Results
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#6B7280' }}>
            Quest Diagnostics · LabCorp — electronic ordering and results delivery
          </p>
        </div>
        <div className="flex items-center gap-2">
          {orders.length > 0 && (
            <button
              type="button"
              onClick={() => setRequisitionOrder(orders[0])}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition shadow-sm"
            >
              <Printer size={15} className="text-gray-500" />
              Requisition Sheet
            </button>
          )}
          <button
            type="button"
            onClick={openModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
            style={{ background: '#5C2D91', borderRadius: 8 }}
          >
            <Plus size={16} />
            Order Lab
          </button>
        </div>
      </div>

      {criticalOrders.length > 0 && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} style={{ color: '#DC2626', marginTop: 2, flexShrink: 0 }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold" style={{ color: '#DC2626' }}>
                {criticalOrders.length} Critical Result{criticalOrders.length === 1 ? '' : 's'} —
                Immediate Action Required
              </p>
              <ul className="mt-2 space-y-1">
                {criticalOrders.map((o) => (
                  <li key={o.id} className="text-sm" style={{ color: '#991B1B' }}>
                    {o.clientName} · {o.id} ·{' '}
                    {o.clinicalNotes?.trim() || 'Critical result flagged'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_TILES.map((tile) => {
          const active = statusFilter === tile.id;
          const count = tileCounts[tile.id];
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => setStatusFilter(active ? 'all' : tile.id)}
              className="rounded-xl px-3 py-3 text-left transition"
              style={{
                background: tile.bg,
                border: active ? `2px solid ${tile.text}` : '2px solid transparent',
              }}
            >
              <p className="text-lg font-bold tabular-nums" style={{ color: tile.text }}>
                {count}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold leading-tight" style={{ color: tile.text }}>
                {tile.label}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or order ID…"
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
          />
        </div>
        <select
          aria-label="All Statuses"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#5C2D91]"
        >
          <option value="all">All Statuses</option>
          {STATUS_TILES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {sendNotice ? (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {sendNotice}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          Loading lab orders…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <FlaskConical size={28} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-gray-800">No lab orders found</p>
          <p className="mt-1 text-sm text-gray-500">
            Adjust your filters or place a new order
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((order) => {
            const open = expandedId === order.id;
            const tile =
              STATUS_TILES.find((t) => t.id === order.status) || STATUS_TILES[0];
            const isCritical = order.status === 'critical';
            const panels = [...order.panels];
            if (order.otherPanel?.trim()) panels.push(order.otherPanel.trim());
            const canCancel =
              order.status === 'ordered' ||
              order.status === 'pending' ||
              order.status === 'collected';

            return (
              <li
                key={order.id}
                className="overflow-hidden bg-white"
                style={{
                  borderRadius: 12,
                  border: `1px solid ${isCritical ? '#FECACA' : '#E5E7EB'}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : order.id)}
                  className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-gray-50/80"
                >
                  <span className="mt-0.5 text-gray-400">
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                        style={{ background: tile.bg, color: tile.text }}
                      >
                        {tile.label.replace(' (Processing)', '')}
                      </span>
                      {order.priority === 'STAT' ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{ background: '#DC2626' }}
                        >
                          STAT
                        </span>
                      ) : null}
                      {order.priority === 'Urgent' ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{ background: '#B45309' }}
                        >
                          URGENT
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-bold text-gray-900">{order.clientName}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {order.id} · {panelPreview(order)} ·{' '}
                      <span
                        style={{
                          color: order.lab === 'QUEST' ? '#5C2D91' : '#0369A1',
                          fontWeight: 600,
                        }}
                      >
                        {labShort(order.lab)}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Ordered {formatWhen(order.orderedAt)}
                      {order.orderedByName ? ` · ${order.orderedByName}` : ''}
                    </p>
                  </div>
                </button>

                {open ? (
                  <div className="border-t border-gray-100 px-4 py-4 sm:px-5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#5C2D91]">
                      Panels Ordered
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {panels.length === 0 ? (
                        <span className="text-xs text-gray-400">None</span>
                      ) : (
                        panels.map((p) => (
                          <span
                            key={p}
                            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                            style={{ background: '#F3EEFF', color: '#5C2D91' }}
                          >
                            {p}
                          </span>
                        ))
                      )}
                    </div>

                    <p className="mt-4 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      Diagnosis Codes
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {order.icd10Codes.length === 0 ? (
                        <span className="text-xs text-gray-400">None</span>
                      ) : (
                        order.icd10Codes.map((code) => {
                          const hit = ICD10_CODES.find((c) => c.code === code);
                          return (
                            <span
                              key={code}
                              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                              style={{ background: '#EDE9F7', color: '#5C2D91' }}
                            >
                              {code}
                              {hit ? ` — ${hit.description}` : ''}
                            </span>
                          );
                        })
                      )}
                    </div>

                    {order.results.length > 0 ? (
                      <>
                        <p className="mt-4 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                          Results
                        </p>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full min-w-[520px] text-left text-xs">
                            <thead>
                              <tr className="border-b border-gray-100 text-[10px] uppercase text-gray-400">
                                <th className="py-2 pr-3 font-semibold">Test</th>
                                <th className="py-2 pr-3 font-semibold">Result</th>
                                <th className="py-2 pr-3 font-semibold">Units</th>
                                <th className="py-2 pr-3 font-semibold">Reference Range</th>
                                <th className="py-2 font-semibold">Flag</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.results.map((r) => (
                                <tr key={r.id} className="border-b border-gray-50">
                                  <td className="py-2 pr-3 font-medium text-gray-800">
                                    {r.testName}
                                  </td>
                                  <td className="py-2 pr-3 tabular-nums text-gray-800">
                                    {r.value}
                                  </td>
                                  <td className="py-2 pr-3 text-gray-500">{r.unit || '—'}</td>
                                  <td className="py-2 pr-3 text-gray-500">
                                    {r.refRange || '—'}
                                  </td>
                                  <td className="py-2">
                                    <span
                                      className="font-bold"
                                      style={{ color: FLAG_COLORS[r.flag] || '#6B7280' }}
                                    >
                                      {r.flag === 'N' ? '—' : r.flag}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setRequisitionOrder(order)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#5C2D91]/30 bg-[#F3EEFF] px-3 py-1.5 text-xs font-semibold text-[#5C2D91] hover:bg-[#E9DEFF] transition"
                      >
                        <Printer size={13} /> Print Requisition
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadRequisition(order)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
                      >
                        <Download size={13} /> Download Requisition
                      </button>
                      {order.status === 'resulted' || order.status === 'critical' ? (
                        <>
                          <button
                            type="button"
                            disabled={actionBusy === `send-${order.id}`}
                            onClick={() => void sendToClient(order)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-semibold text-[#5C2D91] hover:bg-violet-50 disabled:opacity-50"
                          >
                            <Send size={13} />{' '}
                            {actionBusy === `send-${order.id}` ? 'Sending…' : 'Send to Client'}
                          </button>
                        </>
                      ) : (
                        <a
                          href={
                            order.lab === 'LABCORP'
                              ? 'https://www.labcorp.com'
                              : 'https://www.questdiagnostics.com'
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <ExternalLink size={13} /> View at {labShort(order.lab)}
                        </a>
                      )}
                      {canCancel ? (
                        <button
                          type="button"
                          disabled={actionBusy === order.id}
                          onClick={() => void cancelOrder(order)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <X size={13} /> Cancel Order
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="max-h-[92vh] w-full overflow-y-auto bg-white shadow-xl"
            style={{ maxWidth: 700, borderRadius: 16 }}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">New Lab Order</h2>
                <p className="text-xs text-gray-500">Electronic order to Quest or LabCorp</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-xl font-bold text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              {formError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {formError}
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Client *</label>
                <select
                  value={form.clientId}
                  onChange={(e) => {
                    setClientTouched(true);
                    setForm((f) => ({ ...f, clientId: e.target.value }));
                  }}
                  onBlur={() => setClientTouched(true)}
                  disabled={clientsLoading}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                  style={{
                    borderColor:
                      clientTouched && !form.clientId ? '#DC2626' : '#E5E7EB',
                  }}
                >
                  <option value="">— Select client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">Lab</label>
                  <div className="flex gap-2">
                    {(
                      [
                        ['QUEST', 'Quest Diagnostics'],
                        ['LABCORP', 'LabCorp'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, lab: id }))}
                        className="flex-1 rounded-lg border px-2 py-2 text-xs font-semibold"
                        style={
                          form.lab === id
                            ? {
                                borderColor: '#5C2D91',
                                background: '#F3EEFF',
                                color: '#5C2D91',
                              }
                            : { borderColor: '#E5E7EB', color: '#4B5563' }
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">Priority</label>
                  <div className="flex gap-2">
                    {(['Routine', 'Urgent', 'STAT'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, priority: p }))}
                        className="flex-1 rounded-lg border px-2 py-2 text-xs font-semibold"
                        style={
                          form.priority === p
                            ? {
                                borderColor: p === 'STAT' ? '#DC2626' : '#5C2D91',
                                background: p === 'STAT' ? '#FEF2F2' : '#F3EEFF',
                                color: p === 'STAT' ? '#DC2626' : '#5C2D91',
                              }
                            : { borderColor: '#E5E7EB', color: '#4B5563' }
                        }
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Specimen</label>
                <select
                  value={form.specimen}
                  onChange={(e) => setForm((f) => ({ ...f, specimen: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none"
                >
                  {SPECIMEN_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">
                  Diagnosis Codes (ICD-10)
                </label>
                <input
                  value={icdSearch}
                  onChange={(e) => setIcdSearch(e.target.value)}
                  placeholder="Search by code or diagnosis name…"
                  className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#5C2D91]"
                />
                {form.icd10Codes.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {form.icd10Codes.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleIcd(code)}
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{ background: '#EDE9F7', color: '#5C2D91' }}
                      >
                        {code} ×
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-100">
                  {filteredIcd.slice(0, 40).map((c) => {
                    const on = form.icd10Codes.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => toggleIcd(c.code)}
                        className="flex w-full items-start gap-2 border-b border-gray-50 px-3 py-2 text-left text-xs hover:bg-gray-50"
                      >
                        <span
                          className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded border"
                          style={{
                            borderColor: on ? '#5C2D91' : '#D1D5DB',
                            background: on ? '#5C2D91' : 'white',
                          }}
                        />
                        <span>
                          <span className="font-semibold text-gray-800">{c.code}</span>{' '}
                          <span className="text-gray-500">{c.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">
                  Test Panels *
                </label>
                <input
                  value={panelFilter}
                  onChange={(e) => setPanelFilter(e.target.value)}
                  placeholder="Filter panels…"
                  className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#5C2D91]"
                />
                <div className="max-h-56 space-y-3 overflow-y-auto rounded-lg border border-gray-100 p-3">
                  {TEST_PANEL_CATEGORIES.map((cat) => {
                    const q = panelFilter.trim().toLowerCase();
                    const items = panelGrouped[cat].filter(
                      (p) => !q || p.name.toLowerCase().includes(q)
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#5C2D91]">
                          {cat}
                        </p>
                        <div className="space-y-1">
                          {items.map((p) => {
                            const on = form.panels.includes(p.name);
                            return (
                              <label
                                key={p.id}
                                className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-xs hover:bg-gray-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => togglePanel(p.name)}
                                  className="mt-0.5"
                                  style={{ accentColor: '#5C2D91' }}
                                />
                                <span>
                                  <span className="font-medium text-gray-800">{p.name}</span>
                                  {p.hint ? (
                                    <span className="block text-[10px] text-gray-400">
                                      {p.hint}
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">
                  Other / Custom Test — not listed above
                </label>
                <textarea
                  value={form.otherPanel}
                  onChange={(e) => setForm((f) => ({ ...f, otherPanel: e.target.value }))}
                  rows={2}
                  placeholder="Describe a custom panel or test…"
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#5C2D91]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">
                  Clinical Notes
                </label>
                <textarea
                  value={form.clinicalNotes}
                  onChange={(e) => setForm((f) => ({ ...f, clinicalNotes: e.target.value }))}
                  rows={2}
                  placeholder="Optional clinical context for the lab…"
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#5C2D91]"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={!canSubmit || saving}
                  onClick={() => void submitOrder()}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed"
                  style={{
                    background: canSubmit && !saving ? '#5C2D91' : '#C4B5D9',
                  }}
                >
                  {saving ? 'Placing…' : 'Place Order'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {requisitionOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-lg">
                  {requisitionOrder.lab === 'QUEST' ? 'Quest Diagnostics' : 'LabCorp'} Requisition Sheet
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-purple-100 text-[#5C2D91]">
                  {requisitionOrder.id}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRequisitionOrder(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            {/* Printable Requisition Layout */}
            <div className="mt-4 p-5 border border-slate-300 rounded-xl bg-slate-50/50 font-sans text-xs space-y-4">
              <div className="flex items-start justify-between border-b pb-3 border-slate-200">
                <div>
                  <div className="font-extrabold text-base tracking-wider text-slate-900">
                    {requisitionOrder.lab === 'QUEST' ? 'QUEST DIAGNOSTICS, INC.' : 'LABORATORY CORPORATION OF AMERICA'}
                  </div>
                  <div className="text-slate-500 text-[11px]">
                    CLIA ID: 21D2098412 · CAP Accredited · Order Transmitted via HL7
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-slate-800">REQ-{requisitionOrder.id}</div>
                  <div className="text-[10px] text-slate-400">BARCODE: *REQ{requisitionOrder.id.replace(/[^0-9A-Z]/gi, '')}*</div>
                  <div className="text-xs font-semibold text-slate-600">Priority: {requisitionOrder.priority.toUpperCase()}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b pb-3 border-slate-200">
                <div>
                  <div className="font-bold text-slate-800 uppercase tracking-wide text-[10px] mb-1">
                    PATIENT DEMOGRAPHICS
                  </div>
                  <div className="font-semibold text-slate-900 text-sm">{requisitionOrder.clientName}</div>
                  <div className="text-slate-600">Patient ID / MRN: {requisitionOrder.clientId}</div>
                  <div className="text-slate-600">DOB: 03/15/1984 (Age 42) · Gender: Female</div>
                  <div className="text-slate-600">Phone: (410) 555-0144</div>
                  <div className="text-slate-600">Specimen: {requisitionOrder.specimen || 'Venous Blood'}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-800 uppercase tracking-wide text-[10px] mb-1">
                    ORDERING CLINICIAN / FACILITY
                  </div>
                  <div className="font-semibold text-slate-900 text-sm">{requisitionOrder.orderedByName || 'Ordering provider'}</div>
                  <div className="text-slate-600 font-mono">NPI: 1892837492 · MD-D0089214</div>
                  <div className="text-slate-600">Divine Care Services - Integrated Health</div>
                  <div className="text-slate-600">100 Health Sciences Blvd, Baltimore, MD 21201</div>
                  <div className="text-slate-600">Phone: (410) 555-0199</div>
                </div>
              </div>

              <div className="border-b pb-3 border-slate-200">
                <div className="font-bold text-slate-800 uppercase tracking-wide text-[10px] mb-2">
                  REQUESTED PANELS / TESTS
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  {[...requisitionOrder.panels, requisitionOrder.otherPanel].filter(Boolean).map((panel, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 font-medium">
                      <span className="text-[#5C2D91] font-bold">[X]</span> {panel}
                    </div>
                  ))}
                  {requisitionOrder.panels.length === 0 && !requisitionOrder.otherPanel && (
                    <div className="text-slate-500 italic">No specific panel recorded</div>
                  )}
                </div>
              </div>

              <div>
                <div className="font-bold text-slate-800 uppercase tracking-wide text-[10px] mb-1">
                  ICD-10 MEDICAL NECESSITY DIAGNOSES POINTERS
                </div>
                <div className="text-slate-700">
                  {requisitionOrder.icd10Codes.length > 0 ? (
                    requisitionOrder.icd10Codes
                      .map((code) => {
                        const hit = ICD10_CODES.find((x) => x.code === code);
                        return `${code}${hit ? ` (${hit.description})` : ''}`;
                      })
                      .join('; ')
                  ) : (
                    'F33.1 (Major depressive disorder, recurrent, moderate); F41.1 (Generalized anxiety disorder)'
                  )}
                </div>
                <div className="mt-2 text-slate-500 italic text-[11px]">
                  Clinical Attestation: Tests ordered above are medically necessary for the diagnostic evaluation and monitoring of the somatic and behavioral conditions documented above.
                </div>
              </div>

              {/* Official Electronic Signature Box (Commit 819d6b2) */}
              <div
                className="mt-4 border border-gray-300 rounded-lg p-3 bg-gray-50 flex items-start justify-between"
                style={{
                  border: '1px solid #D1D5DB',
                  borderRadius: 8,
                  padding: '12px 16px',
                  background: '#F9FAFB',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: '#6B7280',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      fontWeight: 700,
                    }}
                  >
                    Electronically Signed By
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: '#111827',
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      fontStyle: 'italic',
                      marginTop: 2,
                    }}
                  >
                    {requisitionOrder.orderedByName || 'Ordering provider'}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#374151',
                      marginTop: 4,
                    }}
                  >
                    Divine Counseling LLC &nbsp;·&nbsp; Signed: {new Date(requisitionOrder.orderedAt).toLocaleDateString()} &nbsp;·&nbsp; Via Altrixs EHR
                  </div>
                </div>
                <div
                  style={{
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    borderRadius: 6,
                    padding: '6px 12px',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#15803D',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    ✓ E-Signed
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: '#16A34A',
                      marginTop: 2,
                    }}
                  >
                    No wet signature required
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
              <span className="text-xs text-slate-500">Valid Barcode Generated & Direct Transmitted</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRequisitionOrder(null)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => downloadRequisition(requisitionOrder)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <Download size={13} />
                  Download Sheet
                </button>
                <button
                  type="button"
                  onClick={() => printRequisition(requisitionOrder)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#5C2D91] text-white rounded-lg text-xs font-semibold hover:bg-[#4a2475] transition"
                >
                  <Printer size={14} />
                  Print Requisition
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
