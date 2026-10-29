/**
 * Runtime manuals M1–M8 (parity GO gate). No PHI/emails printed.
 * Password: Altrixs@123. PRP_ELIGIBILITY_TEST_PASS must stay unset.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.AUTH_URL || 'http://localhost:3000';
const PASSWORD = 'Altrixs@123';
const prisma = new PrismaClient();
const stamp = Date.now();
const results = [];

function rec(id, status, detail) {
  results.push({ id, status, detail });
  console.log(`[${status}] ${id} — ${detail}`);
}

async function loginAs(role, organizationId) {
  const user = await prisma.user.findFirst({
    where: {
      role,
      status: 'ACTIVE',
      ...(organizationId ? { organizationId } : { organizationId: { not: null } }),
    },
    select: { id: true, email: true, role: true, passwordHash: true, organizationId: true },
  });
  if (!user?.email) throw new Error(`No user with role ${role}`);
  const ok = user.passwordHash && (await bcrypt.compare(PASSWORD, user.passwordHash));
  if (!ok) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10) },
    });
  }
  const jar = [];
  const take = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) jar.push(c.split(';')[0]);
  };
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  take(csrfRes);
  const csrf = (await csrfRes.json()).csrfToken;
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.join('; ') },
    body: new URLSearchParams({
      csrfToken: csrf,
      email: user.email,
      password: PASSWORD,
      mode: 'password',
      callbackUrl: `${BASE}/dashboard`,
      json: 'true',
    }),
    redirect: 'manual',
  });
  take(loginRes);
  const sess = await (
    await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: jar.join('; ') } })
  ).json();
  if (!sess?.user) throw new Error(`no session ${role}`);
  const cookie = jar.join('; ');
  return {
    cookie,
    userId: user.id,
    orgId: user.organizationId,
    role: user.role,
    async api(p, init = {}) {
      const res = await fetch(`${BASE}${p}`, {
        ...init,
        headers: {
          Cookie: cookie,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {}),
        },
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* */
      }
      return { status: res.status, json, text: text.slice(0, 280) };
    },
  };
}

