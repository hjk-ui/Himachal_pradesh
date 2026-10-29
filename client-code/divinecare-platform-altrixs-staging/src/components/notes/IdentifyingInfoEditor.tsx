'use client';

/**
 * "Identifying Information" section editor, shared by every intake / evaluation / re-evaluation
 * note (StructuredNoteEditor, TherapyNoteEditor and the plain Intake / Psych Eval templates).
 *
 * Prefilled from the chart (GET /api/clients/[id]/identifying-info), the visit (modality /
 * patient state) and, for re-evaluations, the last signed evaluation; every prefilled value is
 * labeled with its source and the clinician confirms or edits it. The section text (narrative +
 * "Label: value" lines) is produced by src/lib/ehr/identifyingInfo.ts. The chart changes only on
 * the explicit "Update chart demographics" button (audited). AI Scribe suggestions (quoted chief
 * complaint, who came along) are offered with "Use" buttons and never touch demographics.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, History, RefreshCw, UserCheck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { US_STATES } from '@/lib/clients/demographics';
import {
  ETHNICITY_OPTIONS,
  GENDER_IDENTITY_OPTIONS,
  GUARDIAN_OPTIONS,
  IDENTIFYING_INFO_HEADING,
  LANGUAGE_OPTIONS,
  LANGUAGE_OTHER,
  MARITAL_OPTIONS,
  MODALITY_OPTIONS,
  NAME_TITLES,
  OTHER,
  PATIENT_REPORTED,
  PRONOUN_OPTIONS,
  RACE_OPTIONS,
  RACE_OTHER,
  DECLINED,
  SEX_AT_BIRTH_OPTIONS,
  ageOn,
  applySuggestion,
  bmiFrom,
  changesSincePrior,
  chartDemographicChanges,
  emptyIdentifyingInfo,
  identifyingInfoIssues,
  identifyingSuggestionsFromTranscript,
  isReEvalNoteType,
  maritalLabel,
  mergePrefill,
  minorGuardianWarning,
  parseIdentifyingInfo,
  prefillFromChart,
  prefillFromPrior,
  prefillFromVisit,
  renderIdentifyingInfo,
  type ChartIdentifying,
  type ChartVitals,
  type FieldSource,
  type FieldSources,
  type IdentifyingField,
  type IdentifyingInfo,
  type ScribeLine,
  type VisitFacts,
} from '@/lib/ehr/identifyingInfo';
import { formatElementsGate, willBeRequiredText } from '@/lib/notes/formatElements';
import { inputCls, smallBtn } from '@/components/notes/structuredNoteUi';

type LoadResponse = {
  success: true;
  chart: ChartIdentifying;
  vitals: ChartVitals;
  prior: { noteId: string; noteType: string; date: string; text: string } | null;
  canUpdateChart: boolean;
};

type Props = {
  noteType: string;
  clientId: string;
  editingNoteId: string | null;
  preview: boolean;
  /** Saved section text at open ('' for a new note) */
  initialText: string;
  dateOfService: string;
  visit: VisitFacts;
  onTextChange: (text: string) => void;
  onUserEdit?: () => void;
  /** AI Scribe transcript lines of the capture drafted into this note (suggestions only) */
  scribeLines?: ScribeLine[] | null;
};

const SOURCE_TEXT: Record<FieldSource, string> = {
  chart: 'from chart',
  visit: 'from appointment',
  vitals: 'from chart vitals',
  prior: 'from last evaluation',
  saved: 'saved draft',
  ai: 'AI Scribe suggestion — reviewed by you',
};

const selectCls = `${inputCls} min-h-[40px]`;

