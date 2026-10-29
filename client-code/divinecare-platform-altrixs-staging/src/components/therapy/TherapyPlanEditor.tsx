'use client';

/**
 * Treatment Plan template editor (initial plan or plan review). Pre-filled from the client's
 * signed intake (diagnoses, goals in the client's words, recommended frequency, strengths) or,
 * for a review, from the active plan. The clinician signs, the plan goes to the client portal,
 * and a supervisor signs only when the clinician is pre-licensed.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ClipboardList, FileText, ShieldAlert } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { fetchClients, type Client } from '@/features/clients';
import { DiagnosisAutocomplete, type SelectedDiagnosis } from '@/components/clinical/DiagnosisAutocomplete';
import { DiagnosisListPanel } from '@/components/chart/DiagnosisListPanel';
import { inputCls, pillBtn, smallBtn } from '@/components/notes/structuredNoteUi';
import { GeneratedPreview, TemplateField } from '@/components/therapy/TemplateFields';
import { PlanSignaturePanel, type PanelPlan } from '@/components/therapy/PlanSignaturePanel';
import { RewriteFromValantPanel, type RewriteInfo } from '@/components/therapy/RewriteFromValantPanel';
import { PlanHierarchyEditor, type PlanLibraries } from '@/components/therapy/PlanHierarchyEditor';
import { addSuggestedGoalsToProblems } from '@/lib/ehr/importedPlans';
import { clinicDate } from '@/lib/workflows/dates';
import { missingFromValues, visibleFromValues, type Values } from '@/lib/ehr/therapy/engine';
import { TP } from '@/lib/ehr/therapy/sections';
import { TREATMENT_PLAN_TEMPLATE } from '@/lib/ehr/therapy/templates';
import {
  planDiagnoses,
  planProblems,
  planWidgetTexts,
  renderPlanSections,
  treatmentPlanBlockers,
  type IntakePrefill,
} from '@/lib/ehr/therapy/planTemplate';
import {
  libraryItemFromNode,
  newNodeId,
  type GoalProgressEntry,
  type LibraryItem,
  type LibraryKind,
  type PlanProblem,
} from '@/lib/ehr/therapy/planHierarchy';
import { PROVIDER_SIGNER_ATTESTATION } from '@/lib/ehr/therapy/planDocument';
import { buttonClasses, PageHeader, Alert } from '@/components/ui';

type EditorContext = {
  client: { id: string; name: string; displayName: string; dateOfBirth: string | null; age: number | null; minor: boolean };
  libraryRules: { libraryEditBeforeActive: boolean; libraryEditAfterActive: boolean };
  progressHistory: Record<string, GoalProgressEntry[]>;
  clinicianName: string | null;
  licenseLevel: 'LICENSED' | 'PRE_LICENSED';
  defaultReviewDate: string;
  maxReviewDate: string;
  reviewDaysNote: string;
  intake: IntakePrefill | null;
  activePlan: { id: string; title: string } | null;
  plan: { id: string | null; status: string; supersedesId: string | null; sourceNoteId: string | null; values: Values; signed: boolean };
  /** Replacing a plan imported from Valant */
  rewrite: RewriteInfo | null;
};

type PlanRow = PanelPlan & { title: string; hasTemplate: boolean };

