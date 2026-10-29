import { PARTNER_STRIP_H2, PARTNER_TRADEMARK, PARTNERS } from '@/lib/marketing/homeContent';

export function PartnerStrip({ className = '' }: { className?: string }) {
  return (
    <section className={`border-y border-slate-200 bg-white py-8 ${className}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          {PARTNER_STRIP_H2}
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {PARTNERS.map((p) => (
            <li
              key={p.name}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs"
            >
              <p className="text-sm font-semibold text-[#141C34]">{p.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{p.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-slate-400">{PARTNER_TRADEMARK}</p>
      </div>
    </section>
  );
}
