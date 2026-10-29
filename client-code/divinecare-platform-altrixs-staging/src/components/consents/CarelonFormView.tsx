'use client';

/**
 * Read-only rendering of the Carelon Behavioral Health - Maryland non-overlap attestation:
 * exact form text (template.ts, or the frozen copy of a signed record), the prefilled
 * participant / provider information, and the signatures recorded so far. Text only, no logo.
 */
import type { CarelonTemplate } from '@/lib/consents/carelon/template';
import type { PartASignature, PartBSignature } from '@/lib/consents/carelon/workflow';
import { formatTin } from '@/lib/consents/carelon/prefill';

type Props = {
  template: CarelonTemplate;
  participant: { participantName: string | null; participantId: string | null; dateOfBirth: string | null };
  provider: { organizationName: string | null; npi: string | null; tin: string | null };
  partA?: PartASignature | null;
  partB?: PartBSignature | null;
  /** Mask the TIN on screen (staff lists); the patient and the PDF see the full number */
  maskTin?: boolean;
};

function Box({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className="mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 translate-y-0.5 items-center justify-center rounded-[2px] border border-slate-700 text-[10px] font-bold leading-none">
      {checked ? 'X' : ''}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 min-h-[1.5rem] border-b border-slate-400 pb-0.5 text-sm ${value ? 'text-slate-900' : 'italic text-slate-400'}`}>{value || 'Not provided'}</p>
    </div>
  );
}

export function CarelonFormView({ template: t, participant, provider, partA, partB, maskTin }: Props) {
  const tin = formatTin(provider.tin);
  const tinShown = tin ? (maskTin ? `•••••${tin.slice(-4)}` : tin) : null;
  const rep = partA?.signerType === 'representative';
  return (
    <article className="min-w-0 space-y-5 break-words rounded-xl border border-slate-200 bg-white p-4 text-slate-800 sm:p-5">
      <header className="border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-slate-900">{t.title}</h2>
        <p className="mt-0.5 text-sm font-semibold text-slate-700">{t.subtitle}</p>
        <p className="mt-1 text-[11px] text-slate-500">Form version {t.version}</p>
      </header>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900">{t.participantInfo.heading}</h3>
        <Field label={t.participantInfo.fields[0].label} value={participant.participantName} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.participantInfo.fields[1].label} value={participant.participantId} />
          <Field label={t.participantInfo.fields[2].label} value={participant.dateOfBirth} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900">{t.providerInfo.heading}</h3>
        <Field label={t.providerInfo.fields[0].label} value={provider.organizationName} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.providerInfo.fields[1].label} value={provider.npi} />
          <Field label={t.providerInfo.fields[2].label} value={tinShown} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900">{t.purpose.heading}</h3>
        {t.purpose.paragraphs.map((p) => (
          <p key={p} className="text-sm leading-6">{p}</p>
        ))}
      </section>

      <section className="space-y-2 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">{t.partA.heading}</h3>
        <p className="text-sm">{t.partA.lead}</p>
        <div className="text-sm leading-6">
          <p>{t.partA.statement1.before}</p>
          <p className="ml-4 flex"><Box checked={partA?.signerType === 'participant'} /><span>{t.partA.statement1.optionParticipant}</span></p>
          <p className="ml-4 font-semibold">{t.partA.statement1.or}</p>
          <p className="ml-4 flex"><Box checked={rep} /><span>{t.partA.statement1.optionRepresentative}</span></p>
        </div>
        {t.partA.statements.map((s) => (
          <p key={s} className="text-sm leading-6">{s}</p>
        ))}
        {partA ? (
          <div className="mt-2 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <Field label={t.partA.fields[0].label} value={partA.printedName} />
            <Field label={t.partA.fields[1].label} value={rep ? partA.relationship : null} />
            <div className="sm:col-span-2"><Field label={t.partA.fields[2].label} value={rep ? partA.authority : null} /></div>
            <Field label={t.partA.fields[3].label} value={partA.signature ? `${partA.signature} (signed electronically)` : null} />
            <Field label={t.partA.fields[4].label} value={partA.dateSigned} />
          </div>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">{t.partB.heading}</h3>
        <p className="text-sm">{t.partB.lead}</p>
        {t.partB.statements.map((s) => (
          <p key={s} className="text-sm leading-6">{s}</p>
        ))}
        {partB ? (
          <div className="mt-2 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <Field label={t.partB.fields[0].label} value={partB.printedName} />
            <Field label={t.partB.fields[1].label} value={partB.title} />
            <Field label={t.partB.fields[2].label} value={`${partB.signature} (signed electronically)`} />
            <Field label={t.partB.fields[3].label} value={partB.dateSigned} />
          </div>
        ) : null}
      </section>

      <footer className="border-t border-slate-200 pt-2 text-[11px] text-slate-500">{t.footer}</footer>
    </article>
  );
}
