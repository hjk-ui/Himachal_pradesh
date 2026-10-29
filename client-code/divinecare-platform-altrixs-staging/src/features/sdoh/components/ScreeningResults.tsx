'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Plus, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AHC_SAFETY_THRESHOLD,
  AHC_SOURCE,
  CORE_DOMAINS,
  DOMAIN_LABEL,
  SUPPLEMENTAL_DOMAINS,
  scoreAhcHrsn,
  type AhcDomain,
} from '@/lib/sdoh/ahcHrsn';
import { ZCODE_SET } from '@/lib/sdoh/zCodes';
import { REFERRAL_TYPES, REFERRAL_TYPE_LABEL, type ReferralType } from '@/lib/sdoh/workflow';
import { suggestCommunityResources } from '@/lib/resources/community';
import { sdohApi, type SdohReferralDto, type SdohResourceDto, type SdohScreeningDto } from '../api';
import { DomainIcon, Pill, formatDate, inputCls, primaryBtn, secondaryBtn } from './ui';

function ReferralCreator({
  clientId,
  screeningId,
  domain,
  resources,
  onCreated,
}: {
  clientId: string;
  screeningId: string;
  domain: AhcDomain;
  resources: SdohResourceDto[];
  onCreated: (r: SdohReferralDto) => void;
}) {
  // Ranked: specific matches first, then all-needs lines such as 211 Maryland (src/lib/resources/community.ts)
  const options = suggestCommunityResources([domain], resources, null, 25)[0]?.resources ?? [];
  const [resourceId, setResourceId] = useState('');
  const [referralType, setReferralType] = useState<ReferralType>('referral_made');
  const [followUp, setFollowUp] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  async function create() {
    setSaving(true);
    try {
      const { referral } = await sdohApi.createReferral({ clientId, screeningId, domain, resourceId: resourceId || null, referralType, followUpDate: followUp || null });
      toast.success('Referral opened');
      onCreated(referral);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Referral could not be saved');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-2">
      <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className={inputCls} aria-label="Suggested community resource">
        <option value="">{options.length ? `${options.length} suggested resource${options.length === 1 ? '' : 's'} (optional)` : 'No matching resources in the directory yet'}</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.city ? ` — ${r.city}` : ''}
            {r.phone ? ` · ${r.phone}` : ''}
          </option>
        ))}
      </select>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <select value={referralType} onChange={(e) => setReferralType(e.target.value as ReferralType)} className={inputCls} aria-label="Referral type">
          {REFERRAL_TYPES.map((t) => <option key={t} value={t}>{REFERRAL_TYPE_LABEL[t]}</option>)}
        </select>
        <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={inputCls} aria-label="Follow-up date" />
        <button type="button" className={primaryBtn} disabled={saving} onClick={create}>
          <Plus size={16} /> Record
        </button>
      </div>
    </div>
  );
}

