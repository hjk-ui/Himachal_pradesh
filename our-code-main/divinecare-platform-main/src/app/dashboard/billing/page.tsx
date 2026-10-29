'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth';
import { DollarSign, Upload, Clock, ClipboardList, BarChart3, Plus, CheckCircle2, AlertTriangle, FileText, CreditCard, Send, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';

// ─── BH Real Client Fallback List ─────────────────────────────────────────────
const BH_CLIENTS: Array<{ id: string; name: string; dob?: string; memberId?: string; payer?: string }> = [];

// ─── BH ICD-10 Codes ─────────────────────────────────────────────────────────
const BH_ICD10 = [
  { code: 'F32.0',  desc: 'Major depressive disorder, single episode, mild' },
  { code: 'F32.1',  desc: 'Major depressive disorder, single episode, moderate' },
  { code: 'F32.2',  desc: 'Major depressive disorder, single episode, severe' },
  { code: 'F33.0',  desc: 'Major depressive disorder, recurrent, mild' },
  { code: 'F33.1',  desc: 'Major depressive disorder, recurrent, moderate' },
  { code: 'F33.2',  desc: 'Major depressive disorder, recurrent, severe without psychosis' },
  { code: 'F41.0',  desc: 'Panic disorder without agoraphobia' },
  { code: 'F41.1',  desc: 'Generalized anxiety disorder' },
  { code: 'F41.9',  desc: 'Anxiety disorder, unspecified' },
  { code: 'F43.10', desc: 'Post-traumatic stress disorder, unspecified' },
  { code: 'F43.11', desc: 'Post-traumatic stress disorder, acute' },
  { code: 'F43.12', desc: 'Post-traumatic stress disorder, chronic' },
  { code: 'F43.20', desc: 'Adjustment disorder, unspecified' },
  { code: 'F43.21', desc: 'Adjustment disorder with depressed mood' },
  { code: 'F43.22', desc: 'Adjustment disorder with anxiety' },
  { code: 'F43.23', desc: 'Adjustment disorder with mixed anxiety and depressed mood' },
  { code: 'F31.9',  desc: 'Bipolar disorder, unspecified' },
  { code: 'F31.81', desc: 'Bipolar II disorder' },
  { code: 'F20.9',  desc: 'Schizophrenia, unspecified' },
  { code: 'F25.0',  desc: 'Schizoaffective disorder, bipolar type' },
  { code: 'F10.20', desc: 'Alcohol use disorder, moderate' },
  { code: 'F11.20', desc: 'Opioid use disorder, moderate' },
  { code: 'F12.20', desc: 'Cannabis use disorder, moderate' },
  { code: 'F14.20', desc: 'Cocaine use disorder, moderate' },
  { code: 'F40.10', desc: 'Social phobia, unspecified' },
  { code: 'F42.2',  desc: 'Mixed obsessional thoughts and acts (OCD)' },
  { code: 'F50.00', desc: 'Anorexia nervosa, unspecified' },
  { code: 'F50.2',  desc: 'Bulimia nervosa' },
  { code: 'F60.3',  desc: 'Borderline personality disorder' },
  { code: 'F90.0',  desc: 'ADHD, predominantly inattentive type' },
  { code: 'F54',    desc: 'Psychological factors affecting other medical conditions' },
  { code: 'Z03.89', desc: 'Encounter for observation, no disorder confirmed' },
  { code: 'Z13.30', desc: 'Encounter for screening for depression' },
];

// ─── Searchable Client Combo ──────────────────────────────────────────────────
function ClientCombo({ value, onChange, clients }: {
  value: string;
  onChange: (name: string, memberId: string, payer?: string) => void;
  clients?: Array<{ id: string; name: string; memberId: string; payer?: string }>;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const sourceList = clients && clients.length > 0 ? clients : BH_CLIENTS;
  const filtered = query.length >= 1
    ? sourceList.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.memberId && c.memberId.toLowerCase().includes(query.toLowerCase()))).slice(0, 12)
    : sourceList.slice(0, 12);

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Type client name or member ID…"
        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.id} type="button"
              onMouseDown={() => { onChange(c.name, c.memberId, c.payer); setQuery(c.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-50 last:border-0 text-sm flex justify-between items-center"
            >
              <div>
                <span className="font-medium text-gray-800">{c.name}</span>
                <span className="ml-2 text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-semibold">{c.payer}</span>
              </div>
              <span className="text-xs text-gray-400 font-mono">{c.memberId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Searchable ICD-10 Combo (multi-select with chips) ───────────────────────
function IcdCombo({ selected, onChange }: {
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const filtered = query.length >= 1
    ? BH_ICD10.filter(c =>
        !selected.includes(c.code) &&
        (c.code.toLowerCase().includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase()))
      ).slice(0, 10)
    : [];

  function add(code: string) {
    if (!selected.includes(code) && selected.length < 4) onChange([...selected, code]);
    setQuery('');
    setOpen(false);
  }
  function remove(code: string) { onChange(selected.filter(c => c !== code)); }

  return (
    <div ref={ref} className="relative">
      {/* Chips row */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((code, i) => {
            const entry = BH_ICD10.find(c => c.code === code);
            return (
              <span key={code} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${i === 0 ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'}`}>
                <span className="font-mono">{code}</span>
                {entry && <span className="hidden sm:inline text-xs opacity-70">— {entry.desc.slice(0, 28)}{entry.desc.length > 28 ? '…' : ''}</span>}
                {i === 0 && <span className="ml-0.5 text-purple-500 text-xs">Primary</span>}
                <button type="button" onClick={() => remove(code)} className="ml-0.5 hover:text-red-500"><X size={10} /></button>
              </span>
            );
          })}
        </div>
      )}
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (query) setOpen(true); }}
        placeholder={selected.length === 0 ? 'Search: F33.1, F41.1, PTSD…' : 'Add another code (up to 4)…'}
        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 font-mono"
        disabled={selected.length >= 4}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.code} type="button"
              onMouseDown={() => add(c.code)}
              className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-50 last:border-0 text-sm"
            >
              <span className="font-mono font-bold text-purple-700 mr-2">{c.code}</span>
              <span className="text-gray-600">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-1">First code = primary. Up to 4 codes. Click chip × to remove.</p>
    </div>
  );
}

