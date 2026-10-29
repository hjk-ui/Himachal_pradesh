'use client';

import React, { useState } from 'react';
import {
  Settings,
  Shield,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Route,
  Building2,
  Globe,
  Clock,
  Zap,
  ToggleLeft,
  ToggleRight,
  FileText,
  Receipt,
  BadgeCheck,
  Info,
  ArrowRightLeft,
  Landmark,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Payers — behavioral health routing (incl. Maryland Medicaid BH carve-out)
// ---------------------------------------------------------------------------

type ClaimRoute = 'aso' | 'direct' | 'selfpay';

interface BhPayer {
  id: string;
  payerId: string;
  name: string;
  short: string;
  type: 'Medicaid' | 'Medicare' | 'Commercial' | 'Self-Pay';
  route: ClaimRoute;
  routeNote: string;
  clearinghouse: string;
  portal: string;
  timely: number; // days
  active: boolean;
}

const INITIAL_PAYERS: BhPayer[] = [
  {
    id: 'bp1', payerId: 'OMDBH', name: 'Optum Maryland (BH ASO) — Maryland Medicaid', short: 'Optum MD',
    type: 'Medicaid', route: 'aso',
    routeNote: 'CARVE-OUT: All Maryland Medicaid behavioral health claims route to the ASO (Optum Maryland / Incedo) — NOT the HealthChoice MCO. Sending BH claims to the MCO is the #1 cause of misdirected-claim denials.',
    clearinghouse: 'Incedo Provider Portal / 837P', portal: 'maryland.optum.com', timely: 365, active: true,
  },
  {
    id: 'bp2', payerId: '00840', name: 'Medicare Part B — Novitas Solutions', short: 'Medicare',
    type: 'Medicare', route: 'direct',
    routeNote: 'Outpatient psych under Part B. No PRP / mobile crisis / residential coverage — H-codes not payable.',
    clearinghouse: 'Change Healthcare', portal: 'novitas-solutions.com', timely: 365, active: true,
  },
  {
    id: 'bp3', payerId: '00580', name: 'CareFirst BCBS (incl. BlueChoice)', short: 'CareFirst',
    type: 'Commercial', route: 'direct',
    routeNote: 'BH managed in-house by CareFirst. Residential SUD requires pre-cert through care management.',
    clearinghouse: 'Availity', portal: 'carefirst.com/providers', timely: 180, active: true,
  },
  {
    id: 'bp4', payerId: '60054', name: 'Aetna (BH via Aetna Behavioral Health)', short: 'Aetna',
    type: 'Commercial', route: 'direct',
    routeNote: 'Behavioral health benefits administered by Aetna Behavioral Health — verify BH payer ID on the member card.',
    clearinghouse: 'Availity', portal: 'availity.com', timely: 180, active: true,
  },
  {
    id: 'bp5', payerId: '87726', name: 'UnitedHealthcare (BH via Optum Behavioral)', short: 'UHC/Optum',
    type: 'Commercial', route: 'direct',
    routeNote: 'BH claims route to Optum Behavioral Health (payer ID 87726 still applies; auth via Provider Express).',
    clearinghouse: 'Availity', portal: 'providerexpress.com', timely: 90, active: true,
  },
  {
    id: 'bp6', payerId: '62308', name: 'Cigna (BH via Evernorth Behavioral)', short: 'Cigna',
    type: 'Commercial', route: 'direct',
    routeNote: 'Behavioral benefits via Evernorth. No residential SUD coverage on most small-group plans — verify per member.',
    clearinghouse: 'Office Ally', portal: 'evernorth.com/provider', timely: 180, active: true,
  },
  {
    id: 'bp7', payerId: 'SELF', name: 'Self-Pay / Sliding Scale', short: 'Self-Pay',
    type: 'Self-Pay', route: 'selfpay',
    routeNote: 'Sliding scale $80–$150. Superbills provided for out-of-network reimbursement.',
    clearinghouse: 'N/A', portal: 'N/A', timely: 0, active: true,
  },
];

const ROUTE_BADGE: Record<ClaimRoute, { label: string; cls: string }> = {
  aso: { label: 'BH ASO Carve-Out', cls: 'bg-purple-100 text-purple-700 border-purple-300' },
  direct: { label: 'Direct / Clearinghouse', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  selfpay: { label: 'Patient Billed', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// ---------------------------------------------------------------------------
// Service coverage matrix — code × payer
// ---------------------------------------------------------------------------

type CoverageStatus = 'covered' | 'pa' | 'not';

interface CoverageCell {
  status: CoverageStatus;
  rate?: number;
  note?: string;
}

interface ServiceRow {
  code: string;
  label: string;
  category: string;
  modifiers?: string;
  limits?: string;
  coverage: Record<string, CoverageCell>; // keyed by payer short
}

// Payer column order for the matrix
const MATRIX_PAYERS = ['Optum MD', 'Medicare', 'CareFirst', 'Aetna', 'UHC/Optum', 'Cigna'];

const SERVICES: ServiceRow[] = [
  {
    code: '90837', label: 'Individual Therapy — 60 min', category: 'Outpatient',
    coverage: {
      'Optum MD': { status: 'covered', rate: 121 }, Medicare: { status: 'covered', rate: 120 },
      CareFirst: { status: 'covered', rate: 145 }, Aetna: { status: 'covered', rate: 138 },
      'UHC/Optum': { status: 'covered', rate: 132 }, Cigna: { status: 'covered', rate: 128 },
    },
  },
  {
    code: '90791', label: 'Psychiatric Diagnostic Evaluation', category: 'Outpatient',
    limits: '1 per client per provider per year (most payers)',
    coverage: {
      'Optum MD': { status: 'covered', rate: 196 }, Medicare: { status: 'covered', rate: 185 },
      CareFirst: { status: 'covered', rate: 235 }, Aetna: { status: 'covered', rate: 225 },
      'UHC/Optum': { status: 'covered', rate: 218 }, Cigna: { status: 'covered', rate: 210 },
    },
  },
  {
    code: '90853', label: 'Group Therapy', category: 'Outpatient', modifiers: 'HQ required',
    coverage: {
      'Optum MD': { status: 'covered', rate: 42 }, Medicare: { status: 'covered', rate: 38 },
      CareFirst: { status: 'covered', rate: 58 }, Aetna: { status: 'covered', rate: 55 },
      'UHC/Optum': { status: 'covered', rate: 52 }, Cigna: { status: 'covered', rate: 50 },
    },
  },
  {
    code: '90839', label: 'Crisis Psychotherapy — first 60 min', category: 'Crisis',
    coverage: {
      'Optum MD': { status: 'covered', rate: 162 }, Medicare: { status: 'covered', rate: 155 },
      CareFirst: { status: 'covered', rate: 220 }, Aetna: { status: 'covered', rate: 210 },
      'UHC/Optum': { status: 'covered', rate: 205 }, Cigna: { status: 'covered', rate: 198 },
    },
  },
  {
    code: 'H2011', label: 'Mobile Crisis Intervention (per 15 min)', category: 'Crisis',
    limits: 'Units must match documented episode minutes · POS 15',
    coverage: {
      'Optum MD': { status: 'covered', rate: 34, note: 'Core Medicaid mobile crisis benefit' },
      Medicare: { status: 'not', note: 'Not a Part B benefit' },
      CareFirst: { status: 'covered', rate: 30, note: 'Covered 2025+ under crisis parity' },
      Aetna: { status: 'not' }, 'UHC/Optum': { status: 'not' }, Cigna: { status: 'not' },
    },
  },
  {
    code: 'S9485', label: 'Crisis Stabilization — per diem', category: 'Crisis',
    coverage: {
      'Optum MD': { status: 'pa', rate: 420 }, Medicare: { status: 'not' },
      CareFirst: { status: 'not' }, Aetna: { status: 'not' },
      'UHC/Optum': { status: 'not' }, Cigna: { status: 'not' },
    },
  },
  {
    code: 'H0018', label: 'Residential SUD — per diem (ASAM 3.5)', category: 'Residential', modifiers: 'HF required',
    limits: '1 unit per DOS · continued-stay review every 7 days · POS 55',
    coverage: {
      'Optum MD': { status: 'pa', rate: 385, note: 'PA via Incedo; concurrent review weekly' },
      Medicare: { status: 'not', note: 'No Part B residential SUD benefit' },
      CareFirst: { status: 'pa', rate: 410, note: 'Pre-cert via care management' },
      Aetna: { status: 'pa', rate: 395 },
      'UHC/Optum': { status: 'pa', rate: 388, note: 'Auth via Provider Express' },
      Cigna: { status: 'not', note: 'Excluded on most small-group plans' },
    },
  },
  {
    code: 'H0019', label: 'Residential SUD — per diem (ASAM 3.1)', category: 'Residential', modifiers: 'HF required',
    limits: '1 unit per DOS · continued-stay review every 30 days · POS 55',
    coverage: {
      'Optum MD': { status: 'pa', rate: 245, note: 'PA via Incedo; 30-day concurrent review' },
      Medicare: { status: 'not' },
      CareFirst: { status: 'pa', rate: 260 },
      Aetna: { status: 'not', note: 'Steps down to IOP benefit instead' },
      'UHC/Optum': { status: 'pa', rate: 250 },
      Cigna: { status: 'not' },
    },
  },
  {
    code: 'H2017', label: 'PRP Services (per 15 min)', category: 'PRP / Rehab', modifiers: 'HK when program director',
    limits: 'Max 16 units/day · PA required · COMAR documentation standards',
    coverage: {
      'Optum MD': { status: 'pa', rate: 24, note: 'Medicaid-only benefit; PA via Incedo' },
      Medicare: { status: 'not' }, CareFirst: { status: 'not' },
      Aetna: { status: 'not' }, 'UHC/Optum': { status: 'not' }, Cigna: { status: 'not' },
    },
  },
  {
    code: 'H0038', label: 'Peer Support Services (per 15 min)', category: 'PRP / Rehab', modifiers: 'U3 required',
    coverage: {
      'Optum MD': { status: 'covered', rate: 16, note: 'CPRS credential required' },
      Medicare: { status: 'not' }, CareFirst: { status: 'not' },
      Aetna: { status: 'not' }, 'UHC/Optum': { status: 'not' }, Cigna: { status: 'not' },
    },
  },
  {
    code: 'T1017', label: 'Targeted Case Management (per 15 min)', category: 'PRP / Rehab',
    coverage: {
      'Optum MD': { status: 'covered', rate: 28 }, Medicare: { status: 'not' },
      CareFirst: { status: 'not' }, Aetna: { status: 'not' },
      'UHC/Optum': { status: 'not' }, Cigna: { status: 'not' },
    },
  },
  {
    code: 'H0004', label: 'SUD Counseling (per 15 min)', category: 'SUD', modifiers: 'HF required',
    coverage: {
      'Optum MD': { status: 'covered', rate: 24 }, Medicare: { status: 'not' },
      CareFirst: { status: 'covered', rate: 26 }, Aetna: { status: 'covered', rate: 25 },
      'UHC/Optum': { status: 'covered', rate: 25 }, Cigna: { status: 'covered', rate: 24 },
    },
  },
];

const COVERAGE_STYLE: Record<CoverageStatus, { Icon: React.FC<{ className?: string }>; cls: string; label: string }> = {
  covered: { Icon: CheckCircle2, cls: 'text-green-600', label: 'Covered' },
  pa: { Icon: ShieldAlert, cls: 'text-amber-600', label: 'PA Required' },
  not: { Icon: XCircle, cls: 'text-gray-300', label: 'Not Covered' },
};

// ---------------------------------------------------------------------------
// BH billing rules engine
// ---------------------------------------------------------------------------

interface BhRule {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  payers: string[];
  priority: number;
  active: boolean;
}

const INITIAL_RULES: BhRule[] = [
  {
    id: 'bhr1', name: 'Maryland Medicaid BH Carve-Out Routing',
    description: 'Behavioral health claims for Maryland Medicaid members route to the BH ASO (Optum Maryland / Incedo), never to the HealthChoice MCO.',
    trigger: 'Member coverage = Maryland Medicaid AND service category = Behavioral Health',
    action: 'Set claim destination to Optum Maryland (OMDBH); block MCO submission with hard-stop warning',
    payers: ['Optum MD'], priority: 1, active: true,
  },
  {
    id: 'bhr2', name: 'Residential Per-Diem Gate',
    description: 'H0018/H0019 charges require an active prior authorization with units remaining AND a current continued-stay review (7-day for 3.5, 30-day for 3.1).',
    trigger: 'CPT/HCPCS in [H0018, H0019]',
    action: 'Block charge generation until PA active and ASAM review current — enforced in Residential & Crisis Billing',
    payers: ['All'], priority: 2, active: true,
  },
  {
    id: 'bhr3', name: 'SUD Program Modifier (HF)',
    description: 'All substance use disorder program codes carry modifier HF.',
    trigger: 'CPT/HCPCS in [H0004, H0018, H0019]',
    action: 'Append modifier HF to the service line',
    payers: ['All'], priority: 3, active: true,
  },
  {
    id: 'bhr4', name: 'Peer Support Modifier (U3)',
    description: 'Maryland Medicaid requires modifier U3 on self-help / peer support services.',
    trigger: 'CPT/HCPCS = H0038 AND payer = Optum MD',
    action: 'Append modifier U3; verify rendering staff holds CPRS credential',
    payers: ['Optum MD'], priority: 4, active: true,
  },
  {
    id: 'bhr5', name: 'Credential-Level Modifier (AJ / HO / HN)',
    description: 'Append the rendering clinician\'s credential-level modifier from their HR record: AJ (LCSW-C), HO (master\'s level), HN (bachelor\'s level).',
    trigger: 'Any BH service line with a rendering clinician on file',
    action: 'Append credential modifier from the credentialing record; flag if license lapsed',
    payers: ['All'], priority: 5, active: true,
  },
  {
    id: 'bhr6', name: 'Same-Day Crisis Distinct Service (Mod 59)',
    description: 'Mobile crisis (H2011) and crisis psychotherapy (90839) on the same date of service require modifier 59 on the second service.',
    trigger: 'H2011 AND 90839 share a date of service for the same client',
    action: 'Append modifier 59 to the later service; attach episode timeline as documentation',
    payers: ['All'], priority: 6, active: true,
  },
  {
    id: 'bhr7', name: 'Telehealth Modifier — GT / 95',
    description: 'Telehealth BH services carry GT for Maryland Medicaid and 95 for commercial & Medicare, with POS 02/10.',
    trigger: 'Service location = Telehealth',
    action: 'Append GT (Optum MD) or 95 (all others); set POS from client location',
    payers: ['All'], priority: 7, active: true,
  },
  {
    id: 'bhr8', name: 'PRP Daily Unit Cap',
    description: 'H2017 is capped at 16 units (4 hours) per day under Maryland Medicaid; units beyond the cap are flagged, not billed.',
    trigger: 'Sum of H2017 units for one client on one DOS > 16',
    action: 'Hold excess units for supervisor review; never auto-bill past the cap',
    payers: ['Optum MD'], priority: 8, active: true,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'payers' | 'matrix' | 'rules';

export default function BhPayerSettingsPage() {
  const [tab, setTab] = useState<Tab>('payers');
  const [payers, setPayers] = useState<BhPayer[]>(INITIAL_PAYERS);
  const [rules, setRules] = useState<BhRule[]>(INITIAL_RULES);
  const [expandedService, setExpandedService] = useState<string>('');
  const [expandedPayer, setExpandedPayer] = useState<string>('');

  const togglePayer = (id: string) => setPayers((prev) => prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  const toggleRule = (id: string) => setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));

  const paCount = SERVICES.reduce((s, svc) => s + Object.values(svc.coverage).filter((c) => c.status === 'pa').length, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-100 rounded-xl">
            <Settings className="h-6 w-6 text-purple-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">BH Payer Settings</h1>
            <p className="text-xs text-gray-500">
              Behavioral health payer routing, service coverage, and billing rules — feeds charge gates across Billing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/dashboard/billing/panels"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            <ShieldCheck className="h-4 w-4" /> Insurance Panels
          </a>
          <a
            href="/dashboard/billing/residential-crisis"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            <Receipt className="h-4 w-4" /> Residential & Crisis
          </a>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Payers', value: String(payers.filter((p) => p.active).length), sub: `${payers.length} configured`, Icon: Building2, cls: 'text-purple-600 bg-purple-50' },
          { label: 'Services in Matrix', value: String(SERVICES.length), sub: 'coverage mapped per payer', Icon: FileText, cls: 'text-indigo-600 bg-indigo-50' },
          { label: 'PA-Required Combinations', value: String(paCount), sub: 'code × payer pairs needing auth', Icon: ShieldAlert, cls: 'text-amber-600 bg-amber-50' },
          { label: 'Active Billing Rules', value: `${rules.filter((r) => r.active).length}/${rules.length}`, sub: 'auto-applied at claim creation', Icon: Zap, cls: 'text-teal-600 bg-teal-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${m.cls}`}>
              <m.Icon className="h-4 w-4" />
            </div>
            <p className="text-xl font-extrabold text-gray-900">{m.value}</p>
            <p className="text-xs font-semibold text-gray-600">{m.label}</p>
            <p className="text-[11px] text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {([
          { id: 'payers', label: 'Payers & Routing', Icon: Route },
          { id: 'matrix', label: 'Service Coverage Matrix', Icon: ArrowRightLeft },
          { id: 'rules', label: 'BH Billing Rules', Icon: Zap },
        ] as { id: Tab; label: string; Icon: React.FC<{ className?: string }> }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap border-2 transition-all ${
              tab === t.id
                ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ===================================================================
          TAB — PAYERS & ROUTING
      =================================================================== */}
      {tab === 'payers' && (
        <div className="space-y-3">
          {/* Carve-out callout */}
          <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4 flex gap-3">
            <Landmark className="h-5 w-5 text-purple-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-purple-900">Maryland Medicaid BH carve-out</p>
              <p className="text-sm text-purple-800 mt-0.5">
                Behavioral health services for Maryland Medicaid members are carved out of HealthChoice MCOs and
                administered by the state's BH ASO (Optum Maryland). Every BH claim, auth, and concurrent review goes
                through Incedo — the routing rule below enforces this with a hard stop.
              </p>
            </div>
          </div>

          {payers.map((p) => {
            const rb = ROUTE_BADGE[p.route];
            const expanded = expandedPayer === p.id;
            return (
              <div key={p.id} className={`bg-white rounded-xl border-2 transition-all ${p.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <div className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {p.short.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{p.name}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rb.cls}`}>{rb.label}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{p.type}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Payer ID {p.payerId} · {p.clearinghouse} · {p.timely ? `Timely filing ${p.timely} days` : 'No filing limit'} · {p.portal}
                    </p>
                  </div>
                  <button
                    onClick={() => setExpandedPayer(expanded ? '' : p.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 shrink-0"
                    aria-label="Toggle details"
                  >
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <button onClick={() => togglePayer(p.id)} className="shrink-0" aria-label="Toggle active">
                    {p.active ? <ToggleRight className="h-7 w-7 text-green-500" /> : <ToggleLeft className="h-7 w-7 text-gray-300" />}
                  </button>
                </div>
                {expanded && (
                  <div className="px-4 pb-4">
                    <div className={`rounded-lg p-3 text-xs leading-relaxed ${p.route === 'aso' ? 'bg-purple-50 text-purple-800 border border-purple-100' : 'bg-gray-50 text-gray-600 border border-gray-100'}`}>
                      <Info className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                      {p.routeNote}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===================================================================
          TAB — SERVICE COVERAGE MATRIX
      =================================================================== */}
      {tab === 'matrix' && (
        <div className="space-y-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {(Object.entries(COVERAGE_STYLE) as [CoverageStatus, typeof COVERAGE_STYLE[CoverageStatus]][]).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1.5 font-semibold text-gray-600">
                <v.Icon className={`h-4 w-4 ${v.cls}`} /> {v.label}
              </span>
            ))}
            <span className="ml-auto text-gray-400 hidden sm:inline">Click a row for rates, limits & payer notes</span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-4 py-2.5 font-semibold min-w-[220px]">Service</th>
                    {MATRIX_PAYERS.map((mp) => (
                      <th key={mp} className="px-2 py-2.5 font-semibold text-center whitespace-nowrap">{mp}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SERVICES.map((svc) => {
                    const expanded = expandedService === svc.code;
                    return (
                      <React.Fragment key={svc.code}>
                        <tr
                          onClick={() => setExpandedService(expanded ? '' : svc.code)}
                          className={`border-b border-gray-50 cursor-pointer transition-colors ${expanded ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {expanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                              <div>
                                <p className="text-xs font-mono font-bold text-gray-800">{svc.code}</p>
                                <p className="text-[11px] text-gray-500">{svc.label}</p>
                              </div>
                            </div>
                          </td>
                          {MATRIX_PAYERS.map((mp) => {
                            const cell = svc.coverage[mp];
                            const cs = COVERAGE_STYLE[cell?.status ?? 'not'];
                            return (
                              <td key={mp} className="px-2 py-3 text-center">
                                <cs.Icon className={`h-4 w-4 mx-auto ${cs.cls}`} />
                                {cell?.rate !== undefined && cell.status !== 'not' && (
                                  <p className="text-[10px] text-gray-400 mt-0.5">${cell.rate}</p>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {expanded && (
                          <tr className="bg-indigo-50/30 border-b border-gray-50">
                            <td colSpan={MATRIX_PAYERS.length + 1} className="px-5 py-3">
                              <div className="flex flex-wrap gap-4 mb-2 text-[11px] text-gray-600">
                                <span className="font-semibold text-gray-700">Category: {svc.category}</span>
                                {svc.modifiers && <span><strong>Modifiers:</strong> {svc.modifiers}</span>}
                                {svc.limits && <span><strong>Limits:</strong> {svc.limits}</span>}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                {MATRIX_PAYERS.map((mp) => {
                                  const cell = svc.coverage[mp];
                                  if (!cell) return null;
                                  const cs = COVERAGE_STYLE[cell.status];
                                  return (
                                    <div key={mp} className="flex items-start gap-2 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5">
                                      <cs.Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${cs.cls}`} />
                                      <p className="text-[11px] text-gray-600">
                                        <strong className="text-gray-800">{mp}:</strong> {cs.label}
                                        {cell.rate !== undefined && cell.status !== 'not' && ` · $${cell.rate}`}
                                        {cell.note && <span className="text-gray-400"> — {cell.note}</span>}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Demo values — load each payer's current contracted fee schedule before go-live. This matrix is what the{' '}
              <a href="/dashboard/billing/residential-crisis" className="font-semibold underline">Residential & Crisis charge gates</a>{' '}
              and <a href="/dashboard/billing/claim-scrubber" className="font-semibold underline">Claim Scrubber</a> read
              from, so a wrong cell here becomes a wrong claim there.
            </p>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — BH BILLING RULES
      =================================================================== */}
      {tab === 'rules' && (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.id} className={`bg-white rounded-xl border-2 p-4 transition-all ${r.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center text-xs font-bold shrink-0">
                  {r.priority}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{r.name}</p>
                    {r.payers.map((p) => (
                      <span key={p} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">{p}</span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{r.description}</p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="bg-gray-50 rounded-lg px-2.5 py-1.5 text-gray-600">
                      <strong className="text-gray-700">When:</strong> {r.trigger}
                    </div>
                    <div className="bg-teal-50 rounded-lg px-2.5 py-1.5 text-teal-800">
                      <strong>Then:</strong> {r.action}
                    </div>
                  </div>
                </div>
                <button onClick={() => toggleRule(r.id)} className="shrink-0" aria-label="Toggle rule">
                  {r.active ? <ToggleRight className="h-7 w-7 text-green-500" /> : <ToggleLeft className="h-7 w-7 text-gray-300" />}
                </button>
              </div>
            </div>
          ))}

          <div className="bg-slate-900 rounded-xl p-4 text-white">
            <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-teal-400" /> Where These Rules Fire
            </h3>
            <ul className="space-y-2 text-xs text-slate-300">
              <li className="flex gap-2"><Zap className="h-3.5 w-3.5 text-teal-400 shrink-0 mt-0.5" /> At charge creation — modifiers and routing are applied before the claim exists, not patched afterward.</li>
              <li className="flex gap-2"><Zap className="h-3.5 w-3.5 text-teal-400 shrink-0 mt-0.5" /> In the Claim Scrubber — violations surface as errors with the rule named, so fixes are teachable.</li>
              <li className="flex gap-2"><Zap className="h-3.5 w-3.5 text-teal-400 shrink-0 mt-0.5" /> In Residential & Crisis Billing — the per-diem gate and unit-match rules block revenue-risk charges at the source.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
