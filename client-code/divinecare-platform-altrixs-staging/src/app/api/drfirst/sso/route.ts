import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { buildRcopiaSsoUrl, DEMO_MODE, type SsoLaunchOptions } from '@/lib/services/drfirstRcopiaService';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { requireDrFirstCaller, findDrFirstClient } from '../_lib/access';
import { drFirstSsoDecision } from '@/lib/drfirst/ssoPolicy';
import { uploadPatientToRcopia, registerOnLaunchEnabled } from '../_lib/registerPatient';
import { recordRcopiaCall } from '@/lib/drfirst/persistence';
import { getAppBaseUrl } from '@/lib/staff/invite';

export const dynamic = 'force-dynamic';

const SCREENS = new Set<string>(['patient', 'message', 'report', 'manage_medications', 'manage_allergies', 'manage_problems']);

/**
 * GET /api/drfirst/sso?patient=<clientId>&screen=<startup screen>
 *
 * Returns a MAC-signed Rcopia SSO launch URL for the SIGNED-IN prescriber.
 * The Rcopia username always comes from the user's own profile (User.rcopiaUsername),
 * never from the request, so nobody can open Rcopia as another prescriber.
 *
 * Who (src/lib/drfirst/ssoPolicy.ts drFirstSsoDecision):
 *  - Prescribers: any screen; a patient only from their caseload (drFirstClientWhere: assigned,
 *    treatment team or appointment, so a covering prescriber reaches the client through the
 *    appointment; the verified Medical Director is org-wide) that passes the 42 CFR Part 2 /
 *    sensitive-record lock (assertClientPhiAccess).
 *  - ADMIN: only with their own rcopiaUsername, and only the message / report screens (no patient
 *    context). Future work: a DrFirst staff user type.
 *
 * DrFirst certification:
 *  - GM10 / PDUM4 / DURM3 / AUM4 / MUM6: with DRFIRST_REGISTER_ON_LAUNCH=true (production), every
 *    upload for the patient (send_patient, problems, allergies, medications; new / changed only)
 *    completes BEFORE the URL is built. A failed upload blocks the launch (409) with the reason, so
 *    a prescriber never prescribes against an out-of-date Rcopia chart. Incomplete demographics on a
 *    patient not yet in Rcopia still open Rcopia on patient search (no patient context), with the reason.
 *  - NCDM3: the message and report screens launch in Limited Multi Patient Mode (limp_mode=y).
 *  - GM11: Altrixs opens Rcopia in a normal browser tab (window.open), never an iframe, so
 *    allow_popup_screen is not sent.
 *  - GM13: every launch attempt is stored in drfirst_api_logs (URL encrypted, MAC removed).
 */
