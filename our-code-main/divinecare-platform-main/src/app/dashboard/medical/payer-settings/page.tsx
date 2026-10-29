'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Clock,
  Cpu,
  Edit2,
  ExternalLink,
  Layers,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { useAuth } from '@/features/auth';
import { scrubMedicalClaim, type ScrubberResult } from '@/lib/medical/claimScrubber';

export interface MedicalPayerRecord {
  id: string;
  payerId: string;
  name: string;
  shortName: string;
  payerType: string;
  address?: string | null;
  claimsPhone?: string | null;
  website?: string | null;
  timely: number;
  electronicSubmission: boolean;
  clearinghouse: string;
  active: boolean;
}

export interface MedicalBillingRuleRecord {
  id: string;
  name: string;
  description?: string | null;
  ruleType: string;
  trigger: string;
  action: string;
  payers: string[];
  active: boolean;
  priority: number;
  lastModified?: string | null;
  modifiedBy?: string | null;
}

export interface MedicalClearinghouseRecord {
  id?: string;
  name: string;
  status: string;
  warningMsg?: string | null;
  lastTx: string;
  claimsMTD: number;
}

const DEFAULT_PAYERS: MedicalPayerRecord[] = [
  {
    id: 'p-1',
    payerId: '87726',
    name: 'UnitedHealthcare / Optum',
    shortName: 'UHC',
    payerType: 'Commercial',
    address: 'PO Box 740800, Atlanta, GA 30374',
    claimsPhone: '(877) 842-3210',
    website: 'https://www.uhcprovider.com',
    timely: 90,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    id: 'p-2',
    payerId: '00050',
    name: 'Humana',
    shortName: 'HUM',
    payerType: 'Commercial',
    address: 'PO Box 14601, Lexington, KY 40512',
    claimsPhone: '(800) 448-6262',
    website: 'https://www.humana.com/provider',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Change Healthcare',
    active: true,
  },
  {
    id: 'p-3',
    payerId: '00960',
    name: 'Aetna',
    shortName: 'AET',
    payerType: 'Commercial',
    address: 'PO Box 981106, El Paso, TX 79998',
    claimsPhone: '(800) 624-0756',
    website: 'https://www.aetna.com/health-care-professionals.html',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    id: 'p-4',
    payerId: '00901',
    name: 'BlueCross BlueShield of Maryland',
    shortName: 'BCBS-MD',
    payerType: 'Commercial',
    address: '10455 Mill Run Circle, Owings Mills, MD 21117',
    claimsPhone: '(800) 676-2583',
    website: 'https://provider.carefirst.com',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    id: 'p-5',
    payerId: '00840',
    name: 'Medicare Part B — Novitas Solutions',
    shortName: 'MCR',
    payerType: 'Medicare',
    address: 'PO Box 3111, Mechanicsburg, PA 17055',
    claimsPhone: '(855) 252-8782',
    website: 'https://www.novitas-solutions.com',
    timely: 365,
    electronicSubmission: true,
    clearinghouse: 'Change Healthcare',
    active: true,
  },
  {
    id: 'p-6',
    payerId: '77013',
    name: 'Maryland Medicaid (HealthChoice)',
    shortName: 'MDMCD',
    payerType: 'Medicaid',
    address: 'PO Box 1935, Baltimore, MD 21203',
    claimsPhone: '(800) 445-1159',
    website: 'https://mmcp.health.maryland.gov',
    timely: 360,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    id: 'p-7',
    payerId: '52133',
    name: 'Cigna Healthcare',
    shortName: 'CIG',
    payerType: 'Commercial',
    address: 'PO Box 188011, Chattanooga, TN 37422',
    claimsPhone: '(800) 882-4462',
    website: 'https://www.cigna.com/health-care-providers',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Office Ally',
    active: true,
  },
  {
    id: 'p-8',
    payerId: 'SELF',
    name: 'Self-Pay',
    shortName: 'SP',
    payerType: 'Self-Pay',
    address: 'In-Clinic Private Pay Account',
    claimsPhone: 'N/A',
    website: 'N/A',
    timely: 0,
    electronicSubmission: false,
    clearinghouse: 'N/A',
    active: true,
  },
];

