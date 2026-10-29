'use client';
import { useState } from 'react';
import { Star, AlertTriangle, MessageSquare, Plus } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';

interface Survey {
  surveyId: string;
  patientName: string;
  clinicianName: string;
  clinicianId: string;
  sessionDate: string;
  status: 'sent' | 'completed';
  nps: number | null;
  therapistCommunication: number | null;
  easeOfScheduling: number | null;
  overallCare: number | null;
  openFeedback: string | null;
}

function npsCategory(score: number) {
  return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor';
}

function calcNPS(surveys: Survey[]): number {
  const c = surveys.filter(s => s.nps !== null);
  if (!c.length) return 0;
  const p = c.filter(s => s.nps! >= 9).length;
  const d = c.filter(s =>s.nps!<= 6).length;
  return Math.round(((p - d) / c.length) * 100);
}

function avg(surveys: Survey[], field: keyof Survey): number {
  const c = surveys.filter(s => s[field] !== null);
  if (!c.length) return 0;
  return Math.round(c.reduce((sum, s) => sum + (s[field] as number), 0) / c.length * 10) / 10;
}

function Stars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} size={12} fill={i < Math.round(rating) ? '#f59e0b' : 'none'} stroke={i < Math.round(rating) ? '#f59e0b' : '#d1d5db'} />
      ))}
    </div>
  );
}

function NPSBadge({ score }: { score: number }) {
  const cat = npsCategory(score);
  const config = {
    promoter:  { color: '#15803d', bg: '#E0E2FC', label: 'Promoter' },
    passive:   { color: '#d97706', bg: '#fef3c7', label: 'Passive' },
    detractor: { color: '#dc2626', bg: '#fee2e2', label: 'Detractor' },
  }[cat];
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: config.color, backgroundColor: config.bg }}>
      {score} · {config.label}
    </span>
  );
}

