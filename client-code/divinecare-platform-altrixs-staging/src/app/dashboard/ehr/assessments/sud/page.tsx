'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  FlaskConical,
  User,
  Bell,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  ChevronRight,
  Sparkles,
  Shield,
  Send,
  ClipboardCheck,
  Stethoscope,
  MessageSquare,
  Save,
  Printer,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, buttonClasses } from '@/components/ui';

// ---------------------------------------------------------------------------
// Clients + assigned prescribers
// ---------------------------------------------------------------------------

const DEMO_CLIENTS: { id: string; name: string; prescriber: string; assigned: boolean }[] = [];

type Tool = 'audit' | 'cage' | 'nida' | 'bam';

const TOOL_META: Record<Tool, { name: string; full: string; threshold: string }> = {
  audit: { name: 'AUDIT', full: 'Alcohol Use Disorders Identification Test (WHO, 10 items)', threshold: 'Positive ≥ 8 · High risk ≥ 15 (possible dependence ≥ 20)' },
  cage: { name: 'CAGE-AID', full: 'CAGE Adapted to Include Drugs (4 items)', threshold: 'Positive ≥ 2 Yes · 1 Yes warrants further screening' },
  nida: { name: 'NIDA Quick Screen', full: 'NIDA Quick Screen (past-year, 4 substances)', threshold: 'Any drug use → full ASSIST · heavy-drinking days → AUDIT' },
  bam: { name: 'BAM', full: 'Brief Addiction Monitor (key use & craving items)', threshold: 'Any use days or craving ≥ 3 flags review' },
};

// AUDIT WHO items
const FREQ5 = ['Never', 'Monthly or less', '2–4 times a month', '2–3 times a week', '4+ times a week'];
const FREQ5B = ['Never', 'Less than monthly', 'Monthly', 'Weekly', 'Daily or almost daily'];

const AUDIT_ITEMS: { q: string; options: { label: string; value: number }[] }[] = [
  { q: 'How often do you have a drink containing alcohol?', options: FREQ5.map((l, i) => ({ label: l, value: i })) },
  { q: 'How many drinks containing alcohol do you have on a typical day when you are drinking?', options: ['1–2', '3–4', '5–6', '7–9', '10 or more'].map((l, i) => ({ label: l, value: i })) },
  { q: 'How often do you have six or more drinks on one occasion?', options: FREQ5B.map((l, i) => ({ label: l, value: i })) },
  { q: 'How often during the last year have you found that you were not able to stop drinking once you had started?', options: FREQ5B.map((l, i) => ({ label: l, value: i })) },
  { q: 'How often during the last year have you failed to do what was normally expected from you because of drinking?', options: FREQ5B.map((l, i) => ({ label: l, value: i })) },
  { q: 'How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?', options: FREQ5B.map((l, i) => ({ label: l, value: i })) },
  { q: 'How often during the last year have you had a feeling of guilt or remorse after drinking?', options: FREQ5B.map((l, i) => ({ label: l, value: i })) },
  { q: 'How often during the last year have you been unable to remember what happened the night before because you had been drinking?', options: FREQ5B.map((l, i) => ({ label: l, value: i })) },
  { q: 'Have you or someone else been injured as a result of your drinking?', options: [{ label: 'No', value: 0 }, { label: 'Yes, but not in the last year', value: 2 }, { label: 'Yes, during the last year', value: 4 }] },
  { q: 'Has a relative, friend, doctor, or another health professional expressed concern about your drinking or suggested you cut down?', options: [{ label: 'No', value: 0 }, { label: 'Yes, but not in the last year', value: 2 }, { label: 'Yes, during the last year', value: 4 }] },
];

// CAGE-AID
const CAGE_ITEMS = [
  'Have you ever felt you ought to Cut down on your drinking or drug use?',
  'Have people Annoyed you by criticizing your drinking or drug use?',
  'Have you ever felt bad or Guilty about your drinking or drug use?',
  'Have you ever had a drink or used drugs first thing in the morning (Eye-opener) to steady your nerves or get rid of a hangover?',
];