const DEFAULT_RULES: MedicalBillingRuleRecord[] = [
  {
    id: 'r-1',
    priority: 1,
    name: 'Supervisor NPI — Box 24J',
    description: 'Enforces supervising physician NPI on claims rendered by residents or interns.',
    ruleType: 'supervisor_npi',
    trigger: 'Rendering provider role = Intern / Resident',
    action: 'Populate Box 24J with supervising physician NPI from provider record',
    payers: ['All'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    id: 'r-2',
    priority: 2,
    name: 'Telehealth Modifier — Medicaid (GT)',
    description: 'Attaches modifier GT to all telehealth procedure codes for state Medicaid claims.',
    ruleType: 'telehealth_modifier',
    trigger: 'Visit location = Telehealth AND payer type = Medicaid',
    action: 'Append modifier GT to all procedure codes on claim',
    payers: ['77013'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    id: 'r-3',
    priority: 3,
    name: 'Telehealth Modifier — Commercial/Medicare (95)',
    description: 'Attaches modifier 95 to all commercial and Medicare telehealth procedure lines.',
    ruleType: 'telehealth_modifier',
    trigger: 'Visit location = Telehealth AND payer type ≠ Medicaid',
    action: 'Append modifier 95 to all procedure codes on claim',
    payers: ['All except Medicaid'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    id: 'r-4',
    priority: 4,
    name: 'Preventive + Office Visit Modifier (25)',
    description: 'Appends modifier 25 to E&M visits occurring on the same day as a wellness visit.',
    ruleType: 'modifier_auto',
    trigger: 'Same-day CPT: 99381-99397 AND 99202-99215',
    action: 'Append modifier 25 to E&M code (99202-99215)',
    payers: ['All'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    id: 'r-5',
    priority: 5,
    name: 'Medicare Secondary Payer Check',
    description: 'Flags claims for coordination of benefits review when Medicare is primary with secondary.',
    ruleType: 'payer_specific',
    trigger: 'Primary payer = Medicare AND secondary insurance on file',
    action: 'Flag claim as MSP review required before submission',
    payers: ['00840'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    id: 'r-6',
    priority: 6,
    name: 'Timely Filing Warning',
    description: 'Alerts billing staff when a charge approaches within 30 days of the filing cutoff.',
    ruleType: 'custom',
    trigger: 'Date of service + timely filing limit ≤ 30 days from today',
    action: 'Show amber warning banner on charge and flag in worklist',
    payers: ['All'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
];

const DEFAULT_CLEARINGHOUSES: MedicalClearinghouseRecord[] = [
  {
    name: 'Availity',
    status: 'connected',
    warningMsg: '',
    lastTx: '09/28/2026',
    claimsMTD: 847,
  },
  {
    name: 'Change Healthcare',
    status: 'connected',
    warningMsg: '',
    lastTx: '09/27/2026',
    claimsMTD: 312,
  },
  {
    name: 'Office Ally',
    status: 'warning',
    warningMsg: 'Credentials expiring in 8 days',
    lastTx: '09/20/2026',
    claimsMTD: 141,
  },
];

export default function MedicalPayerSettingsPage() {
  const { user } = useAuth();

  // Role Gatekeeper
  const isAllowed =
    !user ||
    user.role === 'PRACTICE_DIRECTOR' ||
    user.role === 'BILLING' ||
    user.role === 'ADMIN' ||
    user.role === 'DIRECTOR' ||
    user.baseRole === 'ADMIN';

  const [payers, setPayers] = useState<MedicalPayerRecord[]>(DEFAULT_PAYERS);
  const [rules, setRules] = useState<MedicalBillingRuleRecord[]>(DEFAULT_RULES);
  const [clearinghouses, setClearinghouses] = useState<MedicalClearinghouseRecord[]>(DEFAULT_CLEARINGHOUSES);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Commercial' | 'Medicare' | 'Medicaid' | 'Self-Pay'>('All');

  // Modal State
  const [payerModalOpen, setPayerModalOpen] = useState(false);
  const [editingPayer, setEditingPayer] = useState<MedicalPayerRecord | null>(null);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<MedicalBillingRuleRecord | null>(null);

  // Payer Form State
  const [formPayerId, setFormPayerId] = useState('');
  const [formPayerName, setFormPayerName] = useState('');
  const [formShortName, setFormShortName] = useState('');
  const [formPayerType, setFormPayerType] = useState('Commercial');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formWebsite, setFormWebsite] = useState('');
  const [formTimely, setFormTimely] = useState(180);
  const [formESubmit, setFormESubmit] = useState(true);
  const [formClearinghouse, setFormClearinghouse] = useState('Availity');
  const [formActive, setFormActive] = useState(true);

  // Rule Form State
  const [formRuleName, setFormRuleName] = useState('');
  const [formRuleDescription, setFormRuleDescription] = useState('');
  const [formRuleType, setFormRuleType] = useState('custom');
  const [formTrigger, setFormTrigger] = useState('');
  const [formAction, setFormAction] = useState('');
  const [formPayers, setFormPayers] = useState('All');

  // Status Notices
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reordering, setReordering] = useState(false);

  // Live Scrubber Testing State
  const [testClaimPayerId, setTestClaimPayerId] = useState('87726');
  const [testClaimLocation, setTestClaimLocation] = useState<'Office' | 'Telehealth' | 'Facility'>('Telehealth');
  const [testProviderRole, setTestProviderRole] = useState<'Physician' | 'Intern' | 'Resident' | 'Nurse Practitioner'>('Intern');
  const [testHasPreventive, setTestHasPreventive] = useState(false);
  const [testHasSecondary, setTestHasSecondary] = useState(false);
  const [testDosDaysAgo, setTestDosDaysAgo] = useState(10);
  const [scrubberResult, setScrubberResult] = useState<ScrubberResult | null>(null);

  // Load from API
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetch('/api/medical/payer-settings');
        const data = await res.json();
        if (data.success) {
          if (Array.isArray(data.payers) && data.payers.length > 0) {
            setPayers(data.payers);
          }
          if (Array.isArray(data.rules) && data.rules.length > 0) {
            setRules(data.rules);
          }
          if (Array.isArray(data.clearinghouses) && data.clearinghouses.length > 0) {
            setClearinghouses(data.clearinghouses);
          }
        }
      } catch (err) {
        console.error('Failed to load payer settings from API:', err);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  // Real-time unique Payer ID duplicate conflict check
  const payerIdConflict = useMemo(() => {
    if (!formPayerId.trim()) return null;
    const clean = formPayerId.trim().toUpperCase();
    return payers.find(
      (p) => p.payerId.toUpperCase() === clean && (!editingPayer || p.id !== editingPayer.id)
    );
  }, [formPayerId, payers, editingPayer]);

  // Open Payer Modal
  const openAddPayer = () => {
    setEditingPayer(null);
    setFormPayerId('');
    setFormPayerName('');
    setFormShortName('');
    setFormPayerType('Commercial');
    setFormAddress('');
    setFormPhone('');
    setFormWebsite('');
    setFormTimely(180);
    setFormESubmit(true);
    setFormClearinghouse('Availity');
    setFormActive(true);
    setPayerModalOpen(true);
  };

  const openEditPayer = (p: MedicalPayerRecord) => {
    setEditingPayer(p);
    setFormPayerId(p.payerId);
    setFormPayerName(p.name);
    setFormShortName(p.shortName);
    setFormPayerType(p.payerType);
    setFormAddress(p.address || '');
    setFormPhone(p.claimsPhone || '');
    setFormWebsite(p.website || '');
    setFormTimely(p.timely);
    setFormESubmit(p.electronicSubmission);
    setFormClearinghouse(p.clearinghouse);
    setFormActive(p.active);
    setPayerModalOpen(true);
  };

  const handleSavePayer = async () => {
    if (payerIdConflict || !formPayerId.trim() || !formPayerName.trim()) return;
    try {
      const payload = {
        action: 'save_payer',
        payer: {
          id: editingPayer?.id,
          payerId: formPayerId.trim(),
          name: formPayerName.trim(),
          shortName: formShortName.trim() || formPayerName.slice(0, 6).toUpperCase(),
          payerType: formPayerType,
          address: formAddress.trim(),
          claimsPhone: formPhone.trim(),
          website: formWebsite.trim(),
          timely: formTimely,
          electronicSubmission: formESubmit,
          clearinghouse: formClearinghouse,
          active: formActive,
        },
      };
      const res = await fetch('/api/medical/payer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save payer');
      }

      setPayers((prev) => {
        const idx = prev.findIndex((p) => p.id === data.payer.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data.payer;
          return next;
        }
        return [...prev, data.payer];
      });

      setPayerModalOpen(false);
      setFeedbackMsg({ type: 'success', text: `Saved payer ${data.payer.name} successfully.` });
      setTimeout(() => setFeedbackMsg(null), 3500);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Save failed' });
    }
  };

  const handleTogglePayer = async (id: string) => {
    try {
      const res = await fetch('/api/medical/payer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_payer', id }),
      });
      const data = await res.json();
      if (data.success) {
        setPayers((prev) => prev.map((p) => (p.id === id ? data.payer : p)));
      }
    } catch (err) {
      console.error('Failed to toggle payer:', err);
    }
  };

  // Reorder Rules
  const handleReorderRule = async (ruleId: string, direction: 'up' | 'down') => {
    if (reordering) return;
    setReordering(true);
    try {
      const res = await fetch('/api/medical/payer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder_rules', ruleId, direction }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.rules)) {
        setRules(data.rules);
      }
    } catch (err) {
      console.error('Failed to reorder rules:', err);
    } finally {
      setReordering(false);
    }
  };

  const handleToggleRule = async (id: string) => {
    try {
      const res = await fetch('/api/medical/payer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_rule', id }),
      });
      const data = await res.json();
      if (data.success) {
        setRules((prev) => prev.map((r) => (r.id === id ? data.rule : r)));
      }
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const openAddRule = () => {
    setEditingRule(null);
    setFormRuleName('');
    setFormRuleDescription('');
    setFormRuleType('custom');
    setFormTrigger('');
    setFormAction('');
    setFormPayers('All');
    setRuleModalOpen(true);
  };

  const openEditRule = (r: MedicalBillingRuleRecord) => {
    setEditingRule(r);
    setFormRuleName(r.name);
    setFormRuleDescription(r.description || '');
    setFormRuleType(r.ruleType);
    setFormTrigger(r.trigger);
    setFormAction(r.action);
    setFormPayers(r.payers.join(', '));
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    if (!formRuleName.trim() || !formTrigger.trim() || !formAction.trim()) return;
    try {
      const payload = {
        action: 'save_rule',
        rule: {
          id: editingRule?.id,
          name: formRuleName.trim(),
          description: formRuleDescription.trim(),
          ruleType: formRuleType,
          trigger: formTrigger.trim(),
          action: formAction.trim(),
          payers: formPayers.split(',').map((s) => s.trim()).filter(Boolean),
        },
      };
      const res = await fetch('/api/medical/payer-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save rule');
      }

      setRules((prev) => {
        const idx = prev.findIndex((r) => r.id === data.rule.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data.rule;
          return next;
        }
        return [...prev, data.rule].sort((a, b) => a.priority - b.priority);
      });

      setRuleModalOpen(false);
      setFeedbackMsg({ type: 'success', text: `Saved rule '${data.rule.name}' successfully.` });
      setTimeout(() => setFeedbackMsg(null), 3500);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Save failed' });
    }
  };

  // Run Test Claim Scrubber
  const runTestScrubber = () => {
    const dosDate = new Date(Date.now() - testDosDaysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const lines = [
      {
        id: 'line-1',
        cptCode: '99214',
        modifiers: [],
        description: 'Office / Outpatient E&M Visit, Moderate MDM',
        fee: 145.0,
      },
    ];

    if (testHasPreventive) {
      lines.unshift({
        id: 'line-prev',
        cptCode: '99395',
        modifiers: [],
        description: 'Periodic Comprehensive Preventive Medicine Exam (18-39)',
        fee: 195.0,
      });
    }

    const testClaim = {
      id: 'CLM-TEST-001',
      patientId: 'PT-802',
      patientName: 'Jane Doe',
      payerId: testClaimPayerId,
      secondaryPayerId: testHasSecondary ? '00960' : undefined,
      dos: dosDate,
      location: testClaimLocation,
      renderingProviderRole: testProviderRole,
      renderingProviderNpi: '1982736451',
      supervisingPhysicianNpi: '1092837465',
      lines,
    };

    const res = scrubMedicalClaim(testClaim, rules, payers);
    setScrubberResult(res);
  };

  // Filtered Payers
  const filteredPayers = useMemo(() => {
    return payers.filter((p) => {
      if (typeFilter !== 'All' && p.payerType !== typeFilter) return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.shortName.toLowerCase().includes(q) ||
        p.payerId.toLowerCase().includes(q) ||
        p.clearinghouse.toLowerCase().includes(q)
      );
    });
  }, [payers, typeFilter, searchTerm]);

  const activePayerCount = useMemo(() => payers.filter((p) => p.active).length, [payers]);

  // Unauthorized Screen
  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl pt-12">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-xs">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 mb-3">
              <Shield size={24} />
            </div>
            <h2 className="text-base font-bold text-amber-900">Access Restricted</h2>
            <p className="mt-1 text-sm text-amber-800">
              Payer Settings requires Practice Director, Billing, Admin, or Director.
            </p>
            <div className="mt-5">
              <Link
                href="/dashboard/medical"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#5C2D91] text-white rounded-lg text-xs font-semibold hover:bg-[#4a2475] transition"
              >
                Return to Medical Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MedicalNavHeader
        title="Medical Payer Settings & Claim Rules"
        subtitle="Automated P1–P6 rules engine & clearinghouse telemetry"
        badge="Clearinghouse Active"
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-8">
        {/* Feedback alert */}
        {feedbackMsg && (
          <div
            className={`rounded-xl px-4 py-3 text-xs font-semibold border flex items-center gap-2 ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {feedbackMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{feedbackMsg.text}</span>
          </div>
        )}

        {/* SECTION 1: PAYER REGISTRY */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building2 size={18} className="text-[#5C2D91]" />
                Payer Registry
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {activePayerCount} active payers — enforces one-to-one Payer ID &harr; Name mapping
              </p>
            </div>
            <button
              type="button"
              onClick={openAddPayer}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#5C2D91] text-white rounded-xl text-xs font-semibold hover:bg-[#4a2475] transition shadow-xs self-start sm:self-auto"
            >
              <Plus size={14} />
              Add Payer
            </button>
          </div>

          {/* Filter & Search Bar */}
          <div className="mt-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(['All', 'Commercial', 'Medicare', 'Medicaid', 'Self-Pay'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    typeFilter === t
                      ? 'bg-[#5C2D91] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="relative min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search payer, ID, clearinghouse…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#5C2D91]"
              />
            </div>
          </div>

          {/* Payers Table */}
          <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3">Payer ID</th>
                  <th className="py-2.5 px-3">Payer Name</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Timely Filing</th>
                  <th className="py-2.5 px-3 text-center">E-Submit</th>
                  <th className="py-2.5 px-3">Clearinghouse</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPayers.map((p) => {
                  const isShortTimely = p.timely > 0 && p.timely <= 90;
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/80 transition ${!p.active ? 'opacity-50 bg-slate-50/40' : ''}`}
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px]">
                          {p.payerId}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        <div>{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-semibold">{p.shortName}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            p.payerType === 'Medicare'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : p.payerType === 'Medicaid'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : p.payerType === 'Self-Pay'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-purple-50 text-purple-700 border-purple-200'
                          }`}
                        >
                          {p.payerType}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-medium">
                        {p.timely > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span>{p.timely} days</span>
                            {isShortTimely && (
                              <span className="bg-amber-100 text-amber-800 text-[9px] px-1 py-0.2 rounded font-bold border border-amber-300">
                                &le;90d
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {p.electronicSubmission ? (
                          <CheckCircle2 size={15} className="text-emerald-600 inline" />
                        ) : (
                          <X size={15} className="text-slate-300 inline" />
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px]">
                        {p.clearinghouse}
                      </td>
                      <td className="py-2.5 px-3">
                        {p.active ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditPayer(p)}
                            title="Edit Payer"
                            className="p-1 rounded text-slate-500 hover:text-[#5C2D91] hover:bg-slate-100 transition"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleTogglePayer(p.id)}
                            title={p.active ? 'Deactivate Payer' : 'Activate Payer'}
                            className="p-1 rounded text-slate-500 hover:text-slate-800 transition"
                          >
                            {p.active ? (
                              <ToggleRight size={18} className="text-emerald-600" />
                            ) : (
                              <ToggleLeft size={18} className="text-slate-300" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECTION 2: AUTOMATED BILLING RULES ENGINE */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Cpu size={18} className="text-[#5C2D91]" />
                Automated Billing Rules Engine
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Priority-driven scrubber checks (P1 &rarr; P6) fired live before claim generation
              </p>
            </div>
            <button
              type="button"
              onClick={openAddRule}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-800 text-white rounded-xl text-xs font-semibold hover:bg-slate-900 transition shadow-xs self-start sm:self-auto"
            >
              <Plus size={14} />
              Add Custom Rule
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {rules.map((rule, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === rules.length - 1;

              return (
                <div
                  key={rule.id}
                  className={`rounded-xl border p-4 transition ${
                    rule.active
                      ? 'border-l-4 border-l-emerald-500 border-slate-200 bg-white shadow-xs'
                      : 'border-l-4 border-l-slate-300 border-slate-200 bg-slate-50/70 opacity-60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-100 text-slate-800 border border-slate-200">
                          P{rule.priority}
                        </span>
                        <h3 className="font-bold text-sm text-slate-900">{rule.name}</h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-[#5C2D91] border border-purple-200">
                          {rule.ruleType}
                        </span>
                      </div>

                      {rule.description && (
                        <p className="text-xs text-slate-600">{rule.description}</p>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-xs">
                        <div className="flex items-start gap-1.5 text-amber-900 bg-amber-50/80 p-2 rounded-lg border border-amber-200">
                          <Zap size={14} className="text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-[10px] uppercase tracking-wide text-amber-800 block">
                              Trigger Condition
                            </span>
                            <span className="text-[11px]">{rule.trigger}</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5 text-emerald-900 bg-emerald-50/80 p-2 rounded-lg border border-emerald-200">
                          <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-[10px] uppercase tracking-wide text-emerald-800 block">
                              Action Resolution
                            </span>
                            <span className="text-[11px]">{rule.action}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500">
                        <span className="font-bold text-slate-600">Payers:</span>
                        {rule.payers.map((item) => (
                          <span
                            key={item}
                            className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-700 font-mono text-[10px] border border-slate-200"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Rule Priority Arrows & Actions */}
                    <div className="flex items-center gap-1 shrink-0 self-end sm:self-start bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                      <button
                        type="button"
                        disabled={isFirst || reordering}
                        onClick={() => void handleReorderRule(rule.id, 'up')}
                        title="Move Priority Up"
                        className="p-1 rounded text-slate-600 hover:text-[#5C2D91] hover:bg-slate-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={isLast || reordering}
                        onClick={() => void handleReorderRule(rule.id, 'down')}
                        title="Move Priority Down"
                        className="p-1 rounded text-slate-600 hover:text-[#5C2D91] hover:bg-slate-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <div className="w-[1px] h-4 bg-slate-300 mx-1" />
                      <button
                        type="button"
                        onClick={() => openEditRule(rule)}
                        title="Edit Rule"
                        className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleRule(rule.id)}
                        title={rule.active ? 'Disable Rule' : 'Enable Rule'}
                        className="p-1 rounded text-slate-600 hover:text-slate-900 transition"
                      >
                        {rule.active ? (
                          <ToggleRight size={18} className="text-emerald-600" />
                        ) : (
                          <ToggleLeft size={18} className="text-slate-300" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 3: MONTHLY CLAIM VOLUME & CLEARINGHOUSE TELEMETRY */}
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-[#5C2D91]">
                <span className="text-xs font-bold uppercase tracking-wider">MDB — Behavioral Health</span>
                <TrendingUp size={16} />
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900">1,300 &ndash; 1,800</p>
              <p className="mt-1 text-xs text-purple-700">Estimated commercial & Medicaid claims / mo</p>
            </div>

            <div className="bg-teal-50/70 border border-teal-200 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-teal-700">
                <span className="text-xs font-bold uppercase tracking-wider">BC Services — Primary Care</span>
                <Building2 size={16} />
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900">50 &ndash; 60</p>
              <p className="mt-1 text-xs text-teal-700">Outpatient primary medical encounters / mo</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-700">
                <span className="text-xs font-bold uppercase tracking-wider">Total Monthly Pipeline</span>
                <Layers size={16} />
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900">~1,850</p>
              <p className="mt-1 text-xs text-slate-500">Integrated EHR claim volume across all payers</p>
            </div>
          </div>

          {/* Clearinghouse Status Table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Wifi size={16} className="text-[#5C2D91]" />
                  Clearinghouse Electronic Transmissions
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  EDI 837 claim submission and 835 remittance advice status
                </p>
              </div>
            </div>

            {/* Office Ally Warning Banner */}
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Credential Notice:</span> Clearinghouse credentials are managed in the
                vendor portal. Renew Office Ally credentials before <strong>10/07/2026</strong> to avoid submission interruptions.
              </div>
            </div>

            <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                    <th className="py-2.5 px-3">Gateway</th>
                    <th className="py-2.5 px-3">Connection Status</th>
                    <th className="py-2.5 px-3">Last Transmission</th>
                    <th className="py-2.5 px-3 text-right">Claims Sent (MTD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clearinghouses.map((c) => (
                    <tr key={c.name} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 px-3 font-semibold text-slate-900">{c.name}</td>
                      <td className="py-3 px-3">
                        {c.status === 'connected' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <AlertCircle size={12} className="text-amber-600" />
                            {c.warningMsg || 'Warning'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-600 font-mono">{c.lastTx}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800 tabular-nums">
                        {c.claimsMTD} claims
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 4: LIVE CLAIM SCRUBBER VALIDATION STUDIO */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-600" />
                Live Claim Scrubber Validation Studio
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulate how claims pass through the active P1&ndash;P6 billing rules prior to 837 transmission
              </p>
            </div>
            <button
              type="button"
              onClick={runTestScrubber}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 transition shadow-xs"
            >
              <Cpu size={14} />
              Run Claim Scrub
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Target Payer</label>
              <select
                value={testClaimPayerId}
                onChange={(e) => setTestClaimPayerId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-[#5C2D91]"
              >
                {payers.map((p) => (
                  <option key={p.id} value={p.payerId}>
                    {p.name} ({p.shortName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Visit Location</label>
              <select
                value={testClaimLocation}
                onChange={(e) => setTestClaimLocation(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-[#5C2D91]"
              >
                <option value="Telehealth">Telehealth (GT / 95 rule)</option>
                <option value="Office">Office (In-Person)</option>
                <option value="Facility">Facility</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Rendering Provider</label>
              <select
                value={testProviderRole}
                onChange={(e) => setTestProviderRole(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-[#5C2D91]"
              >
                <option value="Intern">Intern / Resident (P1 Supervisor NPI)</option>
                <option value="Physician">Licensed Physician (MD/DO)</option>
                <option value="Nurse Practitioner">Nurse Practitioner (CRNP)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">DOS Age</label>
              <select
                value={testDosDaysAgo}
                onChange={(e) => setTestDosDaysAgo(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-[#5C2D91]"
              >
                <option value={10}>10 days ago (Clean)</option>
                <option value={75}>75 days ago (Approaching 90d timely)</option>
                <option value={190}>190 days ago (Past 180d filing limit)</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-700 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={testHasPreventive}
                onChange={(e) => setTestHasPreventive(e.target.checked)}
                className="rounded text-[#5C2D91] focus:ring-0"
              />
              <span>Attach Same-Day Preventive (99395) &rarr; Tests Rule P4 Modifier 25</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={testHasSecondary}
                onChange={(e) => setTestHasSecondary(e.target.checked)}
                className="rounded text-[#5C2D91] focus:ring-0"
              />
              <span>Has Secondary Insurance on File &rarr; Tests Rule P5 MSP Check</span>
            </label>
          </div>

          {/* Scrubber Output */}
          {scrubberResult && (
            <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  Scrubber Evaluation Result:
                  {scrubberResult.clean ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                      READY FOR SUBMISSION
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                      VALIDATION ERRORS
                    </span>
                  )}
                </span>
                <span className="text-slate-400 font-mono text-[11px]">
                  Applied Rules: {scrubberResult.appliedRules.length}
                </span>
              </div>

              {/* Applied Rules details */}
              {scrubberResult.appliedRules.length > 0 && (
                <div className="space-y-1.5">
                  {scrubberResult.appliedRules.map((ar, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-lg bg-white border border-slate-200 flex items-start gap-2"
                    >
                      <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-100 text-slate-700">
                        P{ar.priority}
                      </span>
                      <div className="min-w-0 flex-1">
                        <strong className="text-slate-900">{ar.ruleName}:</strong>{' '}
                        <span className="text-slate-600">{ar.details}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Errors */}
              {scrubberResult.errors.length > 0 && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertCircle size={13} /> Errors Found:
                  </div>
                  {scrubberResult.errors.map((e, idx) => (
                    <div key={idx} className="ml-4 list-disc list-item text-[11px]">
                      {e}
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {scrubberResult.warnings.length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle size={13} /> Warnings:
                  </div>
                  {scrubberResult.warnings.map((w, idx) => (
                    <div key={idx} className="ml-4 list-disc list-item text-[11px]">
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Transformed Claim Lines Preview */}
              <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                <span className="font-bold text-slate-700">Scrubbed Procedure Lines:</span>{' '}
                {scrubberResult.modifiedClaim.lines.map((l) => (
                  <span key={l.id} className="font-mono ml-2 font-bold text-purple-900">
                    CPT {l.cptCode}
                    {l.modifiers.length > 0 ? ` (Mods: -${l.modifiers.join(', -')})` : ' (No mods)'}
                  </span>
                ))}
                {scrubberResult.modifiedClaim.box24JNpi && (
                  <span className="ml-3 font-mono text-emerald-800">
                    &bull; Box 24J NPI: {scrubberResult.modifiedClaim.box24JNpi}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* PAYER MODAL (With real-time 1-to-1 duplicate validation) */}
      {payerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 animate-in fade-in space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">
                {editingPayer ? `Edit Payer — ${editingPayer.name}` : 'Add Insurance Payer'}
              </h3>
              <button
                type="button"
                onClick={() => setPayerModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-base"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Payer ID (Electronic Routing Code) *
                </label>
                <input
                  type="text"
                  value={formPayerId}
                  onChange={(e) => setFormPayerId(e.target.value)}
                  placeholder="e.g. 87726, 00901, 77013"
                  className={`w-full rounded-lg border p-2 font-mono text-xs focus:outline-none ${
                    payerIdConflict
                      ? 'border-rose-400 bg-rose-50/50 focus:border-rose-500'
                      : 'border-slate-200 focus:border-[#5C2D91]'
                  }`}
                />
                {/* Real-time duplicate error banner */}
                {payerIdConflict && (
                  <div className="mt-1.5 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-center gap-1.5">
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>
                      Payer ID <strong>{formPayerId}</strong> is already assigned to &lsquo;{payerIdConflict.name}&rsquo;. Each
                      Payer ID must map to exactly one payer.
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payer Full Name *</label>
                  <input
                    type="text"
                    value={formPayerName}
                    onChange={(e) => setFormPayerName(e.target.value)}
                    placeholder="e.g. CareFirst BlueCross BlueShield"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Short Name / Code</label>
                  <input
                    type="text"
                    value={formShortName}
                    onChange={(e) => setFormShortName(e.target.value)}
                    placeholder="e.g. BCBS-MD"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payer Type</label>
                  <select
                    value={formPayerType}
                    onChange={(e) => setFormPayerType(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  >
                    <option value="Commercial">Commercial</option>
                    <option value="Medicare">Medicare</option>
                    <option value="Medicaid">Medicaid</option>
                    <option value="Self-Pay">Self-Pay</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Clearinghouse</label>
                  <select
                    value={formClearinghouse}
                    onChange={(e) => setFormClearinghouse(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  >
                    <option value="Availity">Availity</option>
                    <option value="Change Healthcare">Change Healthcare</option>
                    <option value="Office Ally">Office Ally</option>
                    <option value="N/A">N/A (Self-Pay)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Timely Filing (Days)</label>
                  <input
                    type="number"
                    value={formTimely}
                    onChange={(e) => setFormTimely(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Electronic Submission</label>
                  <select
                    value={formESubmit ? 'true' : 'false'}
                    onChange={(e) => setFormESubmit(e.target.value === 'true')}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  >
                    <option value="true">Enabled (837 EDI)</option>
                    <option value="false">Paper / CMS-1500 only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Claims Mailing Address</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="PO Box, City, State, Zip"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Provider Phone</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="(800) 000-0000"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Portal Website</label>
                  <input
                    type="text"
                    value={formWebsite}
                    onChange={(e) => setFormWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPayerModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(payerIdConflict) || !formPayerId.trim() || !formPayerName.trim()}
                onClick={() => void handleSavePayer()}
                className="px-4 py-2 rounded-xl bg-[#5C2D91] text-white font-semibold hover:bg-[#4a2475] transition disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              >
                Save Payer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RULE MODAL */}
      {ruleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 animate-in fade-in space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">
                {editingRule ? `Edit Rule — ${editingRule.name}` : 'Create Scrubber Rule'}
              </h3>
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-base"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Rule Name *</label>
                <input
                  type="text"
                  value={formRuleName}
                  onChange={(e) => setFormRuleName(e.target.value)}
                  placeholder="e.g. Telehealth POS 10 Modifier Rule"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formRuleDescription}
                  onChange={(e) => setFormRuleDescription(e.target.value)}
                  placeholder="Brief clinical billing explanation"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Rule Type</label>
                  <select
                    value={formRuleType}
                    onChange={(e) => setFormRuleType(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  >
                    <option value="supervisor_npi">supervisor_npi</option>
                    <option value="telehealth_modifier">telehealth_modifier</option>
                    <option value="modifier_auto">modifier_auto</option>
                    <option value="payer_specific">payer_specific</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payers Affected</label>
                  <input
                    type="text"
                    value={formPayers}
                    onChange={(e) => setFormPayers(e.target.value)}
                    placeholder="All, 77013, 00840"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Trigger Condition *</label>
                <input
                  type="text"
                  value={formTrigger}
                  onChange={(e) => setFormTrigger(e.target.value)}
                  placeholder="Condition that fires the rule"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Action Resolution *</label>
                <input
                  type="text"
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value)}
                  placeholder="Action taken on the claim (e.g. append modifier)"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-[#5C2D91]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!formRuleName.trim() || !formTrigger.trim() || !formAction.trim()}
                onClick={() => void handleSaveRule()}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-black transition disabled:opacity-40 shadow-xs"
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
