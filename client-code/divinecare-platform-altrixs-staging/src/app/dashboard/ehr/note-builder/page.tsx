'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { useClients, createClientNote, type Client } from '@/features/clients';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';
import { CPT_CODES } from '@/lib/constants/cpt';
import { normalizeNoteType } from '@/lib/ehr/noteTemplates';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { SmartPhraseTextarea } from '@/components/notes/SmartPhraseTextarea';
import type { NoteMeta } from '@/lib/notes/noteMeta';
import { useOfflineDraft } from '@/lib/offline/useOfflineDraft';
import { apiJson } from '@/lib/api-client';
import { ChevronRight, ChevronLeft, Check, FileText, Brain, Stethoscope, Shield, ClipboardList, Eye } from 'lucide-react';
import { buttonClasses, PageHeader, Alert } from '@/components/ui';

// ─── Config ──────────────────────────────────────────────────────────────────

const MSE: Record<string, { label: string; multi: boolean; options: string[] }> = {
  appearance:     { label: 'Appearance',      multi: true,  options: ['Well-groomed', 'Casually groomed', 'Disheveled', 'Poor hygiene', 'Appropriately dressed', 'Oddly dressed', 'Malodorous'] },
  behavior:       { label: 'Behavior',         multi: true,  options: ['Cooperative', 'Uncooperative', 'Agitated', 'Psychomotor slowing', 'Psychomotor agitation', 'Normal activity level', 'Guarded', 'Hostile'] },
  eyeContact:     { label: 'Eye Contact',      multi: false, options: ['Good', 'Fair', 'Poor', 'Avoided', 'Intense/Staring'] },
  speech:         { label: 'Speech',           multi: true,  options: ['Normal rate and rhythm', 'Pressured', 'Slowed/halting', 'Soft', 'Loud', 'Monotone', 'Tangential', 'Articulate'] },
  mood:           { label: 'Mood (reported)',  multi: false, options: ['Depressed', 'Anxious', 'Irritable', 'Euthymic', 'Elevated/Euphoric', 'Dysphoric', 'Angry', 'Numb', 'Overwhelmed', 'Hopeless'] },
  affect:         { label: 'Affect',           multi: true,  options: ['Congruent with mood', 'Blunted', 'Flat', 'Broad and reactive', 'Restricted', 'Labile', 'Euphoric', 'Tearful'] },
  thoughtProcess: { label: 'Thought Process',  multi: true,  options: ['Logical and linear', 'Tangential', 'Circumstantial', 'Flight of ideas', 'Loose associations', 'Disorganized', 'Goal-directed', 'Perseverative'] },
  thoughtContent: { label: 'Thought Content',  multi: true,  options: ['No SI or HI', 'Passive SI — no plan or intent', 'Active SI with plan', 'Homicidal ideation', 'Paranoid ideation', 'Obsessive thoughts', 'Delusions present', 'Ideas of reference', 'Guilt/worthlessness', 'Hopelessness/helplessness'] },
  perceptions:    { label: 'Perceptions',      multi: true,  options: ['No hallucinations reported', 'Auditory hallucinations', 'Visual hallucinations', 'Command hallucinations', 'Tactile hallucinations'] },
  cognition:      { label: 'Cognition',        multi: true,  options: ['Alert and oriented ×4', 'Alert and oriented ×3', 'Normal cognitive functioning', 'Impaired concentration', 'Memory difficulties', 'Confusion'] },
  insight:        { label: 'Insight',          multi: false, options: ['Good', 'Fair', 'Poor', 'Impaired — denies illness'] },
  judgment:       { label: 'Judgment',         multi: false, options: ['Good', 'Fair', 'Poor', 'Impaired'] },
};

