import { cookies } from 'next/headers';
import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/tenant';
import { assertDrFirstPrescriber } from '@/lib/drfirst/access';
import { getDrFirstConfig } from '@/lib/drfirst/config';
import { readMockLaunch } from '@/lib/drfirst/service';
import { safeDrFirstError } from '@/lib/drfirst/errors';
import { DrFirstPanel } from '@/components/drfirst/DrFirstPanel';
import { getPrescribingUiState } from '@/lib/drfirst/uiState';
import { Alert, Card, PageHeader } from '@/components/ui';

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
      <div className="space-y-4">
        <PageHeader title="DrFirst test harness" description="Mock e-prescribing launch" />
        <Alert tone="danger">{data.error}</Alert>
        <Link href="/dashboard/ehr/prescriptions" className="text-blue-700 underline text-sm">
          Return to prescriptions to launch again
        </Link>
      </div>
    );
  }
  const { session } = data;
  const isRolePreview = Boolean(data.isRolePreview);
  return (
    <div className="space-y-4">
      <PageHeader title="DrFirst test harness" description="Mock e-prescribing launch — nothing is sent to a pharmacy" />
      {isRolePreview && (
        <Alert tone="warning" title="Role Preview Notice (Demo Mode)">
          You are viewing the DrFirst mock environment in administrator preview mode. Gateway simulation and provider credential verification are read-only.
        </Alert>
      )}
      <Link href="/dashboard/ehr/prescriptions" className="text-blue-700 underline">
        Back to prescriptions
      </Link>
      <DrFirstPanel prescriber harness allowFailures={data.allowFailures} previewMode={isRolePreview} />
      <p className="text-xs text-slate-500">
        No prescription is created, signed, or transmitted to a pharmacy. This is an internal Altrixs test harness.
      </p>
      {session ? (
        <Card className="space-y-2 p-5 text-sm text-slate-700">
          <h2 className="text-sm font-semibold text-slate-900">Launch status: {session.status} / {session.mode}</h2>
          <p>Session: {session.externalId}</p>
          <p>Patient mapping: {session.patientId}</p>
          <p>Provider mapping: {session.prescriberId}</p>
          <p>Expires: {session.expiresAt}</p>
        </Card>
      ) : (
        <p className="text-sm text-slate-600">
          {isRolePreview ? 'Launch simulation is disabled in preview mode.' : 'Select an assigned patient to simulate a launch.'}
        </p>
      )}
    </div>
  );
}