// ─── Clearinghouse connection status ─────────────────────────────────────────
// Architecture: Waystar (837P claims + 835 ERA) + Availity (270/271 eligibility only).
// In production the server sets WAYSTAR_CLIENT_ID or AVAILITY_CLIENT_ID.
// Frontend shows DEMO MODE banner until the API health endpoint confirms live mode.
const CLEARINGHOUSE_DEMO = true; // flips to false when server env vars are set

const STAT_ICONS: Record<string, React.ReactNode> = {
  'Revenue MTD': <DollarSign size={20} className="text-white" />,
  'Claims Submitted': <Upload size={20} className="text-white" />,
  'Claims Pending': <Clock size={20} className="text-white" />,
  'Outstanding Balance': <ClipboardList size={20} className="text-white" />,
};

const STATS = [
  { label: 'Revenue MTD', value: '$0', iconBg: '#15803D', color: '#15803D', change: '' },
  { label: 'Claims Submitted', value: '0', iconBg: '#5C2D91', color: '#5C2D91', change: '' },
  { label: 'Claims Pending', value: '0', iconBg: '#B45309', color: '#B45309', change: '' },
  { label: 'Outstanding Balance', value: '$0', iconBg: '#DC2626', color: '#DC2626', change: '' },
];

const CLAIMS: Array<{
  id: string;
  client: string;
  serviceDate: string;
  cpt: string;
  desc: string;
  clinician: string;
  insurance: string;
  amount: string;
  status: string;
}> = [];

const INSURANCE_BREAKDOWN: Array<{
  payer: string;
  claims: number;
  approved: number;
  pending: number;
  denied: number;
  amount: string;
  color: string;
}> = [];

const CPT_CODES = [
  // Individual Therapy
  { code: '90837', desc: 'Individual Therapy — 60 min', rate: '$180', units: 62, category: 'Therapy' },
  { code: '90834', desc: 'Individual Therapy — 45 min', rate: '$135', units: 48, category: 'Therapy' },
  { code: '90832', desc: 'Individual Therapy — 30 min', rate: '$89', units: 14, category: 'Therapy' },
  // Group / Family
  { code: '90853', desc: 'Group Therapy', rate: '$60', units: 44, category: 'Therapy' },
  { code: '90847', desc: 'Family Therapy (with client)', rate: '$160', units: 18, category: 'Therapy' },
  { code: '90846', desc: 'Family Therapy (without client)', rate: '$145', units: 6, category: 'Therapy' },
  // Psychiatric Evaluation
  { code: '90791', desc: 'Psychiatric Evaluation', rate: '$250', units: 9, category: 'Evaluation' },
  { code: '90792', desc: 'Psychiatric Eval w/ Med Mgmt', rate: '$295', units: 5, category: 'Evaluation' },
  // Med Management / E&M
  { code: '99213', desc: 'Med Management — 15 min (E&M Level 3)', rate: '$89', units: 31, category: 'MedMgmt' },
  { code: '99214', desc: 'Med Management — 25 min (E&M Level 4)', rate: '$145', units: 16, category: 'MedMgmt' },
  { code: '99215', desc: 'Med Management — 40 min (E&M Level 5)', rate: '$195', units: 4, category: 'MedMgmt' },
  // Add-On Codes (billed in addition to primary service — require Modifier 59 if payer requires unbundling)
  { code: '90785', desc: 'Interactive Complexity Add-On (+ to psych)', rate: '$35', units: 22, category: 'AddOn' },
  { code: '90833', desc: 'Psychotherapy Add-On 30 min (with E&M) — Mod 25 required', rate: '$68', units: 18, category: 'AddOn' },
  { code: '90836', desc: 'Psychotherapy Add-On 45 min (with E&M) — Mod 25 required', rate: '$98', units: 8, category: 'AddOn' },
  { code: '90838', desc: 'Psychotherapy Add-On 60 min (with E&M) — Mod 25 required', rate: '$130', units: 4, category: 'AddOn' },
  // Crisis (office / telehealth)
  { code: '90839', desc: 'Crisis Psychotherapy — first 60 min', rate: '$220', units: 5, category: 'Crisis' },
  { code: '90840', desc: 'Crisis Psychotherapy — each addl 30 min (add-on to 90839)', rate: '$110', units: 3, category: 'Crisis' },
  // Mobile Crisis (community-based response — POS 15)
  { code: 'H2011', desc: 'Mobile Crisis Intervention (per 15 min)', rate: '$34', units: 46, category: 'MobileCrisis' },
  { code: 'S9484', desc: 'Crisis Intervention Services — per hour', rate: '$140', units: 9, category: 'MobileCrisis' },
  { code: 'S9485', desc: 'Crisis Stabilization — per diem', rate: '$420', units: 2, category: 'MobileCrisis' },
  // Residential SUD (per diem — census-driven, see Residential & Crisis Billing)
  { code: 'H0018', desc: 'Residential SUD Tx — short-term, per diem (ASAM 3.5) — POS 55', rate: '$385', units: 62, category: 'Residential' },
  { code: 'H0019', desc: 'Residential SUD Tx — long-term, per diem (ASAM 3.1) — POS 55', rate: '$245', units: 118, category: 'Residential' },
  // PRP / Community Support
  { code: 'H2017', desc: 'PRP Services (per 15 min unit)', rate: '$24', units: 152, category: 'PRP' },
  { code: 'H2017HK', desc: 'PRP Services — Program Director (Mod HK)', rate: '$36', units: 28, category: 'PRP' },
  { code: 'H0036', desc: 'Community Support (per 15 min)', rate: '$18', units: 44, category: 'PRP' },
  // Peer Support
  { code: 'H0038', desc: 'Self-Help / Peer Services (per 15 min) — Mod U3', rate: '$16', units: 88, category: 'PeerSupport' },
  // Case Management
  { code: 'T1016', desc: 'Case Management (per 15 min)', rate: '$22', units: 64, category: 'CaseMgmt' },
  { code: 'T1017', desc: 'Targeted Case Management (per 15 min)', rate: '$28', units: 32, category: 'CaseMgmt' },
  // SUD / SBIRT
  { code: '99408', desc: 'SBIRT — Alcohol/Drug Screening (15-30 min)', rate: '$30', units: 11, category: 'SUD' },
  { code: '99409', desc: 'SBIRT — Alcohol/Drug Intervention (>30 min)', rate: '$58', units: 4, category: 'SUD' },
  { code: 'H0004', desc: 'BH Counseling & Therapy (per 15 min) — Mod HF', rate: '$24', units: 38, category: 'SUD' },
  // Collaborative Care Management
  { code: '99492', desc: 'Collaborative Care Mgmt — Initial (70+ min)', rate: '$285', units: 2, category: 'CollabCare' },
  { code: '99493', desc: 'Collaborative Care Mgmt — Subsequent (60+ min)', rate: '$185', units: 6, category: 'CollabCare' },
  { code: '99494', desc: 'Collaborative Care Add-On (each addl 30 min)', rate: '$85', units: 4, category: 'CollabCare' },
];

