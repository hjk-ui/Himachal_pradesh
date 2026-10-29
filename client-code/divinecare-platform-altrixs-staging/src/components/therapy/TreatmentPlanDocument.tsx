/**
 * Treatment plan document (print / PDF view and the patient portal), laid out like the practice's
 * Valant "Valant Treatment Plan" template. Presentational only: the server builds the document
 * (planDocument.ts) and freezes it when the clinician signs.
 */
import type { PlanDocument, SignatureBlock } from '@/lib/ehr/therapy/planDocument';
import { PART2_NOTICE } from '@/lib/ehr/therapy/planDocument';
import { interventionLine } from '@/lib/ehr/therapy/planHierarchy';
import { Alert } from '@/components/ui';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="text-xs">
      <span className="font-semibold text-slate-600">{label}: </span>
      <span className="whitespace-pre-wrap text-slate-900">{value}</span>
    </div>
  );
}

export function TreatmentPlanDocumentView({
  document: doc,
  signatures,
  signedText,
  draft,
}: {
  document: PlanDocument | null;
  signatures: SignatureBlock[];
  /** Plans signed before the structured document existed: the signed text */
  signedText?: string | null;
  /** Unsigned plan (current values; changes until signed) */
  draft?: boolean;
}) {
  if (!doc) {
    return (
      <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm">
        <p className="text-xs text-slate-500">This plan was signed before the structured plan document; it is shown exactly as signed.</p>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-800">{signedText || 'No signed text on file.'}</pre>
        <Signatures blocks={signatures} />
      </article>
    );
  }
  const h = doc.header;
  const p = doc.plan;
  const goalNumber = new Map(doc.problems.flatMap((pr) => pr.goals.filter((g) => g.text)).map((g, i) => [g.id, i + 1] as const));
  const numbered = doc.problems.map((pr) => ({ ...pr, goals: pr.goals.filter((g) => g.text).map((g) => ({ g, n: goalNumber.get(g.id) ?? 0 })) }));
  return (
    <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 print:border-0 print:p-0">
      {draft ? <Alert tone="warning">Draft — not signed. Content can still change.</Alert> : null}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">{h.primaryHeader}</h1>
          {h.practiceName ? <p className="text-sm font-semibold text-slate-700">{h.practiceName}</p> : null}
        </div>
        {h.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- practice logo URL from Practice Settings (any https host)
          <img src={h.logoUrl} alt={h.practiceName ? `${h.practiceName} logo` : 'Practice logo'} className="max-h-16 max-w-[200px] object-contain" />
        ) : null}
      </header>

      <section className="grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Patient">
        <div className="space-y-1">
          <p className="text-base font-semibold text-slate-900">{h.patientName}</p>
          <Row label="Patient ID" value={h.patientId || 'None on file'} />
          <Row label="Provider" value={h.provider || 'Not on file'} />
          <Row label="DOB" value={h.dateOfBirth ? `${h.dateOfBirth}${h.age != null ? ` (age ${h.age})` : ''}` : 'None on file'} />
          <Row label="Age" value={h.age} />
        </div>
        <div className="space-y-1">
          <div className="text-xs">
            <span className="font-semibold text-slate-600">Address: </span>
            {h.address.length ? h.address.map((l) => <span key={l} className="block text-slate-900">{l}</span>) : <span className="text-slate-900">None on file</span>}
          </div>
          <Row label="Main phone" value={h.mainPhone || 'None on file'} />
          <Row label="Documentation ID" value={h.documentationId} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          {h.insurances.length ? (
            h.insurances.map((i) => (
              <div key={i.rank} className="text-xs">
                <span className="font-semibold text-slate-600">Insurance {i.rank}: </span>
                <span className="text-slate-900">{i.payerName}</span>
                <span className="text-slate-700">{` · ID # ${i.memberId || 'not on file'} · Group # ${i.groupNumber || 'not on file'}`}</span>
              </div>
            ))
          ) : (
            <Row label="Insurance" value="None on file" />
          )}
          <div className="text-xs">
            <span className="font-semibold text-slate-600">Diagnosis: </span>
            {h.diagnoses.length ? (
              <span className="text-slate-900">
                {h.diagnoses.map((d) => `${d.code}${d.description ? ` ${d.description}` : ''}${d.isPrimary ? ' (primary)' : ''}`).join('; ')}
              </span>
            ) : (
              <span className="text-slate-900">None listed</span>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-x-6 gap-y-1 border-t border-slate-200 pt-3 sm:grid-cols-3" aria-label="Plan">
        <Row label="Plan type" value={p.kind === 'Review' ? 'Treatment Plan Review' : 'Initial treatment plan'} />
        <Row label="Start Date" value={p.startDate || 'Not set'} />
        <Row label="Effective Until" value={p.effectiveUntil || 'Not set'} />
        <Row label="Next review" value={p.reviewDate || 'Not set'} />
      </section>
      {p.patientInstructions ? (
        <section>
          <h2 className="text-sm font-bold text-blue-600">Patient Instructions</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{p.patientInstructions}</p>
        </section>
      ) : null}
      {p.globalComments ? (
        <section>
          <h2 className="text-sm font-bold text-blue-600">Global Comments</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{p.globalComments}</p>
        </section>
      ) : null}

      <section className="space-y-3" aria-label="Problems, goals, objectives and interventions">
        <h2 className="text-sm font-bold text-blue-600">Problems, Goals, Objectives &amp; Interventions</h2>
        {numbered.filter((pr) => pr.text || pr.goals.length).map((pr, pi) => (
          <div key={pr.id} className="space-y-2 break-inside-avoid rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-bold text-slate-900">Problem {pi + 1}: {pr.text || '(problem not named)'}</p>
            <Row label="Behavioral Description" value={pr.behavioralDescription} />
            <Row label="Patient Description" value={pr.patientDescription} />
            <Row label="Strengths" value={pr.strengths} />
            <Row label="Comment" value={pr.comment} />
            {pr.goals.map(({ g, n }) => (
              <div key={g.id} className="ml-3 space-y-1 border-l-2 border-blue-200 pl-3">
                <p className="text-sm font-semibold text-slate-900">Goal {n}: {g.text}</p>
                <div className="flex flex-wrap gap-x-4">
                  <Row label="Responsible Party" value={g.responsibleParty} />
                  <Row label="Target Date" value={g.targetDate} />
                  <Row label="Target # of Sessions" value={g.targetSessions} />
                  <Row label="Progress" value={g.progress ? `${g.progress}${g.progressNote ? ` — ${g.progressNote}` : ''}` : ''} />
                </div>
                <Row label="Patient’s Description" value={g.patientDescription} />
                <Row label="Comment" value={g.comment} />
                {g.objectives.filter((o) => o.text).map((o, oi) => (
                  <div key={o.id} className="ml-3 space-y-0.5 border-l-2 border-slate-200 pl-3">
                    <p className="text-xs font-semibold text-slate-900">Objective {n}.{oi + 1}: {o.text}</p>
                    <div className="flex flex-wrap gap-x-4">
                      <Row label="Target Date" value={o.targetDate || 'Not set'} />
                      <Row label="Target # of Sessions" value={o.targetSessions} />
                      <Row label="Progress" value={o.progress} />
                    </div>
                    <Row label="Patient’s Description" value={o.patientDescription} />
                    <Row label="Comment" value={o.comment} />
                    {o.interventions.filter((iv) => iv.text || iv.type).map((iv) => (
                      <div key={iv.id} className="ml-3 text-xs text-slate-800">
                        <span className="font-semibold text-slate-600">Intervention: </span>
                        {interventionLine(iv)}
                        {iv.comment ? <span className="block text-slate-600">Comment: {iv.comment}</span> : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {!numbered.some((pr) => pr.text || pr.goals.length) ? <p className="text-xs text-slate-500">No problems entered.</p> : null}
      </section>

      {doc.sections.map((s) => (
        <section key={s.heading} className="break-inside-avoid">
          <h2 className="text-sm font-bold text-blue-600">{s.heading}</h2>
          <p className="whitespace-pre-wrap text-xs leading-5 text-slate-800">{s.text}</p>
        </section>
      ))}

      {p.participation.length ? (
        <section className="space-y-0.5">
          {p.participation.map((x) => (
            <p key={x} className="text-xs text-slate-800">
              <span aria-hidden="true">☑ </span>
              {x}
            </p>
          ))}
        </section>
      ) : null}

      <Signatures blocks={signatures} />
      {doc.part2 ? <p className="border-t border-slate-200 pt-2 text-[11px] font-semibold text-slate-700">{PART2_NOTICE}</p> : null}
    </article>
  );
}

function Signatures({ blocks }: { blocks: SignatureBlock[] }) {
  return (
    <section className="space-y-2 border-t border-slate-200 pt-3" aria-label="Signatures">
      <h2 className="text-sm font-bold text-blue-600">Signatures</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {blocks.map((b, i) => (
          <div key={`${b.role}-${i}`} className="break-inside-avoid rounded-lg border border-slate-200 p-2.5">
            <p className="text-xs font-bold text-slate-900">{b.label}</p>
            <p className="mt-0.5 text-[11px] italic text-slate-700">{b.attestation}</p>
            <p className="mt-1 text-xs text-slate-900">
              {b.status === 'signed'
                ? `${b.name || 'Signed'} · ${when(b.signedAt)}`
                : b.status === 'verbal'
                  ? `Verbal consent · ${when(b.signedAt)}`
                  : b.status === 'declined'
                    ? `Declined · ${when(b.signedAt)}`
                    : b.status === 'pending'
                      ? 'Not signed yet'
                      : 'Not sent'}
            </p>
            {b.detail ? <p className="text-[11px] text-slate-500">{b.detail}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
