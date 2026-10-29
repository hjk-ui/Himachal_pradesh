'use client';

/**
 * Consent packet signing (intake, patient portal, in office). One section per template with its own
 * acknowledgment; standalone authorizations (ROI, Part 2 consent) have their own typed signature or
 * can be declined; then ONE final typed signature for the packet. A parent / guardian / legal
 * representative gives relationship and authority. Validation is the same pure code the server runs.
 * Signatures are typed (no drawn-signature component exists in Altrixs).
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSignature, Info, Loader2, ShieldCheck } from 'lucide-react';
import type { RenderedTemplate, TemplateBlock } from '@/lib/consents/library/types';
import type { MinorRule, PacketItem } from '@/lib/consents/library/composer';
import { REPRESENTATIVE_RELATIONSHIPS, validatePacketSubmission, validateSigner, type PacketSubmission, type SectionResponse, type SignerInput } from '@/lib/consents/library/signing';

export type PacketFormItem = PacketItem & { rendered: RenderedTemplate };

// 16px text and 44px height on phones (no iOS focus zoom, thumb-sized); compact from sm.
const input = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 sm:min-h-0 sm:text-[13px] focus:border-[#5C2D91] focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/20';
const label = 'mb-1 block text-[12px] font-semibold text-slate-700';
/** Checkbox / radio: thumb-sized on phones, compact from sm. */
const check = 'mt-0.5 h-5 w-5 shrink-0 sm:h-4 sm:w-4';