export default function SurveysPage() {
  const { clients } = useClients();
  const [surveys, setSurveys] = useModuleList<Survey>('patient-surveys', []);
  const [clinicianFilter, setClinicianFilter] = useState('all');
  const [showLog, setShowLog] = useState(false);
  const [form, setForm] = useState({
    clientId: '',
    clinicianName: '',
    nps: '9',
    therapistCommunication: '5',
    easeOfScheduling: '5',
    overallCare: '5',
    openFeedback: '',
  });

  const completed = surveys.filter(s => s.nps !== null);
  const filtered  = clinicianFilter === 'all' ? completed : completed.filter(s => s.clinicianId === clinicianFilter);
  const practiceNPS = calcNPS(surveys);
  const lowScoreAlerts = completed.filter(s =>s.nps!<= 5);

  const clinicians = [...new Map(surveys.map(s => [s.clinicianId, s.clinicianName])).entries()];

  const byClinician = clinicians.map(([id, name]) => {
    const cSurveys = surveys.filter(s => s.clinicianId === id && s.nps !== null);
    return {
      id, name,
      nps: calcNPS(surveys.filter(s => s.clinicianId === id)),
      avgCommunication: avg(cSurveys, 'therapistCommunication'),
      avgScheduling: avg(cSurveys, 'easeOfScheduling'),
      avgOverall: avg(cSurveys, 'overallCare'),
      count: cSurveys.length,
    };
  });

  const promoters  = completed.filter(s => s.nps! >= 9).length;
  const passives   = completed.filter(s => s.nps! >= 7 && s.nps!<= 8).length;
  const detractors = completed.filter(s =>s.nps!<= 6).length;
  const completedCount = completed.length || 1;

  const saveSurvey = () => {
    const client = clients.find((c) => c.id === form.clientId);
    if (!client) return;
    setSurveys((prev) => [
      {
        surveyId: `sv-${Date.now()}`,
        patientName: client.name,
        clinicianName: form.clinicianName.trim() || 'Assigned clinician',
        clinicianId: form.clinicianName.trim() || 'clinician',
        sessionDate: new Date().toISOString().slice(0, 10),
        status: 'completed',
        nps: Number(form.nps),
        therapistCommunication: Number(form.therapistCommunication),
        easeOfScheduling: Number(form.easeOfScheduling),
        overallCare: Number(form.overallCare),
        openFeedback: form.openFeedback.trim() || null,
      },
      ...prev,
    ]);
    setShowLog(false);
    setForm({
      clientId: '',
      clinicianName: '',
      nps: '9',
      therapistCommunication: '5',
      easeOfScheduling: '5',
      overallCare: '5',
      openFeedback: '',
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Patient Satisfaction</h1>
          <p className="text-slate-500 text-sm mt-0.5">Post-session NPS — log responses here (SMS auto-send is not wired)</p>
        </div>
        <button
          type="button"
          onClick={() => setShowLog(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: '#6868D0' }}
        >
          <Plus size={15} /> Log survey response
        </button>
      </div>

      {/* NPS + response stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 col-span-1">
          <p className="text-xs font-semibold text-slate-500 mb-1">Practice NPS</p>
          <p className="text-3xl font-semibold" style={{ color: practiceNPS >= 50 ? '#15803d' : practiceNPS >= 0 ? '#d97706' : '#dc2626' }}>{practiceNPS}</p>
          <p className="text-xs text-slate-400 mt-0.5">{practiceNPS >= 50 ? 'Excellent' : practiceNPS >= 0 ? 'Good' : 'Needs work'}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-500 mb-1">Response Rate</p>
          <p className="text-2xl font-semibold text-blue-700">{surveys.length ? Math.round((completed.length / surveys.length) * 100) : 0}%</p>
          <p className="text-xs text-slate-400">{completed.length}/{surveys.length} responded</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-500 mb-1">Promoters</p>
          <p className="text-2xl font-semibold text-blue-600">{promoters}</p>
          <p className="text-xs text-slate-400">NPS 9–10</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-500 mb-1">Detractors</p>
          <p className="text-2xl font-semibold text-red-500">{detractors}</p>
          <p className="text-xs text-slate-400">NPS 0–6</p>
        </div>
      </div>

      {/* NPS breakdown bar */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
        <p className="text-sm font-semibold text-slate-800 mb-3">NPS Breakdown</p>
        <div className="flex rounded-xl overflow-hidden h-6">
          <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${Math.round(promoters / completedCount * 100)}%`, backgroundColor: '#15803d' }}>
            {completed.length ? `${Math.round(promoters / completed.length * 100)}%` : '0%'}
          </div>
          <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${Math.round(passives / completedCount * 100)}%`, backgroundColor: '#d97706' }}>
            {completed.length ? `${Math.round(passives / completed.length * 100)}%` : ''}
          </div>
          <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${Math.round(detractors / completedCount * 100)}%`, backgroundColor: '#dc2626' }}>
            {completed.length ? `${Math.round(detractors / completed.length * 100)}%` : ''}
          </div>
        </div>
        <div className="flex gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Promoters ({promoters})</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Passives ({passives})</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Detractors ({detractors})</span>
        </div>
      </div>

      {/* Per-clinician scores */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
        <p className="text-sm font-semibold text-slate-800 mb-4">By Clinician</p>
        <div className="space-y-4">
          {byClinician.map(c => (
            <div key={c.id} className="flex flex-col gap-3 pb-4 border-b border-slate-200/80 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: '#6868D0' }}>
                {c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-400">{c.count} responses</p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 text-center text-xs sm:w-auto sm:grid-cols-4 sm:gap-6">
                <div>
                  <p className="font-bold text-lg" style={{ color: c.nps >= 50 ? '#15803d' : c.nps >= 0 ? '#d97706' : '#dc2626' }}>{c.nps}</p>
                  <p className="text-slate-400">NPS</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{c.avgCommunication}</p>
                  <Stars rating={c.avgCommunication} />
                  <p className="text-slate-400">Comm.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{c.avgScheduling}</p>
                  <Stars rating={c.avgScheduling} />
                  <p className="text-slate-400">Sched.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{c.avgOverall}</p>
                  <Stars rating={c.avgOverall} />
                  <p className="text-slate-400">Overall</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Low-score alerts */}
      {lowScoreAlerts.length > 0 && (
        <div className="bg-red-50 ring-1 ring-inset ring-red-100 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5 mb-3">
            <AlertTriangle size={14} /> {lowScoreAlerts.length} Low-Score Response{lowScoreAlerts.length !== 1 ? 's' : ''} — Review Required
          </p>
          <div className="space-y-2">
            {lowScoreAlerts.map(s => (
              <div key={s.surveyId} className="bg-white border border-red-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-800">{s.patientName}</span>
                  <NPSBadge score={s.nps!} />
                </div>
                <p className="text-xs text-slate-500">{s.clinicianName} · {s.sessionDate}</p>
                {s.openFeedback && <p className="text-xs text-slate-700 italic mt-1.5 bg-slate-50 rounded px-2 py-1.5">&quot;{s.openFeedback}&quot;</p>}
                <button className="text-xs text-blue-600 hover:underline mt-2 font-medium">Follow Up with Client</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Individual responses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Individual Responses</p>
          <select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="all">All Clinicians</option>
            {clinicians.map(([id, name]) =><option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="space-y-3">
          {filtered.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
              No survey responses yet. Use <strong>Log survey response</strong> after a session.
            </p>
          )}
          {filtered.map(s => (
            <div key={s.surveyId} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-sm text-slate-800">{s.patientName}</span>
                    <NPSBadge score={s.nps!} />
                  </div>
                  <p className="text-xs text-slate-400">{s.clinicianName} · {s.sessionDate}</p>
                </div>
                <div className="flex gap-4 text-center text-xs shrink-0">
                  {[
                    { label: 'Comm', value: s.therapistCommunication },
                    { label: 'Sched', value: s.easeOfScheduling },
                    { label: 'Care', value: s.overallCare },
                  ].map(m => (
                    <div key={m.label}>
                      <Stars rating={m.value ?? 0} />
                      <p className="text-slate-400 mt-0.5">{m.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              {s.openFeedback && (
                <p className="text-xs text-slate-600 italic bg-slate-50 rounded-lg px-3 py-2 mt-3 flex items-start gap-1.5">
                  <MessageSquare size={11} className="text-slate-400 shrink-0 mt-0.5" />
                  &quot;{s.openFeedback}&quot;
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-clinic-md">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Log survey response</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Client</label>
                <select
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Clinician name</label>
                <input
                  value={form.clinicianName}
                  onChange={(e) => setForm((f) => ({ ...f, clinicianName: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">
                  NPS (0–10)
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={form.nps}
                    onChange={(e) => setForm((f) => ({ ...f, nps: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Overall care (1–5)
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={form.overallCare}
                    onChange={(e) => setForm((f) => ({ ...f, overallCare: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <textarea
                rows={2}
                value={form.openFeedback}
                onChange={(e) => setForm((f) => ({ ...f, openFeedback: e.target.value }))}
                placeholder="Optional feedback"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowLog(false)} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-600">
                Cancel
              </button>
              <button
                type="button"
                disabled={!form.clientId}
                onClick={saveSurvey}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#6868D0' }}
              >
                Save response
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