const MODIFIER_CODES = [
  // Telehealth
  { modifier: '95', desc: 'Telehealth — synchronous audio/video', posNote: 'Use with POS 02 or 10', category: 'Telehealth' },
  { modifier: 'GT', desc: 'Interactive audio/video (Medicare telehealth)', posNote: 'Medicare only', category: 'Telehealth' },
  // Credential Level
  { modifier: 'AH', desc: 'Clinical Psychologist (PhD/PsyD)', posNote: 'Doctoral-level billing independently', category: 'Credential' },
  { modifier: 'AJ', desc: 'Clinical Social Worker (LCSW)', posNote: 'LCSW billing independently', category: 'Credential' },
  { modifier: 'HN', desc: "Bachelor's level staff", posNote: 'Supervision required', category: 'Credential' },
  { modifier: 'HO', desc: "Master's level staff", posNote: 'LPC, LCSW, LGPC, etc.', category: 'Credential' },
  { modifier: 'HM', desc: 'Less than bachelor\'s level', posNote: 'Para-professional / peer support worker', category: 'Credential' },
  // Service Type
  { modifier: 'HQ', desc: 'Group setting', posNote: 'Required with 90853', category: 'Service' },
  { modifier: 'HF', desc: 'Substance Abuse Program', posNote: 'Required for SUD treatment — H0004, etc.', category: 'Service' },
  { modifier: 'TJ', desc: 'Program for children and adolescents', posNote: 'Add to child therapy codes', category: 'Service' },
  // Billing Rules
  { modifier: '25', desc: 'Significant, separately identifiable E&M (same day)', posNote: 'Required when billing E&M + psychotherapy same visit', category: 'BillingRule' },
  { modifier: '59', desc: 'Distinct Procedural Service', posNote: 'Unbundles add-on codes when payer requires it', category: 'BillingRule' },
  // Maryland Medicaid
  { modifier: 'EP', desc: 'EPSDT — Early Periodic Screening (under age 21)', posNote: 'Maryland Medicaid child services', category: 'Medicaid' },
  { modifier: 'U1', desc: 'Medicaid — high level of care', posNote: 'Maryland Medicaid specific', category: 'Medicaid' },
  { modifier: 'U3', desc: 'Medicaid — self-help / peer support services', posNote: 'Required with H0038 on MD Medicaid', category: 'Medicaid' },
];

const POS_CODES = [
  { pos: '02', desc: 'Telehealth — off-site (patient not at home)' },
  { pos: '03', desc: 'School — educational setting' },
  { pos: '10', desc: 'Telehealth — patient in home' },
  { pos: '11', desc: 'Office / outpatient clinic' },
  { pos: '12', desc: 'Home — in-home services (non-telehealth)' },
  { pos: '13', desc: 'Assisted Living Facility' },
  { pos: '14', desc: 'Group Home / Domiciliary' },
  { pos: '15', desc: 'Mobile Unit (mobile crisis response)' },
  { pos: '23', desc: 'Emergency Room (crisis intervention)' },
  { pos: '55', desc: 'Residential Substance Abuse Treatment Facility (ASAM 3.1/3.5)' },
  { pos: '56', desc: 'Psychiatric Residential Treatment Center' },
  { pos: '53', desc: 'Community Mental Health Center (CMHC)' },
  { pos: '99', desc: 'Other / unlisted' },
];

const ERA_FILES: Array<{
  id: string;
  payer: string;
  received: string;
  claims: number;
  paid: string;
  adjustments: string;
  status: string;
}> = [];

const PAYMENT_HISTORY: Array<{
  id: string;
  type: string;
  source: string;
  amount: string;
  date: string;
  method: string;
  ref: string;
}> = [];

const INVOICES: Array<{
  id: string;
  client: string;
  amount: string;
  due: string;
  status: string;
  services: string;
}> = [];

const ADJ_REASON_CODES = [
  { code: 'CO-45', desc: 'Charge exceeds fee schedule / maximum allowable', responsibility: 'Contractual', common: true },
  { code: 'CO-97', desc: 'Service is included in another already-adjudicated service', responsibility: 'Contractual', common: true },
  { code: 'CO-167', desc: 'Does not meet definition of medical necessity', responsibility: 'Contractual', common: true },
  { code: 'CO-29', desc: 'Filing deadline expired', responsibility: 'Contractual', common: true },
  { code: 'PR-1', desc: 'Deductible amount — patient responsibility', responsibility: 'Patient', common: true },
  { code: 'PR-2', desc: 'Coinsurance amount — patient responsibility', responsibility: 'Patient', common: true },
  { code: 'PR-3', desc: 'Co-payment amount — patient responsibility', responsibility: 'Patient', common: true },
  { code: 'CO-4', desc: 'Service inconsistent with modifier used', responsibility: 'Contractual', common: false },
  { code: 'CO-18', desc: 'Exact duplicate claim / service', responsibility: 'Contractual', common: false },
  { code: 'CO-96', desc: 'Non-covered charge(s)', responsibility: 'Contractual', common: false },
  { code: 'OA-23', desc: 'Non-covered — for coordination of benefits only', responsibility: 'Other', common: false },
  { code: 'CO-109', desc: 'Claim submitted to wrong payer / payer not primary', responsibility: 'Contractual', common: false },
];

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  denied: 'bg-red-100 text-red-700',
};

