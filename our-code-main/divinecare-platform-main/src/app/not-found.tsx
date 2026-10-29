import Link from 'next/link';
import { ArrowLeft, Home, Users } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-[#EEF0FE] flex items-center justify-center text-[#6868D0]">
          <span className="text-2xl font-black">404</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">Page Not Found</h1>
          <p className="text-sm text-slate-500">
            The page or client record you are looking for does not exist, has been archived, or you don&apos;t have permission to view it.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            href="/dashboard/clients"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition shadow-xs"
          >
            <Users size={16} className="text-[#6868D0]" />
            View Clients
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#6868D0] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5555b8] transition shadow-xs"
          >
            <Home size={16} />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