export function ConsentBlocks({ blocks }: { blocks: TemplateBlock[] }) {
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-800">
      {blocks.map((b, i) => {
        if (b.kind === 'h') return <h4 key={i} className="pt-1 text-[13.5px] font-bold text-slate-900">{b.text}</h4>;
        if (b.kind === 'p') return <p key={i}>{b.text}</p>;
        if (b.kind === 'note') return <p key={i} className="italic text-slate-600">{b.text}</p>;
        if (b.kind === 'lead') return <p key={i}><strong>{b.label}</strong> {b.text}</p>;
        const L = b.kind === 'ol' ? 'ol' : 'ul';
        return (
          <L key={i} className={`${b.kind === 'ol' ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
            {b.items.map((it, j) => <li key={j}>{it}</li>)}
          </L>
        );
      })}
    </div>
  );
}

function emptyResponse(item: PacketFormItem): SectionResponse {
  return { version: item.version, acknowledged: false, checkboxes: {}, choices: {}, fields: { ...(item.prefill ?? {}) } };
}

export function ConsentPacketForm(props: {
  items: PacketFormItem[];
  minor: MinorRule | null;
  guardian?: { name: string | null; relationship: string | null; authority: string | null } | null;
  /** Prefill the printed name (e.g. the client's name from intake) */
  defaultPrintedName?: string;
  mode: 'intake' | 'portal' | 'in_office';
  busy?: boolean;
  submitLabel?: string;
  /** Hide the final signature block (intake renders it on its own Signature step) */
  hideSigner?: boolean;
  /** Controlled mode: called on every change (no submit button) */
  onChange?: (sub: PacketSubmission, errors: string[]) => void;
  onSubmit?: (sub: PacketSubmission) => void;
  serverErrors?: string[];
}) {
  const { items, minor } = props;
  const [sections, setSections] = useState<Record<string, SectionResponse>>(() => Object.fromEntries(items.map((it) => [it.key, emptyResponse(it)])));
  const repDefault = Boolean(minor && !minor.mayConsentAlone);
  const [signer, setSigner] = useState<SignerInput>({
    signerType: repDefault ? 'representative' : 'self',
    printedName: repDefault ? props.guardian?.name ?? '' : props.defaultPrintedName ?? '',
    relationship: repDefault ? props.guardian?.relationship ?? '' : '',
    authority: repDefault ? props.guardian?.authority ?? '' : '',
    signature: '',
    agree: false,
  });
  const [touched, setTouched] = useState(false);

  // Keep sections in step with the composed items (intake recomposes when answers change)
  useEffect(() => {
    setSections((prev) => Object.fromEntries(items.map((it) => [it.key, prev[it.key] && prev[it.key].version === it.version ? prev[it.key] : emptyResponse(it)])));
  }, [items]);

  const rendered = useMemo(() => new Map(items.map((it) => [it.key, it.rendered])), [items]);
  const sub: PacketSubmission = useMemo(() => ({ sections, signer }), [sections, signer]);
  const errors = useMemo(() => {
    if (props.hideSigner) {
      const all = validatePacketSubmission(items, rendered, { sections, signer: { ...signer, printedName: signer.printedName || 'placeholder', signature: signer.printedName || 'placeholder', agree: true } }, null);
      const signerErrs = new Set(validateSigner({ ...signer, printedName: signer.printedName || 'placeholder', signature: signer.printedName || 'placeholder', agree: true }, null));
      return all.filter((e) => !signerErrs.has(e) && !/must match the printed name/.test(e));
    }
    return validatePacketSubmission(items, rendered, sub, minor);
  }, [items, rendered, sub, sections, signer, minor, props.hideSigner]);

  const { onChange } = props;
  useEffect(() => {
    onChange?.(sub, errors);
  }, [sub, errors, onChange]);

  const set = (key: string, patch: Partial<SectionResponse>) => setSections((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  const done = items.filter((it) => sections[it.key]?.acknowledged || sections[it.key]?.declined).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-[12.5px] text-[#5C2D91] ring-1 ring-violet-200">
        <ShieldCheck size={15} aria-hidden />
        <span>
          {items.length} section{items.length === 1 ? '' : 's'} to review. Check the acknowledgment at the end of each section{props.hideSigner ? '; you sign once on the next step.' : ', then sign once at the bottom.'}
        </span>
        <span className="ml-auto font-semibold">{done} of {items.length} done</span>
      </div>
      {minor ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>The client is under 18. {minor.explanation}</span>
        </p>
      ) : null}

      {items.map((it, idx) => {
        const r = it.rendered;
        const resp = sections[it.key] ?? emptyResponse(it);
        const complete = resp.acknowledged || resp.declined;
        return (
          <section key={`${it.key}:${it.purposeTag ?? ''}`} className="clinic-card p-4" aria-labelledby={`sec-${idx}`}>
            <div className="mb-2 flex items-start gap-2">
              {complete ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-600" aria-label="Done" /> : <FileSignature size={16} className="mt-0.5 text-[#5C2D91]" aria-hidden />}
              <div className="min-w-0">
                <h3 id={`sec-${idx}`} className="break-words text-[14px] font-bold text-slate-900">{idx + 1}. {it.title}</h3>
                <p className="text-[11px] text-slate-500">Version {it.version}{it.signing === 'standalone' ? ' · signed separately' : ''}{it.optional ? ' · voluntary' : ''}</p>
              </div>
            </div>
            <div className="max-h-[min(420px,60dvh)] overflow-y-auto break-words rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <ConsentBlocks blocks={r.blocks} />
            </div>

            {it.optional ? (
              <label className="mt-3 flex items-start gap-2 text-[12.5px] text-slate-700">
                <input type="checkbox" className={check} checked={Boolean(resp.declined)} onChange={(e) => set(it.key, { declined: e.target.checked, acknowledged: false })} />
                I do not want to sign this authorization (my care is not affected).
              </label>
            ) : null}

            {!resp.declined ? (
              <div className="mt-3 space-y-3">
                {r.choices.map((ch) => (
                  <fieldset key={ch.key}>
                    <legend className={label}>{ch.label}{ch.required ? ' *' : ''}</legend>
                    <div className="flex flex-wrap gap-3">
                      {ch.options.map((o) => (
                        <label key={o.value} className="flex min-h-10 items-center gap-1.5 text-[13px] sm:min-h-0">
                          <input type="radio" className={check} name={`${it.key}-${ch.key}`} checked={resp.choices?.[ch.key] === o.value} onChange={() => set(it.key, { choices: { ...resp.choices, [ch.key]: o.value } })} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                {r.fields.map((f) => {
                  const v = resp.fields?.[f.key];
                  const setField = (val: string | string[]) => set(it.key, { fields: { ...resp.fields, [f.key]: val } });
                  return (
                    <div key={f.key}>
                      <label className={label} htmlFor={`${it.key}-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
                      {f.kind === 'textarea' ? (
                        <textarea id={`${it.key}-${f.key}`} className={input} rows={2} maxLength={2000} value={typeof v === 'string' ? v : ''} onChange={(e) => setField(e.target.value)} />
                      ) : f.kind === 'select' ? (
                        <select id={`${it.key}-${f.key}`} className={input} value={typeof v === 'string' ? v : ''} onChange={(e) => setField(e.target.value)}>
                          <option value="">Choose…</option>
                          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : f.kind === 'multiselect' ? (
                        <div className="grid gap-1 sm:grid-cols-2">
                          {f.options?.map((o) => {
                            const list = Array.isArray(v) ? v : [];
                            return (
                              <label key={o.value} className="flex items-start gap-1.5 text-[12.5px]">
                                <input type="checkbox" className={check} checked={list.includes(o.value)} onChange={(e) => setField(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
                                {o.label}
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <input id={`${it.key}-${f.key}`} type={f.kind === 'date' ? 'date' : 'text'} className={input} maxLength={200} value={typeof v === 'string' ? v : ''} onChange={(e) => setField(e.target.value)} />
                      )}
                      {f.help ? <p className="mt-0.5 text-[11px] text-slate-500">{f.help}</p> : null}
                    </div>
                  );
                })}
                {r.checkboxes.map((c) => (
                  <label key={c.key} className="flex items-start gap-2 text-[13px]">
                    <input type="checkbox" className={check} checked={Boolean(resp.checkboxes?.[c.key])} onChange={(e) => set(it.key, { checkboxes: { ...resp.checkboxes, [c.key]: e.target.checked } })} />
                    {c.label}{c.required ? ' *' : ''}
                  </label>
                ))}
                <label className="flex items-start gap-2 rounded-lg bg-white p-2 text-[13px] font-semibold text-slate-900 ring-1 ring-slate-200">
                  <input type="checkbox" className={check} checked={resp.acknowledged} onChange={(e) => set(it.key, { acknowledged: e.target.checked })} />
                  {r.acknowledgment}
                </label>
                {it.signing === 'standalone' ? (
                  <div>
                    <label className={label} htmlFor={`${it.key}-sig`}>Sign this authorization separately: type the same full name you sign the packet with *</label>
                    <input id={`${it.key}-sig`} className={`${input} italic`} maxLength={120} value={resp.signature ?? ''} onChange={(e) => set(it.key, { signature: e.target.value })} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {!props.hideSigner ? <SignerBlock signer={signer} setSigner={setSigner} minor={minor} /> : null}

      {touched && (props.serverErrors?.length || errors.length) ? (
        <ul role="alert" className="list-disc space-y-0.5 rounded-lg bg-rose-50 px-6 py-2 text-[12.5px] text-rose-800 ring-1 ring-rose-200">
          {(props.serverErrors?.length ? props.serverErrors : errors).slice(0, 8).map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}

      {props.onSubmit ? (
        <button
          type="button"
          disabled={props.busy}
          onClick={() => {
            setTouched(true);
            if (!errors.length) props.onSubmit!(sub);
          }}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#5C2D91] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#4a2475] disabled:opacity-60 sm:min-h-10 sm:w-auto"
        >
          {props.busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FileSignature size={15} aria-hidden />}
          {props.submitLabel ?? 'Sign the packet'}
        </button>
      ) : (
        <button type="button" className="min-h-10 text-[12px] text-[#5C2D91] underline" onClick={() => setTouched(true)}>
          Check what is missing
        </button>
      )}
    </div>
  );
}

export function SignerBlock({ signer, setSigner, minor }: { signer: SignerInput; setSigner: (s: SignerInput) => void; minor: MinorRule | null }) {
  const rep = signer.signerType === 'representative';
  return (
    <section className="clinic-card p-4" aria-label="Signature">
      <h3 className="mb-2 text-[14px] font-bold text-slate-900">Signature</h3>
      <fieldset className="mb-3">
        <legend className={label}>Who is signing? *</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex min-h-10 items-center gap-1.5 sm:min-h-0">
            <input type="radio" className={check} checked={!rep} onChange={() => setSigner({ ...signer, signerType: 'self' })} disabled={Boolean(minor && !minor.mayConsentAlone)} />
            The client
          </label>
          <label className="flex min-h-10 items-center gap-1.5 sm:min-h-0">
            <input type="radio" className={check} checked={rep} onChange={() => setSigner({ ...signer, signerType: 'representative' })} />
            Parent, guardian or legal representative
          </label>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="signer-name">Printed name of the person signing *</label>
          <input id="signer-name" className={input} maxLength={120} value={signer.printedName} onChange={(e) => setSigner({ ...signer, printedName: e.target.value })} />
        </div>
        {rep ? (
          <div>
            <label className={label} htmlFor="signer-rel">Relationship to the client *</label>
            <select id="signer-rel" className={input} value={signer.relationship ?? ''} onChange={(e) => setSigner({ ...signer, relationship: e.target.value })}>
              <option value="">Choose…</option>
              {REPRESENTATIVE_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        ) : null}
        {rep ? (
          <div className="sm:col-span-2">
            <label className={label} htmlFor="signer-auth">Your legal authority to sign for the client *</label>
            <input id="signer-auth" className={input} maxLength={300} placeholder="e.g. parent with legal custody; guardianship order, Montgomery County Circuit Court" value={signer.authority ?? ''} onChange={(e) => setSigner({ ...signer, authority: e.target.value })} />
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <label className={label} htmlFor="signer-sig">Signature: type your full name *</label>
          <input id="signer-sig" className={`${input} text-[16px] italic`} style={{ fontFamily: 'cursive' }} maxLength={120} value={signer.signature} onChange={(e) => setSigner({ ...signer, signature: e.target.value })} />
        </div>
      </div>
      <label className="mt-3 flex items-start gap-2 text-[12.5px] text-slate-700">
        <input type="checkbox" className={check} checked={signer.agree} onChange={(e) => setSigner({ ...signer, agree: e.target.checked })} />
        I agree that my typed name is my electronic signature on every section I acknowledged above, with the same effect as a handwritten signature, and that today&apos;s date is the date signed.
      </label>
    </section>
  );
}