const CAT_COLORS: Record<string, string> = {
  Therapy: 'bg-purple-100 text-purple-700',
  Evaluation: 'bg-fuchsia-100 text-fuchsia-700',
  MedMgmt: 'bg-lime-100 text-lime-700',
  AddOn: 'bg-sky-100 text-sky-700',
  Crisis: 'bg-red-100 text-red-700',
  MobileCrisis: 'bg-rose-100 text-rose-700',
  Residential: 'bg-cyan-100 text-cyan-700',
  PRP: 'bg-teal-100 text-teal-700',
  PeerSupport: 'bg-pink-100 text-pink-700',
  CaseMgmt: 'bg-violet-100 text-violet-700',
  SUD: 'bg-orange-100 text-orange-700',
  CollabCare: 'bg-indigo-100 text-indigo-700',
};

// ─── Payer ID map for Availity trading partner IDs ────────────────────────────
const PAYER_IDS: Record<string, string> = {
  'Maryland Medicaid':  'MDMCD',
  'Medicare Part B':    '01192',
  'BCBS Maryland':      '00590',
  'Aetna':              '60054',
  'Cigna':              '62308',
  'UnitedHealthcare':   '87726',
  'Tricare':            'TRICR',
  'Self-Pay':           '',
};

type ClaimRow = typeof CLAIMS[0] & { availityClaimId?: string; draft?: boolean; payerStatus?: string };