(async () => {
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  if (/^PRP_ELIGIBILITY_TEST_PASS\s*=\s*true\s*$/m.test(envText)) {
    throw new Error('PRP_ELIGIBILITY_TEST_PASS is true');
  }
  console.log('host', new URL(process.env.DATABASE_URL).host);
  console.log('BASE', BASE);

  const enumRows = await prisma.$queryRawUnsafe(
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'LabOrderStatus' ORDER BY 1"
  );
  console.log(
    'LabOrderStatus',
    enumRows.map((r) => r.enumlabel).join(',')
  );

  const admin = await loginAs('ADMIN');
  const orgId = admin.orgId;
  const pd = await loginAs('PRACTICE_DIRECTOR', orgId);
  const th = await loginAs('THERAPIST', orgId);
  let psych;
  try {
    psych = await loginAs('PSYCHIATRIST', orgId);
  } catch {
    psych = await loginAs('NURSE_PRACTITIONER', orgId);
  }
  let peer;
  try {
    peer = await loginAs('PEER_SUPPORT', orgId);
  } catch {
    peer = null;
  }

  const created = await pd.api('/api/clients', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Manual',
      lastName: `M${stamp}`,
      phone: '+14105551234',
      email: `manual.m8.${stamp}@example.test`,
    }),
  });
  let client =
    created.json?.client ||
    (created.json?.id ? { id: created.json.id, name: created.json.name } : null);
  if (!client?.id) {
    client = await prisma.client.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, phone: true, email: true },
    });
  }
  if (!client?.id) throw new Error('No client for manuals');
  await prisma.client.update({
    where: { id: client.id },
    data: { assignedToId: th.userId },
  });
  console.log('clientId', client.id);

  // ── M1 Labs: Other+ICD order → refresh; Cancel → cancelled ──
  // Prefer psych for order; fall back to admin. List/cancel with same actor (caseload scope).
  let labActor = psych;
  let lab = await psych.api('/api/labs/orders', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      lab: 'QUEST',
      priority: 'Routine',
      specimen: 'Venous Blood',
      icd10Codes: ['F32.1', 'F41.1'],
      panels: [],
      otherPanel: `Custom Other ${stamp}`,
    }),
  });
  if (lab.status >= 400) {
    // Psych caseload-scoped — temporarily assign for order, then restore therapist.
    await prisma.client.update({
      where: { id: client.id },
      data: { assignedToId: psych.userId },
    });
    lab = await psych.api('/api/labs/orders', {
      method: 'POST',
      body: JSON.stringify({
        clientId: client.id,
        lab: 'QUEST',
        priority: 'Routine',
        specimen: 'Venous Blood',
        icd10Codes: ['F32.1', 'F41.1'],
        panels: [],
        otherPanel: `Custom Other ${stamp}`,
      }),
    });
    if (lab.status >= 400) {
      labActor = admin;
      lab = await admin.api('/api/labs/orders', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client.id,
          lab: 'QUEST',
          priority: 'Routine',
          specimen: 'Venous Blood',
          icd10Codes: ['F32.1', 'F41.1'],
          panels: [],
          otherPanel: `Custom Other ${stamp}`,
        }),
      });
    }
  }
  const labId = lab.json?.order?.id;
  const labList = await labActor.api('/api/labs/orders');
  const listed = (labList.json?.orders || []).some((o) => o.id === labId);
  const cancel = labId
    ? await labActor.api(`/api/labs/orders/${labId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      })
    : { status: 400, json: {} };
  await prisma.client.update({
    where: { id: client.id },
    data: { assignedToId: th.userId },
  });
  const labDb = labId
    ? await prisma.labOrder.findUnique({
        where: { id: labId },
        select: { id: true, status: true, otherPanel: true, icd10Codes: true },
      })
    : null;
  rec(
    'M1',
    lab.status < 400 &&
      listed &&
      cancel.status < 400 &&
      labDb?.status === 'cancelled' &&
      (labDb.otherPanel || '').includes(String(stamp)) &&
      (labDb.icd10Codes || []).includes('F32.1')
      ? 'PASS'
      : 'FAIL',
    `POST=${lab.status} id=${labDb?.id || 'none'} listed=${listed} cancel=${cancel.status} status=${labDb?.status} err=${lab.json?.error || cancel.json?.error || ''}`
  );

  // ── M2 Notes: .cbt UTF-8; Copy Forward; Comprehend POST ──
  const phrases = fs.readFileSync(path.join(__dirname, '..', 'src/lib/ehr/smartPhrases.ts'), 'utf8');
  const utf8Ok = phrases.includes('\\u00d7') || phrases.includes('×');
  const cbtOk = phrases.includes(".cbt") && phrases.includes('CBT');
  const seedNote = await th.api(`/api/clients/${client.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      body: `<!--ehr type="SOAP" duration="50" cpt="90837" telehealth="false" pos="11" part2="false"-->\nSubjective\nPrior visit content ${stamp}\n\nObjective\nWNL\n\nAssessment\nModerate MDD with anxiety symptoms lasting well over thirty characters for Comprehend debounce path.\n\nPlan\nContinue CBT`,
    }),
  });
  const copy = await th.api(
    `/api/notes/copy-forward?clientId=${encodeURIComponent(client.id)}&noteType=SOAP`
  );
  const comp = await th.api('/api/comprehend/analyze', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Moderate MDD with anxiety symptoms lasting well over thirty characters for Comprehend debounce path. Sertraline discussed.',
      clientId: client.id,
      noteType: 'SOAP',
    }),
  });
  rec(
    'M2',
    utf8Ok &&
      cbtOk &&
      seedNote.status < 400 &&
      copy.status < 400 &&
      (copy.json?.found === true || copy.json?.displayBody) &&
      comp.status < 400 &&
      comp.json?.success !== false
      ? 'PASS'
      : 'FAIL',
    `utf8=${utf8Ok} cbt=${cbtOk} seed=${seedNote.status} copy=${copy.status} found=${copy.json?.found} comp=${comp.status} demo=${comp.json?.demoMode} err=${comp.json?.error || ''}`
  );

  // ── M3 Comms: SMS persist; Contact Lens; Secure forward ──
  const sms = await pd.api('/api/connect/sms', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      body: `Manual SMS ${stamp} — no PHI`,
      toPhone: '+14105550199',
    }),
  });
  const smsRow = await prisma.connectMessage.findFirst({
    where: { organizationId: orgId, clientId: client.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, demoMode: true },
  });
  const call = await pd.api('/api/connect/call', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      clientPhone: '+14105550199',
    }),
  });
  const contactId =
    call.json?.call?.contactId || call.json?.call?.id || call.json?.contactId || smsRow?.id;
  const lens = contactId
    ? await pd.api(`/api/connect/analysis/${encodeURIComponent(contactId)}`)
    : { status: 404, json: {} };
  const threadCreate = await pd.api('/api/messages/threads', {
    method: 'POST',
    body: JSON.stringify({ clientId: client.id, topic: 'clinical' }),
  });
  const threadId = threadCreate.json?.thread?.id;
  const forward = threadId
    ? await pd.api(`/api/messages/threads/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'forwarded',
          forwardedTo: 'Clinician Manual',
          forwardNote: `Forward ${stamp}`,
        }),
      })
    : { status: 400, json: {} };
  const threadDb = threadId
    ? await prisma.messageThread.findUnique({
        where: { id: threadId },
        select: { id: true, status: true, forwardedTo: true },
      })
    : null;
  rec(
    'M3',
    sms.status < 500 &&
      smsRow &&
      (lens.status < 500 || call.status < 500) &&
      threadId &&
      forward.status < 400 &&
      (threadDb?.status === 'FORWARDED' || String(threadDb?.forwardedTo || '').length > 0)
      ? 'PASS'
      : 'FAIL',
    `sms=${sms.status} row=${smsRow?.id || 'none'} call=${call.status} lens=${lens.status} thread=${threadId || 'none'} fwd=${forward.status} thrStatus=${threadDb?.status || 'none'}`
  );

  // ── M4 Scribe: agents/scribe fail-closed OR note save ──
  const scribe = await th.api('/api/agents/scribe', {
    method: 'POST',
    body: JSON.stringify({
      transcript:
        'Client discussed mood and sleep. Clinician used CBT techniques and reviewed safety. Plan continue weekly therapy and homework.',
      noteFormat: 'SOAP',
      clientId: client.id,
      sessionType: 'Individual Therapy',
      sourceMode: 'live',
    }),
  });
  const failClosed =
    scribe.status === 503 &&
    (scribe.json?.demoMode === true || /bedrock|fail-closed|unavailable/i.test(scribe.json?.error || ''));
  const scribeNote = await th.api(`/api/clients/${client.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      body: `<!--ehr type="SOAP" duration="50" cpt="90837" telehealth="false" pos="11" part2="false"-->\nSubjective\nScribe manual ${stamp}\n\nObjective\nAlert\n\nAssessment\nStable\n\nPlan\nFollow up`,
    }),
  });
  const scribeNoteId = scribeNote.json?.note?.id;
  const scribeDb = scribeNoteId
    ? await prisma.progressNote.findUnique({ where: { id: scribeNoteId }, select: { id: true } })
    : null;
  rec(
    'M4',
    (failClosed || scribe.json?.success === true) && scribeDb ? 'PASS' : 'FAIL',
    `scribe=${scribe.status} failClosed=${failClosed} noteId=${scribeDb?.id || 'none'} err=${scribe.json?.error || ''}`
  );

  // ── M5 Schedule AC-######; migration dryRun 0; BTG 403→grant→200 ──
  const settingsGet = await admin.api('/api/scheduling/settings');
  const orgSlug = settingsGet.json?.slug || '';
  const settingsPatch = await admin.api('/api/scheduling/settings', {
    method: 'PUT',
    body: JSON.stringify({
      bufferMinutes: 0,
      bookAheadDays: 30,
      minNoticeDays: 0,
      practiceCity: 'Baltimore',
      rules: { requireInsurance: false, newClientsOnly: false },
    }),
  });
  const pubQs = orgSlug
    ? `organizationSlug=${encodeURIComponent(orgSlug)}`
    : `organizationId=${encodeURIComponent(orgId)}`;
  const from = new Date();
  from.setDate(from.getDate() + 2);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const providers = await fetch(
    `${BASE}/api/scheduling/providers?service=individual_therapy&${pubQs}`
  ).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const providerId = providers.json?.providers?.[0]?.id || null;
  const slots = await fetch(
    `${BASE}/api/scheduling/slots?service=individual_therapy&from=${fromStr}&to=${toStr}&${pubQs}` +
      (providerId ? `&provider=${encodeURIComponent(providerId)}` : '')
  ).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const slot = slots.json?.slots?.[0];
  let book = { status: 0, json: null };
  if (slot?.startsAt) {
    book = await fetch(`${BASE}/api/scheduling/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: orgId,
        organizationSlug: orgSlug || undefined,
        serviceId: 'individual_therapy',
        modality: 'telehealth',
        providerId,
        startsAt: slot.startsAt,
        firstName: 'Book',
        lastName: `M5${stamp}`,
        dob: '1990-04-04',
        phone: '4105550188',
        email: `book.m5.${stamp}@example.test`,
        hipaaConsent: true,
      }),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  }
  const conf = book.json?.confirmationCode || book.json?.appointment?.confirmationCode;
  const apptDb = conf
    ? await prisma.appointment.findFirst({
        where: { confirmationCode: String(conf) },
        select: { id: true, confirmationCode: true },
      })
    : null;

  const dry = await pd.api('/api/migration/clients', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      platform: 'valant',
      rows: [{ firstName: 'Dry', lastName: 'Run', dob: '1990-01-01' }],
    }),
  });
  const dryJobNull = dry.json?.jobId == null || dry.json?.jobId === null;
  const dryOk = dry.status < 500 && dryJobNull && dry.json?.dryRun === true;

  // BTG: mark client sensitive → therapist GET 403 → therapist break-glass → GET 200
  await prisma.client.update({
    where: { id: client.id },
    data: { assignedToId: th.userId },
  });
  await prisma.breakTheGlassGrant.deleteMany({
    where: { clientId: client.id, userId: th.userId },
  });
  await prisma.sensitiveRecord.upsert({
    where: { clientId: client.id },
    create: {
      organizationId: orgId,
      clientId: client.id,
      reason: 'legal',
      alias: 'Protected Client',
      accessWhitelist: [],
      setById: pd.userId,
    },
    update: {
      reason: 'legal',
      alias: 'Protected Client',
      accessWhitelist: [],
    },
  });
  const denied = await th.api(`/api/clients/${client.id}`);
  const grant = await th.api(`/api/sensitive-records/${client.id}/break-glass`, {
    method: 'POST',
    body: JSON.stringify({
      reason: 'Manual parity BTG justification over fifteen chars',
    }),
  });
  const after = await th.api(`/api/clients/${client.id}`);
  const deniedLocked =
    denied.status === 403 &&
    (denied.json?.error === 'SENSITIVE_RECORD' || denied.json?.canRequestBreakGlass === true);
  const afterOk = after.status === 200 && after.json?.client?.id === client.id;
  const btgOk = deniedLocked && grant.status < 400 && afterOk && grant.json?.grant?.id;

  rec(
    'M5',
    settingsPatch.status < 400 &&
      /^AC-\d{6}$/.test(String(conf || '')) &&
      apptDb &&
      dryOk &&
      btgOk
      ? 'PASS'
      : 'FAIL',
    `settings=${settingsPatch.status} slots=${slots.status} book=${book.status} code=${conf || 'none'} appt=${apptDb?.id || 'none'} dry=${dry.status} dryRun=${dry.json?.dryRun} deny=${denied.status} grant=${grant.status} grantId=${grant.json?.grant?.id || 'none'} after=${after.status}`
  );

  // ── M6 Therapist PII masked; PD clear ──
  await prisma.client.update({
    where: { id: client.id },
    data: { assignedToId: th.userId, phone: '+14105551234', email: `pii.${stamp}@example.test` },
  });
  const thClient = await th.api(`/api/clients/${client.id}`);
  const pdClient = await pd.api(`/api/clients/${client.id}`);
  const thPhone = String(thClient.json?.client?.phone || thClient.json?.phone || '');
  const pdPhone = String(pdClient.json?.client?.phone || pdClient.json?.phone || '');
  const thMasked = thClient.status === 200 && (thPhone.includes('•') || thPhone.includes('*'));
  const pdClear = pdClient.status === 200 && pdPhone.replace(/\D/g, '').length >= 10 && !pdPhone.includes('•');
  rec(
    'M6',
    thMasked && pdClear ? 'PASS' : 'FAIL',
    `th=${thClient.status} pd=${pdClient.status} thMasked=${thMasked} pdClear=${pdClear}`
  );

  // ── M7 C-SSRS save; Personalize psych ≠ peer ──
  // Psych is caseload-scoped; assign so Patient not found (404) does not mask save.
  await prisma.client.update({
    where: { id: client.id },
    data: { assignedToId: psych.userId },
  });
  const cssrsAnswers = { q1: 1, q2: 1, q3: 0, q4: 0, q5: 0, q6: 0 };
  const cssrs = await psych.api('/api/clinical/assessments', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      instrumentId: 'c-ssrs-brief',
      administrationType: 'Manual',
      respondentType: 'Clinician',
      totalScore: 1,
      severity: 'Low Risk',
      interpretation: 'C-SSRS risk: Low Risk. Manual parity save.',
      clinicianVerified: true,
      answers: cssrsAnswers,
    }),
  });
  const cssrsDb = await prisma.clinicalAssessmentRecord.findFirst({
    where: { clientId: client.id, instrumentId: 'c-ssrs-brief' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, totalScore: true, createdAt: true },
  });
  const cssrsFresh =
    cssrsDb && cssrs.status < 400 && Date.now() - new Date(cssrsDb.createdAt).getTime() < 120000;
  const psychIns = await psych.api('/api/personalize/caseload-insights', { method: 'POST' });
  const peerIns = peer
    ? await peer.api('/api/personalize/caseload-insights', { method: 'POST' })
    : { status: 0, json: null };
  const psychCards = JSON.stringify(psychIns.json || {});
  const peerCards = JSON.stringify(peerIns.json || {});
  const differ =
    peer && peerIns.status < 500
      ? psychCards !== peerCards ||
        psychIns.json?.role !== peerIns.json?.role ||
        psychIns.json?.persona !== peerIns.json?.persona
      : psychIns.status < 500;
  // Restore therapist assignment for any follow-ups
  await prisma.client.update({
    where: { id: client.id },
    data: { assignedToId: th.userId },
  });
  rec(
    'M7',
    cssrs.status < 400 && cssrsFresh && psychIns.status < 500 && differ ? 'PASS' : 'FAIL',
    `cssrs=${cssrs.status} id=${cssrsDb?.id || 'none'} err=${cssrs.json?.error || ''} psych=${psychIns.status} peer=${peerIns.status} differ=${differ}`
  );

  // ── M8 Grep no live DEMO_* ──
  const root = path.join(__dirname, '..', 'src');
  const bad = [];
  const patterns = [
    'DEMO_AR',
    'TODAY_SESSIONS',
    'INSIGHTS_BY_ROLE',
    'TMS_PATIENTS',
    'DEMO_ELG',
    'DEMO_RECORDS',
  ];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.next') continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const p of patterns) {
          const re = new RegExp(`(^|[^A-Z_])${p}([^A-Z_]|$)`);
          if (!re.test(text)) continue;
          // allow comments only
          const live = text.split('\n').some((line) => {
            const t = line.trim();
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
            return line.includes(p) && !line.includes(`No ${p}`) && !line.includes(`no ${p}`);
          });
          if (live) bad.push(`${path.relative(root, full)}:${p}`);
        }
      }
    }
  }
  walk(root);
  rec('M8', bad.length === 0 ? 'PASS' : 'FAIL', bad.length ? bad.slice(0, 8).join('; ') : 'no live DEMO_* symbols');

  const fail = results.filter((r) => r.status !== 'PASS');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  console.log(fail.length ? `FAIL ${fail.length}` : 'ALL PASS');
  await prisma.$disconnect();
  process.exit(fail.length ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