export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });

  if (DEMO_MODE) {
    return NextResponse.json({
      demo: true,
      message: 'DrFirst is not configured on this server.',
      fallbackUrl: '/dashboard/ehr/prescriptions',
    });
  }
  const sp = req.nextUrl.searchParams;
  const screenParam = sp.get('screen') || 'patient';
  const startupScreen = (SCREENS.has(screenParam) ? screenParam : 'patient') as SsoLaunchOptions['startupScreen'];

  const me = await prisma.user.findUnique({ where: { id: s.session.user.id }, select: { rcopiaUsername: true } });
  const rcopiaUsername = me?.rcopiaUsername?.trim();
  // Prescribers (own username); ADMIN only with their own username and only messages / reports
  const decision = drFirstSsoDecision({ role: String(s.role), rcopiaUsername, screen: startupScreen, hasPatient: Boolean(sp.get('patient')) });
  if (decision.ok === false) return NextResponse.json({ error: decision.error }, { status: decision.status });

  // Patient context (prescribers only): caseload + Part 2 lock, and only once synced to Rcopia.
  let patientExternalId: string | undefined;
  let patientRcopiaId: string | undefined;
  let patientSynced: boolean | null = null;
  const clientId = sp.get('patient');
  const logAttempt = (ok: boolean, url: string | null, errorCode?: string) =>
    recordRcopiaCall({
      kind: 'sso', command: `sso:${startupScreen}`, rcopiaUsername, organizationId: s.organizationId ?? null, clientId: clientId || null,
      actorUserId: s.session.user.id, ok, ...(errorCode ? { errorCode } : {}),
      ...(url ? { payloadKind: 'sso_url' as const, payload: url } : {}),
    });
  if (clientId) {
    if (!s.organizationId) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    const found = await findDrFirstClient(
      { organizationId: s.organizationId, userId: s.session.user.id, role: String(s.role) },
      clientId,
      { id: true, rcopiaPatientId: true, importedAt: true, sourcePlatform: true },
      '/api/drfirst/sso',
    );
    if (found.response) {
      await logAttempt(false, null, found.response.status === 404 ? 'patient_not_found' : 'sensitive_record');
      return found.response;
    }
    const client = found.client;
    patientSynced = Boolean(client.rcopiaPatientId);
    // DRFIRST_REGISTER_ON_LAUNCH (production: all; staging: patients created in Altrixs only): upload the chart (new / changed records) before launching
    if (registerOnLaunchEnabled(client)) {
      const g = await requireDrFirstCaller(req, { requireRcopiaUser: true });
      if (g.response) return g.response;
      const reg = await uploadPatientToRcopia(g.caller, client.id, 'eprescribe-launch');
      const chartFailed = reg.ok && 'failed' in reg.chart ? reg.chart.failed : reg.ok && 'error' in reg.chart ? 1 : 0;
      // PDUM1/PDUM4: never open Rcopia for a patient we could not send first: it would land on
      // patient search and invite a duplicate. Incomplete demographics: say exactly what to add.
      if (reg.ok === false && reg.code === 'DEMOGRAPHICS_INCOMPLETE') {
        await logAttempt(false, null, 'demographics_incomplete');
        const fields = (reg.missing ?? []).map((m) => m.label);
        return NextResponse.json(
          {
            error: `DrFirst was not opened: add ${fields.length ? fields.join(', ') : 'the missing demographics'} to this patient's chart (Edit demographics), then open DrFirst again. DrFirst needs them to create the patient.`,
            code: 'DEMOGRAPHICS_INCOMPLETE',
            missing: reg.missing,
          },
          { status: 409 },
        );
      }
      if (reg.ok === false) {
        await logAttempt(false, null, 'upload_failed');
        return NextResponse.json(
          { error: `DrFirst was not opened: the patient could not be updated in DrFirst first (${reg.reason}).`, code: 'UPLOAD_FAILED', missing: reg.missing },
          { status: 409 },
        );
      }
      if (reg.ok && chartFailed) {
        await logAttempt(false, null, 'upload_failed');
        return NextResponse.json(
          { error: 'DrFirst was not opened: some problems, allergies or medications could not be sent to DrFirst. Try again in a minute.', code: 'UPLOAD_FAILED' },
          { status: 409 },
        );
      }
      patientSynced = true;
    }
    // Registered patients carry our client id as external id; a chart linked to an existing Rcopia
    // patient (Link to DrFirst / update_patient) opens by that patient's Rcopia id instead.
    const linkedId = client.rcopiaPatientId && client.rcopiaPatientId !== client.id ? client.rcopiaPatientId : null;
    if (patientSynced && linkedId) patientRcopiaId = linkedId;
    else if (patientSynced) patientExternalId = client.id;
  }

  // NCDM3: messages and reports open in Limited Multi Patient Mode (no patient context)
  const limpMode = startupScreen === 'message' || startupScreen === 'report';
  const url = buildRcopiaSsoUrl({
    rcopiaUsername, startupScreen,
    // On-demand update: Rcopia's Log off sends the browser here, which pulls this patient's changes
    // immediately and reopens the chart (DrFirst certification call 2026-10-26)
    logoutUrl: `${getAppBaseUrl()}/dashboard/ehr/prescriptions/return`,
    ...(limpMode ? { limpMode: true } : { patientExternalId, patientRcopiaId }),
  });
  await logAttempt(Boolean(url), url, url ? undefined : 'not_configured');
  if (!url) return NextResponse.json({ error: 'DrFirst is not configured on this server.' }, { status: 503 });

  await writeAuditLog({
    action: 'DRFIRST_SSO_LAUNCH',
    actorUserId: s.session.user.id,
    actorRole: String(s.role),
    organizationId: s.organizationId,
    resourceType: 'prescription',
    resourceId: 'drfirst-sso-launch',
    patientId: clientId || null,
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { startupScreen, patientSynced, limpMode },
  });

  // When the patient isn't in Rcopia yet, Rcopia opens on patient search instead of the chart
  return NextResponse.json({ demo: false, url, patientSynced });
}
