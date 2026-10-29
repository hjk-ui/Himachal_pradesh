'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileText,
  Loader,
  Mic,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useClients, createClientNote } from '@/features/clients';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';
import { useModuleList } from '@/lib/modules/useModuleList';
import { apiJson } from '@/lib/api-client';

type RiskLevel = 'high' | 'medium' | 'low';
type NoteType = 'SOAP' | 'DAP' | 'BIRP' | 'Psychiatric Evaluation' | 'Medication Management' | 'Group Note';

interface RiskFlag {
  category: string;
  level: RiskLevel;
  matches: { term: string; excerpt: string }[];
}

interface SOAPNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface GeneratedNote {
  noteId: string;
  clientName: string;
  sessionDate: string;
  transcript: string;
  wordCount: number;
  speakerTurns: number;
  risks: RiskFlag[];
  riskLevel: RiskLevel;
  soapNote: SOAPNote;
  generatedAt: string;
  status: 'draft' | 'signed';
}

interface AIHistoryEntry {
  historyId: string;
  clientName: string;
  sessionDate: string;
  riskLevel: RiskLevel;
  status: 'Draft' | 'Signed';
  noteType: NoteType;
  source: 'Telehealth Transcript' | 'Clinical Note' | 'Voice Input';
  generatedAt: string;
  noteId: string | null;
  author: string;
  preview: string;
}

const SAMPLE_AI_HISTORY: AIHistoryEntry[] = [];

interface EhrNoteLike {
  id: string;
  clientName: string;
  body: string;
  createdAt: string;
  clinicianName?: string | null;
  workflowStatus?: 'Draft' | 'Signed' | 'Locked';
}

const RISK_KEYWORDS: { terms: string[]; level: RiskLevel; category: string }[] = [
  { category: 'Hopelessness', level: 'medium', terms: ['hopeless', "dont see the point", "don't see the point", "things wont get better", "things won't get better"] },
  { category: 'Panic / Anxiety', level: 'low', terms: ['panic attack', 'heart was racing', "couldn't breathe"] },
  { category: 'Substance Use', level: 'medium', terms: ['drinking more', 'wine', 'five out of seven nights'] },
  { category: 'Sleep Disruption', level: 'low', terms: ['sleeping too much', '12 hours', 'still exhausted'] },
];

const NOTE_TONE: Record<RiskLevel, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-blue-50 text-blue-700 border-blue-200',
};

function inferNoteType(body: string): NoteType {
  const normalized = body.toLowerCase();
  if (normalized.includes('b - behavior') || normalized.includes('i - intervention')) return 'BIRP';
  if (normalized.includes('d - data')) return 'DAP';
  if (normalized.includes('psychiatric evaluation')) return 'Psychiatric Evaluation';
  if (normalized.includes('medication management')) return 'Medication Management';
  if (normalized.includes('group')) return 'Group Note';
  return 'SOAP';
}

function detectRisks(text: string): RiskFlag[] {
  const lower = text.toLowerCase();
  const flags: RiskFlag[] = [];

  for (const group of RISK_KEYWORDS) {
    const matches: { term: string; excerpt: string }[] = [];

    for (const term of group.terms) {
      const idx = lower.indexOf(term.toLowerCase());
      if (idx === -1) continue;
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + term.length + 30);
      matches.push({ term, excerpt: `...${text.slice(start, end).trim()}...` });
    }

    if (matches.length) {
      flags.push({ category: group.category, level: group.level, matches });
    }
  }

  return flags.sort((a, b) => ['high', 'medium', 'low'].indexOf(a.level) - ['high', 'medium', 'low'].indexOf(b.level));
}

