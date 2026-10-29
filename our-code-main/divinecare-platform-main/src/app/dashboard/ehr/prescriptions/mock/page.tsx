import { cookies } from 'next/headers';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/tenant';
import { assertDrFirstPrescriber } from '@/lib/drfirst/access';
import { getDrFirstConfig } from '@/lib/drfirst/config';
import { readMockLaunch } from '@/lib/drfirst/service';
import { safeDrFirstError } from '@/lib/drfirst/errors';
import { DrFirstPanel } from '@/components/drfirst/DrFirstPanel';
import { getPrescribingUiState } from '@/lib/drfirst/uiState';

async function loadMockPage() {
  try {
    const context = await requireOrgContext();
    if (!context.ok) return { error: 'Unauthorized.' };

    const uiState = getPrescribingUiState(context.session?.user);
    const config = getDrFirstConfig();
    if (!config.enabled || config.environment !== 'mock') {
      return { error: 'Mock integration is unavailable.' };
    }

    assertDrFirstPrescriber(context);
    const token = (await cookies()).get('drfirst-mock-launch')?.value;
    const session = token ? await readMockLaunch(token, context) : null;
    return { session, isRolePreview: uiState.isRolePreview, allowFailures: Boolean(config.allowMockFailures) };
  } catch (error) {
    return { error: safeDrFirstError(error).message };
  }
}

export default async function MockPrescribingPage() {
  const data = await loadMockPage();
  if ('error' in data) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-red-700 font-medium">{data.error}</p>
        <Link href="/dashboard/ehr/prescriptions" className="text-indigo-700 underline text-sm">
          Return to prescriptions to launch again
        </Link>
      </div>
    );
  }
  const { session } = data;
  const isRolePreview = Boolean(data.isRolePreview);
  return (
    <div className="space-y-4">
      {isRolePreview && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Role Preview Notice (Demo Mode)</p>
          <p className="text-xs text-amber-800 mt-0.5">
            You are viewing the DrFirst mock environment in administrator preview mode. Gateway simulation and provider credential verification are read-only.
          </p>
        </div>
      )}
      <Link href="/dashboard/ehr/prescriptions" className="text-indigo-700 underline">
        Back to prescriptions
      </Link>
      <DrFirstPanel prescriber harness allowFailures={data.allowFailures} previewMode={isRolePreview} />
      <p className="text-xs text-slate-500">
        No prescription is created, signed, or transmitted to a pharmacy. This is an internal Altrixs test harness.
      </p>
      {session ? (
        <section className="rounded-xl border p-4 space-y-2">
          <h2 className="font-semibold">Launch status: {session.status} / {session.mode}</h2>
          <p>Session: {session.externalId}</p>
          <p>Patient mapping: {session.patientId}</p>
          <p>Provider mapping: {session.prescriberId}</p>
          <p>Expires: {session.expiresAt}</p>
        </section>
      ) : (
        <p className="text-sm text-slate-600">
          {isRolePreview ? 'Launch simulation is disabled in preview mode.' : 'Select an assigned patient to simulate a launch.'}
        </p>
      )}
    </div>
  );
}
