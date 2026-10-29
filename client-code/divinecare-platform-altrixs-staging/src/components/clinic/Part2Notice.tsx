import { ShieldAlert } from 'lucide-react';

export function Part2Notice() {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <ShieldAlert className="mt-0.5 shrink-0" size={20} />
      <div>
        <p className="font-semibold">42 CFR Part 2 — Federal confidentiality protection</p>
        <p className="mt-1">
          This note is marked as a substance use disorder / chemical dependency record. Confirm
          applicable consent and disclosure requirements before sharing or releasing it.
        </p>
        <a
          className="mt-1 inline-block underline"
          href="https://www.hhs.gov/hipaa/part-2/index.html"
          target="_blank"
          rel="noreferrer"
        >
          HHS Part 2 guidance
        </a>
      </div>
    </div>
  );
}