export function TherapyPlanEditor() {
  const router = useRouter();
  const params = useSearchParams();
  const clientId = params.get('clientId') || '';
  const planIdParam = params.get('planId') || '';
  const kind = params.get('kind') === 'Review' ? 'Review' : 'Initial';
  const fromNoteId = params.get('fromNoteId') || '';
  /** Imported Valant plan this new plan replaces */
  const rewriteOf = params.get('rewriteOf') || '';
  const { user } = useAuth();
  const [today] = useState(() => clinicDate());

  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => {
    if (clientId) return;
    fetchClients().then(setClients).catch(() => setClients([]));
  }, [clientId]);

  const [context, setContext] = useState<EditorContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [planId, setPlanId] = useState<string | null>(planIdParam || null);
  const [planRow, setPlanRow] = useState<PlanRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [libraries, setLibraries] = useState<PlanLibraries>({ practice: [], personal: [], canEditPractice: false, loaded: false, error: null });
  useEffect(() => {
    if (!clientId) return;
    apiJson<{ success: true; practice: LibraryItem[]; personal: LibraryItem[]; canEditPractice: boolean }>('/api/ehr/treatment-plans/library')
      .then((res) => setLibraries({ practice: res.practice, personal: res.personal, canEditPractice: res.canEditPractice, loaded: true, error: null }))
      .catch((err: unknown) => setLibraries((l) => ({ ...l, loaded: true, error: err instanceof Error ? err.message : 'not available' })));
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    setLoadError(null);
    const qs = new URLSearchParams({
      clientId,
      ...(planIdParam ? { planId: planIdParam } : rewriteOf ? { rewriteOf } : { kind }),
      ...(fromNoteId ? { fromNoteId } : {}),
    });
    apiJson<{ success: true; context: EditorContext }>(`/api/ehr/treatment-plans/template?${qs.toString()}`)
      .then((res) => {
        setContext(res.context);
        // Hierarchy normalized once on load (plans saved with flat goals are moved into problems);
        // after that the editor keeps what is typed as-is (trimmed on save)
        setValues({ ...res.context.plan.values, tpProblems: planProblems(res.context.plan.values) });
        setPlanId(res.context.plan.id);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not load the treatment plan'));
  }, [clientId, planIdParam, kind, fromNoteId, rewriteOf]);

  const loadPlanRow = useCallback(async (id: string) => {
    const res = await apiJson<{ success: true; plan: PlanRow }>(`/api/ehr/treatment-plans/${encodeURIComponent(id)}`);
    setPlanRow(res.plan);
  }, []);
  useEffect(() => {
    if (planId) void loadPlanRow(planId).catch(() => undefined);
  }, [planId, loadPlanRow]);

  const signed = Boolean(planRow?.signatures.clinicianSignedAt);
  const tctx = useMemo(() => ({ minor: Boolean(context?.client.minor), telehealth: false }), [context]);
  const set = useCallback((id: string, v: unknown) => setValues((prev) => ({ ...prev, [id]: v })), []);
  const sections = useMemo(() => renderPlanSections(values, tctx), [values, tctx]);
  const blockers = useMemo(() => treatmentPlanBlockers(values, tctx), [values, tctx]);
  const missing = useMemo(() => {
    const m = new Set<string>();
    for (const x of missingFromValues(TREATMENT_PLAN_TEMPLATE, values, tctx, planWidgetTexts(values))) if (x.required) m.add(x.fieldId);
    return m;
  }, [values, tctx]);
  const isReview = values.planKind === 'Review';

  const save = async (): Promise<string | null> => {
    if (!context) return null;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiJson<{ success: true; planId: string }>('/api/ehr/treatment-plans/template', {
        method: 'POST',
        body: JSON.stringify({
          clientId: context.client.id,
          planId,
          supersedesId: context.plan.supersedesId,
          sourceNoteId: context.plan.sourceNoteId,
          values,
        }),
      });
      setPlanId(res.planId);
      if (!planIdParam) router.replace(`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(context.client.id)}&planId=${encodeURIComponent(res.planId)}`);
      setMessage('Draft saved.');
      return res.planId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the plan');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveAndSign = async () => {
    if (blockers.length || !attested) return;
    const id = await save();
    if (!id) return;
    setSaving(true);
    try {
      const res = await apiJson<{ success: true; portalAccount: boolean }>(`/api/ehr/treatment-plans/${encodeURIComponent(id)}/signatures`, {
        method: 'POST',
        body: JSON.stringify({ action: 'sign', attested: true }),
      });
      await loadPlanRow(id);
      setMessage(
        res.portalAccount
          ? 'Signed and sent to the client portal for signature.'
          : 'Signed. The client has no portal account yet: invite them from the client chart, or record verbal consent below.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign the plan');
    } finally {
      setSaving(false);
    }
  };

  // ── Problems → goals → objectives → interventions ──────────────────────────
  const problems = Array.isArray(values.tpProblems) ? (values.tpProblems as PlanProblem[]) : planProblems(values);
  const setProblems = (next: PlanProblem[]) => set('tpProblems', next);
  const saveToLibrary = async (kind: LibraryKind, node: Parameters<typeof libraryItemFromNode>[1], scope: 'practice' | 'personal') => {
    const current = scope === 'practice' ? libraries.practice : libraries.personal;
    const item = libraryItemFromNode(kind, node, { id: `lib-${newNodeId('I').toLowerCase()}`, updatedByName: context?.clinicianName ?? null, now: new Date().toISOString() });
    try {
      const res = await apiJson<{ success: true; items: LibraryItem[] }>('/api/ehr/treatment-plans/library', {
        method: 'PUT',
        body: JSON.stringify({ scope, items: [...current, item] }),
      });
      setLibraries((l) => ({ ...l, [scope]: res.items }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to the library');
      throw err;
    }
  };
  const goalsWidget = context ? (
    <PlanHierarchyEditor
      problems={problems}
      onChange={setProblems}
      review={isReview}
      disabled={signed}
      rules={context.libraryRules}
      libraries={libraries}
      onSaveToLibrary={saveToLibrary}
      progressHistory={context.progressHistory || {}}
      clinicianName={context.clinicianName}
    />
  ) : null;

  const dxValue: SelectedDiagnosis[] = planDiagnoses(values).map((d) => ({ code: d.code, description: d.description, isPrimary: d.isPrimary, specifier: '' }));
  const diagnosesWidget = (
    <div className="space-y-1">
      <DiagnosisAutocomplete clientId={context?.client.id ?? null} value={dxValue} onChange={(v) => set('diagnoses', v.map((d) => ({ code: d.code, description: [d.description, d.specifier?.trim()].filter(Boolean).join(', '), isPrimary: d.isPrimary })))} />
      {context?.intake?.diagnoses.length ? <p className="text-[11px] text-sky-700">Pre-filled from the intake signed {context.intake.date}.</p> : null}
      {context?.client.id ? (
        <details className="rounded-lg border border-slate-200 bg-white p-2" open={isReview}>
          <summary className="cursor-pointer text-xs font-semibold text-[#5C2D91]">
            {isReview ? 'Review the client’s diagnosis list for this plan review' : 'Client’s diagnosis list (the chart’s diagnoses are offered first above)'}
          </summary>
          <div className="mt-2">
            <DiagnosisListPanel clientId={context.client.id} reviewContext={isReview ? 'treatment_plan_review' : 'manual'} compact />
          </div>
        </details>
      ) : null}
    </div>
  );

  if (!clientId) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="New treatment plan" />
          <label className="block text-xs font-semibold text-slate-600">
          Client
          <select
            className={`mt-1 ${inputCls}`}
            defaultValue=""
            onChange={(e) => e.target.value && router.replace(`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(e.target.value)}`)}
          >
            <option value="">— Select client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <Alert tone="danger">{loadError}</Alert>
        <Link href="/dashboard/ehr/treatment-plans" className={smallBtn}>
          <ArrowLeft size={12} /> Treatment Plans
        </Link>
      </div>
    );
  }
  if (!context) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/dashboard/ehr/treatment-plans" className="inline-flex items-center gap-1 normal-case tracking-normal text-xs font-semibold text-blue-700 hover:underline">
            <ArrowLeft size={12} aria-hidden /> Treatment Plans
          </Link>
        }
        title={<>{isReview ? 'Treatment Plan Review' : 'Treatment Plan'} — {context.client.displayName || context.client.name}</>}
        description={<>{context.client.dateOfBirth ? `DOB ${context.client.dateOfBirth}${context.client.age != null ? ` (age ${context.client.age})` : ''} · ` : ''} Clinician: {context.clinicianName || 'you'} ({context.licenseLevel === 'PRE_LICENSED' ? 'pre-licensed — supervisor signature required' : 'licensed'})</>}
        actions={<>
        {planId ? (
          <Link href={`/dashboard/ehr/treatment-plans/${encodeURIComponent(planId)}/document`} target="_blank" className={smallBtn}>
            <FileText size={12} /> Plan document
          </Link>
        ) : null}
        {context.activePlan && !isReview && !context.plan.id && !context.rewrite ? (
          <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(context.client.id)}&kind=Review`} className={smallBtn}>
            <ClipboardList size={12} /> Review the active plan instead
          </Link>
        ) : null}
        </>}
      />

      {context.rewrite ? (
        <RewriteFromValantPanel
          rewrite={context.rewrite}
          clientId={context.client.id}
          today={today}
          disabled={signed}
          onAddGoals={(picked) => setProblems(addSuggestedGoalsToProblems(problems, picked))}
        />
      ) : null}

      {context.intake && !isReview ? (
        <Alert tone="info">
          Pre-filled from the {context.intake.noteType === 'Substance Abuse Intake' ? 'Substance Abuse Intake' : 'MD Therapy Adult & Child Intake'} signed {context.intake.date}: diagnoses, goals in the client’s words, strengths and recommended frequency. Review each one.
        </Alert>
      ) : !isReview && !context.plan.id ? (
        <Alert tone="warning">No signed therapist intake on file to pre-fill from. The plan normally follows the intake (90791).</Alert>
      ) : null}
      {isReview && context.activePlan ? (
        <Alert tone="info">
          Reviewing “{context.activePlan.title}”. Goals were copied forward; rate progress on each. The current plan is closed when this review becomes active.
        </Alert>
      ) : null}

      {TREATMENT_PLAN_TEMPLATE.filter((s) => visibleFromValues(s.when, tctx, values)).map((s, n) => (
        <section key={s.heading} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h2 className="text-sm font-bold text-blue-600">{n + 1}. {s.heading}</h2>
          {s.intro ? <p className="text-[11px] text-slate-500">{s.intro}</p> : null}
          <fieldset disabled={signed} className="space-y-3 disabled:opacity-70">
            {s.fields
              .filter((f) => visibleFromValues(f.when, tctx, values))
              .map((f) =>
                f.kind === 'widget' ? (
                  <div key={f.id}>{f.widget === 'tpGoals' ? goalsWidget : f.widget === 'diagnoses' ? diagnosesWidget : null}</div>
                ) : (
                  <TemplateField key={f.id} field={f} values={values} set={set} missing={missing.has(f.id) ? 'required' : null} />
                )
              )}
            {s.heading === TP.reviewDate ? (
              <p className="text-[11px] text-slate-500">
                {context.reviewDaysNote} Latest allowed: {context.maxReviewDate}.{' '}
                <button type="button" className="font-semibold text-blue-600 hover:underline" onClick={() => set('reviewDate', context.defaultReviewDate)}>
                  Use {context.defaultReviewDate}
                </button>
              </p>
            ) : null}
          </fieldset>
          <GeneratedPreview text={sections[s.heading] || ''} label="Goes into the plan" />
        </section>
      ))}

      <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
        <h2 className="text-sm font-bold text-blue-600">Signatures</h2>
        {!signed ? (
          <>
            {blockers.length ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <p className="mb-1 font-semibold">Required before signing</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {blockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
              <span>
                <strong className="text-slate-900">{PROVIDER_SIGNER_ATTESTATION}</strong> I developed this plan with the client{context.client.minor ? ' and parent / guardian' : ''}. Signing makes it active
                {context.licenseLevel === 'PRE_LICENSED' ? ' once my supervisor signs' : ''} and sends it to the client portal for signature.
              </span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={saving || blockers.length > 0 || !attested}
                onClick={() => void saveAndSign()}
                className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
              >
                {saving ? 'Saving…' : 'Save, sign & send to client'}
              </button>
              <button type="button" disabled={saving} onClick={() => void save()} className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Save draft
              </button>
            </div>
          </>
        ) : null}
        {planRow ? (
          <PlanSignaturePanel
            plan={planRow}
            currentUserId={user?.id ?? null}
            allowSign={false}
            onChanged={() => {
              if (planId) void loadPlanRow(planId);
              router.refresh();
            }}
          />
        ) : null}
        {signed ? (
          <p className="flex items-start gap-2 text-[11px] text-slate-500">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" /> A signed plan is read-only. Use “Reopen for edits” (clears every signature) or start a Treatment Plan Review.
          </p>
        ) : null}
        {message ? <p className="text-xs font-semibold text-emerald-700">{message}</p> : null}
        {error ? <p className="text-xs text-rose-700">{error}</p> : null}
        <button type="button" className={pillBtn(false)} onClick={() => window.print()}>
          Print
        </button>
      </section>
    </div>
  );
}