export default function BillingPage() {
  const { user } = useAuth();
  const canCreatePrpClaim = user?.role === 'ADMIN' || user?.role === 'DIRECTOR' || user?.role === 'PRACTICE_DIRECTOR' || user?.role === 'BILLING';
  const [prpClientId, setPrpClientId] = useState('');
  const [prpNote, setPrpNote] = useState('');
  const [tab, setTab] = useState<'claims' | 'insurance' | 'cpt' | 'payments' | 'invoices'>('claims');
  const [filter, setFilter] = useState('all');
  const [newClaimModal, setNewClaimModal] = useState(false);
  const [cptFilter, setCptFilter] = useState('All');

  // Live claim list — seeded with demo data; new submissions prepend
  const [claims, setClaims] = useState<ClaimRow[]>(CLAIMS as ClaimRow[]);
  const [realClients, setRealClients] = useState<Array<{ id: string; name: string; memberId: string; payer?: string }>>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [claimsRes, clientsRes] = await Promise.all([
          fetch('/api/billing/claims'),
          fetch('/api/clients?take=200')
        ]);
        if (claimsRes.ok) {
          const cData = await claimsRes.json();
          if (cData.success && Array.isArray(cData.claims)) {
            setClaims(cData.claims.map((c: any) => ({
              id: c.displayId || c.id,
              client: c.clientName,
              serviceDate: c.serviceDate ? new Date(c.serviceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
              cpt: c.cptCode,
              desc: c.cptDescription || 'Clinical Session',
              clinician: c.clinicianName || 'Attending Clinician',
              insurance: c.payer || 'Medicaid / Commercial',
              amount: c.amountCents ? `$${(c.amountCents / 100).toFixed(2)}` : '$180.00',
              status: c.uiStatus || 'pending',
              availityClaimId: c.availityClaimId || '',
            })));
          }
        }
        if (clientsRes.ok) {
          const clData = await clientsRes.json();
          if (clData.success && Array.isArray(clData.clients)) {
            setRealClients(clData.clients.map((c: any) => ({
              id: c.id,
              name: c.name,
              memberId: c.mrn || c.insuranceMemberId || 'On File',
              payer: c.insurancePayer || 'Commercial Payer',
            })));
          }
        }
      } catch (err) {
        console.error('Failed to load real billing data:', err);
      }
    }
    loadData();
  }, []);

  const [clinicians, setClinicians] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers/roster')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !data?.success || !Array.isArray(data.roster)) return;
        setClinicians(
          data.roster
            .map((user: { name?: string }) => user.name || '')
            .filter(Boolean)
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // New claim form state
  const [form, setForm] = useState({
    client: '',
    serviceDate: '',
    pos: '11',
    diagnosisCodes: [] as string[],
    payer: 'Optum MD Medicaid BH',
    clinician: '',
    memberId: '',
    notes: '',
    serviceLines: [
      { cptCode: '90837', modifier: '', units: 1, unitCharge: 180 }
    ],
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ claimId: string; availityClaimId: string } | null>(null);

  // Per-row action state
  const [statusChecking, setStatusChecking] = useState<string | null>(null);
  const [rowStatuses, setRowStatuses] = useState<Record<string, string>>({});
  const [rowSubmitting, setRowSubmitting] = useState<string | null>(null);
  const [selectedClaims, setSelectedClaims] = useState<Set<string>>(new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const filtered = filter === 'all' ? claims : claims.filter(c => c.status === filter);
  const cptCategories = ['All', ...Array.from(new Set(CPT_CODES.map(c => c.category)))];
  const filteredCpt = cptFilter === 'All' ? CPT_CODES : CPT_CODES.filter(c => c.category === cptFilter);

  // ─── Submit new claim to API (Waystar 837P) ──────────────────────────────────
  async function handleSubmitClaim() {
    if (!form.client || !form.serviceDate || form.diagnosisCodes.length === 0 || form.serviceLines.length === 0) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const match = realClients.find((client) => client.name === form.client);
      const primary = form.serviceLines[0];
      if (!match || !primary) {
        setSubmitResult({ claimId: 'Not saved', availityClaimId: 'Choose a client from the roster.' });
        return;
      }
      const response = await fetch('/api/billing/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: match.id,
          cptCode: primary.cptCode,
          diagnosisCodes: form.diagnosisCodes,
          placeOfService: form.pos,
          units: primary.units || 1,
          payer: form.payer,
          memberId: form.memberId,
          serviceDate: form.serviceDate,
          clinicianLabel: form.clinician,
          markReady: false,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        setSubmitResult({ claimId: 'Not saved', availityClaimId: payload?.error || 'Test mode — claim was not saved.' });
        return;
      }
      const savedId = payload.claim?.id || payload.claim?.claimNumber || 'Draft saved';
      setSubmitResult({ claimId: String(savedId), availityClaimId: 'Test mode — draft saved, not transmitted' });
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Check 277 status for a single claim ─────────────────────────────────────
  async function handleCheckStatus(claimId: string) {
    setStatusChecking(claimId);
    try {
      const response = await fetch(`/api/billing/claims/${claimId}/status`);
      const payload = await response.json();
      const status = payload?.claim?.payerStatus || payload?.claim?.status || payload?.status || payload?.error || 'Test mode — no payer status';
      setRowStatuses(prev => ({ ...prev, [claimId]: String(status) }));
    } finally {
      setStatusChecking(null);
    }
  }

  // ─── Submit individual draft claim to clearinghouse ───────────────────────────
  async function handleRowSubmit(claimId: string) {
    setRowSubmitting(claimId);
    try {
      const response = await fetch(`/api/billing/claims/${claimId}/submit`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        setRowStatuses((prev) => ({ ...prev, [claimId]: payload?.error || 'Not submitted' }));
        return;
      }
      const tracking = payload?.trackingId || payload?.claim?.clearinghouseClaimId || 'Test mode — not transmitted';
      setClaims((prev) => prev.map((c) => c.id === claimId ? { ...c, status: String(payload?.claim?.status || 'pending').toLowerCase(), availityClaimId: String(tracking) } : c));
    } finally {
      setRowSubmitting(null);
    }
  }

  // ─── Batch submit selected draft claims ──────────────────────────────────────
  async function handleBatchSubmit() {
    setBatchSubmitting(true);
    try {
      const response = await fetch('/api/billing/claims/batch-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimIds: [...selectedClaims] }),
      });
      if (response.ok) setSelectedClaims(new Set());
    } finally {
      setBatchSubmitting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-gray-500 text-sm mt-0.5">Claims · ERA · Payments · Revenue Cycle</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
            <BarChart3 size={15} /> Run Report
          </button>
          <button onClick={() => setNewClaimModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
            <Plus size={15} /> New Claim
          </button>
        </div>
      </div>

      {/* Clearinghouse status banner */}
      <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm ${
        CLEARINGHOUSE_DEMO
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-green-50 border-green-200 text-green-800'
      }`}>
        <div className="flex items-start gap-2">
          {CLEARINGHOUSE_DEMO ? <WifiOff size={15} className="mt-0.5 shrink-0" /> : <Wifi size={15} className="mt-0.5 shrink-0" />}
          <div>
            {CLEARINGHOUSE_DEMO ? (
              <>
                <span className="font-semibold">Test mode</span>
                {' — '}Claims are not transmitted to a live payer. Live charging stays off.
              </>
            ) : (
              <>
                <span className="font-semibold">Waystar + Availity Connected</span>
                {' — '}Waystar: 837P submission · 277 status · 835 ERA auto-post.
                Availity: 270/271 eligibility.
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs font-medium">
          <span className={`px-2 py-0.5 rounded-full ${CLEARINGHOUSE_DEMO ? 'bg-amber-100' : 'bg-green-100'}`}>837P</span>
          <span className={`px-2 py-0.5 rounded-full ${CLEARINGHOUSE_DEMO ? 'bg-amber-100' : 'bg-green-100'}`}>277</span>
          <span className={`px-2 py-0.5 rounded-full ${CLEARINGHOUSE_DEMO ? 'bg-amber-100' : 'bg-green-100'}`}>835 ERA</span>
          <span className={`px-2 py-0.5 rounded-full ${CLEARINGHOUSE_DEMO ? 'bg-amber-100' : 'bg-green-100'}`}>270/271</span>
        </div>
      </div>

      {canCreatePrpClaim ? (
        <form
          className="rounded-xl border border-slate-200 bg-white p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPrpNote('');
            const response = await fetch('/api/prp/billing-model', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId: prpClientId.trim(), diagnosisCode: 'F20.9', code: 'H2017', createClaim: true }),
            });
            const data = await response.json().catch(() => ({}));
            setPrpNote(response.ok ? 'H2017 claim saved as a draft from the confirmed PRP billing model. Test mode does not send it.' : (data.error || 'Claim was not created.'));
          }}
        >
          <h2 className="text-sm font-bold text-slate-900">PRP claim from the confirmed model</h2>
          <p className="mt-1 text-xs text-slate-500">Uses the saved H2017 model for that client. The claim stays a draft.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              required
              value={prpClientId}
              onChange={(event) => setPrpClientId(event.target.value)}
              placeholder="Client id"
              className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm"
            />
            <button type="submit" className="rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">Create draft</button>
          </div>
          {prpNote ? <p className="mt-2 text-sm text-slate-700">{prpNote}</p> : null}
        </form>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-purple-100 shadow-sm p-5">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: s.iconBg }}>
                {STAT_ICONS[s.label]}
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                !s.change ? 'bg-gray-100 text-gray-500' : s.change.startsWith('+') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>{s.change || '—'}</span>
            </div>
            <p className="text-2xl font-extrabold mt-2" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Main panel */}
      <div className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {([
            { key: 'claims', label: 'Claims' },
            { key: 'insurance', label: 'Payer Breakdown' },
            { key: 'cpt', label: 'CPT / HCPCS Codes' },
            { key: 'payments', label: 'ERA & Payments' },
            { key: 'invoices', label: 'Invoices' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                tab === t.key ? 'border-purple-600 text-purple-700 bg-purple-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Claims tab */}
        {tab === 'claims' && (
          <div className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap gap-2">
                {['all', 'approved', 'pending', 'denied'].map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                      filter === f ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    style={filter === f ? { background: '#5C2D91' } : {}}>
                    {f} {f !== 'all' && `(${claims.filter(c => c.status === f).length})`}
                  </button>
                ))}
              </div>
              {selectedClaims.size > 0 && (
                <button
                  onClick={handleBatchSubmit}
                  disabled={batchSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white"
                  style={{ background: batchSubmitting ? '#9ca3af' : '#5C2D91' }}>
                  <Send size={12} />
                  {batchSubmitting ? 'Submitting…' : `Submit ${selectedClaims.size} to Availity`}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="pb-3 pr-3 w-8">
                      <input type="checkbox" onChange={e => {
                        if (e.target.checked) setSelectedClaims(new Set(filtered.filter(c => c.status === 'pending' || !c.availityClaimId).map(c => c.id)));
                        else setSelectedClaims(new Set());
                      }} />
                    </th>
                    {['Claim ID', 'Client', 'Service Date', 'CPT', 'Insurance', 'Amount', 'Status', 'Clearinghouse', ''].map(h => (
                      <th key={h} className="text-left pb-3 pr-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-3">
                        <input type="checkbox" checked={selectedClaims.has(c.id)}
                          onChange={e => setSelectedClaims(prev => { const s = new Set(prev); e.target.checked ? s.add(c.id) : s.delete(c.id); return s; })} />
                      </td>
                      <td className="py-3 pr-3 text-xs font-mono text-gray-500">{c.id}</td>
                      <td className="py-3 pr-3">
                        <p className="text-sm font-medium text-gray-900">{c.client}</p>
                        <p className="text-xs text-gray-400">{c.clinician}</p>
                      </td>
                      <td className="py-3 pr-3 text-sm text-gray-600">{c.serviceDate}</td>
                      <td className="py-3 pr-3">
                        <span className="text-xs font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{c.cpt}</span>
                      </td>
                      <td className="py-3 pr-3 text-sm text-gray-600">{c.insurance}</td>
                      <td className="py-3 pr-3 text-sm font-semibold text-gray-800">{c.amount}</td>
                      <td className="py-3 pr-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_STYLES[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {c.status}
                        </span>
                      </td>
                      {/* Clearinghouse column */}
                      <td className="py-3 pr-3">
                        {(c as ClaimRow).availityClaimId ? (
                          <div>
                            <span className="text-xs font-mono text-green-700 bg-green-50 px-1.5 py-0.5 rounded block mb-0.5">
                              {(c as ClaimRow).availityClaimId}
                            </span>
                            {rowStatuses[c.id] && (
                              <span className="text-xs text-blue-600">{rowStatuses[c.id]}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Not submitted</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {!(c as ClaimRow).availityClaimId ? (
                            <button
                              onClick={() => handleRowSubmit(c.id)}
                              disabled={rowSubmitting === c.id}
                              className="flex items-center gap-1 text-xs text-white px-2.5 py-1 rounded-lg font-medium"
                              style={{ background: rowSubmitting === c.id ? '#9ca3af' : '#5C2D91' }}>
                              <Send size={10} />
                              {rowSubmitting === c.id ? '…' : 'Submit'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleCheckStatus(c.id)}
                              disabled={statusChecking === c.id}
                              className="flex items-center gap-1 text-xs text-purple-600 border border-purple-200 px-2.5 py-1 rounded-lg font-medium hover:bg-purple-50">
                              <RefreshCw size={10} className={statusChecking === c.id ? 'animate-spin' : ''} />
                              {statusChecking === c.id ? '…' : '277'}
                            </button>
                          )}
                          {c.status === 'denied' && (
                            <button className="text-xs text-red-600 hover:underline font-medium">Appeal</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-sm text-gray-500">
                        <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        No claims found. Click &quot;+ New Claim&quot; to generate an 837P claim.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Insurance / Payer Breakdown */}
        {tab === 'insurance' && (
          <div className="p-6">
            <div className="space-y-4">
              {INSURANCE_BREAKDOWN.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">No payer totals yet. Totals appear after claims are entered.</p>
              ) : INSURANCE_BREAKDOWN.map(p => (
                <div key={p.payer} className="p-4 rounded-xl border border-gray-100 hover:border-purple-200 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                      <h3 className="font-semibold text-gray-800">{p.payer}</h3>
                      <span className="text-xs text-gray-400">{p.claims} total claims</span>
                    </div>
                    <span className="text-lg font-bold text-gray-800">{p.amount}</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${(p.approved / p.claims) * 100}%`, background: p.color }} />
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-green-600 font-medium flex items-center gap-1"><CheckCircle2 size={12} /> {p.approved} approved</span>
                    <span className="text-amber-600 font-medium flex items-center gap-1"><Clock size={12} /> {p.pending} pending</span>
                    {p.denied > 0 && <span className="text-red-600 font-medium">{p.denied} denied</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CPT / HCPCS Codes */}
        {tab === 'cpt' && (
          <div className="p-6 space-y-6">
            {/* Category filter */}
            <div className="flex flex-wrap gap-2">
              {cptCategories.map(cat => (
                <button key={cat} onClick={() => setCptFilter(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    cptFilter === cat ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  style={cptFilter === cat ? { background: '#5C2D91' } : {}}>
                  {cat}
                </button>
              ))}
            </div>

            {/* CPT table */}
            <div>
              <p className="text-xs text-gray-500 mb-3">Rates are standard fee schedule — actual reimbursement varies by payer contract. Add-On codes are billed in addition to a primary service code.</p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      {['Code', 'Description', 'Category', 'Fee'].map(h => (
                        <th key={h} className="text-left pb-3 pr-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredCpt.map(c => (
                        <tr key={c.code} className="hover:bg-gray-50">
                          <td className="py-3 pr-4">
                            <span className="text-sm font-mono font-bold text-purple-700">{c.code}</span>
                          </td>
                          <td className="py-3 pr-4 text-sm text-gray-700 max-w-xs">{c.desc}</td>
                          <td className="py-3 pr-4">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CAT_COLORS[c.category] || 'bg-gray-100 text-gray-600'}`}>{c.category}</span>
                          </td>
                          <td className="py-3 text-sm font-semibold text-gray-800">{c.rate}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modifiers */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Billing Modifiers</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left p-3 font-semibold">Modifier</th>
                      <th className="text-left p-3 font-semibold">Description</th>
                      <th className="text-left p-3 font-semibold">Category</th>
                      <th className="text-left p-3 font-semibold">When to Use</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {MODIFIER_CODES.map(m => (
                      <tr key={m.modifier} className="hover:bg-gray-50">
                        <td className="p-3 font-mono font-bold text-purple-700">{m.modifier}</td>
                        <td className="p-3 text-gray-700">{m.desc}</td>
                        <td className="p-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{m.category}</span>
                        </td>
                        <td className="p-3 text-gray-500 text-xs">{m.posNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Place of Service */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Place of Service (POS) Codes</p>
              <div className="flex flex-wrap gap-3">
                {POS_CODES.map(p => (
                  <div key={p.pos} className="border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-3 bg-white">
                    <span className="font-mono font-bold text-purple-700 text-sm">{p.pos}</span>
                    <span className="text-xs text-gray-600">{p.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ERA & Payments */}
        {tab === 'payments' && (
          <div className="p-6 space-y-8">
            {/* ERA Files */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Electronic Remittance Advice (ERA)</p>
                  <p className="text-xs text-gray-500 mt-0.5">835 transaction files received from payers — auto-posted to claims.</p>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <FileText size={13} /> Import ERA
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      {['ERA ID', 'Payer', 'Received', 'Claims', 'Amount Paid', 'Adjustments', 'Status', ''].map(h => (
                        <th key={h} className="text-left p-3 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ERA_FILES.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-xs text-gray-500">{e.id}</td>
                        <td className="p-3 font-semibold text-gray-800">{e.payer}</td>
                        <td className="p-3 text-gray-600">{e.received}</td>
                        <td className="p-3 text-gray-600 tabular-nums">{e.claims}</td>
                        <td className="p-3 font-semibold text-green-700 tabular-nums">{e.paid}</td>
                        <td className="p-3 text-amber-700 tabular-nums">{e.adjustments}</td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            e.status === 'posted' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>{e.status === 'review' ? 'Needs Review' : 'Auto-Posted'}</span>
                        </td>
                        <td className="p-3">
                          <button className="text-xs text-purple-600 hover:underline font-medium">View</button>
                        </td>
                      </tr>
                    ))}
                    {ERA_FILES.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-xs text-gray-400">
                          No 835 ERA remittance files received yet. Files will appear automatically as payers adjudicate claims.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment History */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Payment History</p>
                  <p className="text-xs text-gray-500 mt-0.5">Insurance EFT, patient credit card, check, and portal payments.</p>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                  style={{ background: '#5C2D91' }}>
                  <CreditCard size={13} /> Post Payment
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-100 rounded-xl overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                      {['Payment ID', 'Type', 'Source', 'Amount', 'Date', 'Method', 'Applied To'].map(h => (
                        <th key={h} className="text-left p-3 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {PAYMENT_HISTORY.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-xs text-gray-500">{p.id}</td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            p.type === 'insurance' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
                          }`}>{p.type === 'insurance' ? 'Insurance' : 'Patient'}</span>
                        </td>
                        <td className="p-3 font-semibold text-gray-800">{p.source}</td>
                        <td className="p-3 font-bold text-green-700 tabular-nums">{p.amount}</td>
                        <td className="p-3 text-gray-600">{p.date}</td>
                        <td className="p-3 text-gray-600">{p.method}</td>
                        <td className="p-3 text-xs font-mono text-gray-500">{p.ref}</td>
                      </tr>
                    ))}
                    {PAYMENT_HISTORY.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-xs text-gray-400">
                          No payment transactions recorded yet. Payments posted via EFT, Credit Card, or Check will appear here.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Adjustment Reason Codes */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Adjustment Reason Codes (CARC)</p>
              <p className="text-xs text-gray-500 mb-3">Standard CMS codes explaining claim adjustments on ERAs. CO = Contractual, PR = Patient Responsibility, OA = Other.</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {ADJ_REASON_CODES.map(a => (
                  <div key={a.code} className={`flex items-start gap-3 p-3 rounded-xl border ${a.common ? 'border-gray-200' : 'border-gray-100 opacity-70'}`}>
                    <span className="font-mono font-bold text-xs text-purple-700 shrink-0 mt-0.5">{a.code}</span>
                    <div>
                      <p className="text-xs text-gray-700">{a.desc}</p>
                      <span className={`text-xs mt-0.5 inline-block ${
                        a.responsibility === 'Patient' ? 'text-teal-600' :
                        a.responsibility === 'Other' ? 'text-orange-600' : 'text-gray-500'
                      }`}>{a.responsibility}</span>
                    </div>
                    {a.common && <span className="ml-auto text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded shrink-0">Common</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Invoices */}
        {tab === 'invoices' && (
          <div className="p-6">
            <p className="text-xs text-gray-500 mb-4">Patient-facing statements. Send reminders or mark paid individually.</p>
            <div className="grid sm:grid-cols-2 gap-4">
            {INVOICES.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-sm font-semibold text-gray-700">No Patient Invoices</p>
                <p className="text-xs text-gray-400 mt-1">Patient statements will appear here when generated from completed visits or superbills.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {INVOICES.map(inv => (
                  <div key={inv.id} className="p-4 rounded-xl border border-gray-100">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-xs font-mono text-gray-400">{inv.id}</p>
                        <p className="font-semibold text-gray-800 text-sm">{inv.client}</p>
                        <p className="text-xs text-gray-500">{inv.services}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                        inv.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>{inv.status}</span>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-lg font-bold text-gray-900">{inv.amount}</span>
                      <span className="text-xs text-gray-400">Due {inv.due}</span>
                    </div>
                    {inv.status !== 'paid' && (
                      <div className="flex gap-2 mt-3">
                        <button className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                          Send Reminder
                        </button>
                        <button className="flex-1 py-1.5 rounded-lg text-xs font-medium text-white"
                          style={{ background: '#5C2D91' }}>
                          Mark Paid
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </div>

      {/* Billing Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <p className="text-xs text-amber-800 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span><strong>HIPAA Billing Notice:</strong> All billing information is protected health information (PHI). Access is restricted to authorized billing staff. Ensure compliance with Maryland HIPAA regulations and Medicaid billing requirements. 42 CFR Part 2 applies to any SUD-related billing — obtain specific written consent before disclosing to payers.</span>
        </p>
      </div>

      {/* New Claim Modal */}
      {newClaimModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            {submitResult ? (
              <div className="text-center py-6">
                <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3" />
                <p className="text-lg font-bold text-gray-900 mb-1">Claim Submitted</p>
                <p className="text-sm text-gray-500 mb-3">Transmitted to Waystar clearinghouse via 837P</p>
                <div className="bg-gray-50 rounded-xl p-3 text-left space-y-1 text-sm mb-5">
                  <div><span className="text-gray-500">Internal Claim ID:</span> <span className="font-mono font-semibold">{submitResult.claimId}</span></div>
                  <div><span className="text-gray-500">Waystar Tracking ID:</span> <span className="font-mono font-semibold text-green-700">{submitResult.availityClaimId}</span></div>
                  <div><span className="text-gray-500">Transaction:</span> <span className="text-gray-700">ASC X12N 837P Professional Claim</span></div>
                  {CLEARINGHOUSE_DEMO && <div className="text-xs text-amber-600 pt-1">Demo Mode — not transmitted to live payer. Set WAYSTAR_CLIENT_ID to go live.</div>}
                </div>
                <button onClick={() => {
                  setNewClaimModal(false);
                  setSubmitResult(null);
                  setForm({
                    client: '', serviceDate: '', pos: '11', diagnosisCodes: [],
                    payer: 'Optum MD Medicaid BH', clinician: '',
                    memberId: '', notes: '', serviceLines: [{ cptCode: '90837', modifier: '', units: 1, unitCharge: 180 }]
                  });
                }}
                  className="px-6 py-2.5 rounded-xl text-sm font-medium text-white"
                  style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Submit New Claim to Waystar (837P)</h2>
                    <p className="text-xs text-gray-500">Electronic professional claim filing with multi-service line scrub</p>
                  </div>
                  <button onClick={() => setNewClaimModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>

                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Client Name *</label>
                      <ClientCombo
                        value={form.client}
                        clients={realClients}
                        onChange={(name, memberId, payer) => setForm(f => ({
                          ...f,
                          client: name,
                          memberId: f.memberId || memberId,
                          payer: payer || f.payer
                        }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Date of Service *</label>
                      <input type="date" value={form.serviceDate} onChange={e => setForm(f => ({ ...f, serviceDate: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Insurance Payer *</label>
                      <input
                        list="payer-master-list"
                        value={form.payer}
                        onChange={e => setForm(f => ({ ...f, payer: e.target.value }))}
                        placeholder="Search payer..."
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                      <datalist id="payer-master-list">
                        <option value="Optum MD Medicaid BH" />
                        <option value="Medicare Novitas Solutions" />
                        <option value="CareFirst BlueCross BlueShield" />
                        <option value="Aetna Behavioral Health" />
                        <option value="UnitedHealthcare Community Plan" />
                        <option value="Cigna Behavioral Health" />
                        <option value="Maryland Medicaid" />
                        <option value="Self-Pay" />
                      </datalist>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Place of Service (POS)</label>
                      <select value={form.pos} onChange={e => setForm(f => ({ ...f, pos: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300">
                        {POS_CODES.map(p => <option key={p.pos} value={p.pos}>{p.pos} — {p.desc}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-600 font-medium block mb-1">Diagnosis Code (ICD-10) *</label>
                    <IcdCombo
                      selected={form.diagnosisCodes}
                      onChange={codes => setForm(f => ({ ...f, diagnosisCodes: codes }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Member ID</label>
                      <input value={form.memberId} onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 font-mono" placeholder="Insurance member ID" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Rendering Clinician</label>
                      <select value={form.clinician} onChange={e => setForm(f => ({ ...f, clinician: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300">
                        <option value="">Select clinician…</option>
                        {clinicians.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Multi-CPT Service Lines */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-700 font-semibold">Service Lines (CPT / HCPCS)</label>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          serviceLines: [...f.serviceLines, { cptCode: '90837', modifier: '', units: 1, unitCharge: 180 }]
                        }))}
                        className="text-xs text-purple-700 hover:text-purple-900 font-medium flex items-center gap-1 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200"
                      >
                        <Plus size={12} /> Add CPT Line
                      </button>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {form.serviceLines.map((line, idx) => (
                        <div key={idx} className="p-2.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-gray-600">Line {idx + 1}</span>
                            {form.serviceLines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setForm(f => ({ ...f, serviceLines: f.serviceLines.filter((_, i) => i !== idx) }))}
                                className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-6">
                              <label className="text-[10px] text-gray-500 block">CPT Code</label>
                              <select
                                value={line.cptCode}
                                onChange={e => {
                                  const code = e.target.value;
                                  const found = CPT_CODES.find(c => c.code === code);
                                  const rateNum = found ? parseFloat(found.rate.replace('$', '')) : 100;
                                  setForm(f => ({
                                    ...f,
                                    serviceLines: f.serviceLines.map((l, i) => i === idx ? { ...l, cptCode: code, unitCharge: rateNum } : l)
                                  }));
                                }}
                                className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white"
                              >
                                {CPT_CODES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.desc} ({c.rate})</option>)}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-gray-500 block">Mod</label>
                              <input
                                value={line.modifier}
                                onChange={e => setForm(f => ({
                                  ...f,
                                  serviceLines: f.serviceLines.map((l, i) => i === idx ? { ...l, modifier: e.target.value } : l)
                                }))}
                                placeholder="95, HF"
                                className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white uppercase font-mono"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-gray-500 block">Units</label>
                              <input
                                type="number"
                                min="1"
                                value={line.units}
                                onChange={e => setForm(f => ({
                                  ...f,
                                  serviceLines: f.serviceLines.map((l, i) => i === idx ? { ...l, units: parseInt(e.target.value) || 1 } : l)
                                }))}
                                className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-gray-500 block">Charge ($)</label>
                              <input
                                type="number"
                                value={line.unitCharge}
                                onChange={e => setForm(f => ({
                                  ...f,
                                  serviceLines: f.serviceLines.map((l, i) => i === idx ? { ...l, unitCharge: parseFloat(e.target.value) || 0 } : l)
                                }))}
                                className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Running Claim Total Summary */}
                  <div className="bg-purple-50 rounded-xl p-3 text-sm flex justify-between items-center border border-purple-100">
                    <span className="text-gray-700 font-medium">Claim Total ({form.serviceLines.length} line{form.serviceLines.length > 1 ? 's' : ''})</span>
                    <span className="font-bold text-purple-700 text-base">
                      ${form.serviceLines.reduce((acc, l) => acc + (l.unitCharge * (l.units || 1)), 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 mt-5">
                  <button onClick={() => setNewClaimModal(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitClaim}
                    disabled={submitting || !form.client || !form.serviceDate || form.diagnosisCodes.length === 0}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-2"
                    style={{ background: (submitting || !form.client || !form.serviceDate || form.diagnosisCodes.length === 0) ? '#d1d5db' : 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
                    {submitting ? <><RefreshCw size={14} className="animate-spin" /> Transmitting 837P…</> : <><Send size={14} /> Submit to Waystar (837P)</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
