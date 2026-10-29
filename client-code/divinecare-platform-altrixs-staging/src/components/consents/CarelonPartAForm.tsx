'use client';

/**
 * Part A signature entry for the Carelon non-overlap attestation (patient portal, in-office staff
 * screen and the intake packet). Typed electronic signature, consistent with treatment plan
 * signing. An Authorized Representative must give their relationship and a brief description of
 * their legal authority (prefilled from the chart's guardian fields when present).
 */
import { useState } from 'react';
import { validatePartA, type PartAInput, type SignerType } from '@/lib/consents/carelon/workflow';

export const REPRESENTATIVE_RELATIONSHIPS = ['Parent', 'Legal guardian', 'Health care agent (power of attorney)', 'Court-appointed representative', 'Other'] as const;

type Props = {
  busy?: boolean;
  /** Chart guardian / personal representative (prefills the representative fields) */
  guardian?: { name: string | null; relationship: string | null } | null;
  /** Who is holding the device: the client themself, or staff recording an in-office signature */
  mode: 'portal' | 'in_office' | 'intake';
  submitLabel?: string;
  onSubmit: (input: PartAInput) => void;
  onCancel?: () => void;
  /** Controlled use (intake packet): report every change instead of a submit button */
  onChange?: (input: PartAInput, errors: string[]) => void;
};

export function CarelonPartAForm({ busy, guardian, mode, submitLabel, onSubmit, onCancel, onChange }: Props) {
  const [signerType, setSignerType] = useState<SignerType>('participant');
  const [printedName, setPrintedName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [authority, setAuthority] = useState('');
  const [signature, setSignature] = useState('');
  const [agree, setAgree] = useState(false);
  const [tried, setTried] = useState(false);

  const input: PartAInput = { signerType, printedName, relationship, authority, signature, agree };
  const errors = validatePartA(input);
  const emit = (patch: Partial<PartAInput>) => {
    if (!onChange) return;
    const next = { ...input, ...patch };
    onChange(next, validatePartA(next));
  };

  const pickSigner = (t: SignerType) => {
    setSignerType(t);
    const patch: Partial<PartAInput> = { signerType: t };
    if (t === 'representative' && guardian?.name) {
      if (!printedName) { setPrintedName(guardian.name); patch.printedName = guardian.name; }
      if (!relationship && guardian.relationship) { setRelationship(guardian.relationship); patch.relationship = guardian.relationship; }
    }
    emit(patch);
  };

  const who = mode === 'in_office' ? 'the person signing' : 'you';
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold text-slate-800">1. {mode === 'in_office' ? 'The person signing is' : 'I am'} (check one)</legend>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="radio" name="carelon-signer" checked={signerType === 'participant'} onChange={() => pickSigner('participant')} className="mt-0.5 h-5 w-5 shrink-0 sm:mt-1 sm:h-4 sm:w-4" />
          <span>The participant identified above</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="radio" name="carelon-signer" checked={signerType === 'representative'} onChange={() => pickSigner('representative')} className="mt-0.5 h-5 w-5 shrink-0 sm:mt-1 sm:h-4 sm:w-4" />
          <span>The participant&apos;s Authorized Representative / legal guardian with legal authority to act on the participant&apos;s behalf</span>
        </label>
      </fieldset>

      <label className="block text-sm font-medium text-slate-700">
        Printed name ({signerType === 'participant' ? 'participant' : 'Authorized Representative'})
        <input value={printedName} onChange={(e) => { setPrintedName(e.target.value); emit({ printedName: e.target.value }); }} autoComplete="name" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-2 text-base sm:min-h-0 sm:text-sm" />
      </label>

      {signerType === 'representative' ? (
        <>
          <label className="block text-sm font-medium text-slate-700">
            Relationship to the participant
            <input list="carelon-rel" value={relationship} onChange={(e) => { setRelationship(e.target.value); emit({ relationship: e.target.value }); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-2 text-base sm:min-h-0 sm:text-sm" />
            <datalist id="carelon-rel">
              {REPRESENTATIVE_RELATIONSHIPS.map((r) => <option key={r} value={r} />)}
            </datalist>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Brief description of legal authority
            <textarea value={authority} onChange={(e) => { setAuthority(e.target.value); emit({ authority: e.target.value }); }} rows={2} placeholder="For example: parent of a minor; court-appointed guardian (case number); health care power of attorney" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-2 text-base sm:min-h-0 sm:text-sm" />
          </label>
        </>
      ) : null}

      <label className="block text-sm font-medium text-slate-700">
        Signature: type the printed name again
        <input value={signature} onChange={(e) => { setSignature(e.target.value); emit({ signature: e.target.value }); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-2 font-serif text-base italic" />
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); emit({ agree: e.target.checked }); }} className="mt-0.5 h-5 w-5 shrink-0 sm:mt-1 sm:h-4 sm:w-4" />
        <span>
          {mode === 'in_office'
            ? 'The signer read statements 1 to 6 above (or had them read to them), had the chance to ask questions, and agrees. The typed name is their electronic signature.'
            : `I have read statements 1 to 6 above, had the chance to ask questions, and agree to them. Typing my name is my electronic signature.`}
        </span>
      </label>

      {tried && errors.length ? (
        <ul role="alert" className="list-disc space-y-0.5 rounded-lg bg-rose-50 p-2 pl-6 text-xs text-rose-800">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}

      {onChange ? null : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTried(true);
              if (!errors.length) onSubmit({ ...input, printedName: printedName.trim(), signature: signature.trim() });
            }}
            className="min-h-11 w-full rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 sm:min-h-10 sm:w-auto"
          >
            {busy ? 'Saving…' : submitLabel ?? 'Sign'}
          </button>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 sm:min-h-10 sm:w-auto">Cancel</button>
          ) : null}
        </div>
      )}
      <p className="text-[11px] text-slate-500">Questions about this form: Carelon customer service 1-800-888-1965. Signing is voluntary; {who} may ask the clinic any question first.</p>
    </div>
  );
}