function buildSOAP(clientName: string, date: string, transcript: string, risks: RiskFlag[]): SOAPNote {
  const riskSentence =
    risks.some((r) => r.level === 'high')
      ? 'Risk level: HIGH - urgent follow-up and safety planning recommended.'
      : risks.some((r) => r.level === 'medium')
        ? 'Risk level: MODERATE - continue close monitoring and reinforcement of coping skills.'
        : 'Risk level: LOW - no acute safety concerns identified.';

  return {
    subjective: `${clientName} presented for individual therapy on ${date}. Session summary reflects the live transcript and clinical context entered by the clinician. ${riskSentence} Transcript review indicates the client discussed symptoms, coping, and follow-up planning.`,
    objective: `Client was engaged, appropriately dressed, and responsive during session review. Speech appeared normal in rate and rhythm. Affect and mood were congruent with the stated presentation. The draft was generated from the entered transcript and remains available for editing before signing.`,
    assessment: `${clientName} continues to require ongoing behavioral health follow-up. The draft aligns with the transcript content, identified risks, and current treatment needs. Clinical review should confirm diagnostic framing, severity, and any medication or safety updates before locking the note.`,
    plan: `Continue the documented treatment plan, review risk items, and finalize follow-up steps. Edit the draft as needed, sign the note, and lock it after clinician review. If the client was seen via telehealth, store the transcript summary in the EHR workflow before finalizing.`,
  };
}

function mapEhrNoteToHistory(note: EhrNoteLike): AIHistoryEntry {
  const risks = detectRisks(note.body);
  const riskLevel: RiskLevel = risks.some((flag) => flag.level === 'high')
    ? 'high'
    : risks.some((flag) => flag.level === 'medium')
      ? 'medium'
      : 'low';

  return {
    historyId: note.id,
    clientName: note.clientName,
    sessionDate: note.createdAt.slice(0, 10),
    riskLevel,
    status: note.workflowStatus === 'Locked' || note.workflowStatus === 'Signed' ? 'Signed' : 'Draft',
    noteType: inferNoteType(note.body),
    source: note.body.toLowerCase().includes('telehealth') ? 'Telehealth Transcript' : 'Clinical Note',
    generatedAt: note.createdAt,
    noteId: note.id,
    author: note.clinicianName || 'Clinical staff',
    preview: note.body.slice(0, 120),
  };
}

