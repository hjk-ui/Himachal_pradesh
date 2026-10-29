import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BAA_DRAFT_BANNER,
  BAA_LEGAL_REVIEWED,
  BAA_TITLE,
  BAA_VERSION,
  baaPlainText,
} from '@/lib/legal/baa';

export const metadata: Metadata = {
  title: `${BAA_TITLE} | Altrixs`,
  description: 'Altrixs Business Associate Agreement for covered entities.',
};

export default function LegalBaaPage() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Legal</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{BAA_TITLE}</h1>
      <p className="mt-1 text-sm text-slate-500">Version {BAA_VERSION}</p>
      {!BAA_LEGAL_REVIEWED ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
        >
          {BAA_DRAFT_BANNER}
        </p>
      ) : null}
      <pre className="mt-6 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-xs">
        {baaPlainText()}
      </pre>
      <p className="mt-6 text-sm text-slate-500">
        <Link href="/get-started" className="font-semibold text-[#5C2D91] hover:underline">
          Back to get started
        </Link>
      </p>
    </main>
  );
}