const INTERVENTIONS = [
  'Cognitive Behavioral Therapy (CBT)', 'Dialectical Behavior Therapy (DBT)',
  'Motivational Interviewing', 'EMDR / Trauma Processing',
  'Mindfulness-Based Techniques', 'Psychoeducation',
  'Supportive Therapy', 'Family Systems Therapy',
  'Strength-Based Approach', 'Solution-Focused Therapy',
  'Narrative Therapy', 'Acceptance and Commitment Therapy (ACT)',
  'Relapse Prevention Planning', 'Crisis Intervention',
  'Behavioral Activation', 'Skills Training (DBT)',
  'Exposure and Response Prevention (ERP)', 'Grounding Techniques',
];

const CLIENT_RESPONSE = [
  'Fully engaged and motivated', 'Partially engaged', 'Ambivalent about treatment', 'Resistant to treatment',
  'Demonstrated insight into symptoms', 'Limited insight', 'Denied current symptoms',
  'Practiced skills in session', 'Homework reviewed — completed', 'Homework not completed',
  'Progress toward treatment goals noted', 'No measurable progress this session', 'Regression from prior session',
  'Reported symptom improvement since last session', 'Reported symptom worsening since last session',
];

const RISK_LEVELS = [
  { value: 'No current risk identified' },
  { value: 'Low risk — safety plan in place' },
  { value: 'Moderate risk — monitoring closely, safety plan reviewed' },
  { value: 'High risk — safety plan updated, emergency contacts notified' },
];

const PLAN_OPTIONS = [
  'Continue current treatment plan', 'Continue weekly individual therapy',
  'Medication evaluation recommended', 'Medication adjustment — coordinating with prescriber',
  'Increase session frequency', 'Decrease session frequency',
  'Referral to psychiatry', 'Referral to substance abuse treatment',
  'Safety plan reviewed and updated', 'Crisis resources provided (988 Lifeline)',
  'Coordinate care with PCP', 'Family session recommended',
  'Return in 1 week', 'Return in 2 weeks', 'Return in 1 month',
  'PHQ-9 / GAD-7 at next session', 'Columbia C-SSRS at next session',
];

type MseValues = Record<string, string | string[]>;

interface NoteState {
  clientId: string;
  patientName: string;
  sessionDate: string;
  sessionType: string;
  duration: string;
  cptCode: string;
  chiefComplaint: string;
  mse: MseValues;
  interventions: string[];
  interventionsNotes: string;
  clientResponse: string[];
  progressNotes: string;
  riskLevel: string;
  riskNotes: string;
  plan: string[];
  planNotes: string;
}

function buildNarrative(n: NoteState): string {
  const parts: string[] = [];
  const cptLabel = CPT_CODES.find((c) => c.code === n.cptCode);
  parts.push(
    `SESSION: ${n.patientName || 'Client'} · ${n.sessionDate || '—'} · ${n.sessionType.toUpperCase()} · ${n.duration || '—'} min · CPT ${n.cptCode}${cptLabel ? ` (${cptLabel.desc})` : ''}`
  );

  if (n.chiefComplaint) parts.push(`SUBJECTIVE: ${n.chiefComplaint}`);

  // Only the domains the clinician actually selected; nothing is filled in by default.
  const m = n.mse;
  const get = (k: string) => (Array.isArray(m[k]) ? (m[k] as string[]).join(', ') : (m[k] as string) || '');
  const mseParts = Object.entries(MSE)
    .map(([key, cfg]) => {
      const value = get(key);
      return value ? `${cfg.label}: ${value}.` : '';
    })
    .filter(Boolean);
  if (mseParts.length > 0) parts.push(`MENTAL STATUS EXAMINATION: ${mseParts.join(' ')}`);

  // Free-text notes are kept even when no chip in that step is selected.
  const section = (label: string, picked: string, notes: string) => {
    const text = [picked, notes.trim()].filter(Boolean).join(' ');
    if (text) parts.push(`${label}: ${text}`);
  };
  section(
    'OBJECTIVE / INTERVENTIONS',
    n.interventions.length > 0 ? `Interventions utilized during this session included ${n.interventions.join(', ')}.` : '',
    n.interventionsNotes
  );
  section('ASSESSMENT / CLIENT RESPONSE', n.clientResponse.length > 0 ? `${n.clientResponse.join('; ')}.` : '', n.progressNotes);
  section('RISK ASSESSMENT', n.riskLevel ? `${n.riskLevel}.` : '', n.riskNotes);
  section('PLAN', n.plan.length > 0 ? `${n.plan.join('; ')}.` : '', n.planNotes);

  return parts.join('\n\n');
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${selected
        ? 'bg-blue-600 text-white border-transparent'
        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-blue-700 bg-white'}`}
      aria-pressed={selected}>
      {selected && <Check size={12} aria-hidden className="inline mr-1" />}{label}
    </button>
  );
}

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
}