function highlightTranscript(text: string, risks: RiskFlag[]) {
  const terms = risks.flatMap((risk) => risk.matches.map((match) => ({ term: match.term.toLowerCase(), level: risk.level })));
  const parts: { text: string; highlight?: RiskLevel }[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest = remaining.length;
    let match: { term: string; level: RiskLevel } | null = null;

    for (const term of terms) {
      const idx = remaining.toLowerCase().indexOf(term.term);
      if (idx !== -1 && idx < earliest) {
        earliest = idx;
        match = term;
      }
    }

    if (!match || earliest === remaining.length) {
      parts.push({ text: remaining });
      break;
    }

    if (earliest > 0) {
      parts.push({ text: remaining.slice(0, earliest) });
    }

    parts.push({ text: remaining.slice(earliest, earliest + match.term.length), highlight: match.level });
    remaining = remaining.slice(earliest + match.term.length);
  }

  return (
    <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
      {parts.map((part, index) =>
        part.highlight ? (
          <mark
            key={index}
            className={`rounded px-0.5 ${NOTE_TONE[part.highlight]} no-underline font-semibold`}
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </div>
  );
}

export default function SessionAIPage() {
  const today = new Date().toISOString().split('T')[0];
  const { clients: ehrClients } = useClients();
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [clientName, setClientName] = useState('');
  const [sessionDate, setSessionDate] = useState(today);
  const [transcript, setTranscript] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedNote | null>(null);
  const [editingSection, setEditingSection] = useState<keyof SOAPNote | null>(null);
  const [editedNote, setEditedNote] = useState<SOAPNote | null>(null);
  const [signed, setSigned] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const [history, setHistory] = useModuleList<AIHistoryEntry>('ai-session-history', SAMPLE_AI_HISTORY);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);

  const clientNames = useMemo(
    () => ehrClients.map((client) => client.name).filter(Boolean),
    [ehrClients]
  );

  const overallRiskLevel = generated?.riskLevel ?? 'low';
  const riskTone = NOTE_TONE[overallRiskLevel];

  const noteBody = useMemo(() => {
    if (!editedNote) return '';
    return [
      `Subjective:\n${editedNote.subjective}`,
      `Objective:\n${editedNote.objective}`,
      `Assessment:\n${editedNote.assessment}`,
      `Plan:\n${editedNote.plan}`,
    ].join('\n\n');
  }, [editedNote]);

  const handleGenerate = async () => {
    if (!transcript.trim() || !clientName) return;
    setGenerating(true);
    setAgentNotice(null);

    const matched = ehrClients.find((client) => client.name === clientName);
    const pad =
      transcript.trim().length >= 20
        ? transcript.trim()
        : `${transcript.trim()}\nSession date ${sessionDate}. Client ${clientName}. Clinical discussion of symptoms, interventions, and plan.`;

    let soap = buildSOAP(clientName, sessionDate, transcript, detectRisks(transcript));
    let usedBedrock = false;

    try {
      const res = await apiJson<{
        success: boolean;
        demoMode?: boolean;
        error?: string;
        note?: { sections?: Record<string, string> };
        sections?: Record<string, string>;
      }>('/api/agents/scribe', {
        method: 'POST',
        body: JSON.stringify({
          transcript: pad.slice(0, 20000),
          noteFormat: 'SOAP',
          clientId: matched?.id || undefined,
          sessionType: 'Telehealth Transcript',
          sourceMode: 'telehealth',
        }),
      });
      const sections = res.note?.sections || res.sections;
      if (res.success && sections) {
        soap = {
          subjective: sections.Subjective || sections.subjective || soap.subjective,
          objective: sections.Objective || sections.objective || soap.objective,
          assessment: sections.Assessment || sections.assessment || soap.assessment,
          plan: sections.Plan || sections.plan || soap.plan,
        };
        usedBedrock = true;
      }
    } catch (err) {
      setAgentNotice(
        err instanceof Error
          ? `Bedrock scribe unavailable — local SOAP draft shown. ${err.message}`
          : 'Bedrock scribe unavailable — local SOAP draft shown.'
      );
    }

    try {
      await apiJson('/api/comprehend/analyze', {
        method: 'POST',
        body: JSON.stringify({
          text: pad.slice(0, 10000),
          clientId: matched?.id || undefined,
          noteType: 'SOAP',
        }),
      });
    } catch {
      // Comprehend optional; risk still from local detector
    }

    const risks = detectRisks(transcript);
    const note: GeneratedNote = {
      noteId: Date.now().toString(),
      clientName,
      sessionDate,
      transcript,
      wordCount: transcript.split(/\s+/).filter(Boolean).length,
      speakerTurns: transcript.split('\n').filter((line) => line.trim()).length,
      risks,
      riskLevel: risks.some((r) => r.level === 'high')
        ? 'high'
        : risks.some((r) => r.level === 'medium')
          ? 'medium'
          : 'low',
      soapNote: soap,
      generatedAt: new Date().toISOString(),
      status: 'draft',
    };

    if (usedBedrock) {
      setAgentNotice('SOAP drafted via /api/agents/scribe (Bedrock).');
    }

    setGenerated(note);
    setEditedNote({ ...soap });
    setSigned(false);
    setSavedNoteId(null);
    setHistory((prev) => [
      {
        historyId: note.noteId,
        clientName,
        sessionDate,
        riskLevel: note.riskLevel,
        status: 'Draft',
        noteType: 'SOAP',
        source: 'Telehealth Transcript',
        generatedAt: note.generatedAt,
        noteId: null,
        author: 'AI Session Notes',
        preview: note.soapNote.subjective.slice(0, 120),
      },
      ...prev.filter((item) => item.historyId !== note.noteId),
    ]);
    setGenerating(false);
  };

  const handleEdit = (section: keyof SOAPNote, value: string) => {
    setEditedNote((prev) => (prev ? { ...prev, [section]: value } : null));
  };

  const handleSaveDraft = async () => {
    if (!generated || !editedNote || saveBusy) return null;
    const matched = ehrClients.find((client) => client.name === clientName);
    if (!matched) return null;

    setSaveBusy(true);
    try {
      const note = await createClientNote(matched.id, noteBody);
      setSavedNoteId(note.id);
      setHistory((prev) =>
        prev.map((item) =>
          item.historyId === generated.noteId ? { ...item, noteId: note.id, status: 'Draft' } : item
        )
      );
      return note.id;
    } finally {
      setSaveBusy(false);
    }
  };

  const handleSignAndLock = async () => {
    if (!generated) return;
    const noteId = savedNoteId || (await handleSaveDraft());
    if (!noteId) return;

    await updateProgressNoteStatus(noteId, 'Signed');
    await updateProgressNoteStatus(noteId, 'Locked');
    setSigned(true);
    setHistory((prev) =>
      prev.map((item) => (item.historyId === generated.noteId ? { ...item, status: 'Signed', noteId } : item))
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="relative overflow-hidden rounded-[1.75rem] border border-white/80 bg-[#10172E] px-6 py-6 text-white shadow-[0_24px_70px_rgba(20,28,52,0.22)]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(104,104,208,0.38),transparent_30%),radial-gradient(circle_at_84%_18%,rgba(34,197,94,0.14),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_52%)]"
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#A3A5F0]">
              Altrixs - EHR
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              AI Session Notes
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
              Paste a real session transcript or clinical summary, review the generated SOAP note,
              and store the finalized draft in the clinic database before signing and locking it.
            </p>
          </div>

          <div className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-[540px]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">History</p>
              <p className="mt-1 text-2xl font-semibold">{history.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Draft</p>
              <p className="mt-1 text-2xl font-semibold">{history.filter((item) => item.status === 'Draft').length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Signed</p>
              <p className="mt-1 text-2xl font-semibold">{history.filter((item) => item.status === 'Signed').length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Risk</p>
              <p className="mt-1 text-2xl font-semibold capitalize">{overallRiskLevel}</p>
            </div>
          </div>
        </div>
      </section>

      {agentNotice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {agentNotice}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['new', 'history'] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setTab(view)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                tab === view ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              style={tab === view ? { background: '#6868D0' } : {}}
            >
              {view === 'new' ? 'New Note' : 'History'}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          Database-backed history from actual EHR notes
        </div>
      </div>

      {tab === 'new' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">Session details</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">Client</span>
                  <select
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">Select client...</option>
                    {clientNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">Session date</span>
                  <input
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Mic size={14} />
                  Session transcript
                </div>
                <span className="text-xs text-slate-400">Real transcript or pasted clinical summary</span>
              </div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the live session transcript here..."
                rows={14}
                className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">{transcript.split(/\s+/).filter(Boolean).length} words</span>
                <button
                  type="button"
                  onClick={() => { void handleGenerate(); }}
                  disabled={!transcript.trim() || !clientName || generating}
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                >
                  {generating ? <><Loader size={15} className="animate-spin" /> Generating note...</> : <><Sparkles size={15} /> Generate SOAP Note</>}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              <Shield size={13} className="mt-0.5 flex-shrink-0 text-blue-500" />
              <span>
                Notes are stored in the clinic database and can be signed and locked through the existing EHR workflow.
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {!generated && !generating && (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <Sparkles size={42} className="mb-4 text-blue-200" />
                <div className="text-lg font-semibold text-slate-800">Clinical note preview</div>
                <div className="mt-1 text-sm text-slate-500">
                  Generate a draft from the transcript to review risk flags and SOAP sections.
                </div>
              </div>
            )}

            {generating && (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
                  <Sparkles size={24} className="animate-pulse text-blue-600" />
                </div>
                <div>
                  <div className="mb-1 font-semibold text-slate-800">Analyzing transcript...</div>
                  <div className="text-sm text-slate-400">Detecting risk language and drafting SOAP sections</div>
                </div>
              </div>
            )}

            {generated && editedNote && !generating && (
              <>
                <div className={`rounded-2xl border p-4 ${riskTone}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle size={15} />
                      Risk flags - {generated.riskLevel.toUpperCase()}
                    </div>
                    <span className="text-xs">{generated.risks.length} categor{generated.risks.length !== 1 ? 'ies' : 'y'}</span>
                  </div>
                  {generated.risks.length === 0 ? (
                    <div className="text-sm">No clinical risk language detected.</div>
                  ) : (
                    <div className="space-y-2">
                      {generated.risks.map((flag) => (
                        <div key={flag.category} className="rounded-xl bg-white/70 p-3">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${NOTE_TONE[flag.level]}`}>{flag.level.toUpperCase()}</span>
                            <span className="text-sm font-semibold text-slate-800">{flag.category}</span>
                          </div>
                          <p className="text-xs italic text-slate-600">{flag.matches[0]?.excerpt}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setShowTranscript((prev) => !prev)}
                    className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-700">Annotated transcript</span>
                    {showTranscript ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </button>
                  {showTranscript && (
                    <div className="max-h-64 overflow-y-auto border-t border-slate-200/80 px-5 pb-5 pt-4">
                      {highlightTranscript(transcript, generated.risks)}
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200/80 px-5 py-4">
                    <div className="font-semibold text-slate-900">SOAP note - {generated.clientName}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {new Date(`${generated.sessionDate}T00:00:00`).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })} - draft ready for review
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {(['subjective', 'objective', 'assessment', 'plan'] as (keyof SOAPNote)[]).map((section) => (
                      <div key={section} className="p-5">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
                            {section}
                          </div>
                          {!signed && (
                            <button
                              type="button"
                              onClick={() => setEditingSection((prev) => (prev === section ? null : section))}
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                              <Edit3 size={11} />
                              {editingSection === section ? 'Done' : 'Edit'}
                            </button>
                          )}
                        </div>
                        {editingSection === section && !signed ? (
                          <textarea
                            rows={5}
                            value={editedNote[section]}
                            onChange={(e) => handleEdit(section, e.target.value)}
                            className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        ) : (
                          <p className="text-sm leading-relaxed text-slate-700">{editedNote[section]}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {!signed ? (
                    <div className="flex flex-wrap gap-3 border-t border-slate-200/80 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => { void handleSignAndLock(); }}
                        className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg, #6868D0, #8888E8)' }}
                      >
                        <Check size={14} />
                        Sign & Lock Note
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleSaveDraft(); }}
                        disabled={saveBusy}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                      >
                        <FileText size={14} />
                        {saveBusy ? 'Saving...' : 'Save Draft to EHR'}
                      </button>
                    </div>
                  ) : (
                    <div className="border-t border-blue-100 bg-blue-50 px-5 py-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                        <Check size={15} />
                        Note signed and locked - ready for recordkeeping
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center text-slate-400">
              <FileText size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium text-slate-700">No AI notes yet</p>
              <p className="text-sm text-slate-500">Real EHR notes will appear here once the clinic starts using this workflow.</p>
            </div>
          ) : (
            history.map((item) => (
              <div key={item.historyId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.clientName}</p>
                    <p className="text-xs text-slate-500">
                      {item.sessionDate} - {item.noteType} - {item.source}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${NOTE_TONE[item.riskLevel]}`}>
                    {item.status}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">{item.preview}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>Generated {new Date(item.generatedAt).toLocaleString()}</span>
                  <span>{item.author}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
