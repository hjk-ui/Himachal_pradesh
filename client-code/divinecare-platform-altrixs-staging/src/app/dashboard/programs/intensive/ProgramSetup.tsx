'use client';

/**
 * Program setup (leadership): program per location, type, age group, schedule template, policy
 * settings and billing codes / unit rules. Empty policy fields use the default for the program type,
 * labelled "Practice policy — confirm" until leadership confirms the program policy.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  Badge, Card, ConfirmTag, DAYS, SESSION_LABEL, btnPrimary, btnSecondary, errText, inputCls,
  type Block, type Program, type UnitRule,
} from './shared';

type Options = { staff: unknown[]; locations: { id: string; name: string }[]; groups: { id: string; name: string; kind: string; groupType: string; billingMode: string; billingCode: string | null }[] };

const POLICY_FIELDS: { key: keyof Program['policy']; label: string; unit: string; help: string }[] = [
  { key: 'minWeeklyHours', label: 'Minimum weekly hours', unit: 'h', help: 'Under it is flagged each week (prorated for partial weeks).' },
  { key: 'initialPlanDays', label: 'Initial treatment plan due', unit: 'days after admission', help: '' },
  { key: 'planReviewDays', label: 'Treatment plan review interval', unit: 'days', help: '' },
  { key: 'authRenewalLeadDays', label: 'Authorization renewal lead time', unit: 'days', help: '' },
  { key: 'followUpWindowDays', label: 'Post-discharge follow-up window', unit: 'days', help: 'HEDIS FUH-style 7-day measure.' },
  { key: 'missedDayOutreachHours', label: 'Missed-day outreach due', unit: 'hours', help: '' },
];

type Form = {
  id: string | null;
  name: string;
  locationId: string;
  programType: Program['programType'];
  ageGroup: Program['ageGroup'];
  active: boolean;
  phpLicensureConfirmed: boolean;
  sudFocus: boolean;
  days: number[];
  blocks: Block[];
  policy: Record<keyof Program['policy'], string>;
  billingMode: Program['billingMode'];
  perDiemCode: string;
  serviceCodes: Record<Block['sessionType'], string>;
  unitRules: UnitRule[];
  linkedGroupIds: string[];
};

function formFrom(p: Program | null): Form {
  if (!p) {
    return {
      id: null, name: '', locationId: '', programType: 'MH_IOP', ageGroup: 'adult', active: true, phpLicensureConfirmed: false, sudFocus: false,
      days: [1, 3, 4],
      blocks: [
        { key: 'b1', label: 'Group 1', start: '09:00', minutes: 90, sessionType: 'group' },
        { key: 'b2', label: 'Group 2', start: '10:45', minutes: 90, sessionType: 'group' },
      ],
      policy: { minWeeklyHours: '', initialPlanDays: '', planReviewDays: '', authRenewalLeadDays: '', followUpWindowDays: '', missedDayOutreachHours: '' },
      billingMode: 'per_diem', perDiemCode: '', serviceCodes: { group: '', individual: '', family: '', psychiatry: '' }, unitRules: [], linkedGroupIds: [],
    };
  }
  const pol = Object.fromEntries(Object.entries(p.policy).map(([k, v]) => [k, v.isDefault ? '' : String(v.value)])) as Form['policy'];
  return {
    id: p.id, name: p.name, locationId: p.locationId ?? '', programType: p.programType, ageGroup: p.ageGroup, active: p.active,
    phpLicensureConfirmed: p.phpLicensureConfirmed, sudFocus: p.programType === 'PHP' && p.part2, days: p.schedule.days, blocks: p.schedule.blocks, policy: pol,
    billingMode: p.billingMode, perDiemCode: p.perDiemIsDefault ? '' : p.perDiemCode,
    serviceCodes: Object.fromEntries(Object.entries(p.serviceCodes).map(([k, v]) => [k, v ?? ''])) as Form['serviceCodes'],
    unitRules: p.unitRules, linkedGroupIds: p.linkedGroupIds,
  };
}

export function ProgramSetup({ programs, onSaved }: { programs: Program[]; onSaved: (m: string) => void }) {
  const [editing, setEditing] = useState<Form | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiJson<{ options: Options }>('/api/intensive/options').then((r) => setOptions(r.options)).catch(() => setOptions(null));
  }, []);

  const save = async () => {
    if (!editing) return;
    setErr(null);
    setSaving(true);
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const editingProgram = programs.find((p) => p.id === editing.id) ?? null;
    try {
      const r = await apiJson<{ policyReset: boolean }>('/api/intensive/programs', {
        method: 'POST',
        body: JSON.stringify({
          id: editing.id,
          name: editing.name,
          locationId: editing.locationId || null,
          programType: editing.programType,
          ageGroup: editing.ageGroup,
          active: editing.active,
          phpLicensureConfirmed: editing.phpLicensureConfirmed,
          sudFocus: editing.sudFocus,
          schedule: { days: editing.days, blocks: editing.blocks },
          minWeeklyHours: num(editing.policy.minWeeklyHours),
          initialPlanDays: num(editing.policy.initialPlanDays),
          planReviewDays: num(editing.policy.planReviewDays),
          authRenewalLeadDays: num(editing.policy.authRenewalLeadDays),
          followUpWindowDays: num(editing.policy.followUpWindowDays),
          missedDayOutreachHours: num(editing.policy.missedDayOutreachHours),
          billingMode: editing.billingMode,
          perDiemCode: editing.perDiemCode.trim() || null,
          // Untouched defaults stay null (shown as defaults); edited ones are saved
          serviceCodes: editingProgram && editingProgram.serviceCodesIsDefault && JSON.stringify(formFrom(editingProgram).serviceCodes) === JSON.stringify(editing.serviceCodes)
            ? null
            : editing.id || Object.values(editing.serviceCodes).some(Boolean)
              ? Object.fromEntries(Object.entries(editing.serviceCodes).map(([k, v]) => [k, v.trim() || null]))
              : null,
          unitRules: editingProgram && editingProgram.unitRulesIsDefault && JSON.stringify(editingProgram.unitRules) === JSON.stringify(editing.unitRules) ? null : editing.unitRules.length ? editing.unitRules : null,
          linkedGroupIds: editing.linkedGroupIds,
        }),
      });
      setEditing(null);
      onSaved(r.policyReset ? 'Program saved. Policy changed: confirm it again.' : 'Program saved.');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const confirm = async (id: string) => {
    try {
      await apiJson('/api/intensive/programs', { method: 'PATCH', body: JSON.stringify({ id, action: 'confirm_policy' }) });
      onSaved('Program policy confirmed.');
    } catch (e) {
      setErr(errText(e));
    }
  };

  const set = (patch: Partial<Form>) => setEditing((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => setEditing(formFrom(null))}><Plus size={14} aria-hidden /> New program</button>
      </div>
      {err && <p className="text-sm text-rose-700">{err}</p>}

      {programs.map((p) => (
        <Card
          key={p.id}
          title={`${p.name} · ${p.typeLabel} · ${p.ageGroup}`}
          icon={<Settings2 size={16} className="text-blue-700" aria-hidden />}
          right={
            <div className="flex flex-wrap items-center gap-2">
              {!p.active && <Badge cls="bg-slate-100 text-slate-600">Inactive</Badge>}
              {p.part2 && <Badge cls="bg-blue-100 text-blue-800">42 CFR Part 2</Badge>}
              {p.policyConfirmed ? (
                <Badge cls="bg-emerald-100 text-emerald-800"><CheckCircle2 size={11} aria-hidden /> Policy confirmed {p.policyConfirmed.at.slice(0, 10)}{p.policyConfirmed.by ? ` by ${p.policyConfirmed.by}` : ''}</Badge>
              ) : (
                <button className={btnSecondary} onClick={() => confirm(p.id)}>Confirm program policy</button>
              )}
              <button className={btnSecondary} onClick={() => setEditing(formFrom(p))}>Edit</button>
            </div>
          }
        >
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Schedule</p>
              <p>{p.schedule.days.map((d) => DAYS[d]).join(', ')} · {(p.scheduleMinutes.perDay / 60).toFixed(1)} h/day · {(p.scheduleMinutes.perWeek / 60).toFixed(1)} h/week</p>
              <p className="text-xs text-slate-500">{p.schedule.blocks.map((b) => `${b.start} ${b.label} (${b.minutes}m, ${SESSION_LABEL[b.sessionType]})`).join(' · ')}</p>
              <p className="text-xs text-slate-500">{p.locationName ?? 'No location'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Policy</p>
              <ul className="space-y-0.5">
                {POLICY_FIELDS.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-1">{f.label}: <strong>{p.policy[f.key].value}</strong> {f.unit} <ConfirmTag isDefault={p.policy[f.key].isDefault} /></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Billing (drafts only; no fees)</p>
              <p>{p.billingMode === 'per_diem' ? `Per diem ${p.perDiemCode}` : 'Per service'} <ConfirmTag isDefault={p.perDiemIsDefault} /></p>
              <p className="text-xs text-slate-600">Services: {Object.entries(p.serviceCodes).map(([k, v]) => `${SESSION_LABEL[k as Block['sessionType']]} ${v ?? 'not set'}`).join(' · ')}</p>
              <ul className="text-xs text-slate-600">
                {p.unitRules.map((u) => <li key={u.code}>{u.code}: {u.unit.replace(/_/g, ' ')}; minimum minutes {u.minMinutes ?? 'not set'}{u.unit === 'per_15_min' || u.unit === 'per_hour' ? `; ${u.rounding} rounding` : ''}</li>)}
              </ul>
              {(p.serviceCodesIsDefault || p.unitRulesIsDefault) && <p className="mt-1 text-[11px] text-amber-800">Codes / unit rules are defaults for billing to confirm with each payer.</p>}
            </div>
          </div>
          {p.warnings.map((w) => <p key={w} className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{w}</p>)}
        </Card>
      ))}

      {editing && (
        <Card title={editing.id ? 'Edit program' : 'New program'} icon={<Settings2 size={16} className="text-blue-700" aria-hidden />}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">Name<input className={`${inputCls} mt-1`} value={editing.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="text-xs font-medium text-slate-600">Location
              <select className={`${inputCls} mt-1`} value={editing.locationId} onChange={(e) => set({ locationId: e.target.value })}>
                <option value="">Not set</option>
                {options?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">Program type
              <select
                className={`${inputCls} mt-1`}
                value={editing.programType}
                onChange={(e) => {
                  const t = e.target.value as Form['programType'];
                  set({ programType: t, active: t === 'PHP' ? editing.phpLicensureConfirmed && editing.active : editing.active });
                }}
              >
                <option value="MH_IOP">Mental health IOP</option>
                <option value="SUD_IOP">SUD IOP (ASAM 2.1) · 42 CFR Part 2</option>
                <option value="PHP">Partial hospitalization (ASAM 2.5 / MH PHP)</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">Age group
              <select className={`${inputCls} mt-1`} value={editing.ageGroup} onChange={(e) => set({ ageGroup: e.target.value as Form['ageGroup'] })}>
                <option value="adult">Adult</option><option value="adolescent">Adolescent</option>
              </select>
            </label>
            {editing.programType === 'PHP' && (
              <>
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="accent-blue-700" checked={editing.phpLicensureConfirmed} onChange={(e) => set({ phpLicensureConfirmed: e.target.checked, active: e.target.checked ? editing.active : false })} /> The practice holds PHP licensure (required to turn PHP on)</label>
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="accent-blue-700" checked={editing.sudFocus} onChange={(e) => set({ sudFocus: e.target.checked })} /> SUD program (ASAM 2.5): 42 CFR Part 2 records</label>
              </>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="accent-blue-700" checked={editing.active} disabled={editing.programType === 'PHP' && !editing.phpLicensureConfirmed} onChange={(e) => set({ active: e.target.checked })} /> Active (accepting referrals)</label>
          </div>
          {editing.programType === 'PHP' && !editing.phpLicensureConfirmed && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">Requires PHP licensure: the program stays off until the practice confirms its PHP license.</p>}

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Schedule template</h3>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-blue-700" checked={editing.days.includes(i)} onChange={(e) => set({ days: e.target.checked ? [...editing.days, i].sort() : editing.days.filter((x) => x !== i) })} /> {d}</label>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            {editing.blocks.map((b, i) => (
              <div key={b.key} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <input aria-label="Block label" className={inputCls} value={b.label} onChange={(e) => set({ blocks: editing.blocks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <input aria-label="Start time" type="time" className={inputCls} value={b.start} onChange={(e) => set({ blocks: editing.blocks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                <input aria-label="Minutes" type="number" min={5} max={600} className={inputCls} value={b.minutes} onChange={(e) => set({ blocks: editing.blocks.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)) })} />
                <select aria-label="Session type" className={inputCls} value={b.sessionType} onChange={(e) => set({ blocks: editing.blocks.map((x, j) => (j === i ? { ...x, sessionType: e.target.value as Block['sessionType'] } : x)) })}>
                  {Object.entries(SESSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className={btnSecondary} onClick={() => set({ blocks: editing.blocks.filter((_, j) => j !== i) })} disabled={editing.blocks.length <= 1}><Trash2 size={13} aria-hidden /> Remove</button>
              </div>
            ))}
            <button className={btnSecondary} onClick={() => set({ blocks: [...editing.blocks, { key: `b${Date.now().toString(36)}`, label: `Session ${editing.blocks.length + 1}`, start: '13:00', minutes: 60, sessionType: 'group' }] })}><Plus size={13} aria-hidden /> Add session block</button>
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Policy (blank = default, “Practice policy — confirm”)</h3>
          <div className="mt-1 grid gap-3 md:grid-cols-3">
            {POLICY_FIELDS.map((f) => {
              const def = programs.find((p) => p.id === editing.id)?.policy[f.key];
              return (
                <label key={f.key} className="text-xs font-medium text-slate-600">{f.label} ({f.unit})
                  <input type="number" min={1} className={`${inputCls} mt-1`} value={editing.policy[f.key]} placeholder={def?.isDefault ? `Default ${def.value}` : 'Default for the program type'} onChange={(e) => set({ policy: { ...editing.policy, [f.key]: e.target.value } })} />
                  {f.help && <span className="text-[11px] font-normal text-slate-500">{f.help}</span>}
                </label>
              );
            })}
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Billing (claim drafts only; billing confirms codes and unit rules per payer)</h3>
          <div className="mt-1 grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">Billing mode
              <select className={`${inputCls} mt-1`} value={editing.billingMode} onChange={(e) => set({ billingMode: e.target.value as Form['billingMode'] })}>
                <option value="per_diem">Per diem (one line per program day)</option><option value="per_service">Per service (one line per session)</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">Per diem code<input className={`${inputCls} mt-1`} value={editing.perDiemCode} placeholder={editing.programType === 'SUD_IOP' ? 'Default H0015' : editing.programType === 'PHP' ? 'Default H0035' : 'Default S9480'} onChange={(e) => set({ perDiemCode: e.target.value.toUpperCase() })} /></label>
            {(Object.keys(SESSION_LABEL) as Block['sessionType'][]).map((k) => (
              <label key={k} className="text-xs font-medium text-slate-600">{SESSION_LABEL[k]} code<input className={`${inputCls} mt-1`} value={editing.serviceCodes[k]} placeholder="Not set" onChange={(e) => set({ serviceCodes: { ...editing.serviceCodes, [k]: e.target.value.toUpperCase() } })} /></label>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-slate-500">Unit rules per code. Minimum minutes blank = not set: per diem drafts are held until billing sets it.</p>
            {editing.unitRules.map((u, i) => (
              <div key={`${u.code}-${i}`} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <input aria-label="Code" className={inputCls} value={u.code} onChange={(e) => set({ unitRules: editing.unitRules.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) })} />
                <select aria-label="Unit" className={inputCls} value={u.unit} onChange={(e) => set({ unitRules: editing.unitRules.map((x, j) => (j === i ? { ...x, unit: e.target.value as UnitRule['unit'] } : x)) })}>
                  <option value="per_diem">Per diem</option><option value="per_session">Per session</option><option value="per_15_min">Per 15 min</option><option value="per_hour">Per hour</option>
                </select>
                <input aria-label="Minimum minutes" type="number" min={1} className={inputCls} placeholder="Min minutes (not set)" value={u.minMinutes ?? ''} onChange={(e) => set({ unitRules: editing.unitRules.map((x, j) => (j === i ? { ...x, minMinutes: e.target.value === '' ? null : Number(e.target.value) } : x)) })} />
                <select aria-label="Rounding" className={inputCls} value={u.rounding} onChange={(e) => set({ unitRules: editing.unitRules.map((x, j) => (j === i ? { ...x, rounding: e.target.value as UnitRule['rounding'] } : x)) })}>
                  <option value="midpoint">Midpoint rounding</option><option value="whole">Whole units only</option>
                </select>
                <button className={btnSecondary} onClick={() => set({ unitRules: editing.unitRules.filter((_, j) => j !== i) })}><Trash2 size={13} aria-hidden /> Remove</button>
              </div>
            ))}
            <button className={btnSecondary} onClick={() => set({ unitRules: [...editing.unitRules, { code: '', unit: 'per_session', minMinutes: null, rounding: 'midpoint' }] })}><Plus size={13} aria-hidden /> Add unit rule</button>
          </div>

          {options && options.groups.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Linked group sessions (attendance taken there counts toward this program)</h3>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {options.groups
                  .filter((g) => (editing.programType === 'SUD_IOP' || (editing.programType === 'PHP' && editing.sudFocus) ? g.kind === 'sud' : g.kind !== 'sud'))
                  .map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" className="accent-blue-700" checked={editing.linkedGroupIds.includes(g.id)} onChange={(e) => set({ linkedGroupIds: e.target.checked ? [...editing.linkedGroupIds, g.id] : editing.linkedGroupIds.filter((x) => x !== g.id) })} />
                      {g.name} <span className="text-slate-500">({g.billingMode === 'per_session' && g.billingCode ? `bills ${g.billingCode} per session` : 'attendance only'})</span>
                    </label>
                  ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Per-session groups bill through the group note; their sessions are skipped in per-service drafts so nothing is billed twice. IOP groups are normally attendance only (rolled into the per diem).</p>
            </>
          )}

          {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
            <button className={btnPrimary} onClick={save} disabled={saving || !editing.name.trim() || !editing.days.length}><Save size={14} aria-hidden /> Save program</button>
          </div>
        </Card>
      )}
    </div>
  );
}
