import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { PARTNER_TRADEMARK_LINE } from './partners';

export function MarketingDocShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="relative block h-8 w-32">
            <Image
              src="/altrixs-logo.png"
              alt="Altrixs"
              fill
              className="object-contain object-left"
              sizes="128px"
              priority
            />
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-[#5C2D91] hover:text-[#5C2D91]"
          >
            Staff sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-700">{children}</div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500 sm:px-6">
          <p>&copy; {new Date().getFullYear()} Altrixs. All rights reserved.</p>
          <nav className="flex gap-4 font-medium" aria-label="Footer">
            <Link href="/privacy" className="hover:text-[#5C2D91]">
              Privacy
            </Link>
            <Link href="/support" className="hover:text-[#5C2D91]">
              Support
            </Link>
            <Link href="/legal/baa" className="hover:text-[#5C2D91]">
              BAA
            </Link>
            <Link href="/" className="hover:text-[#5C2D91]">
              Home
            </Link>
          </nav>
          <p className="w-full text-xs text-slate-400">{PARTNER_TRADEMARK_LINE}</p>
        </div>
      </footer>
    </div>
  );
}