export function ScreeningResults({
  screening,
  clientId,
  canConfirm,
  resources,
  referrals,
  riskAlertCreated,
  safetyItemEndorsed,
  onScreeningChange,
  onReferralCreated,
}: {
  screening: SdohScreeningDto;
  clientId: string;
  canConfirm: boolean;
  resources: SdohResourceDto[];
  referrals: SdohReferralDto[];
  riskAlertCreated?: boolean;
  safetyItemEndorsed?: boolean;
  onScreeningChange: (s: SdohScreeningDto) => void;
  onReferralCreated: (r: SdohReferralDto) => void;
}) {
  const positive = new Set(screening.positiveDomains);
  const domains = screening.includesSupplemental ? [...CORE_DOMAINS, ...SUPPLEMENTAL_DOMAINS] : CORE_DOMAINS;
  const confirmed = new Set(screening.confirmedZCodes);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(screening.suggestions.filter((s) => s.preselected && !confirmed.has(s.code)).map((s) => s.code))
  );
  const [saving, setSaving] = useState(false);
  const openByDomain = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of referrals) if (r.screeningId === screening.id && r.status !== 'closed') m.set(r.domain, (m.get(r.domain) ?? 0) + 1);
    return m;
  }, [referrals, screening.id]);

  async function confirmCodes() {
    setSaving(true);
    try {
      const res = await sdohApi.confirmCodes(screening.id, [...picked]);
      toast.success(res.addedToDiagnoses.length ? `Added ${res.addedToDiagnoses.join(', ')} to diagnoses` : 'Codes confirmed (already on the chart)');
      setPicked(new Set());
      onScreeningChange(res.screening);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Codes could not be saved');
    } finally {
      setSaving(false);
    }
  }

  const safetyPositive = positive.has('safety');
  const itemEndorsed = useMemo(
    () => safetyItemEndorsed ?? scoreAhcHrsn(screening.answers, screening.includesSupplemental).safetyItemEndorsed,
    [safetyItemEndorsed, screening.answers, screening.includesSupplemental]
  );
  const answered = (d: AhcDomain) => {
    const a = screening.answers;
    const ids: Record<AhcDomain, string[]> = {
      housing_instability: ['q1'], housing_quality: ['q2'], food: ['q3', 'q4'], transportation: ['q5'], utilities: ['q6'],
      safety: ['q7', 'q8', 'q9', 'q10'], financial_strain: ['q11'], employment: ['q12'], family_support: ['q13', 'q14'], education: ['q15', 'q16'],
    };
    return ids[d].some((id) => a[id] !== undefined && a[id] !== null);
  };

  return (
    <div className="space-y-4">
      {safetyPositive && (
        <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 shrink-0 text-rose-600" size={22} />
            <div className="space-y-2 text-sm text-rose-900">
              <p className="text-base font-bold">
                Interpersonal safety positive — score {screening.safetyScore ?? `${AHC_SAFETY_THRESHOLD}+`} ({AHC_SAFETY_THRESHOLD} or more means the person might not be safe)
              </p>
              <p>
                {riskAlertCreated || screening.riskAlertId
                  ? 'A HIGH risk alert was created and routed to the assigned clinician.'
                  : 'Follow up with the assigned clinician.'}{' '}
                Do the safety follow-up now, in private: ask about immediate danger, complete or update the safety plan, and offer
                domestic violence resources (National Domestic Violence Hotline 1-800-799-7233, or text START to 88788). If the client
                is in immediate danger call 911; for thoughts of suicide, 988.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href={`/dashboard/ehr/safety-plan?clientId=${encodeURIComponent(clientId)}`} className={secondaryBtn}>
                  Safety plan
                </Link>
                <Link href="/dashboard/alerts" className={secondaryBtn}>
                  Risk alerts
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
      {!safetyPositive && itemEndorsed && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <p>
            The safety total is under {AHC_SAFETY_THRESHOLD}, but the client said someone physically hurts or threatens them at least
            rarely. This is not an AHC positive; check in privately before the client leaves.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">Results</h3>
          <span className="text-xs text-slate-500">
            {formatDate(screening.completedAt)} · {screening.completedByName || 'Staff'} · {screening.respondent === 'caregiver' ? 'Caregiver answered' : 'Client answered'}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {domains.map((d) => {
            const isPos = positive.has(d);
            const wasAnswered = answered(d);
            return (
              <div key={d} className={`rounded-xl border p-3 ${isPos ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className={isPos ? 'text-rose-600' : 'text-slate-500'}>
                      <DomainIcon domain={d} />
                    </span>
                    {DOMAIN_LABEL[d]}
                  </span>
                  {isPos ? <Pill tone="rose">Need</Pill> : wasAnswered ? <Pill tone="emerald">No need</Pill> : <Pill>Not answered</Pill>}
                </div>
                {isPos && (
                  <div className="mt-3">
                    {openByDomain.get(d) ? (
                      <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                        <CheckCircle2 size={15} /> Referral open
                      </p>
                    ) : (
                      <ReferralCreator clientId={clientId} screeningId={screening.id} domain={d} resources={resources} onCreated={onReferralCreated} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {screening.suggestions.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Suggested ICD-10-CM Z codes</h3>
          <p className="mt-1 text-sm text-slate-500">
            Suggestions only. {canConfirm ? 'Tick the codes that fit what you documented, then add them to the diagnoses.' : 'A clinician who manages diagnoses confirms these.'}{' '}
            Code set {ZCODE_SET.fiscalYear}.
          </p>
          <div className="mt-3 space-y-2">
            {screening.suggestions.map((s) => {
              const done = confirmed.has(s.code);
              return (
                <label key={s.code} className={`flex items-start gap-3 rounded-xl border p-3 ${done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200'}`}>
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 accent-[#5C2D91]"
                    disabled={!canConfirm || done}
                    checked={done || picked.has(s.code)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(s.code);
                        else n.delete(s.code);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      {s.code} <span className="font-normal text-slate-700">{s.title}</span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      {DOMAIN_LABEL[s.domain]}
                      {s.note ? ` · ${s.note}` : ''}
                      {done ? ' · On the chart' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {canConfirm && (
            <button type="button" className={`${primaryBtn} mt-3`} disabled={saving || picked.size === 0} onClick={confirmCodes}>
              Add {picked.size || ''} to diagnoses
            </button>
          )}
        </div>
      )}

      <p className="px-1 text-[11px] text-slate-400">
        Scoring per the CMS AHC HRSN tool (underlined answers = possible need; safety items 7-10 total {AHC_SAFETY_THRESHOLD}+).{' '}
        <a href={AHC_SOURCE.toolUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
          CMS tool <ExternalLink size={10} />
        </a>
      </p>
    </div>
  );
}
