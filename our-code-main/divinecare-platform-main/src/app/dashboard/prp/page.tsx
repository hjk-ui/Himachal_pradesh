'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Users, Target, BarChart3, ClipboardList, Home, Briefcase, Handshake, Globe, Brain, DollarSign, GraduationCap, TrendingUp, CreditCard, Download, FileText, AlertTriangle, Stethoscope, UserPlus, Send } from 'lucide-react';
import { demoToast } from '@/components/DemoActionProvider';

const STATS = [
  { label: 'Active Participants', value: '0', icon: Users, color: '#5C2D91', bg: '#EDE9F7' },
  { label: 'Group Sessions Today', value: '0', icon: Users, color: '#00897B', bg: '#E0F2F1' },
  { label: 'Goals Met This Month', value: '0', icon: Target, color: '#D4A017', bg: '#FEF9E7' },
  { label: 'Avg Attendance Rate', value: '—', icon: BarChart3, color: '#E8673A', bg: '#FDF0EC' },
];

const GROUPS: { id: number; time: string; name: string; facilitator: string; room: string; enrolled: number; capacity: number; type: string; status: string }[] = [];

const PARTICIPANTS: { name: string; specialist: string; enrolled: string; goalsTotal: number; goalsMet: number; attendance: string; status: string; phase: string }[] = [];

const DOMAINS = [
  { domain: 'Independent Living', icon: Home, active: 14, completed: 8 },
  { domain: 'Vocational Skills', icon: Briefcase, active: 12, completed: 5 },
  { domain: 'Social Functioning', icon: Handshake, active: 16, completed: 11 },
  { domain: 'Community Integration', icon: Globe, active: 10, completed: 7 },
  { domain: 'Mental Health Wellness', icon: Brain, active: 18, completed: 14 },
  { domain: 'Financial Management', icon: DollarSign, active: 8, completed: 3 },
];

const REPORTS = [
  { title: 'Monthly Progress Report', desc: 'Individual goal achievement, attendance, and phase transitions', icon: TrendingUp, date: 'Feb 2026', status: 'ready' },
  { title: 'Medicaid PRP Billing Summary', desc: 'H2017 service units billed, approved, and denied', icon: CreditCard, date: 'Feb 2026', status: 'ready' },
  { title: 'Group Attendance Log', desc: 'Per-session attendance for all group activities', icon: ClipboardList, date: 'Mar 2026', status: 'in_progress' },
  { title: 'Transition Planning Report', desc: 'Participants completing Phase 3 and readiness for discharge', icon: GraduationCap, date: 'Q1 2026', status: 'ready' },
  { title: 'Outcome Measures (MORS)', desc: 'Maryland Outcomes Rating Scale quarterly assessment', icon: BarChart3, date: 'Q1 2026', status: 'due' },
  { title: 'Stakeholder Report', desc: 'Program summary for community partners and funders', icon: Globe, date: 'Q1 2026', status: 'draft' },
];