export function IdentifyingInfoEditor(props: Props) {
  const { noteType, clientId, editingNoteId, preview, initialText, dateOfService, visit, onTextChange, onUserEdit, scribeLines } = props;
  const reEval = isReEvalNoteType(noteType);
  const [info, setInfo] = useState<IdentifyingInfo>(() => (initialText.trim() ? parseIdentifyingInfo(initialText) : emptyIdentifyingInfo()));
  const [sources, setSources] = useState<FieldSources>({});
  const [chart, setChart] = useState<ChartIdentifying | null>(null);
  const [prior, setPrior] = useState<LoadResponse['prior']>(null);
  const [canUpdateChart, setCanUpdateChart] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [chartMsg, setChartMsg] = useState<string | null>(null);
  const [chartBusy, setChartBusy] = useState(false);
  const noteIdRef = useRef(editingNoteId);
  noteIdRef.current = editingNoteId;

  // ── Load chart / vitals / prior evaluation, then prefill blank fields ──
  useEffect(() => {
    if (!clientId || preview) return;
    let cancelled = false;
    const qs = `?noteType=${encodeURIComponent(noteType)}${noteIdRef.current ? `&excludeNoteId=${encodeURIComponent(noteIdRef.current)}` : ''}`;
    apiJson<LoadResponse>(`/api/clients/${encodeURIComponent(clientId)}/identifying-info${qs}`)
      .then((res) => {
        if (cancelled) return;
        setChart(res.chart);
        setPrior(res.prior);
        setCanUpdateChart(res.canUpdateChart);
        const patches = [prefillFromChart(res.chart, res.vitals)];
        if (res.prior) patches.push(prefillFromPrior(parseIdentifyingInfo(res.prior.text)));
        setInfo((cur) => {
          const merged = mergePrefill(cur, {}, ...patches);
          setSources((s) => ({ ...merged.sources, ...s }));
          return merged.info;
        });
      })
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load chart demographics'));
    return () => {
      cancelled = true;
    };
  }, [clientId, noteType, preview]);

  // ── Visit modality / patient state follow the appointment until the clinician changes them ──
  useEffect(() => {
    const v = prefillFromVisit(visit);
    if (!v.values.modality) return;
    setInfo((cur) => {
      const followVisit = !cur.modality || sources.modality === 'visit';
      if (!followVisit) return cur;
      const next = { ...cur, modality: v.values.modality! };
      if (v.values.patientLocationState && (!cur.patientLocationState || sources.patientLocationState === 'visit')) next.patientLocationState = v.values.patientLocationState;
      return next;
    });
    setSources((s) => ({ ...s, ...(s.modality && s.modality !== 'visit' ? {} : v.sources) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.known, visit.telehealth, visit.audioOnly, visit.patientLocationState]);

  const age = ageOn(chart?.dateOfBirth ?? null, dateOfService);
  const text = useMemo(
    () =>
      renderIdentifyingInfo(info, {
        noteType,
        patientName: chart?.name ?? null,
        preferredName: chart?.preferredName ?? null,
        dateOfBirth: chart?.dateOfBirth ?? null,
        dateOfService,
      }),
    [info, chart, noteType, dateOfService]
  );
  const onTextRef = useRef(onTextChange);
  onTextRef.current = onTextChange;
  useEffect(() => {
    // Chart not loaded (Demo Preview / error) and nothing edited: keep the saved text as it is
    if (!chart && initialText.trim() && !touched) onTextRef.current(initialText.trim());
    else onTextRef.current(text);
  }, [text, chart, initialText, touched]);

  const set = <K extends IdentifyingField>(k: K, v: IdentifyingInfo[K]) => {
    setInfo((cur) => ({ ...cur, [k]: v }));
    setSources((s) => {
      const next = { ...s };
      delete next[k];
      return next;
    });
    setTouched(true);
    onUserEdit?.();
  };

  const priorInfo = useMemo(() => (prior ? parseIdentifyingInfo(prior.text) : null), [prior]);
  const changes = useMemo(() => (reEval && priorInfo ? changesSincePrior(info, priorInfo) : []), [reEval, priorInfo, info]);
  const changed = (field: string) => changes.find((c) => c.field === field);
  const chartDiff = useMemo(() => (chart ? chartDemographicChanges(info, chart, sources) : { patch: {}, changes: [] }), [chart, info, sources]);

  const gate = formatElementsGate({});
  const issues = useMemo(() => identifyingInfoIssues(noteType, `${IDENTIFYING_INFO_HEADING}\n${text}`), [noteType, text]);
  const guardianWarn = minorGuardianWarning(info, age);
  const suggestions = useMemo(() => (scribeLines?.length ? identifyingSuggestionsFromTranscript(scribeLines) : null), [scribeLines]);

  const updateChart = async () => {
    if (!chart || !chartDiff.changes.length) return;
    setChartBusy(true);
    setChartMsg(null);
    try {
      const res = await apiJson<{ success: true; updatedFields: string[]; client: ChartIdentifying }>(`/api/clients/${encodeURIComponent(clientId)}/identifying-info`, {
        method: 'POST',
        body: JSON.stringify({ noteId: editingNoteId, changes: chartDiff.patch }),
      });
      setChart({ ...chart, ...res.client, race: res.client.race ?? [] });
      setChartMsg(`Chart updated: ${chartDiff.changes.map((c) => c.label).join(', ')}.`);
    } catch (err) {
      setChartMsg(err instanceof Error ? `Chart not updated: ${err.message}` : 'Chart not updated.');
    } finally {
      setChartBusy(false);
    }
  };

  const tag = (k: IdentifyingField) => (sources[k] ? <span className="ml-1 font-normal text-teal-700">({SOURCE_TEXT[sources[k]!]})</span> : null);
  const mark = (field: string) => {
    const c = changed(field);
    return c ? (
      <span className="mt-0.5 block text-[11px] font-semibold text-amber-700">
        Changed since last evaluation ({prior?.date}): was {c.was}
      </span>
    ) : null;
  };
  const select = (k: IdentifyingField, label: string, options: readonly { code: string; label: string }[], value: string, extraLabel?: string) => (
    <label className="text-xs font-semibold text-slate-600">
      {label}
      {tag(k)}
      <select aria-label={label} value={value} onChange={(e) => set(k, e.target.value as never)} className={`mt-1 ${selectCls}`}>
        <option value="">— Not recorded —</option>
        {value && !options.some((o) => o.code === value) ? <option value={value}>{extraLabel || value}</option> : null}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const textInput = (k: IdentifyingField, label: string, placeholder = '') => (
    <label className="text-xs font-semibold text-slate-600">
      {label}
      {tag(k)}
      <input aria-label={label} value={info[k] as string} onChange={(e) => set(k, e.target.value as never)} placeholder={placeholder} className={`mt-1 ${inputCls}`} />
    </label>
  );
  const toggleRace = (code: string) => {
    const exclusive = code === DECLINED;
    const has = info.race.includes(code);
    const next = has ? info.race.filter((c) => c !== code) : exclusive ? [code] : [...info.race.filter((c) => c !== DECLINED), code];
    set('race', next);
  };
  const w = info.weightLb;
  const bmi = bmiFrom(w, info.heightFt, info.heightIn);
  const telehealth = info.modality.startsWith('telehealth');

  return (
    <div className="space-y-3">
      {loadError && !preview ? <p className="text-xs text-amber-700">{loadError}</p> : null}
      {preview ? <p className="text-xs text-slate-500">Chart demographics are not loaded in Demo Preview.</p> : null}
      {reEval && chart ? (
        prior ? (
          <p className="flex items-center gap-1.5 text-[11px] text-sky-800">
            <History size={13} /> Prefilled from the chart and the last evaluation ({prior.date}). Fields that differ from it are marked.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500">No signed prior evaluation with Identifying Information on file.</p>
        )
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="text-xs font-semibold text-slate-600">
          Name
          <p className="mt-1 text-sm font-normal text-slate-800">
            {chart ? chart.name : 'Not loaded'}
            {chart?.preferredName ? <span className="text-slate-500"> (preferred: {chart.preferredName})</span> : null}
          </p>
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Title (only if the patient uses one){tag('title')}
          <select aria-label="Title" value={info.title} onChange={(e) => set('title', e.target.value)} className={`mt-1 ${selectCls}`}>
            <option value="">None — full name</option>
            {NAME_TITLES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs font-semibold text-slate-600">
          Age
          <p className="mt-1 text-sm font-normal text-slate-800">{age != null ? `${age} (from date of birth ${chart?.dateOfBirth})` : chart ? 'No date of birth on file' : '—'}</p>
        </div>

        <div>
          {select('sexAtBirth', 'Sex assigned at birth', SEX_AT_BIRTH_OPTIONS, info.sexAtBirth)}
          {mark('sexAtBirth')}
        </div>
        <div>
          {select('genderIdentity', 'Gender identity', GENDER_IDENTITY_OPTIONS, info.genderIdentity)}
          {info.genderIdentity === OTHER ? <div className="mt-1">{textInput('genderOther', 'Gender identity (other)', 'Describe')}</div> : null}
          {mark('genderIdentity')}
        </div>
        <div>
          {select('pronouns', 'Pronouns', PRONOUN_OPTIONS, info.pronouns)}
          {info.pronouns === OTHER ? <div className="mt-1">{textInput('pronounsOther', 'Pronouns (other)', 'e.g. xe/xem')}</div> : null}
          {mark('pronouns')}
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs font-semibold text-slate-600">
            Race (select all that apply){tag('race')}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Race">
            {RACE_OPTIONS.map((o) => (
              <button
                key={o.code}
                type="button"
                aria-pressed={info.race.includes(o.code)}
                onClick={() => toggleRace(o.code)}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold ${info.race.includes(o.code) ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-blue-50'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {info.race.includes(RACE_OTHER) ? <div className="mt-1">{textInput('raceOther', 'Race (other)', 'As the patient describes it')}</div> : null}
          {mark('race')}
        </div>
        <div>
          {select('ethnicity', 'Hispanic or Latino ethnicity', ETHNICITY_OPTIONS, info.ethnicity)}
          {mark('ethnicity')}
        </div>

        <div>
          {select('maritalStatus', 'Marital status', MARITAL_OPTIONS, info.maritalStatus, maritalLabel(info.maritalStatus))}
          {mark('maritalStatus')}
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">
            Legal guardian{tag('guardian')}
            <select aria-label="Legal guardian" value={info.guardian} onChange={(e) => set('guardian', e.target.value as IdentifyingInfo['guardian'])} className={`mt-1 ${selectCls}`}>
              <option value="">— Not recorded —</option>
              {GUARDIAN_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          {info.guardian === 'Other' ? <div className="mt-1">{textInput('guardianRelationship', 'Relationship', 'e.g. Aunt')}</div> : null}
          {info.guardian && info.guardian !== 'Self' ? <div className="mt-1">{textInput('guardianName', 'Guardian name')}</div> : null}
          {guardianWarn ? (
            <span className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-amber-700">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {guardianWarn}
            </span>
          ) : null}
          {mark('guardian')}
        </div>
        <div>
          {select('language', 'Preferred language', LANGUAGE_OPTIONS, info.language)}
          {info.language === LANGUAGE_OTHER ? <div className="mt-1">{textInput('languageOther', 'Language (other)')}</div> : null}
          {mark('language')}
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">
            Interpreter needed{tag('interpreterNeeded')}
            <select aria-label="Interpreter needed" value={info.interpreterNeeded} onChange={(e) => set('interpreterNeeded', e.target.value as IdentifyingInfo['interpreterNeeded'])} className={`mt-1 ${selectCls}`}>
              <option value="">— Not recorded —</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          {info.interpreterNeeded === 'yes' ? <div className="mt-1">{textInput('interpreterName', 'Interpreter name / ID')}</div> : null}
          {mark('interpreterNeeded')}
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-600">
            Visit modality *{tag('modality')}
            <select aria-label="Visit modality" value={info.modality} onChange={(e) => set('modality', e.target.value as IdentifyingInfo['modality'])} className={`mt-1 ${selectCls}`}>
              <option value="">— Choose —</option>
              {MODALITY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {visit.known && info.modality && (info.modality === 'in_office') === visit.telehealth ? (
            <span className="mt-1 block text-[11px] font-semibold text-amber-700">Differs from the note&apos;s telehealth setting: check the visit details.</span>
          ) : null}
        </div>
        {telehealth ? (
          <label className="text-xs font-semibold text-slate-600">
            Patient location (state){tag('patientLocationState')}
            <select aria-label="Patient location state" value={info.patientLocationState} onChange={(e) => set('patientLocationState', e.target.value)} className={`mt-1 ${selectCls}`}>
              <option value="">— Not recorded —</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-xs font-semibold text-slate-600">Accompanied by{tag('companions')}</p>
          <div className="mt-1 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#5C2D91]"
                checked={info.accompaniedNone}
                onChange={(e) => {
                  set('accompaniedNone', e.target.checked);
                  if (e.target.checked) set('companions', []);
                }}
              />
              None (came alone)
            </label>
            {info.companions.map((c, i) => (
              <div key={i} className="flex flex-col gap-1.5 sm:flex-row">
                <input aria-label="Companion relationship" value={c.relationship} placeholder="Relationship (e.g. Mother)" className={inputCls} onChange={(e) => set('companions', info.companions.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)))} />
                <input aria-label="Companion name" value={c.name} placeholder="Name (optional)" className={inputCls} onChange={(e) => set('companions', info.companions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button type="button" className={smallBtn} onClick={() => set('companions', info.companions.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={smallBtn}
              onClick={() => {
                set('accompaniedNone', false);
                set('companions', [...info.companions, { relationship: '', name: '' }]);
              }}
            >
              Add person
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-600">
            Weight (lb){tag('weightLb')}
            <input
              aria-label="Weight in pounds"
              inputMode="decimal"
              value={info.weightLb}
              onChange={(e) => {
                set('weightLb', e.target.value);
                set('weightSource', PATIENT_REPORTED);
              }}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <span className="mt-0.5 block text-[11px] text-slate-500">{info.weightSource}</span>
          {mark('weightLb')}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-600">Height{tag('heightFt')}</p>
          <div className="mt-1 flex gap-1.5">
            <input aria-label="Height feet" inputMode="numeric" placeholder="ft" value={info.heightFt} onChange={(e) => { set('heightFt', e.target.value); set('heightSource', PATIENT_REPORTED); }} className={inputCls} />
            <input aria-label="Height inches" inputMode="numeric" placeholder="in" value={info.heightIn} onChange={(e) => { set('heightIn', e.target.value); set('heightSource', PATIENT_REPORTED); }} className={inputCls} />
          </div>
          <span className="mt-0.5 block text-[11px] text-slate-500">{info.heightSource}</span>
          {mark('height')}
        </div>
        <div className="text-xs font-semibold text-slate-600">
          BMI
          <p className="mt-1 text-sm font-normal text-slate-800">{bmi != null ? bmi.toFixed(1) : '—'}</p>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label className="text-xs font-semibold text-slate-600">
            Chief complaint, in the patient&apos;s own words *{tag('chiefComplaint')}
            <textarea
              aria-label="Chief complaint"
              rows={2}
              value={info.chiefComplaint}
              onChange={(e) => set('chiefComplaint', e.target.value)}
              placeholder="Patient states: …  (quoted as the patient said it)"
              className={`mt-1 ${inputCls} resize-y`}
            />
          </label>
        </div>
      </div>

      {suggestions && (suggestions.chiefComplaint.length || suggestions.accompaniedBy.length || suggestions.interpreterHeard) ? (
        <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900">
          <p className="flex items-center gap-1.5 font-semibold">
            <Bot size={13} /> AI Scribe suggestions from the transcript (review before using; demographics are never filled by AI)
          </p>
          {suggestions.chiefComplaint.map((s) => (
            <div key={s.cite} className="flex flex-wrap items-center gap-2">
              <span>
                Chief complaint ({s.cite}, client): &quot;{s.text}&quot;
              </span>
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  const r = applySuggestion(info, sources, { kind: 'chiefComplaint', text: s.text });
                  setInfo(r.info);
                  setSources(r.sources);
                  setTouched(true);
                  onUserEdit?.();
                }}
              >
                Use
              </button>
            </div>
          ))}
          {suggestions.accompaniedBy.map((s) => (
            <div key={s.cite} className="flex flex-wrap items-center gap-2">
              <span>
                Also spoke ({s.cite}): {s.relationship}
              </span>
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  const r = applySuggestion(info, sources, { kind: 'companion', relationship: s.relationship });
                  setInfo(r.info);
                  setSources(r.sources);
                  setTouched(true);
                  onUserEdit?.();
                }}
              >
                Add to accompanied by
              </button>
            </div>
          ))}
          {suggestions.interpreterHeard ? <p>An interpreter spoke in this session: confirm &quot;Interpreter needed&quot; and the interpreter&apos;s name / ID yourself.</p> : null}
        </div>
      ) : null}

      {issues.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
          <p className="font-semibold">{gate.enforced ? 'Required before signing' : `Needed to sign (${willBeRequiredText(gate)})`}</p>
          <ul className="list-disc pl-4">
            {issues.map((i) => (
              <li key={i.id}>{i.message.replace(`${IDENTIFYING_INFO_HEADING}: `, '')}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {chart && chartDiff.changes.length && !preview ? (
        <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-xs text-slate-700">
          <p className="font-semibold text-[#5C2D91]">These answers differ from the chart</p>
          <ul className="list-disc pl-4">
            {chartDiff.changes.map((c) => (
              <li key={c.key}>
                {c.label}: chart {c.chart} → note {c.note}
              </li>
            ))}
          </ul>
          {canUpdateChart ? (
            <button type="button" disabled={chartBusy} className={`${smallBtn} border-violet-300 text-[#5C2D91]`} onClick={() => void updateChart()}>
              {chartBusy ? <RefreshCw size={12} className="animate-spin" /> : <UserCheck size={13} />} Update chart demographics
            </button>
          ) : (
            <p className="text-[11px] text-slate-500">Your role cannot change chart demographics; ask the front desk to update the profile.</p>
          )}
          <p className="text-[11px] text-slate-500">The chart changes only when you click the button (recorded in the audit log). The note keeps what you entered either way.</p>
        </div>
      ) : null}
      {chartMsg ? <p className="text-[11px] font-semibold text-slate-700">{chartMsg}</p> : null}

      {text ? (
        <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#5C2D91]">Goes into the note</p>
          <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-slate-700">{text}</pre>
        </div>
      ) : null}
    </div>
  );
}
