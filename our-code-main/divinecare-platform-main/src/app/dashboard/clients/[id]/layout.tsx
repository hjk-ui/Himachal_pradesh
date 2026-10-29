import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { bannerShowsRiskOnly, chartTabVisible } from '@/lib/clients/chartVisibility';

const RISK_LABEL = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' } as const;
const TAB_NAMES = ['Overview', 'Notes', 'Medications', 'Alerts', 'Insurance', 'Measures'] as const;

export default async function ClientChartLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gate = await requireSession();
  if (!gate.ok || !gate.organizationId || !bannerShowsRiskOnly(gate.role)) return children;

  const client = await prisma.client.findFirst({
    where: { id, organizationId: gate.organizationId },
    select: { name: true, riskLevel: true },
  });
  if (!client) return children;

  const risk = RISK_LABEL[client.riskLevel] ?? 'low';
  const tabs = TAB_NAMES.filter((tab) => chartTabVisible(gate.role, tab));

  return (
    <>
      <div className="mx-auto mb-4 w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{client.name}</h1>
        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-slate-700">
          {risk} risk
        </span>
        <div className="mt-3 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button key={tab} type="button" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700">
              {tab}
            </button>
          ))}
        </div>
      </div>
      {children}
    </>
  );
}