// NIDA Quick Screen
const NIDA_FREQ = ['Never', 'Once or twice', 'Monthly', 'Weekly', 'Daily or almost daily'];
const NIDA_ITEMS = [
  { key: 'alcohol', q: 'In the past year, how often have you had 5 or more drinks (men) / 4 or more drinks (women) in a day?' },
  { key: 'tobacco', q: 'In the past year, how often have you used tobacco products?' },
  { key: 'rx', q: 'In the past year, how often have you used prescription drugs for non-medical reasons?' },
  { key: 'illicit', q: 'In the past year, how often have you used illegal drugs?' },
];

interface RoutedAlert {
  id: string;
  client: string;
  prescriber: string;
  tool: string;
  score: string;
  trigger: string;
  time: string;
}

const INITIAL_ALERTS: RoutedAlert[] = [];

interface AlertRecipient {
  userId: string;
  name: string;
  roleLabel: string;
  source: 'treatment_team' | 'assigned_clinician';
}

export default function SudScreenersPage() {
  const [tool, setTool] = useState<Tool>('audit');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState(DEMO_CLIENTS);
  const [alerts, setAlerts] = useState<RoutedAlert[]>(INITIAL_ALERTS);
  const [routed, setRouted] = useState(false);
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routing, setRouting] = useState(false);
  // Screening row saved (unsigned) when the alert was routed; Sign & Save signs this row.
  const [routedScreeningId, setRoutedScreeningId] = useState<string | null>(null);
  // Who a referral alert for the selected client routes to (treatment-team prescriber first).
  const [recipient, setRecipient] = useState<AlertRecipient | null>(null);
  const [recipientLoading, setRecipientLoading] = useState(false);

  // Answers state
  const [auditAns, setAuditAns] = useState<(number | null)[]>(Array(10).fill(null));
  const [cageAns, setCageAns] = useState<(boolean | null)[]>(Array(4).fill(null));
  const [nidaAns, setNidaAns] = useState<(number | null)[]>(Array(4).fill(null));
  const [bam, setBam] = useState({ alcoholDays: '', heavyDays: '', drugDays: '', craving: null as number | null });

  // "Start SBIRT" from the SUD Referral Radar opens this page with ?clientId= preselected.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('clientId');
    if (preset) setClientId(preset);
  }, []);

  // Fetch real clients from database if available
  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/clients');
        const json = await res.json();
        // GET /api/clients returns `clients` (older callers expected `data`).
        const rows = Array.isArray(json.clients) ? json.clients : Array.isArray(json.data) ? json.data : [];
        if (json.success && rows.length > 0) {
          setClients(rows.map((c: any) => ({
            id: c.id,
            name: c.name,
            prescriber: c.assignedToName || 'No assigned clinician',
            assigned: Boolean(c.assignedToId),
          })));
        }
      } catch {
        /* no clients available */
      }

      try {
        const resAlerts = await fetch('/api/ehr/assessments/sud');
        const jsonAlerts = await resAlerts.json();
        if (jsonAlerts.success && Array.isArray(jsonAlerts.routedAlerts) && jsonAlerts.routedAlerts.length > 0) {
          setAlerts(jsonAlerts.routedAlerts);
        }
      } catch {
        /* fallback */
      }
    }
    void loadData();
  }, []);

  const client = clients.find((c) => c.id === clientId);

  useEffect(() => {
    if (!clientId) {
      setRecipient(null);
      return;
    }
    let cancelled = false;
    setRecipientLoading(true);
    fetch(`/api/ehr/assessments/sud?recipientFor=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setRecipient(json.success ? (json.recipient as AlertRecipient | null) : null);
      })
      .catch(() => {
        if (!cancelled) setRecipient(null);
      })
      .finally(() => {
        if (!cancelled) setRecipientLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const recipientLabel = recipient ? `${recipient.name} (${recipient.roleLabel})` : null;

  const resetAnswers = () => {
    setAuditAns(Array(10).fill(null));
    setCageAns(Array(4).fill(null));
    setNidaAns(Array(4).fill(null));
    setBam({ alcoholDays: '', heavyDays: '', drugDays: '', craving: null });
    setRouted(false);
    setSigned(false);
  };

  // Live scoring & trigger rules
  const result = useMemo((): { complete: boolean; score: string; level: 'negative' | 'positive' | 'high'; trigger: string } => {
    if (tool === 'audit') {
      const complete = auditAns.every((a) => a !== null);
      const total = auditAns.reduce((s: number, a) => s + (a ?? 0), 0);
      const level = total >= 15 ? 'high' : total >= 8 ? 'positive' : 'negative';
      return {
        complete,
        score: `${total} / 40`,
        level,
        trigger:
          level === 'high' ? 'High risk (AUDIT ≥ 15) — assess for dependence; consider ASAM level-of-care evaluation'
          : level === 'positive' ? 'Positive screen (AUDIT ≥ 8) — brief intervention; prescriber review for SUD referral'
          : 'Below threshold — reinforce and rescreen per protocol',
      };
    }
    if (tool === 'cage') {
      const complete = cageAns.every((a) => a !== null);
      const total = cageAns.filter((a) => a === true).length;
      const level = total >= 2 ? 'positive' : 'negative';
      return {
        complete,
        score: `${total} / 4`,
        level,
        trigger:
          level === 'positive' ? 'Positive screen (CAGE-AID ≥ 2) — brief intervention; prescriber review for SUD referral'
          : total === 1 ? 'One positive response — below threshold, but follow up with AUDIT or NIDA Quick Screen'
          : 'Below threshold — rescreen per protocol',
      };
    }
    if (tool === 'nida') {
      const complete = nidaAns.every((a) => a !== null);
      const drugUse = (nidaAns[2] ?? 0) > 0 || (nidaAns[3] ?? 0) > 0;
      const heavyAlcohol = (nidaAns[0] ?? 0) > 0;
      const level = drugUse ? 'high' : heavyAlcohol ? 'positive' : 'negative';
      return {
        complete,
        score: drugUse ? 'Drug use endorsed' : heavyAlcohol ? 'Heavy-drinking days endorsed' : 'All negative',
        level,
        trigger:
          drugUse ? 'Drug use endorsed — administer full NIDA-Modified ASSIST; prescriber review for SUD referral'
          : heavyAlcohol ? 'Heavy-drinking days endorsed — administer AUDIT'
          : 'Below threshold — rescreen annually',
      };
    }
    // BAM
    const complete = bam.alcoholDays !== '' && bam.heavyDays !== '' && bam.drugDays !== '' && bam.craving !== null;
    const anyUse = Number(bam.alcoholDays || 0) > 0 || Number(bam.heavyDays || 0) > 0 || Number(bam.drugDays || 0) > 0;
    const highCraving = (bam.craving ?? 0) >= 3;
    const level = Number(bam.heavyDays || 0) > 0 || Number(bam.drugDays || 0) > 0 ? 'high' : anyUse || highCraving ? 'positive' : 'negative';
    return {
      complete,
      score: `${bam.alcoholDays || 0}d alcohol · ${bam.heavyDays || 0}d heavy · ${bam.drugDays || 0}d drugs · craving ${bam.craving ?? '—'}/4`,
      level,
      trigger:
        level === 'high' ? 'Heavy drinking or drug use days reported — prescriber review; reassess level of care'
        : level === 'positive' ? 'Use or elevated craving reported — prescriber review; adjust treatment plan'
        : 'Stable — continue monitoring cadence',
    };
  }, [tool, auditAns, cageAns, nidaAns, bam]);

  const alertWorthy = result.complete && result.level !== 'negative';

  const toolMap: Record<Tool, string> = { audit: 'AUDIT', cage: 'CAGE_AID', nida: 'NIDA', bam: 'BAM' };
  const currentAnswers = () => (tool === 'audit' ? auditAns : tool === 'cage' ? cageAns : tool === 'nida' ? nidaAns : bam);

  // Saves the screening (unsigned) and creates a SUD_REFERRAL_PROMPT risk alert assigned to the
  // client's clinician. No SMS/push is sent — the alert appears in the Alerts queue.
  const routeAlert = async () => {
    if (!client || !alertWorthy || routing) return;
    setRouting(true);
    try {
      const res = await fetch('/api/ehr/assessments/sud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          tool: toolMap[tool],
          answers: currentAnswers(),
          routeAlert: true,
          sign: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to route referral alert');
      }
      const alert = data.data?.alert;
      const routedTo = (data.data?.recipient as AlertRecipient | null | undefined) ?? null;
      setRecipient(routedTo);
      if (alert) {
        setAlerts((prev) => [
          {
            id: alert.id,
            client: client.name,
            prescriber: routedTo
              ? `${routedTo.name} (${routedTo.roleLabel})`
              : 'Unassigned — general Alerts queue',
            tool: TOOL_META[tool].name,
            score: result.score,
            trigger: result.trigger,
            time: new Date(alert.createdAt).toISOString(),
          },
          ...prev,
        ]);
      }
      setRoutedScreeningId(data.data?.screening?.id ?? null);
      setRouted(true);
      toast.success(
        routedTo
          ? `Referral alert and To-Do task sent to ${routedTo.name}`
          : 'Referral alert created in the Alerts queue (unassigned)'
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to route referral alert');
    } finally {
      setRouting(false);
    }
  };

  const handleSaveToChart = async () => {
    if (!client) {
      toast.error('Please select a client');
      return;
    }
    if (alertWorthy && !routed) {
      toast.error('Route the referral alert before saving — positive screens cannot be filed silently');
      return;
    }

    setSaving(true);
    try {
      // A routed screening is already saved — sign that row instead of creating a duplicate.
      const res = routed && routedScreeningId
        ? await fetch('/api/ehr/assessments/sud', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: routedScreeningId, sign: true }),
          })
        : await fetch('/api/ehr/assessments/sud', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: client.id,
              tool: toolMap[tool],
              answers: currentAnswers(),
              routeAlert: false,
              sign: true,
            }),
          });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save screening');
      }

      setSigned(true);
      toast.success('SUD Screener signed and saved to chart');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error saving screening';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const levelStyle =
    result.level === 'high'
      ? { bg: 'bg-rose-50', border: 'border-rose-400', text: 'text-rose-800', Icon: AlertOctagon }
      : result.level === 'positive'
      ? { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-800', Icon: AlertTriangle }
      : { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', Icon: CheckCircle2 };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      {/* Header */}
      <PageHeader
        title={<>SUD Screeners & Referral Alerts</>}
        description={<>AUDIT · CAGE-AID · NIDA Quick Screen · BAM — threshold hits route a referral prompt and To-Do task to the treatment team&apos;s NP / psychiatrist</>}
        actions={<>
          <a href="/dashboard/ehr/scanner/sud-radar" className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}>
          <Sparkles className="h-4 w-4 text-blue-600" /> SUD Referral Radar
        </a>
        </>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Screener Column */}
        <div className="min-w-0 lg:col-span-2 space-y-4">
          {/* Client & Tool Selector */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-xs">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Client
              </label>
              <select
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); resetAnswers(); }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50/50"
              >
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {client && (
                <p className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Stethoscope className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                  {recipientLoading ? (
                    'Finding prescriber…'
                  ) : recipient ? (
                    <>
                      Alerts route to: <span className="font-bold text-slate-800">{recipientLabel}</span>
                      {recipient.source === 'treatment_team'
                        ? ' — prescriber on the treatment team'
                        : ' — assigned clinician (no prescriber on the treatment team)'}
                    </>
                  ) : (
                    'No prescriber on the treatment team and no assigned clinician — alerts go to the general Alerts queue with no assignee'
                  )}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Instrument</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(TOOL_META) as Tool[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTool(t); setRouted(false); setSigned(false); }}
                    className={`py-2 px-3 rounded-xl border-2 text-xs sm:text-sm font-bold transition-all text-center ${
                      tool === t ? 'bg-amber-600 border-amber-600 text-white shadow-xs' : 'border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50'
                    }`}
                  >
                    {TOOL_META[t].name}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                {TOOL_META[tool].full} · <span className="font-semibold text-amber-700">{TOOL_META[tool].threshold}</span>
              </p>
            </div>
          </div>

          {/* AUDIT Questions */}
          {tool === 'audit' && (
            <div className="space-y-3">
              {AUDIT_ITEMS.map((item, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  <p className="text-xs sm:text-sm font-semibold text-slate-800 mb-2.5">
                    <span className="text-amber-700 font-bold mr-1.5">{i + 1}.</span>{item.q}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.options.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => { setAuditAns((prev) => prev.map((v, j) => (j === i ? opt.value : v))); setRouted(false); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          auditAns[i] === opt.value
                            ? opt.value >= 3 ? 'bg-rose-600 border-rose-600 text-white shadow-xs' : opt.value >= 1 ? 'bg-amber-500 border-amber-500 text-white shadow-xs' : 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                            : 'border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50'
                        }`}
                      >
                        {opt.label} <span className="opacity-70">({opt.value})</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CAGE-AID Questions */}
          {tool === 'cage' && (
            <div className="space-y-3">
              {CAGE_ITEMS.map((q, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center gap-3">
                  <p className="text-xs sm:text-sm font-semibold text-slate-800 flex-1">
                    <span className="text-amber-700 font-bold mr-1.5">{i + 1}.</span>{q}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setCageAns((prev) => prev.map((v, j) => (j === i ? true : v))); setRouted(false); }}
                      className={`px-5 py-2 rounded-xl border-2 text-xs sm:text-sm font-bold transition-all ${cageAns[i] === true ? 'bg-rose-600 border-rose-600 text-white shadow-xs' : 'border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50'}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCageAns((prev) => prev.map((v, j) => (j === i ? false : v))); setRouted(false); }}
                      className={`px-5 py-2 rounded-xl border-2 text-xs sm:text-sm font-bold transition-all ${cageAns[i] === false ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs' : 'border-slate-200 text-slate-600 hover:border-emerald-200 hover:bg-emerald-50'}`}
                    >
                      No
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* NIDA Quick Screen Questions */}
          {tool === 'nida' && (
            <div className="space-y-3">
              {NIDA_ITEMS.map((item, i) => (
                <div key={item.key} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                  <p className="text-xs sm:text-sm font-semibold text-slate-800 mb-2.5">
                    <span className="text-amber-700 font-bold mr-1.5">{i + 1}.</span>{item.q}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {NIDA_FREQ.map((label, v) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => { setNidaAns((prev) => prev.map((x, j) => (j === i ? v : x))); setRouted(false); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          nidaAns[i] === v
                            ? v === 0 ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs' : 'bg-rose-600 border-rose-600 text-white shadow-xs'
                            : 'border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BAM Questions */}
          {tool === 'bam' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Past 30 Days Use & Craving (Key Items)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Days used alcohol</label>
                  <input
                    type="number" min={0} max={30} value={bam.alcoholDays}
                    onChange={(e) => { setBam((p) => ({ ...p, alcoholDays: e.target.value })); setRouted(false); }}
                    placeholder="0–30" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Heavy alcohol days</label>
                  <input
                    type="number" min={0} max={30} value={bam.heavyDays}
                    onChange={(e) => { setBam((p) => ({ ...p, heavyDays: e.target.value })); setRouted(false); }}
                    placeholder="0–30" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Days used any drug</label>
                  <input
                    type="number" min={0} max={30} value={bam.drugDays}
                    onChange={(e) => { setBam((p) => ({ ...p, drugDays: e.target.value })); setRouted(false); }}
                    placeholder="0–30" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Craving intensity in past 30 days</label>
                <div className="flex flex-wrap gap-2">
                  {['0: None', '1: Slight', '2: Moderate', '3: Considerable', '4: Extreme'].map((label, v) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { setBam((p) => ({ ...p, craving: v })); setRouted(false); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        bam.craving === v
                          ? v >= 3 ? 'bg-rose-600 border-rose-600 text-white shadow-xs' : v >= 1 ? 'bg-amber-500 border-amber-500 text-white shadow-xs' : 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                          : 'border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Result + Alert Routing Card */}
          <div className={`rounded-xl border-2 p-5 ${result.complete ? `${levelStyle.bg} ${levelStyle.border}` : 'bg-slate-50 border-slate-200'}`}>
            {result.complete ? (
              <>
                <div className="flex items-center gap-3">
                  <levelStyle.Icon className={`h-7 w-7 shrink-0 ${levelStyle.text}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest truncate">
                      {TOOL_META[tool].name} Result {client ? `— ${client.name}` : ''}
                    </p>
                    <p className={`text-lg sm:text-xl font-semibold ${levelStyle.text}`}>
                      {result.score} · {result.level === 'high' ? 'High Risk' : result.level === 'positive' ? 'Positive Screen' : 'Below Threshold'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs sm:text-sm text-slate-700 bg-white/80 rounded-xl p-3 border border-white/60 leading-relaxed">
                  {result.trigger}
                </p>

                {alertWorthy && (
                  <div className="mt-4">
                    {routed ? (
                      <div className="rounded-xl bg-white border-2 border-emerald-300 p-4">
                        <p className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                          <BellRing className="h-4 w-4" />{' '}
                          {recipient
                            ? `SUD Referral Alert sent to ${recipientLabel}`
                            : 'SUD Referral Alert created in the general Alerts queue (no one is assigned)'}
                        </p>
                        <div className="mt-2 space-y-1">
                          {[
                            { Icon: AlertTriangle, ch: 'Risk Alerts — "SUD Referral Prompt" created with score & trigger evidence' },
                            ...(recipient
                              ? [{ Icon: ClipboardCheck, ch: `To-Do — "SUD Referral Review" task added to ${recipient.name}'s task list` }]
                              : []),
                            { Icon: MessageSquare, ch: 'No text or push notification is sent — tell the prescriber directly if this is urgent' },
                          ].map((c) => (
                            <p key={c.ch} className="text-[11px] text-slate-600 flex items-center gap-1.5">
                              <c.Icon className="h-3 w-3 text-emerald-700 shrink-0" /> {c.ch}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void routeAlert()}
                        disabled={!client || routing}
                        title={!client ? 'Select a client first' : ''}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs sm:text-sm font-bold hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-all"
                      >
                        {routing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} {client && !recipientLoading && !recipient
                          ? 'Add Referral Alert to Alerts Queue (unassigned)'
                          : `Route Referral Alert to ${recipient ? recipient.name : 'Prescriber'}`}
                      </button>
                    )}
                  </div>
                )}

                {/* Save to Chart Guardrail */}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-black/5">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 shadow-xs"
                  >
                    <Printer className="h-4 w-4" /> Print
                  </button>

                  {signed ? (
                    <span className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-bold">
                      <CheckCircle2 className="h-4 w-4" /> Saved & Signed in Chart
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveToChart}
                      disabled={saving || !client || (alertWorthy && !routed)}
                      title={!client ? 'Select a client' : alertWorthy && !routed ? 'Route the referral alert before saving — positive screens cannot be filed silently' : ''}
                      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Sign & Save to Chart
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs sm:text-sm text-slate-500 flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-slate-500" /> Score computes live — answer all items to finalize{client ? '' : ' (and select a client)'}.
              </p>
            )}
          </div>
        </div>

        {/* Right Rail: Routed Alerts + Statutory Rules */}
        <aside className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-amber-700" /> Routed Referral Alerts
            </h3>
            <p className="text-[11px] text-slate-500 mb-3">Every threshold hit with who was prompted and why.</p>
            <div className="space-y-3">
              {alerts.length === 0 && <p className="text-xs text-slate-500">No referral alerts routed yet.</p>}
              {alerts.map((a) => (
                <div key={a.id} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-900 flex-1 truncate">{a.client}</p>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
                      {a.tool} {a.score}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 leading-snug">{a.trigger}</p>
                  <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                    <Send className="h-2.5 w-2.5 text-slate-500" /> {a.prescriber} · {a.time}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 sm:p-5 text-white shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3 text-slate-500 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-700" /> Alert Trigger Rules
            </h3>
            <ul className="space-y-2.5 text-xs text-slate-500">
              <li className="flex gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                <span><strong className="text-white">AUDIT ≥ 8</strong> positive · <strong className="text-white">≥ 15</strong> high risk → prescriber prompt.</span>
              </li>
              <li className="flex gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                <span><strong className="text-white">CAGE-AID ≥ 2</strong> → prompt; 1 Yes → follow-up screen suggested.</span>
              </li>
              <li className="flex gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                <span><strong className="text-white">NIDA Quick Screen</strong> → any drug use → full ASSIST + prompt; heavy-drinking days → AUDIT.</span>
              </li>
              <li className="flex gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                <span><strong className="text-white">BAM</strong> → any heavy days or drug days → high risk; craving ≥ 3/4 → prescriber review.</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