const STEPS = [
  { id: 'session',       label: 'Session Info',    icon: FileText },
  { id: 'mse',           label: 'Mental Status',   icon: Brain },
  { id: 'interventions', label: 'Interventions',   icon: Stethoscope },
  { id: 'response',      label: 'Response & Risk', icon: Shield },
  { id: 'plan',          label: 'Plan',            icon: ClipboardList },
  { id: 'preview',       label: 'Preview & Sign',  icon: Eye },
];

const EMPTY: NoteState = {
  clientId: '', patientName: '', sessionDate: new Date().toISOString().split('T')[0],
  sessionType: 'soap', duration: '53', cptCode: '90837',
  chiefComplaint: '', mse: {}, interventions: [], interventionsNotes: '',
  clientResponse: [], progressNotes: '', riskLevel: '', riskNotes: '', plan: [], planNotes: '',
};

export default function NoteBuilderPage() {
  const { user } = useAuth();
  const { clients: caseloadClients } = useClients();
  const [orgClients, setOrgClients] = useState<Client[] | null>(null);
  const elevated =
    user?.baseRole === 'ADMIN' || user?.baseRole === 'PRACTICE_DIRECTOR';
  const clients = useMemo(() => {
    if (elevated && orgClients) return orgClients;
    return caseloadClients;
  }, [elevated, orgClients, caseloadClients]);

  useEffect(() => {
    if (!elevated) {
      setOrgClients(null);
      return;
    }
    let cancelled = false;
    apiJson<{ success: true; clients: Client[] }>('/api/clients?roster=org')
      .then((data) => {
        if (!cancelled) setOrgClients(data.clients);
      })
      .catch(() => {
        if (!cancelled) setOrgClients(null);
      });
    return () => {
      cancelled = true;
    };
  }, [elevated]);

  const [step, setStep] = useState(0);
  const [note, setNote] = useState<NoteState>(EMPTY);
  const [signed, setSigned] = useState(false);
  /** Saved to the offline queue: not in the database and not signed yet */
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [attested, setAttested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

  const typeMap: Record<string, string> = {
    soap: 'SOAP',
    dap: 'DAP',
    birp: 'BIRP',
    psychiatric_eval: 'Psychiatric Evaluation',
    medication_mgmt: 'Medication Management',
    group: 'Group Therapy',
  };

  // The queued payload is the API body ({ body, ...meta }); the client id comes
  // from the per-client URL. Offline replay only creates the note as a Draft.
  const { save: saveOfflineAware, isOnline } = useOfflineDraft({
    url: '/api/clients/notes',
    onlinePost: async (payload) => {
      const { body, ...meta } = payload as { body: string } & NoteMeta;
      const created = await createClientNote(note.clientId, body, meta);
      // One round-trip: DRAFT → LOCKED (sets signedAt + lockedAt); the clinician attested on this screen
      await updateProgressNoteStatus(created.id, 'Locked', { attested: true });
      return created;
    },
  });

  const narrative = buildNarrative(note);
  const blanks = findUnfilledBlanks(narrative);
  /** More than the SESSION header line */
  const hasClinicalContent = narrative.includes('\n\n');

  const handleSignAndLock = async () => {
    if (saving) return;
    if (!note.clientId) {
      setSaveError('Select a patient on Session Info before signing.');
      setStep(0);
      return;
    }
    if (!hasClinicalContent) {
      setSaveError('Nothing to save yet: complete the previous steps first.');
      return;
    }
    if (blanks > 0) {
      setSaveError(`Fill the ${blanks} remaining [___] blank${blanks === 1 ? '' : 's'} before signing.`);
      return;
    }
    if (isOnline && !attested) {
      setSaveError('Confirm the clinical attestation before signing.');
      return;
    }
    const meta: NoteMeta = {
      noteType: normalizeNoteType(typeMap[note.sessionType] || note.sessionType),
      dateOfService: note.sessionDate || null,
      durationMinutes: Number(note.duration) || null,
      cptCode: note.cptCode || null,
      telehealth: false,
      placeOfService: '11',
      part2: false,
    };
    setSaving(true);
    setSaveError(null);
    try {
      // No clientId in the payload: useOfflineDraft would otherwise strip the metadata when queueing.
      const result = (await saveOfflineAware(
        { body: narrative.slice(0, 11000), ...meta },
        'note',
        `/api/clients/${note.clientId}/notes`
      )) as { id?: string; offline?: boolean };
      if (result?.offline) {
        setSavedNoteId(null);
        setQueuedOffline(true);
      } else if (!result?.id) {
        setSaveError('Save returned no note ID. Check Progress Notes before trying again.');
      } else {
        setSavedNoteId(result.id);
        setSigned(true);
      }
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message === 'Forbidden'
            ? 'Forbidden — this client is not on your caseload. Assign the client to yourself, or exit Role Preview back to Admin.'
            : err.message
          : isOnline
            ? 'Could not save note to database'
            : 'Offline draft failed'
      );
    } finally {
      setSaving(false);
    }
  };

  const upd = (k: keyof NoteState, v: any) => setNote(prev => ({ ...prev, [k]: v }));
  const updMse = (k: string, v: string | string[]) => setNote(prev => ({ ...prev, mse: { ...prev.mse, [k]: v } }));

  const currentStep = STEPS[step];
  const goNext = () => {
    if (step === 0 && !note.clientId) {
      setSaveError('Select a patient before continuing.');
      return;
    }
    setSaveError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <PageHeader
        title="Note Builder"
        description="Click-through structured documentation — narrative generates automatically"
        actions={<>
          {signed && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-blue-700 bg-blue-50 ring-1 ring-inset ring-blue-100">
            <Check size={12} /> Signed & Locked
          </span>
        )}
        {queuedOffline && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-amber-800 bg-amber-50 ring-1 ring-inset ring-amber-200">
            Queued — not signed
          </span>
        )}
        </>}
      />
      {user?.rolePreview ? (
        <Alert tone="warning">
          Role Preview is on ({user.role}). Notes still save to the live database. Patient list uses your org roster when you are Admin.
        </Alert>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs px-5 py-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive  = i === step;
            const isDone    = i < step;
            return (
              <button key={s.id} type="button" onClick={() => setStep(i)}
                className={`flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${isActive ? 'bg-blue-600 text-white' : isDone ? 'text-blue-700 bg-blue-50' : 'text-slate-500 hover:text-slate-600'}`}>
                {isDone ? <Check size={12} />:<Icon size={12} />}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-xs p-6">

          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-800">Session Information</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-500 block mb-1">Patient</label>
                  <select
                    value={note.clientId}
                    onChange={e => {
                      const client = clients.find((c) => c.id === e.target.value);
                      setNote((prev) => ({
                        ...prev,
                        clientId: e.target.value,
                        patientName: client?.name || '',
                      }));
                      setSaveError(null);
                    }}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="">Select a client</option>
                    {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  {clients.length === 0 ? (
                    <p className="mt-1 text-xs text-rose-600">
                      No clients in list. Assign patients to this clinician, or switch Role Preview back to Admin.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Session Date</label>
                  <input type="date" value={note.sessionDate} onChange={e => upd('sessionDate', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Note Type</label>
                  <select value={note.sessionType} onChange={e => upd('sessionType', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="soap">SOAP</option>
                    <option value="dap">DAP</option>
                    <option value="birp">BIRP</option>
                    <option value="psychiatric_eval">Psychiatric Evaluation</option>
                    <option value="medication_mgmt">Medication Management</option>
                    <option value="group">Group Note</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Duration (min)</label>
                  <select value={note.duration} onChange={e => upd('duration', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {['30', '45', '53', '60', '90'].map(d =><option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">CPT Code</label>
                  <select value={note.cptCode} onChange={e => upd('cptCode', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {(['Therapy', 'Evaluation', 'MedMgmt'] as const).map((cat) => (
                      <optgroup key={cat} label={cat}>
                        {CPT_CODES.filter((c) => c.category === cat).map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} — {c.desc}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Chief Complaint / Subjective</label>
                <SmartPhraseTextarea rows={4} value={note.chiefComplaint} onChange={v => upd('chiefComplaint', v)}
                  placeholder="Describe what the client reported, their presenting concerns, and any significant events since last session…"
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-slate-800">Mental Status Examination</h2>
              {Object.entries(MSE).map(([key, cfg]) => {
                const val = note.mse[key];
                const selected: string[] = cfg.multi
                  ? (Array.isArray(val) ? val : val ? [val] : [])
                  : [];
                const singleVal = !cfg.multi ? (val as string | undefined) || '' : '';
                return (
                  <div key={key}>
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                      {cfg.label} {cfg.multi ? <span className="text-slate-500 normal-case font-normal">(select all that apply)</span> : <span className="text-slate-500 normal-case font-normal">(select one)</span>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {cfg.options.map(opt => (
                        <Chip key={opt} label={opt}
                          selected={cfg.multi ? selected.includes(opt) : singleVal === opt}
                          onClick={() => {
                            if (cfg.multi) updMse(key, toggle(selected, opt));
                            else updMse(key, singleVal === opt ? '' : opt);
                          }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-800">Interventions Utilized</h2>
              <div className="flex flex-wrap gap-2">
                {INTERVENTIONS.map(i => (
                  <Chip key={i} label={i} selected={note.interventions.includes(i)}
                    onClick={() => upd('interventions', toggle(note.interventions, i))} />
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Additional Intervention Notes</label>
                <SmartPhraseTextarea rows={2} value={note.interventionsNotes} onChange={v => upd('interventionsNotes', v)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-800">Client Response & Risk</h2>
              <div className="flex flex-wrap gap-2">
                {CLIENT_RESPONSE.map(r => (
                  <Chip key={r} label={r} selected={note.clientResponse.includes(r)}
                    onClick={() => upd('clientResponse', toggle(note.clientResponse, r))} />
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Progress Notes</label>
                <SmartPhraseTextarea rows={2} value={note.progressNotes} onChange={v => upd('progressNotes', v)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Risk Level</p>
                <div className="flex flex-wrap gap-2">
                  {RISK_LEVELS.map(r => (
                    <Chip key={r.value} label={r.value} selected={note.riskLevel === r.value}
                      onClick={() => upd('riskLevel', note.riskLevel === r.value ? '' : r.value)} />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Risk Notes</label>
                <SmartPhraseTextarea rows={2} value={note.riskNotes} onChange={v => upd('riskNotes', v)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-800">Treatment Plan</h2>
              <div className="flex flex-wrap gap-2">
                {PLAN_OPTIONS.map(p => (
                  <Chip key={p} label={p} selected={note.plan.includes(p)}
                    onClick={() => upd('plan', toggle(note.plan, p))} />
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Additional Plan Notes</label>
                <SmartPhraseTextarea rows={3} value={note.planNotes} onChange={v => upd('planNotes', v)}
                  placeholder="Any additional plan details, homework assignments, coordination notes…"
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-slate-800">Final Note Preview</h2>
              <div className="bg-slate-50 rounded-xl p-4 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed border border-slate-200">
                {narrative || <span className="text-slate-500 italic">Complete the previous steps to generate the clinical note narrative.</span>}
              </div>
              {queuedOffline ? (
                <div className="bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-900">Queued — not signed</p>
                  <p className="mt-1 text-xs text-amber-800">
                    You are offline. The note is saved on this device and will be created as a draft when it syncs. It is not signed: open Progress Notes after it syncs and sign it there.
                  </p>
                  <Link href="/dashboard/ehr/notes" className="mt-2 inline-block text-xs font-semibold text-blue-600 hover:underline">
                    Open Progress Notes
                  </Link>
                </div>
              ) : !signed ? (
                <div className="bg-amber-50 ring-1 ring-inset ring-amber-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-amber-800 mb-2">Ready to sign?</p>
                  <p className="text-xs text-amber-700 mb-3">
                    {isOnline
                      ? 'Once signed, the note is saved to Progress Notes in the database and locked.'
                      : 'You are offline: the note will be queued as an unsigned draft and must be signed after it syncs.'}
                  </p>
                  {!note.clientId ? (
                    <p className="mb-3 text-xs font-medium text-rose-700">Select a client on Session Info before signing.</p>
                  ) : null}
                  {blanks > 0 ? (
                    <p className="mb-3 text-xs font-medium text-rose-700">
                      {blanks} unfilled [___] blank{blanks === 1 ? ' remains' : 's remain'}. Go back and fill {blanks === 1 ? 'it' : 'them'} before signing.
                    </p>
                  ) : null}
                  {isOnline ? (
                    <label className="mb-3 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attested}
                        onChange={(e) => setAttested(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <span>
                        <strong className="font-semibold text-slate-900">Clinical Attestation:</strong> I have reviewed, verified, and assume full clinical responsibility for this note per CARF &amp; OMHC documentation standards.
                      </span>
                    </label>
                  ) : null}
                  {saveError ? (
                    <p className="mb-3 text-xs font-medium text-rose-700">{saveError}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!note.clientId || saving || blanks > 0 || !hasClinicalContent || (isOnline && !attested)}
                    onClick={() => void handleSignAndLock()}
                    className={buttonClasses({ variant: 'primary' })}>
                    {saving ? 'Saving…' : isOnline ? 'Sign & Lock Note' : 'Queue Draft (Offline)'}
                  </button>
                </div>
              ) : (
                <div className="bg-blue-50 ring-1 ring-inset ring-blue-100 rounded-xl p-4 flex items-center gap-3">
                  <Check size={18} className="text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800">Note signed and locked</p>
                    <p className="text-xs text-blue-600">
                      {savedNoteId ? `Saved to database (id ${savedNoteId}).` : saveError}
                    </p>
                    <Link href="/dashboard/ehr/notes" className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline">
                      Open Progress Notes
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {!signed && !queuedOffline && (
            <div className="flex justify-between mt-6 pt-4 border-t border-slate-200/80">
              <button type="button" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} /> Previous
              </button>
              {step < STEPS.length - 1 && (
                <button type="button" onClick={goNext}
                  className={buttonClasses({ variant: 'primary' })}>
                  Next <ChevronRight size={14} />
                </button>
              )}
            </div>
          )}
          {saveError && step !== 5 ? (
            <p className="mt-3 text-xs font-medium text-rose-700">{saveError}</p>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-5 flex flex-col">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Eye size={12} className="text-blue-500" /> Live Narrative Preview
          </p>
          <div className="flex-1 bg-slate-50 rounded-xl p-3 font-mono text-xs text-slate-700 whitespace-pre-wrap leading-relaxed overflow-auto max-h-[600px]">
            {narrative || <span className="text-slate-500 italic">Narrative will appear here as you complete each step…</span>}
          </div>
          <div className="mt-3 text-xs text-slate-500 text-center">
            Step: {currentStep.label} · Auto-generated from your selections
          </div>
        </div>
      </div>
    </div>
  );
}
