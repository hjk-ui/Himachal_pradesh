'use client';

import { useMemo, useState } from 'react';
import {
  CAT_COLORS,
  CPT_CATEGORIES,
  CPT_CODES,
  MODIFIER_CODES,
  POS_CODES,
  catalogTotalRevenue,
  type CptCategory,
} from '@/lib/constants/cpt';

function money(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function moneyExact(n: number) {
  return `$${n.toFixed(2)}`;
}

export function BillingCodeLibrary() {
  const [cat, setCat] = useState<'All' | CptCategory>('All');

  const rows = useMemo(() => {
    if (cat === 'All') return CPT_CODES;
    return CPT_CODES.filter((c) => c.category === cat);
  }, [cat]);

  const totalRevenue = useMemo(() => {
    if (cat === 'All') return catalogTotalRevenue();
    return rows.reduce((s, c) => s + c.rate * c.units, 0);
  }, [cat, rows]);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-bold text-[#141C34]">CPT / HCPCS Codes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Rates are standard fee schedule — actual reimbursement varies by payer contract. Add-On
          codes are billed in addition to a primary service code.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCat('All')}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
              cat === 'All'
                ? 'bg-[#5C2D91] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({CPT_CODES.length})
          </button>
          {CPT_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                cat === c
                  ? 'bg-[#5C2D91] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                <th className="px-3 py-3">Code</th>
                <th className="px-3 py-3">Description</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Rate</th>
                <th className="px-3 py-3">Units</th>
                <th className="px-3 py-3">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const colors = CAT_COLORS[row.category];
                return (
                  <tr key={row.code} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-mono text-sm font-bold text-[#5C2D91]">
                      {row.code}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{row.desc}</td>
                    <td className="px-3 py-3">
                      <span
                        className="inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold"
                        style={{
                          backgroundColor: colors.bg,
                          color: colors.text,
                          borderColor: colors.border,
                        }}
                      >
                        {row.category}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-700">
                      {moneyExact(row.rate)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{row.units}</td>
                    <td className="px-3 py-3 font-bold text-emerald-700">
                      {money(row.rate * row.units)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {cat === 'All' ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={5} className="px-3 py-3 text-right text-sm font-bold text-slate-600">
                    Total Estimated Revenue
                  </td>
                  <td className="px-3 py-3 text-base font-black text-[#5C2D91]">
                    {money(totalRevenue)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-[#141C34]">Billing Modifiers</h2>
        <p className="mt-1 text-sm text-slate-500">
          Apply on the claim service line when payer rules require them (telehealth, credential,
          Maryland Medicaid, bundling).
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                <th className="px-3 py-3">Modifier</th>
                <th className="px-3 py-3">Description</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">When to Use</th>
              </tr>
            </thead>
            <tbody>
              {MODIFIER_CODES.map((m) => (
                <tr key={m.modifier} className="border-t border-slate-100">
                  <td className="px-3 py-3 font-mono font-bold text-[#5C2D91]">{m.modifier}</td>
                  <td className="px-3 py-3 text-slate-700">{m.desc}</td>
                  <td className="px-3 py-3 text-slate-500">{m.category}</td>
                  <td className="px-3 py-3 text-slate-600">{m.posNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-[#141C34]">Place of Service (POS) Codes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Default POS 11 (office). PRP / community often 99; crisis often 23; telehealth 02 or 10.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {POS_CODES.map((p) => (
            <span
              key={p.pos}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm"
            >
              <span className="font-mono font-bold text-[#5C2D91]">{p.pos}</span>
              <span className="text-slate-600">{p.desc}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
