import Image from 'next/image';
import { PARTNERS, type Partner } from './partners';

/**
 * "Integrated with" strip. Text wordmarks by default; an approved logo renders only when the
 * partner's `logo` path is set in partners.ts (see docs/marketing-partner-logos.md).
 */
export function PartnerStrip({ partners = PARTNERS, className = '' }: { partners?: Partner[]; className?: string }) {
  return (
    <section aria-labelledby="integrated-with" className={className}>
      <div className="mx-auto max-w-6xl">
        <h2 id="integrated-with" className="text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          Integrated with
        </h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-6">
          {partners.map((p) => (
            <li
              key={p.key}
              className="flex min-h-16 flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-center"
            >
              {p.logo ? (
                <>
                  <span className="relative block h-8 w-36">
                    <Image src={p.logo} alt={`${p.logoAlt} (${p.name}, ${p.role})`} fill className="object-contain" sizes="144px" />
                  </span>
                  <span className="mt-1 text-xs text-slate-500">{p.role}</span>
                </>
              ) : (
                <>
                  <span className="text-base font-bold tracking-tight text-[#141C34]">{p.name}</span>
                  <span className="mt-0.5 text-xs text-slate-500">{p.role}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
