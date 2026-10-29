import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';

export default function DashboardNotFound() {
  return (
    <div className="mx-auto my-12 max-w-lg rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 text-center shadow-sm space-y-5">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F5F3FF] text-[#5C2D91]">
        <span className="text-xl font-black">404</span>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-lg font-bold text-slate-900">Record not found</h2>
        <p className="text-xs sm:text-sm text-slate-500">
          The client or resource you are trying to view doesn&apos;t exist or is not assigned to your caseload.
        </p>
      </div>

      <div className="flex justify-center pt-2">
        <Link
          href="/dashboard/clients"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-5 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#4a2475] transition shadow-xs"
        >
          <ArrowLeft size={15} />
          Back to Clients
        </Link>
      </div>
    </div>
  );
}
