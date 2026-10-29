'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { BAA_VERSION, baaAttestationLabel } from '@/lib/legal/baa';
import { BaaDocument } from './BaaDocument';

export type BaaAcceptanceValue = {
  accepted: boolean;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
};

export const EMPTY_BAA_ACCEPTANCE: BaaAcceptanceValue = { accepted: false, signerName: '', signerTitle: '', signerEmail: '' };

/** Request body block expected by /api/auth/register (`baa`) and POST /api/admin/baa. */
export function baaRequestBody(v: BaaAcceptanceValue) {
  return {
    accepted: v.accepted,
    version: BAA_VERSION,
    signerName: v.signerName.trim(),
    signerTitle: v.signerTitle.trim(),
    signerEmail: v.signerEmail.trim().toLowerCase(),
  };
}

/** Client-side check mirroring parseBaaAcceptance (the server is the authority). */
export function baaClientError(v: BaaAcceptanceValue): string | null {
  if (v.signerName.trim().length < 2) return 'Enter the full name of the person accepting the BAA.';
  if (v.signerTitle.trim().length < 2) return 'Enter the signer’s title (for example Owner or Practice Director).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.signerEmail.trim())) return 'Enter a valid email for the BAA signer.';
  if (!v.accepted) return 'An authorized signer must accept the Business Associate Agreement to continue.';
  return null;
}

const INPUT =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';

/** Signer fields, viewable BAA text and the attestation checkbox. */
export function BaaAcceptanceFields({
  organizationName,
  value,
  onChange,
}: {
  organizationName: string;
  value: BaaAcceptanceValue;
  onChange: (next: BaaAcceptanceValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<BaaAcceptanceValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Altrixs stores protected health information for your organization, so a Business Associate
        Agreement (BAA) must be accepted by someone authorized to sign for it.
      </p>
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="baa-text"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-[#5C2D91] hover:underline"
        >
          {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          {open ? 'Hide the Business Associate Agreement' : 'Read the Business Associate Agreement'}
        </button>
        <a
          href="/legal/baa"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-[#5C2D91]"
        >
          Open in a new tab <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        {open ? (
          <div
            id="baa-text"
            tabIndex={0}
            className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4"
          >
            <BaaDocument headingLevel="h3" />
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
          Signer name
          <input className={`${INPUT} mt-1 normal-case tracking-normal font-normal`} value={value.signerName} onChange={(e) => set({ signerName: e.target.value })} autoComplete="name" />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
          Signer title
          <input className={`${INPUT} mt-1 normal-case tracking-normal font-normal`} value={value.signerTitle} onChange={(e) => set({ signerTitle: e.target.value })} placeholder="Owner, CEO, Practice Director" autoComplete="organization-title" />
        </label>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
          Signer email
          <input type="email" className={`${INPUT} mt-1 normal-case tracking-normal font-normal`} value={value.signerEmail} onChange={(e) => set({ signerEmail: e.target.value })} autoComplete="email" />
        </label>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-800">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#5C2D91]"
          checked={value.accepted}
          onChange={(e) => set({ accepted: e.target.checked })}
          required
        />
        <span>{baaAttestationLabel(organizationName)} (version {BAA_VERSION}).</span>
      </label>
    </div>
  );
}