const PRP_DX_CODES = [
  {
    category: 'Schizophrenia Spectrum',
    color: '#5C2D91',
    bg: '#EDE9F7',
    note: null,
    codes: [
      { code: 'F20.0', description: 'Paranoid schizophrenia', warning: null },
      { code: 'F20.9', description: 'Schizophrenia, unspecified', warning: null },
      { code: 'F22',   description: 'Delusional disorders', warning: null },
      { code: 'F25.0', description: 'Schizoaffective disorder, bipolar type', warning: null },
      { code: 'F25.1', description: 'Schizoaffective disorder, depressive type', warning: null },
      { code: 'F29',   description: 'Unspecified psychosis not due to a substance or known physiological condition', warning: null },
    ],
  },
  {
    category: 'Mood Disorders',
    color: '#00897B',
    bg: '#E0F2F1',
    note: null,
    codes: [
      { code: 'F31.13', description: 'Bipolar disorder, current episode manic without psychotic features, severe', warning: null },
      { code: 'F31.4',  description: 'Bipolar disorder, current episode depressed, severe, without psychotic features', warning: null },
      { code: 'F31.81', description: 'Bipolar II disorder', warning: null },
      { code: 'F33.2',  description: 'Major depressive disorder, recurrent severe without psychotic features', warning: null },
      { code: 'F33.3',  description: 'Major depressive disorder, recurrent, severe with psychotic symptoms', warning: null },
    ],
  },
  {
    category: 'Anxiety Disorders',
    color: '#D4A017',
    bg: '#FEF9E7',
    note: 'Added by Kevin. Verify medical necessity documentation for all anxiety diagnoses.',
    codes: [
      { code: 'F41.1',  description: 'Generalized Anxiety Disorder', warning: null },
      { code: 'F41.0',  description: 'Panic Disorder', warning: null },
      { code: 'F40.10', description: 'Social Anxiety Disorder (Social phobia, unspecified)', warning: null },
      { code: 'F43.22', description: 'Adjustment Disorder with Anxiety', warning: null },
      { code: 'F41.9',  description: 'Anxiety Disorder, Unspecified', warning: 'Use sparingly — can trigger insurance denials' },
    ],
  },
];

const TYPE_COLORS: Record<string, string> = {
  Wellness: 'bg-green-100 text-green-700',
  Skills: 'bg-blue-100 text-blue-700',
  Vocational: 'bg-amber-100 text-amber-700',
  Community: 'bg-purple-100 text-purple-700',
};

