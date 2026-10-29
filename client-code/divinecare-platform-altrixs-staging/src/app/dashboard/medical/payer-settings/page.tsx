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
import { buttonClasses } from '@/components/ui';

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

// No built-in payers or rules: the lists show only what this practice saved.

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

  const [payers, setPayers] = useState<MedicalPayerRecord[]>([]);
  const [rules, setRules] = useState<MedicalBillingRuleRecord[]>([]);
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
  const [testClaimPayerId, setTestClaimPayerId] = useState('');
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
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Could not load payer settings');
        }
        setPayers(Array.isArray(data.payers) ? data.payers : []);
        setRules(Array.isArray(data.rules) ? data.rules : []);
      } catch (err: any) {
        setFeedbackMsg({
          type: 'error',
          text: `${err?.message || 'Could not load payer settings'}. Nothing is shown until your saved settings load.`,
        });
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not update payer');
      setPayers((prev) => prev.map((p) => (p.id === id ? data.payer : p)));
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Could not update payer' });
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
      if (!res.ok || !data.success || !Array.isArray(data.rules)) {
        throw new Error(data.error || 'Could not reorder rules');
      }
      setRules(data.rules);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Could not reorder rules' });
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not update rule');
      setRules((prev) => prev.map((r) => (r.id === id ? data.rule : r)));
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Could not update rule' });
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
      patientId: 'TEST-CLAIM',
      patientName: 'Test Claim (not a patient)',
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
      <div className="mx-auto w-full max-w-3xl">
        <div className="pt-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center shadow-xs">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 mb-3">
              <Shield size={24} />
            </div>
            <h2 className="text-base font-semibold text-amber-900">Access Restricted</h2>
            <p className="mt-1 text-sm text-amber-800">
              Payer Settings requires Practice Director, Billing Specialist, or Office Manager role.
            </p>
            <div className="mt-5">
              <Link
                href="/dashboard/medical"
                className={buttonClasses({ size: 'sm' })}
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
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
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
        <section className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Building2 size={18} className="text-blue-600" />
                Payer Registry
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {activePayerCount} active payers — enforces one-to-one Payer ID &harr; Name mapping
              </p>
            </div>
            <button
              type="button"
              onClick={openAddPayer}
              className={buttonClasses({ size: 'sm', className: 'self-start' })}
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
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="relative min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search payer, ID, clearinghouse…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-500 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Payers Table */}
          <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="py-2.5 px-3">Payer ID</th>
                  <th scope="col" className="py-2.5 px-3">Payer Name</th>
                  <th scope="col" className="py-2.5 px-3">Type</th>
                  <th scope="col" className="py-2.5 px-3">Timely Filing</th>
                  <th scope="col" className="py-2.5 px-3 text-center">E-Submit</th>
                  <th scope="col" className="py-2.5 px-3">Clearinghouse</th>
                  <th scope="col" className="py-2.5 px-3">Status</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading && filteredPayers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 px-3 text-center text-slate-500">
                      {payers.length === 0 ? 'No payers configured yet. Add the payers this practice bills.' : 'No payers match your search.'}
                    </td>
                  </tr>
                )}
                {filteredPayers.map((p) => {
                  const isShortTimely = p.timely > 0 && p.timely <= 90;
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50/80 transition ${!p.active ? 'opacity-50 bg-slate-50/40' : ''}`}
                    >
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-700">
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px]">
                          {p.payerId}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        <div>{p.name}</div>
                        <div className="text-[11px] text-slate-500 font-semibold">{p.shortName}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            p.payerType === 'Medicare'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : p.payerType === 'Medicaid'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : p.payerType === 'Self-Pay'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
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
                              <span className="bg-amber-100 text-amber-800 text-[11px] px-1 py-0.5 rounded font-semibold border border-amber-300">
                                &le;90d
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">N/A</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {p.electronicSubmission ? (
                          <CheckCircle2 size={15} className="text-emerald-700 inline" />
                        ) : (
                          <X size={15} className="text-slate-500 inline" />
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px]">
                        {p.clearinghouse}
                      </td>
                      <td className="py-2.5 px-3">
                        {p.active ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
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
                            className="p-1 rounded text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition"
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
                              <ToggleRight size={18} className="text-emerald-700" />
                            ) : (
                              <ToggleLeft size={18} className="text-slate-500" />
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
        <section className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Cpu size={18} className="text-blue-600" />
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
            {!loading && rules.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                No billing rules configured yet.
              </p>
            )}
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
                        <span className="px-2 py-0.5 rounded font-mono font-semibold text-xs bg-slate-100 text-slate-800 border border-slate-200">
                          P{rule.priority}
                        </span>
                        <h3 className="font-semibold text-sm text-slate-900">{rule.name}</h3>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                          {rule.ruleType}
                        </span>
                      </div>

                      {rule.description && (
                        <p className="text-xs text-slate-600">{rule.description}</p>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-xs">
                        <div className="flex items-start gap-1.5 text-amber-900 bg-amber-50/80 p-2 rounded-lg border border-amber-200">
                          <Zap size={14} className="text-amber-700 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-[11px] uppercase tracking-wide text-amber-800 block">
                              Trigger Condition
                            </span>
                            <span className="text-[11px]">{rule.trigger}</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5 text-emerald-900 bg-emerald-50/80 p-2 rounded-lg border border-emerald-200">
                          <CheckCircle2 size={14} className="text-emerald-700 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-[11px] uppercase tracking-wide text-emerald-800 block">
                              Action Resolution
                            </span>
                            <span className="text-[11px]">{rule.action}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-600">Payers:</span>
                        {rule.payers.map((item) => (
                          <span
                            key={item}
                            className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-700 font-mono text-[11px] border border-slate-200"
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
                        className="p-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={isLast || reordering}
                        onClick={() => void handleReorderRule(rule.id, 'down')}
                        title="Move Priority Down"
                        className="p-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
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
                          <ToggleRight size={18} className="text-emerald-700" />
                        ) : (
                          <ToggleLeft size={18} className="text-slate-500" />
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
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-blue-600">
                <span className="text-xs font-semibold uppercase tracking-wider">MDB — Behavioral Health</span>
                <TrendingUp size={16} />
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">1,300 &ndash; 1,800</p>
              <p className="mt-1 text-xs text-blue-700">Estimated commercial & Medicaid claims / mo</p>
            </div>

            <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-sky-700">
                <span className="text-xs font-semibold uppercase tracking-wider">BC Services — Primary Care</span>
                <Building2 size={16} />
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">50 &ndash; 60</p>
              <p className="mt-1 text-xs text-sky-700">Outpatient primary medical encounters / mo</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-700">
                <span className="text-xs font-semibold uppercase tracking-wider">Total Monthly Pipeline</span>
                <Layers size={16} />
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">~1,850</p>
              <p className="mt-1 text-xs text-slate-500">Integrated EHR claim volume across all payers</p>
            </div>
          </div>

          {/* Clearinghouse Status Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                  <Wifi size={16} className="text-blue-600" />
                  Clearinghouse Electronic Transmissions
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  EDI 837 claim submission and 835 remittance advice status
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 flex items-start gap-2">
              <AlertCircle size={15} className="text-slate-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Not connected yet:</span> the medical module has no live clearinghouse
                connection, so there is no transmission status or claim count to show. Medical claims are not sent
                from Altrixs; submit them through the clearinghouse portal and mark them Submitted on the Medical
                Billing page.
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: LIVE CLAIM SCRUBBER VALIDATION STUDIO */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-700" />
                Live Claim Scrubber Validation Studio
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulate how claims pass through the active P1&ndash;P6 billing rules prior to 837 transmission
              </p>
            </div>
            <button
              type="button"
              onClick={runTestScrubber}
              className={buttonClasses({ size: 'sm' })}
            >
              <Cpu size={14} />
              Run Claim Scrub
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Payer</label>
              <select
                value={testClaimPayerId}
                onChange={(e) => setTestClaimPayerId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
              >
                {payers.map((p) => (
                  <option key={p.id} value={p.payerId}>
                    {p.name} ({p.shortName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Visit Location</label>
              <select
                value={testClaimLocation}
                onChange={(e) => setTestClaimLocation(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
              >
                <option value="Telehealth">Telehealth (GT / 95 rule)</option>
                <option value="Office">Office (In-Person)</option>
                <option value="Facility">Facility</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Rendering Provider</label>
              <select
                value={testProviderRole}
                onChange={(e) => setTestProviderRole(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
              >
                <option value="Intern">Intern / Resident (P1 Supervisor NPI)</option>
                <option value="Physician">Licensed Physician (MD/DO)</option>
                <option value="Nurse Practitioner">Nurse Practitioner (CRNP)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">DOS Age</label>
              <select
                value={testDosDaysAgo}
                onChange={(e) => setTestDosDaysAgo(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
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
                className="rounded text-blue-600 focus:ring-0"
              />
              <span>Attach Same-Day Preventive (99395) &rarr; Tests Rule P4 Modifier 25</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={testHasSecondary}
                onChange={(e) => setTestHasSecondary(e.target.checked)}
                className="rounded text-blue-600 focus:ring-0"
              />
              <span>Has Secondary Insurance on File &rarr; Tests Rule P5 MSP Check</span>
            </label>
          </div>

          {/* Scrubber Output */}
          {scrubberResult && (
            <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  Scrubber Evaluation Result:
                  {scrubberResult.clean ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px]">
                      READY FOR SUBMISSION
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-semibold text-[11px]">
                      VALIDATION ERRORS
                    </span>
                  )}
                </span>
                <span className="text-slate-500 font-mono text-[11px]">
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
                      <span className="px-1.5 py-0.5 rounded font-mono font-semibold text-[11px] bg-slate-100 text-slate-700">
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
                  <div className="font-semibold flex items-center gap-1">
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
                  <div className="font-semibold flex items-center gap-1">
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
                <span className="font-semibold text-slate-700">Scrubbed Procedure Lines:</span>{' '}
                {scrubberResult.modifiedClaim.lines.map((l) => (
                  <span key={l.id} className="font-mono ml-2 font-semibold text-blue-900">
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
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 animate-in fade-in space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-sm text-slate-900">
                {editingPayer ? `Edit Payer — ${editingPayer.name}` : 'Add Insurance Payer'}
              </h3>
              <button
                type="button"
                onClick={() => setPayerModalOpen(false)}
                className="text-slate-500 hover:text-slate-600 font-semibold text-base"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
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
                      : 'border-slate-200 focus:border-blue-600'
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payer Full Name *</label>
                  <input
                    type="text"
                    value={formPayerName}
                    onChange={(e) => setFormPayerName(e.target.value)}
                    placeholder="e.g. CareFirst BlueCross BlueShield"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Short Name / Code</label>
                  <input
                    type="text"
                    value={formShortName}
                    onChange={(e) => setFormShortName(e.target.value)}
                    placeholder="e.g. BCBS-MD"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payer Type</label>
                  <select
                    value={formPayerType}
                    onChange={(e) => setFormPayerType(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  >
                    <option value="Commercial">Commercial</option>
                    <option value="Medicare">Medicare</option>
                    <option value="Medicaid">Medicaid</option>
                    <option value="Self-Pay">Self-Pay</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Clearinghouse</label>
                  <select
                    value={formClearinghouse}
                    onChange={(e) => setFormClearinghouse(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  >
                    <option value="Availity">Availity</option>
                    <option value="Change Healthcare">Change Healthcare</option>
                    <option value="Office Ally">Office Ally</option>
                    <option value="N/A">N/A (Self-Pay)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Timely Filing (Days)</label>
                  <input
                    type="number"
                    value={formTimely}
                    onChange={(e) => setFormTimely(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Electronic Submission</label>
                  <select
                    value={formESubmit ? 'true' : 'false'}
                    onChange={(e) => setFormESubmit(e.target.value === 'true')}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  >
                    <option value="true">Enabled (837 EDI)</option>
                    <option value="false">Paper / CMS-1500 only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Claims Mailing Address</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="PO Box, City, State, Zip"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Provider Phone</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="(800) 000-0000"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Portal Website</label>
                  <input
                    type="text"
                    value={formWebsite}
                    onChange={(e) => setFormWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
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
                className={buttonClasses()}
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
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 animate-in fade-in space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-sm text-slate-900">
                {editingRule ? `Edit Rule — ${editingRule.name}` : 'Create Scrubber Rule'}
              </h3>
              <button
                type="button"
                onClick={() => setRuleModalOpen(false)}
                className="text-slate-500 hover:text-slate-600 font-semibold text-base"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Rule Name *</label>
                <input
                  type="text"
                  value={formRuleName}
                  onChange={(e) => setFormRuleName(e.target.value)}
                  placeholder="e.g. Telehealth POS 10 Modifier Rule"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formRuleDescription}
                  onChange={(e) => setFormRuleDescription(e.target.value)}
                  placeholder="Brief clinical billing explanation"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Rule Type</label>
                  <select
                    value={formRuleType}
                    onChange={(e) => setFormRuleType(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  >
                    <option value="supervisor_npi">supervisor_npi</option>
                    <option value="telehealth_modifier">telehealth_modifier</option>
                    <option value="modifier_auto">modifier_auto</option>
                    <option value="payer_specific">payer_specific</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payers Affected</label>
                  <input
                    type="text"
                    value={formPayers}
                    onChange={(e) => setFormPayers(e.target.value)}
                    placeholder="All, 77013, 00840"
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Trigger Condition *</label>
                <input
                  type="text"
                  value={formTrigger}
                  onChange={(e) => setFormTrigger(e.target.value)}
                  placeholder="Condition that fires the rule"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Action Resolution *</label>
                <input
                  type="text"
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value)}
                  placeholder="Action taken on the claim (e.g. append modifier)"
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-600"
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
