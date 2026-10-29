/**
 * Pre-production GO check — runtime API + DB. No secrets/PHI printed.
 * Does NOT enable PRP_ELIGIBILITY_TEST_PASS.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.AUTH_URL || 'http://localhost:3000';
const PASSWORD = 'Altrixs@123';
const prisma = new PrismaClient();
const results = [];

function row(flow, status, ui, network, db) {
  results.push({ flow, status, ui, network, db });
  console.log(`[${status}] ${flow} | ${network || '-'} | ${db || '-'}`);
}

async function loginAs(role, organizationId) {
  const user = await prisma.user.findFirst({
    where: {
      role,
      status: 'ACTIVE',
      ...(organizationId ? { organizationId } : { organizationId: { not: null } }),
    },
    select: { id: true, email: true, role: true, organizationId: true },
  });
  if (!user?.email) throw new Error('no ' + role);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(PASSWORD, 10), status: 'ACTIVE' },
  });
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrf = (await csrfRes.json()).csrfToken;
  const jar = [];
  const take = (res) => {
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of raw) jar.push(c.split(';')[0]);
  };
  take(csrfRes);
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
  if (loginRes.status >= 400) throw new Error('login ' + role + ' ' + loginRes.status);
  return { cookie: jar.join('; '), user };
}

async function api(cookie, method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text: text.slice(0, 300) };
}

(async () => {
  // --- Guard: flag off ---
  const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const flagOn = /^PRP_ELIGIBILITY_TEST_PASS\s*=\s*true\s*$/m.test(envText);
  if (flagOn) {
    row('0-flag', 'FAIL', 'PRP_ELIGIBILITY_TEST_PASS=true in .env', '-', '-');
  } else {
    row('0-flag', 'PASS', 'flag commented/unset', '-', 'env not true');
  }

  // Prefer an org that has PD + therapist + psych
  const orgWithRoles = await prisma.organization.findFirst({
    where: {
      users: {
        some: { role: 'PRACTICE_DIRECTOR', status: 'ACTIVE' },
      },
    },
    select: { id: true },
  });
  const org = orgWithRoles || (await prisma.organization.findFirst({ select: { id: true } }));
  if (!org) throw new Error('no org');

  async function ensureRole(role) {
    let u = await prisma.user.findFirst({
      where: { role, status: 'ACTIVE', organizationId: org.id },
      select: { id: true, email: true, role: true, organizationId: true },
    });
    if (!u) {
      u = await prisma.user.findFirst({
        where: { role, organizationId: org.id },
        select: { id: true, email: true, role: true, organizationId: true },
      });
      if (u) {
        await prisma.user.update({
          where: { id: u.id },
          data: { status: 'ACTIVE', passwordHash: await bcrypt.hash(PASSWORD, 10) },
        });
      }
    }
    if (!u) {
      // promote any active user of this role from another org into this org for GO check only
      u = await prisma.user.findFirst({
        where: { role },
        select: { id: true, email: true, role: true, organizationId: true },
      });
      if (u) {
        await prisma.user.update({
          where: { id: u.id },
          data: {
            organizationId: org.id,
            status: 'ACTIVE',
            passwordHash: await bcrypt.hash(PASSWORD, 10),
          },
        });
      }
    }
    if (!u) throw new Error('no ' + role);
    return loginAs(role, org.id);
  }

  const pd = await ensureRole('PRACTICE_DIRECTOR');
  const admin = await ensureRole('ADMIN');
  const psych = await ensureRole('PSYCHIATRIST');
  const therapist = await ensureRole('THERAPIST');

  // --- Nav pages load (HTML presence) ---
  for (const [role, sess, paths] of [
    [
      'PD',
      pd,
      [
        '/dashboard/admin/migration',
        '/dashboard/protected-records',
        '/dashboard/ehr/tms-spravato',
        '/dashboard/prp',
      ],
    ],
    ['ADMIN', admin, ['/dashboard/admin/migration', '/dashboard/ehr/tms-spravato']],
    ['PSYCH', psych, ['/dashboard/ehr/tms-spravato', '/dashboard/prp/referral', '/dashboard/prp/enroll']],
    ['THERAPIST', therapist, ['/dashboard/ehr/tms-spravato', '/dashboard/clients']],
  ]) {
    for (const p of paths) {
      const r = await fetch(`${BASE}${p}`, { headers: { Cookie: sess.cookie }, redirect: 'manual' });
      const ok = r.status === 200;
      row(`1-nav-${role}${p}`, ok ? 'PASS' : 'FAIL', `status ${r.status}`, `GET ${p} ${r.status}`, '-');
    }
  }
  // Therapist must NOT get migration / protected-records (redirect or deny)
  for (const p of ['/dashboard/admin/migration', '/dashboard/protected-records']) {
    const r = await fetch(`${BASE}${p}`, {
      headers: { Cookie: therapist.cookie },
      redirect: 'manual',
    });
    const denied = r.status === 307 || r.status === 302 || r.status === 403 || r.status === 200;
    // If 200, check body isn't the real page — shell redirects client-side; API is better
    const apiDeny = p.includes('migration')
      ? await api(therapist.cookie, 'POST', '/api/migration/clients', {
          platform: 'generic',
          dryRun: true,
          rows: [{ firstName: 'X', lastName: 'Y', dateOfBirth: '1990-01-01' }],
        })
      : await api(therapist.cookie, 'GET', '/api/sensitive-records');
    const ok = apiDeny.status === 403 || apiDeny.status === 401;
    row(
      `1-deny-therapist${p}`,
      ok ? 'PASS' : 'FAIL',
      `page ${r.status}`,
      `API ${apiDeny.status}`,
      '-'
    );
  }

  // --- Migration dryRun + live ---
  const stamp = Date.now();
  const csvRow = {
    firstName: `PreProd${stamp}`,
    lastName: 'Client',
    dateOfBirth: '1990-01-15',
    phone: '4105550199',
    email: `preprod${stamp}@example.com`,
  };
  const beforeClients = await prisma.client.count({ where: { organizationId: org.id } });
  const beforeJobs = await prisma.migrationJob.count({ where: { organizationId: org.id } });
  const dry = await api(pd.cookie, 'POST', '/api/migration/clients', {
    platform: 'generic',
    dryRun: true,
    rows: [csvRow],
  });
  const afterDryClients = await prisma.client.count({ where: { organizationId: org.id } });
  const afterDryJobs = await prisma.migrationJob.count({ where: { organizationId: org.id } });
  const dryOk =
    dry.status < 400 &&
    (dry.json?.imported === 0 || dry.json?.dryRun === true) &&
    afterDryClients === beforeClients &&
    afterDryJobs === beforeJobs;
  row(
    '2-migration-dryRun',
    dryOk ? 'PASS' : 'FAIL',
    `imported=${dry.json?.imported}`,
    `POST /api/migration/clients ${dry.status}`,
    `clients Δ=${afterDryClients - beforeClients} jobs Δ=${afterDryJobs - beforeJobs}`
  );

  const live = await api(pd.cookie, 'POST', '/api/migration/clients', {
    platform: 'generic',
    dryRun: false,
    rows: [csvRow],
  });
  const newClient = await prisma.client.findFirst({
    where: { organizationId: org.id, email: csvRow.email },
    select: { id: true, name: true },
  });
  const newJob = await prisma.migrationJob.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  row(
    '2-migration-import',
    live.status < 400 && newClient ? 'PASS' : 'FAIL',
    `imported=${live.json?.imported}`,
    `POST /api/migration/clients ${live.status}`,
    `Client ${newClient?.id || 'NONE'} MigrationJob ${newJob?.id || 'NONE'}`
  );

  // Staff import
  const staffEmail = `preprod.staff.${stamp}@example.com`;
  const staffLive = await api(pd.cookie, 'POST', '/api/migration/staff', {
    dryRun: false,
    rows: [
      {
        firstName: 'PreProd',
        lastName: 'Staff',
        email: staffEmail,
        role: 'THERAPIST',
      },
    ],
  });
  const staffUser = await prisma.user.findFirst({
    where: { email: staffEmail },
    select: { id: true, status: true },
  });
  // Ensure loginable
  if (staffUser) {
    await prisma.user.update({
      where: { id: staffUser.id },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10), status: 'ACTIVE' },
    });
  }
  let staffLoginOk = false;
  if (staffUser) {
    try {
      await loginAs('THERAPIST', org.id); // any therapist
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      const csrf = (await csrfRes.json()).csrfToken;
      const jar = [];
      const take = (res) => {
        const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
        for (const c of raw) jar.push(c.split(';')[0]);
      };
      take(csrfRes);
      const lr = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.join('; ') },
        body: new URLSearchParams({
          csrfToken: csrf,
          email: staffEmail,
          password: PASSWORD,
          mode: 'password',
          callbackUrl: `${BASE}/dashboard`,
          json: 'true',
        }),
        redirect: 'manual',
      });
      take(lr);
      const sess = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: jar.join('; ') } });
      const sj = await sess.json();
      staffLoginOk = !!sj?.user;
    } catch {
      staffLoginOk = false;
    }
  }
  row(
    '2-migration-staff',
    staffLive.status < 400 && staffUser && staffLoginOk ? 'PASS' : 'FAIL',
    `status=${staffUser?.status}`,
    `POST /api/migration/staff ${staffLive.status}`,
    `User ${staffUser?.id || 'NONE'} login=${staffLoginOk}`
  );

  // --- PII mask ---
  const clientForPii = await prisma.client.findFirst({
    where: { organizationId: org.id, email: { not: null }, phone: { not: null } },
    select: { id: true, email: true, phone: true, assignedToId: true },
  });
  if (clientForPii) {
    await prisma.sensitiveRecord.deleteMany({ where: { clientId: clientForPii.id } }).catch(() => {});
    await prisma.client.update({
      where: { id: clientForPii.id },
      data: { assignedToId: therapist.user.id },
    });
    const thGet = await api(therapist.cookie, 'GET', `/api/clients/${clientForPii.id}`);
    const pdGet = await api(pd.cookie, 'GET', `/api/clients/${clientForPii.id}`);
    const thClient = thGet.json?.client || thGet.json;
    const pdClient = pdGet.json?.client || pdGet.json;
    const thMasked =
      thClient?.phone === '••• ••• ••••' ||
      (typeof thClient?.phone === 'string' && thClient.phone.includes('•••'));
    const thEmailMasked =
      typeof thClient?.email === 'string' && thClient.email.startsWith('••••@');
    const pdClear =
      pdClient?.phone &&
      !String(pdClient.phone).includes('•••') &&
      pdClient?.email &&
      !String(pdClient.email).startsWith('••••@');
    row(
      '3-pii-mask',
      thGet.status === 200 && thMasked && thEmailMasked && pdClear ? 'PASS' : 'FAIL',
      `th phone masked=${thMasked} email=${thEmailMasked} pd clear=${!!pdClear}`,
      `GET /api/clients/{id} th=${thGet.status} pd=${pdGet.status}`,
      `Client ${clientForPii.id}`
    );
  } else {
    row('3-pii-mask', 'FAIL', 'no client with email+phone', '-', '-');
  }

  // --- PRP ---
  const refClient = await prisma.client.findFirst({
    where: { organizationId: org.id },
    select: { id: true, name: true, dateOfBirth: true },
  });
  const referral = await api(psych.cookie, 'POST', '/api/prp/referrals', {
    clientId: refClient.id,
    clientName: refClient.name || 'GO Client',
    dateOfBirth: refClient.dateOfBirth
      ? refClient.dateOfBirth.toISOString().slice(0, 10)
      : '1990-01-15',
    medicaidId: 'MDGO' + String(stamp).slice(-8),
    diagnosisCode: 'F33.2',
    diagnosisNarrative: 'Major depressive disorder, recurrent, severe',
    recommendedDomains: ['Daily Living', 'Social', 'Financial'],
    functionalNarrative: 'Pre-prod GO functional impairment narrative for PRP referral.',
    prpJustification: 'Pre-prod GO clinical justification that PRP is medically necessary.',
    prescriberName: 'GO Review MD',
    prescriberNpi: '1234567890',
    signature: 'GO Review MD',
  });
  const refId = referral.json?.referral?.id || referral.json?.id;
  const refDisplay = referral.json?.referral?.displayId || referral.json?.displayId;
  const refDb = refId
    ? await prisma.prpReferral.findUnique({ where: { id: refId }, select: { id: true, displayId: true } })
    : null;
  row(
    '4-prp-referral',
    referral.status < 400 && refDb ? 'PASS' : 'FAIL',
    `displayId=${refDisplay || refDb?.displayId}`,
    `POST /api/prp/referrals ${referral.status}`,
    `PrpReferral ${refDb?.id || 'NONE'}`
  );

  const elig = await api(psych.cookie, 'POST', '/api/prp/eligibility', {
    clientId: (await prisma.client.findFirst({ where: { organizationId: org.id } })).id,
  });
  // GO: fail-closed (4xx/5xx) OR honest live 200 is OK. testPass=true is NO-GO for prod.
  const eligOk = elig.json?.testPass !== true && (elig.status >= 400 || elig.status === 200);
  row(
    '4-prp-eligibility',
    eligOk ? 'PASS' : 'FAIL',
    `status=${elig.status} active=${elig.json?.active} prpCovered=${elig.json?.prpCovered} testPass=${elig.json?.testPass}`,
    `POST /api/prp/eligibility ${elig.status}`,
    elig.json?.error || elig.json?.detail || elig.json?.message || 'response-ok'
  );

  const enroll = await prisma.prpEnrollment.findFirst({
    where: { displayId: 'PRP-9805' },
    select: { id: true, displayId: true, priorAuthId: true },
  });
  const pa = enroll?.priorAuthId
    ? await prisma.priorAuth.findUnique({
        where: { id: enroll.priorAuthId },
        select: { id: true, cptCodes: true, unitsApproved: true, demoMode: true },
      })
    : null;
  row(
    '4-prp-enroll-prior',
    enroll && pa && pa.cptCodes?.includes('H2017') && pa.unitsApproved === 60 && !pa.demoMode
      ? 'PASS'
      : 'FAIL',
    `enroll ${enroll?.displayId} PA H2017×${pa?.unitsApproved}`,
    'prior leftover A rows',
    `PrpEnrollment ${enroll?.id || 'NONE'} PriorAuth ${pa?.id || 'NONE'}`
  );

  // --- BTG ---
  const btgClient = await prisma.client.findFirst({
    where: { organizationId: org.id, id: { not: clientForPii?.id } },
    select: { id: true },
  });
  await prisma.breakTheGlassGrant.deleteMany({ where: { clientId: btgClient.id } }).catch(() => {});
  await prisma.sensitiveAccessLog.deleteMany({ where: { clientId: btgClient.id } }).catch(() => {});
  await prisma.sensitiveRecord.deleteMany({ where: { clientId: btgClient.id } }).catch(() => {});

  const protect = await api(pd.cookie, 'POST', `/api/sensitive-records/${btgClient.id}`, {
    reason: 'other',
    reasonNote: 'preprod go check',
    alias: 'GO-Client',
  });
  const sens = await prisma.sensitiveRecord.findFirst({
    where: { clientId: btgClient.id },
    select: { id: true },
  });
  await prisma.client.update({
    where: { id: btgClient.id },
    data: { assignedToId: null },
  });
  const th403 = await api(therapist.cookie, 'GET', `/api/clients/${btgClient.id}`);
  const canBtg =
    th403.status === 403 &&
    (th403.json?.code === 'SENSITIVE_RECORD' ||
      th403.json?.error?.includes?.('SENSITIVE') ||
      th403.json?.canRequestBreakGlass === true ||
      JSON.stringify(th403.json || {}).includes('SENSITIVE') ||
      JSON.stringify(th403.json || {}).includes('Break'));
  const btg = await api(
    therapist.cookie,
    'POST',
    `/api/sensitive-records/${btgClient.id}/break-glass`,
    { reason: 'preprod-go-check-reason-15c' }
  );
  const grant = await prisma.breakTheGlassGrant.findFirst({
    where: { clientId: btgClient.id },
    orderBy: { grantedAt: 'desc' },
    select: { id: true, expiresAt: true },
  });
  const th200 = await api(therapist.cookie, 'GET', `/api/clients/${btgClient.id}`);
  const log = await prisma.sensitiveAccessLog.findFirst({
    where: { clientId: btgClient.id },
    orderBy: { timestamp: 'desc' },
    select: { id: true, accessType: true, reason: true },
  });
  const logOk =
    !!log &&
    (/break/i.test(log.accessType || '') ||
      /break/i.test(log.reason || '') ||
      log.accessType === 'break_the_glass');
  const list = await api(pd.cookie, 'GET', '/api/sensitive-records');
  const listOk = list.status === 200 && !JSON.stringify(list.json || {}).includes('DEMO_RECORDS');
  const expiresOk =
    grant?.expiresAt &&
    grant.expiresAt.getTime() - Date.now() > 20 * 60 * 60 * 1000 &&
    grant.expiresAt.getTime() - Date.now() < 30 * 60 * 60 * 1000;
  row(
    '5-btg',
    protect.status < 400 &&
      sens &&
      canBtg &&
      btg.status < 400 &&
      grant &&
      expiresOk &&
      th200.status === 200 &&
      listOk &&
      logOk
      ? 'PASS'
      : 'FAIL',
    `403→grant→${th200.status} expiresOk=${!!expiresOk} log=${log?.accessType || 'n/a'}`,
    `POST sensitive ${protect.status}; GET ${th403.status}; BTG ${btg.status}; GET ${th200.status}`,
    `SensitiveRecord ${sens?.id} Grant ${grant?.id} Log ${log?.id || 'n/a'}`
  );

  // --- TMS ---
  const tmsClient = await prisma.client.findFirst({
    where: { organizationId: org.id },
    select: { id: true },
  });
  let course = await prisma.tmsCourse.findFirst({
    where: { clientId: tmsClient.id },
    select: { id: true },
  });
  if (!course) {
    const c = await api(psych.cookie, 'POST', '/api/tms/courses', {
      clientId: tmsClient.id,
      targetSessions: 36,
    });
    course = { id: c.json?.course?.id || c.json?.id };
  }
  const sess = await api(psych.cookie, 'POST', '/api/tms/sessions', {
    courseId: course.id,
    sessionDate: new Date().toISOString(),
    durationMin: 37,
    frequencyHz: 10,
    pulses: 3000,
    notes: `preprod-go-${stamp}`,
  });
  const phq = await api(psych.cookie, 'POST', '/api/tms/phq9', {
    courseId: course.id,
    milestone: 'baseline',
    score: 12,
  });
  const thWrite = await api(therapist.cookie, 'POST', '/api/tms/sessions', {
    courseId: course.id,
    sessionDate: new Date().toISOString(),
    durationMin: 37,
  });
  const sessDb = await prisma.tmsSession.findFirst({
    where: { notes: { contains: `preprod-go-${stamp}` } },
    select: { id: true },
  });
  const phqDb = await prisma.tmsPhq9.findFirst({
    where: { courseId: course.id },
    orderBy: { recordedAt: 'desc' },
    select: { id: true },
  });
  row(
    '6-tms-write',
    sess.status < 400 && sessDb && thWrite.status === 403 ? 'PASS' : 'FAIL',
    `psych write ok; therapist 403=${thWrite.status === 403}`,
    `POST /api/tms/sessions ${sess.status}; th ${thWrite.status}; phq ${phq.status}`,
    `TmsSession ${sessDb?.id || 'NONE'} TmsPhq9 ${phqDb?.id || 'NONE'}`
  );

  // Spravato enrollment smoke
  const spr = await api(psych.cookie, 'POST', '/api/spravato/enrollments', {
    clientId: tmsClient.id,
  }).catch(() => ({ status: 0, json: {} }));
  // may already exist
  const sprEnroll = await prisma.spravatoEnrollment.findFirst({
    where: { clientId: tmsClient.id },
    select: { id: true },
  });
  row(
    '6-spravato',
    sprEnroll || spr.status < 400 ? 'PASS' : 'FAIL',
    `enrollment present`,
    `POST /api/spravato/enrollments ${spr.status}`,
    `SpravatoEnrollment ${sprEnroll?.id || spr.json?.enrollment?.id || 'NONE'}`
  );

  // --- Peer support quote ---
  const peerData = fs.readFileSync(
    path.join(__dirname, '..', 'src/features/compliance/peerSupportData.ts'),
    'utf8'
  );
  const peerOk = peerData.includes(`"St. Matthew's Church"`) || peerData.includes('"St. Matthew\'s Church"');
  // actual file uses double quotes wrapping with apostrophe inside
  const peerExact = /organization:\s*"St\. Matthew's Church"/.test(peerData);
  row('8-peer-support', peerExact ? 'PASS' : 'FAIL', "St. Matthew's Church double-quoted", '-', 'source check');

  // --- Existing offline note from leftover B ---
  const offlineNote = await prisma.progressNote.findFirst({
    where: { body: { contains: 'OFFLINE-SYNC-' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  row(
    '7-offline-prior',
    offlineNote ? 'PASS' : 'FAIL',
    'prior leftover B note in DB',
    'headed e2e separately',
    `ProgressNote ${offlineNote?.id || 'NONE'}`
  );

  // Summary
  const fails = results.filter((r) => r.status === 'FAIL');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({ failCount: fails.length, fails: fails.map((f) => f.flow) }, null, 2));
  console.log('PREPROD_JSON', JSON.stringify(results));
  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL', e);
  await prisma.$disconnect();
  process.exit(1);
});