export default function PRPPage() {
  const [tab, setTab] = useState<'schedule' | 'participants' | 'domains' | 'reports' | 'codes'>('schedule');
  const [attendanceTaken, setAttendanceTaken] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const filtered = PARTICIPANTS.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.specialist.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PRP Program</h1>
          <p className="text-gray-500 text-sm mt-0.5">Psychiatric Rehabilitation Program · MD Behavioral Health</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/dashboard/prp/referral"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors">
            <Send size={14} />
            PRP Referral
          </Link>
          <Link href="/dashboard/prp/enroll"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
            <UserPlus size={14} />
            Enroll Client
          </Link>
          <Link href="/dashboard/prp/assessment"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors">
            <ClipboardList size={14} />
            Rehab Assessment
          </Link>
          <Link href="/dashboard/prp/irp"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors">
            <FileText size={14} />
            IRP Builder
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl border border-purple-100 shadow-sm p-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: s.bg }}>
                <Icon size={20} style={{ color: s.color }} />
              </div>
              <p className="text-3xl font-extrabold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {(['schedule', 'participants', 'domains', 'reports', 'codes'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-medium capitalize transition-colors border-b-2 ${
                tab === t ? 'border-purple-600 text-purple-700 bg-purple-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'schedule' ? "Today's Schedule" : t === 'domains' ? 'Rehab Domains' : t === 'codes' ? 'Dx Codes' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Today's Schedule */}
        {tab === 'schedule' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500" /> <span className="text-gray-600">In Progress</span>
                <span className="w-2 h-2 rounded-full bg-gray-300 ml-2" /> <span className="text-gray-600">Upcoming</span>
              </div>
            </div>
            {GROUPS.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-gray-500">
                <Users className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                <p className="text-sm font-semibold text-gray-700">No PRP group sessions scheduled today</p>
                <p className="text-xs text-gray-400 mt-1">Schedule new group cohorts to manage daily attendance and H2017 billing units.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {GROUPS.map(g => (
                  <div key={g.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                    g.status === 'in_progress' ? 'border-green-200 bg-green-50' : 'border-gray-100 hover:border-purple-200'
                  }`}>
                    <div className="text-center w-20 flex-shrink-0">
                      <p className="text-sm font-bold text-gray-800">{g.time}</p>
                      {g.status === 'in_progress' && (
                        <span className="text-xs text-green-600 font-medium">Live</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-gray-900 text-sm">{g.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[g.type]}`}>{g.type}</span>
                      </div>
                      <p className="text-xs text-gray-500">{g.facilitator} · {g.room}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-gray-700">{g.enrolled}/{g.capacity}</p>
                      <p className="text-xs text-gray-400">enrolled</p>
                    </div>
                    <div className="w-24">
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${(g.enrolled / g.capacity) * 100}%` }} />
                      </div>
                    </div>
                    {attendanceTaken.includes(g.name) ? (
                      <span className="text-xs text-green-600 font-semibold flex-shrink-0">Attendance recorded ✓</span>
                    ) : (
                      <button onClick={() => { setAttendanceTaken(prev => [...prev, g.name]); demoToast('Attendance recorded for ' + g.name + ' — H2017 units queued for billing'); }} className="text-xs text-purple-600 font-medium hover:underline flex-shrink-0">Take Attendance</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Participants */}
        {tab === 'participants' && (
          <div className="p-6">
            <div className="mb-4">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search participants or specialist..."
                className="w-full max-w-sm border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="text-left pb-3 pr-4">Participant</th>
                    <th className="text-left pb-3 pr-4">Specialist</th>
                    <th className="text-left pb-3 pr-4">Phase</th>
                    <th className="text-left pb-3 pr-4">Goals</th>
                    <th className="text-left pb-3 pr-4">Attendance</th>
                    <th className="text-left pb-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">
                        No PRP participants enrolled yet. Enroll clients using the referral and enrollment wizard.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
                            {p.name[0]}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{p.name}</p>
                            <p className="text-xs text-gray-400">Since {p.enrolled}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-sm text-gray-600">{p.specialist}</td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          p.phase === 'Phase 1' ? 'bg-blue-100 text-blue-700' :
                          p.phase === 'Phase 2' ? 'bg-purple-100 text-purple-700' :
                          'bg-green-100 text-green-700'
                        }`}>{p.phase}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-100 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${(p.goalsMet / p.goalsTotal) * 100}%` }} />
                          </div>
                          <span className="text-xs text-gray-600">{p.goalsMet}/{p.goalsTotal}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-sm font-semibold ${
                          parseFloat(p.attendance) >= 90 ? 'text-green-600' :
                          parseFloat(p.attendance) >= 75 ? 'text-amber-600' : 'text-red-600'
                        }`}>{p.attendance}</span>
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${
                          p.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {p.status === 'transitioning' ? (
                            <><GraduationCap size={11} /> Transitioning</>
                          ) : (
                            <><Target size={11} /> Active</>
                          )}
                        </span>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rehab Domains */}
        {tab === 'domains' && (
          <div className="p-6">
            <p className="text-sm text-gray-500 mb-5">Active rehabilitation goals by functional domain across all participants.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {DOMAINS.map(d => {
                const Icon = d.icon;
                return (
                  <div key={d.domain} className="p-5 rounded-xl border border-gray-100 hover:border-purple-200 transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                        <Icon size={18} className="text-purple-600" />
                      </div>
                      <h3 className="font-semibold text-gray-800">{d.domain}</h3>
                    </div>
                    <div className="flex gap-4 text-sm mb-2">
                      <span className="text-blue-600 font-medium">{d.active} active goals</span>
                      <span className="text-green-600 font-medium">{d.completed} completed</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="h-2 rounded-full bg-purple-500 transition-all"
                        style={{ width: `${(d.completed / (d.active + d.completed)) * 100}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      {Math.round((d.completed / (d.active + d.completed)) * 100)}% completion rate
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reports */}
        {tab === 'reports' && (
          <div className="p-6">
            <div className="grid sm:grid-cols-2 gap-4">
              {REPORTS.map(r => {
                const Icon = r.icon;
                return (
                  <div key={r.title} className="p-4 rounded-xl border border-gray-100 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                      <Icon size={18} className="text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-800">{r.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                          r.status === 'ready' ? 'bg-green-100 text-green-700' :
                          r.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          r.status === 'due' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                        }`}>{r.status}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{r.desc}</p>
                      <p className="text-xs text-gray-400 mt-1">Period: {r.date}</p>
                      <button onClick={() => { if (r.status === 'ready') { const b = new Blob([r.title + ' — ' + r.date + '\n\n' + r.desc + '\n\n[Report data renders here from live records.]'], { type: 'text/plain' }); const u = URL.createObjectURL(b); const el = document.createElement('a'); el.href = u; el.download = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.txt'; el.click(); URL.revokeObjectURL(u); } else { demoToast(r.title + (r.status === 'draft' ? ' — draft opened' : ' — generation queued, ready in a few minutes')); } }} className="mt-2 inline-flex items-center gap-1 text-xs text-purple-600 font-medium hover:underline">
                        {r.status === 'ready' ? (
                          <><Download size={11} /> Download PDF</>
                        ) : r.status === 'draft' ? (
                          <><FileText size={11} /> Continue Draft</>
                        ) : (
                          <><BarChart3 size={11} /> Generate</>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Dx Codes */}
        {tab === 'codes' && (
          <div className="p-6 space-y-6">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
              <Stethoscope size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800">
                These ICD-10-CM codes qualify participants for PRP services under Maryland Medicaid — COMAR 10.63, authorized through Optum Maryland (Incedo).
                Diagnosis must be documented by a licensed clinician and present in the member&apos;s active problem list.
              </p>
            </div>

            {PRP_DX_CODES.map(cat => (
              <div key={cat.category}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                  <h3 className="font-semibold text-gray-800 text-sm">{cat.category}</h3>
                  <span className="text-xs text-gray-400">({cat.codes.length} codes)</span>
                </div>
                {cat.note && (
                  <p className="text-xs text-gray-500 mb-2 ml-5 italic">{cat.note}</p>
                )}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: cat.color + '33' }}>
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wide" style={{ backgroundColor: cat.bg }}>
                        <th className="text-left px-4 py-2.5 w-28 font-semibold">ICD-10 Code</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Description</th>
                        <th className="w-10 px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                      {cat.codes.map(c => (
                        <tr key={c.code} className={`transition-colors ${c.warning ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'}`}>
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm font-bold" style={{ color: cat.color }}>{c.code}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">{c.description}</td>
                          <td className="px-4 py-3 text-right">
                            {c.warning && (
                              <span title={c.warning} className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                                <AlertTriangle size={11} />
                                Use sparingly
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-xs text-gray-500 space-y-1">
              <p className="font-semibold text-gray-700">Billing Reference</p>
              <p>PRP services bill under H2017 (Medicaid). Diagnosis must align with the qualifying code in the authorized service plan.</p>
              <p>Source: Brenda Williams / Kevin — updated Sep 2025. Review with billing team before adding new codes to active authorizations.</p>
            </div>
          </div>
        )}
      </div>

      {/* PRP Info Banner */}
      <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
          <div>
            <h3 className="font-bold text-base mb-1">Psychiatric Rehabilitation Program — COMAR 10.63</h3>
            <p className="text-purple-200 text-sm">Medicaid-funded community-based rehabilitation · H2017 Billing Code · Licensed by BEHAVIORAL HEALTH ADMINISTRATION</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => window.open('https://dsd.maryland.gov/regulations/Pages/10.63.01.00.aspx', '_blank')} className="px-4 py-2 rounded-xl text-sm font-medium bg-white/20 hover:bg-white/30 transition-colors">COMAR Guidelines</button>
            <button onClick={() => window.open('https://health.maryland.gov/bha/Pages/Index.aspx', '_blank')} className="px-4 py-2 rounded-xl text-sm font-medium bg-white text-purple-700 hover:bg-white/90 transition-colors">Contact BHA</button>
          </div>
        </div>
      </div>
    </div>
  );
}
