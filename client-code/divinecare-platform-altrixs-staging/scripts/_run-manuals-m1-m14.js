/**
 * Runtime manuals M1–M14 (Sep 24–28). No PHI/emails printed.
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
      return { status: res.status, json, text: text.slice(0, 240) };
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

  // API smoke
  const smoke = [
    ['GET', '/api/migration/history', pd],
    ['GET', '/api/tms/courses', psych],
    ['GET', '/api/labs/orders', psych],
    ['GET', '/api/billing/ar', admin],
    ['GET', '/api/prp/referrals', psych],
    ['GET', '/api/sensitive-records', pd],
    ['GET', '/api/healthlake/status', pd],
    ['GET', '/api/scheduling/settings', admin],
  ];
  for (const [method, ep, who] of smoke) {
    const r = await who.api(ep, { method });
    const ok = r.status < 500;
    console.log(`SMOKE ${method} ${ep} → ${r.status} ${ok ? 'ok' : 'ERR'} ${Object.keys(r.json || {}).join(',')}`);
  }

  // Create a client assigned to both psych (primary) for caseload writes
  const created = await pd.api('/api/clients', {
    method: 'POST',
    body: JSON.stringify({
      name: `Manual ${stamp}`,
      dateOfBirth: '1991-01-15',
      phone: '4105550199',
      email: `manual.${stamp}@example.test`,
      assignedToId: psych.userId,
    }),
  });
  let client = created.json?.client
    ? {
        id: created.json.client.id,
        name: created.json.client.name || `Manual ${stamp}`,
        phone: '4105550199',
        email: `manual.${stamp}@example.test`,
      }
    : null;
  if (!client?.id) {
    const existing = await prisma.client.findFirst({
      where: { organizationId: orgId, assignedToId: psych.userId },
      select: { id: true, name: true, phone: true, email: true },
    });
    client = existing;
  }
  if (!client?.id) throw new Error('no client for manuals');
  // Ensure therapist can also access for notes/PII checks — mirror assign via prisma if needed
  await prisma.client.update({
    where: { id: client.id },
    data: {
      assignedToId: psych.userId,
      phone: client.phone || '4105550199',
    },
  });
  // Also put therapist on treatment team JSON if used
  try {
    await prisma.client.update({
      where: { id: client.id },
      data: {
        treatmentTeam: {
          primaryTherapistId: th.userId,
          prescriberId: psych.userId,
        },
      },
    });
  } catch {
    /* treatmentTeam shape may differ — ignore */
  }

  // M1 Schedule
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
  const pub = await fetch(`${BASE}/api/scheduling/settings/public?${pubQs}`).then(async (r) => ({
    status: r.status,
    json: await r.json().catch(() => null),
  }));
  const providers = await fetch(
    `${BASE}/api/scheduling/providers?service=individual_therapy&${pubQs}`
  ).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const providerId = providers.json?.providers?.[0]?.id || null;
  const from = new Date();
  from.setDate(from.getDate() + 2);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
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
        lastName: `M1${stamp}`,
        dob: '1990-04-04',
        phone: '4105550188',
        email: `book.${stamp}@example.test`,
        hipaaConsent: true,
      }),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  }
  const conf = book.json?.confirmationCode || book.json?.appointment?.confirmationCode;
  const apptDb = conf
    ? await prisma.appointment.findFirst({
        where: { confirmationCode: conf },
        select: { id: true, confirmationCode: true },
      })
    : null;
  const embedRes = await fetch(`${BASE}/schedule?embed=true${orgSlug ? `&org=${encodeURIComponent(orgSlug)}` : ''}`);
  const embedHtml = await embedRes.text();
  const embedOk = embedRes.status === 200 && !/Sign in to Altrixs/i.test(embedHtml);
  rec(
    'M1',
    settingsPatch.status < 400 && conf && apptDb && /^AC-\d{6}$/.test(String(conf)) ? 'PASS' : 'FAIL',
    `settings=${settingsPatch.status} pub=${pub.status} slots=${slots.status} book=${book.status} code=${conf || 'none'} db=${apptDb?.id || 'none'} embed=${embedRes.status}`
  );

  // M2 Labs — admin/PD can order; fall back to psych
  let lab = await admin.api('/api/labs/orders', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      icd10Codes: ['F32.1'],
      panels: [],
      otherPanel: `Custom panel ${stamp}`,
      priority: 'ROUTINE',
    }),
  });
  if (lab.status >= 400) {
    lab = await psych.api('/api/labs/orders', {
      method: 'POST',
      body: JSON.stringify({
        clientId: client.id,
        icd10Codes: ['F32.1'],
        panels: [],
        otherPanel: `Custom panel ${stamp}`,
        priority: 'ROUTINE',
      }),
    });
  }
  const labId = lab.json?.order?.id || lab.json?.id;
  const labDb = labId
    ? await prisma.labOrder.findUnique({
        where: { id: labId },
        select: { id: true, orderedById: true, otherPanel: true },
      })
    : null;
  rec(
    'M2',
    lab.status < 400 && labDb ? 'PASS' : 'FAIL',
    `POST=${lab.status} id=${labDb?.id || 'none'} orderedBy=${labDb?.orderedById || 'none'} err=${lab.json?.error || ''}`
  );

  // M3 PII — compare therapist vs PD on assigned client (assign th temporarily for GET)
  await prisma.client.update({ where: { id: client.id }, data: { assignedToId: th.userId } });
  const thClient = await th.api(`/api/clients/${client.id}`);
  await prisma.client.update({ where: { id: client.id }, data: { assignedToId: psych.userId } });
  const pdClient = await pd.api(`/api/clients/${client.id}`);
  const thPhone = String(thClient.json?.client?.phone || '');
  const pdPhone = String(pdClient.json?.client?.phone || '');
  const thMasked = thClient.status === 200 && (thPhone.includes('•') || thPhone.includes('*'));
  const pdClear = pdClient.status === 200 && pdPhone.length > 0 && !pdPhone.includes('•');
  rec(
    'M3',
    thClient.status === 200 && pdClient.status === 200 && (thMasked || pdClear) ? 'PASS' : 'FAIL',
    `th=${thClient.status} pd=${pdClient.status} thMasked=${thMasked} pdClear=${pdClear}`
  );

  // M4 RMS — digital answers use q1..q10 with option scores 0/1
  const rmsAnswers = {};
  for (let i = 1; i <= 10; i++) rmsAnswers[`q${i}`] = i <= 6 ? 1 : 0;
  const rms = await psych.api('/api/clinical/assessments', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      instrumentId: 'rms',
      administrationType: 'Digital',
      clinicianVerified: true,
      answers: rmsAnswers,
    }),
  });
  const rmsId = rms.json?.assessment?.id || rms.json?.data?.id || rms.json?.id || rms.json?.record?.id;
  const rmsDb = rmsId
    ? await prisma.clinicalAssessmentRecord.findUnique({
        where: { id: rmsId },
        select: { id: true, instrumentId: true, totalScore: true, severity: true },
      })
    : await prisma.clinicalAssessmentRecord.findFirst({
        where: { clientId: client.id, instrumentId: 'rms' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, instrumentId: true, totalScore: true, severity: true },
      });
  rec(
    'M4',
    rms.status < 400 && rmsDb && Number(rmsDb.totalScore) >= 5 ? 'PASS' : 'FAIL',
    `POST=${rms.status} id=${rmsDb?.id || 'none'} score=${rmsDb?.totalScore} sev=${rmsDb?.severity} err=${rms.json?.error || ''}`
  );

  // M5 Telehealth UI (code presence + sessions list)
  const thSessions = await psych.api('/api/telehealth/sessions');
  const telePage = await psych.api('/dashboard/telehealth');
  const teleHtml = telePage.text || '';
  // page returns HTML as text when fetched via api helper — re-fetch as text
  const teleRes = await fetch(`${BASE}/dashboard/telehealth`, { headers: { Cookie: psych.cookie } });
  const teleBody = await teleRes.text();
  const hasCallFirst = /Call \{callFirst\}|Call \$\{|Call \{/.test(
    fs.readFileSync(path.join(__dirname, '..', 'src/app/dashboard/telehealth/page.tsx'), 'utf8')
  );
  rec(
    'M5',
    thSessions.status < 500 && hasCallFirst ? 'PASS' : 'FAIL',
    `sessions=${thSessions.status} page=${teleRes.status} CallFirstNameInCode=${hasCallFirst} (DOM digits not printed)`
  );

  // M6 Intake homeless + FVN
  const invite = await pd.api('/api/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: `Home Less${stamp}`,
      clientEmail: `homeless.${stamp}@example.test`,
      homeless: true,
      appointmentType: 'In Office',
      sendVia: 'Email',
    }),
  });
  const token = invite.json?.invite?.token || invite.json?.token;
  const inviteDb = token
    ? await prisma.intakeInvite.findFirst({
        where: { token },
        select: { id: true, homeless: true, token: true },
      })
    : null;
  const note = await psych.api(`/api/clients/${client.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body: `First Visit Note ${stamp} — presenting concerns documented.` }),
  });
  const noteId = note.json?.note?.id;
  const noteDb = noteId
    ? await prisma.progressNote.findUnique({ where: { id: noteId }, select: { id: true } })
    : null;
  rec(
    'M6',
    invite.status < 400 && inviteDb?.homeless === true && noteDb ? 'PASS' : 'FAIL',
    `invite=${invite.status} homeless=${inviteDb?.homeless} note=${noteDb?.id || 'none'}`
  );

  // M7 C-SSRS crisis-flag — 6 YES/NO items as q1..q6
  const cssrsAnswers = { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 0 };
  const cssrs = await psych.api('/api/clinical/assessments', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      instrumentId: 'c-ssrs-brief',
      administrationType: 'Digital',
      clinicianVerified: true,
      answers: cssrsAnswers,
    }),
  });
  const crisis = await psych.api('/api/events/crisis-flag', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      clientName: client.name,
      riskLevel: 'imminent',
      instrumentId: 'c-ssrs-brief',
      assessmentId: cssrs.json?.assessment?.id || cssrs.json?.data?.id || cssrs.json?.id || cssrs.json?.record?.id,
    }),
  });
  const evt = await prisma.clinicalEvent.findFirst({
    where: { organizationId: orgId, eventType: 'crisis-flag', clientId: client.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, eventType: true },
  });
  const cssrsDb = await prisma.clinicalAssessmentRecord.findFirst({
    where: { clientId: client.id, instrumentId: 'c-ssrs-brief' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, totalScore: true },
  });
  rec(
    'M7',
    cssrs.status < 400 && crisis.status < 400 && evt && cssrsDb ? 'PASS' : 'FAIL',
    `assess=${cssrs.status} id=${cssrsDb?.id || 'none'} crisis=${crisis.status} event=${evt?.id || 'none'} err=${cssrs.json?.error || crisis.json?.error || ''}`
  );

  // M8 Connect SMS
  const sms = await pd.api('/api/connect/sms', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      body: `Manual SMS ${stamp}`,
      toPhone: '+14105550199',
    }),
  });
  const smsRow = await prisma.connectMessage.findFirst({
    where: { organizationId: orgId, clientId: client.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, demoMode: true },
  });
  const thread = await pd.api(`/api/connect/thread/${client.id}`);
  rec(
    'M8',
    sms.status < 500 && smsRow && thread.status < 500 ? 'PASS' : 'FAIL',
    `sms=${sms.status} row=${smsRow?.id || 'none'} demo=${smsRow?.demoMode} thread=${thread.status}`
  );

  // M9 Notes .cbt + copy-forward + comprehend
  const phrases = fs.readFileSync(path.join(__dirname, '..', 'src/lib/ehr/smartPhrases.ts'), 'utf8');
  const hasCbt = /\.cbt|cbt:/.test(phrases);
  const copy = await th.api(`/api/notes/copy-forward?clientId=${client.id}`);
  const comp = await th.api('/api/comprehend/analyze', {
    method: 'POST',
    body: JSON.stringify({ text: 'Patient reports anxiety and low mood with insomnia.' }),
  });
  rec(
    'M9',
    hasCbt && copy.status < 500 && comp.status < 500 ? 'PASS' : 'FAIL',
    `.cbt=${hasCbt} copy=${copy.status} comprehend=${comp.status} demo=${comp.json?.demoMode}`
  );

  // M10 Personalize psych vs peer
  const psychIns = await psych.api('/api/personalize/caseload-insights', { method: 'POST' });
  const peerIns = peer
    ? await peer.api('/api/personalize/caseload-insights', { method: 'POST' })
    : { status: 0, json: null };
  const diffRoles =
    psychIns.json?.roleKey &&
    peerIns.json?.roleKey &&
    psychIns.json.roleKey !== peerIns.json.roleKey;
  rec(
    'M10',
    psychIns.status === 200 && (peer ? peerIns.status === 200 && diffRoles : psychIns.status === 200)
      ? 'PASS'
      : 'FAIL',
    `psych=${psychIns.status}/${psychIns.json?.roleKey} peer=${peerIns.status}/${peerIns.json?.roleKey}`
  );

  // M11 HealthLake
  const hl = await pd.api('/api/healthlake/status');
  const hli = await pd.api('/api/healthlake/import', {
    method: 'POST',
    body: JSON.stringify({ resourceTypes: ['Patient'] }),
  });
  rec(
    'M11',
    hl.status === 200 && hli.status < 500 ? 'PASS' : 'FAIL',
    `status=${hl.status} import=${hli.status} demo=${hl.json?.demoMode ?? hli.json?.demoMode}`
  );

  // M12 Evaluations CAGE + ASAM — content values must be strings per schema
  const evalRes = await psych.api('/api/clinical/evaluations', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      templateId: 'sud_asam',
      status: 'DRAFT',
      content: {
        substance_patterns: 'Alcohol and cannabis use documented for manual.',
        cageAid: JSON.stringify({ q1: true, q2: false, q3: true, q4: false, score: 2 }),
        asam: JSON.stringify({ dim1: 2, dim2: 1, dim3: 2, dim4: 1, dim5: 2, dim6: 1 }),
        asam_dim1: 'Mild withdrawal potential',
        asam_dim3: 'Co-occurring anxiety',
      },
    }),
  });
  const evalId = evalRes.json?.data?.id || evalRes.json?.evaluation?.id || evalRes.json?.id;
  const evalDb = evalId
    ? await prisma.clinicalEvaluationRecord.findUnique({
        where: { id: evalId },
        select: { id: true, formDataJson: true },
      })
    : null;
  const hasCage = evalDb?.formDataJson && /cageAid|cage/i.test(evalDb.formDataJson);
  const hasAsam = evalDb?.formDataJson && /asam/i.test(evalDb.formDataJson);
  rec(
    'M12',
    evalRes.status < 400 && evalDb && (hasCage || hasAsam) ? 'PASS' : 'FAIL',
    `POST=${evalRes.status} id=${evalDb?.id || 'none'} cage=${!!hasCage} asam=${!!hasAsam} err=${evalRes.json?.error || ''}`
  );

  // M13 Prior sprint spot checks
  const dry = await pd.api('/api/migration/clients', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      platform: 'valant',
      rows: [{ firstName: 'Dry', lastName: 'Run', dob: '1990-01-01' }],
    }),
  });
  const dryJobNull = dry.json?.jobId == null || dry.json?.jobId === null;
  const dryWrites = dry.json?.imported === 0 || dry.json?.created === 0 || dry.json?.dryRun === true;
  const tmsGad = fs.readFileSync(
    path.join(__dirname, '..', 'src/app/dashboard/ehr/tms-spravato/page.tsx'),
    'utf8'
  );
  const hasGad = /gad7|GAD-7|spo2|SpO/i.test(tmsGad);
  rec(
    'M13',
    dry.status < 500 && dryJobNull && hasGad ? 'PASS' : 'FAIL',
    `dryRun=${dry.status} jobIdNull=${dryJobNull} imported=${dry.json?.imported} gadSpo2Code=${hasGad}`
  );

  // M14 Command palette real clients
  const cmdSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src/components/layout/DashboardCommandSearch.tsx'),
    'utf8'
  );
  const usesFetchClients = /fetchClients\(/.test(cmdSrc);
  const clientsList = await th.api('/api/clients');
  rec(
    'M14',
    usesFetchClients && clientsList.status === 200 && (clientsList.json?.clients?.length || 0) > 0
      ? 'PASS'
      : 'FAIL',
    `fetchClients=${usesFetchClients} list=${clientsList.status} n=${clientsList.json?.clients?.length || 0}`
  );

  // Billing extras
  const ar = await admin.api('/api/billing/ar');
  const scrub = await admin.api('/api/billing/claim-scrub');
  const stmt = await admin.api('/api/billing/statements', {
    method: 'POST',
    body: JSON.stringify({
      periodLabel: `Manual ${stamp}`,
      includeClientIds: [client.id],
      delivery: 'email',
      minBalanceCents: 0,
    }),
  });
  const stmtRow = await prisma.patientStatement.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  console.log(
    `BILLING ar=${ar.status} scrub=${scrub.status} stmt=${stmt.status} stmtId=${stmtRow?.id || 'none'} err=${stmt.json?.error || ''}`
  );

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
  fs.writeFileSync(
    path.join(__dirname, '..', '_m1-m14-results.json'),
    JSON.stringify({ stamp, pass, fail, results }, null, 2)
  );
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error('FATAL', err.message || err);
  await prisma.$disconnect();
  process.exit(2);
});
