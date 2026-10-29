/**
 * Leftover A: prove PrpEnrollment + PriorAuth via TEST PASS flag (Availity stays fail-closed by default).
 * Does not print emails/PHI.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const BASE = process.env.AUTH_URL || 'http://localhost:3000';
const PASSWORD = 'Altrixs@123';
const ENV_PATH = path.join(__dirname, '..', '.env');
const FLAG = 'PRP_ELIGIBILITY_TEST_PASS';
const prisma = new PrismaClient();

function setFlag(on) {
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  const line = `${FLAG}=true`;
  const re = new RegExp(`^\\s*#?\\s*${FLAG}\\s*=.*$`, 'm');
  if (on) {
    if (re.test(text)) text = text.replace(re, line);
    else text = text.trimEnd() + `\n${line}\n`;
  } else {
    if (re.test(text)) text = text.replace(re, `# ${FLAG}=true`);
    else text = text; // already off
  }
  fs.writeFileSync(ENV_PATH, text);
  console.log(`FLAG_${on ? 'ON' : 'OFF'}`);
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
  if (!user) throw new Error('no user ' + role);
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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.join('; '),
    },
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
  return {
    orgId: user.organizationId,
    userId: user.id,
    cookie: jar.join('; '),
    async api(p, init = {}) {
      const res = await fetch(`${BASE}${p}`, {
        ...init,
        headers: {
          Cookie: jar.join('; '),
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 200) };
      }
      return { status: res.status, json };
    },
  };
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/csrf`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('server not ready');
}

(async () => {
  // Ensure insurance on a client
  const admin = await loginAs('ADMIN');
  const client = await prisma.client.findFirst({
    where: { organizationId: admin.orgId },
    select: { id: true },
  });
  await prisma.client.update({
    where: { id: client.id },
    data: {
      insuranceMemberId: 'MD99887766',
      insurancePayer: 'Maryland Medicaid',
    },
  });

  // --- Prove flag OFF / fail-closed (current server may still have old env) ---
  // We toggle .env; caller must restart Next between FLAG_ON and FLAG_OFF runs.
  // This script assumes: if process.argv[2]==='with-flag' then enroll; else check blocked.
  const mode = process.argv[2] || 'check-blocked';

  if (mode === 'set-on') {
    setFlag(true);
    console.log('RESTART_NEXT_THEN_RUN: node scripts/_leftover-a-enroll.js with-flag');
    await prisma.$disconnect();
    return;
  }
  if (mode === 'set-off') {
    setFlag(false);
    console.log('RESTART_NEXT_THEN_RUN: node scripts/_leftover-a-enroll.js check-blocked');
    await prisma.$disconnect();
    return;
  }

  await waitReady();
  const psych = await loginAs('PSYCHIATRIST', admin.orgId);

  if (mode === 'check-blocked') {
    const elig = await psych.api('/api/prp/eligibility', {
      method: 'POST',
      body: JSON.stringify({ clientId: client.id }),
    });
    console.log(
      `BLOCKED_CHECK status=${elig.status} active=${elig.json?.active} prpCovered=${elig.json?.prpCovered} testPass=${elig.json?.testPass} err=${elig.json?.error || elig.json?.message || ''}`
    );
    const blockedOk =
      elig.json?.testPass !== true &&
      elig.json?.active !== true &&
      (elig.status >= 400 || elig.json?.active === false);
    console.log(blockedOk ? 'LEFTOVER_A_DEFAULT_FAILCLOSED=PASS' : 'LEFTOVER_A_DEFAULT_FAILCLOSED=FAIL');
    await prisma.$disconnect();
    return;
  }

  if (mode === 'with-flag') {
    const elig = await psych.api('/api/prp/eligibility', {
      method: 'POST',
      body: JSON.stringify({ clientId: client.id }),
    });
    console.log(
      `ELIG Network POST /api/prp/eligibility status=${elig.status} active=${elig.json?.active} prpCovered=${elig.json?.prpCovered} mode=${elig.json?.mode} testPass=${elig.json?.testPass}`
    );
    if (!(elig.status < 300 && elig.json?.active && elig.json?.prpCovered && elig.json?.testPass)) {
      console.log('LEFTOVER_A=FAIL eligibility test pass not active — did you restart Next after set-on?');
      await prisma.$disconnect();
      process.exit(1);
    }

    const pa = await psych.api('/api/prp/prior-auth', {
      method: 'POST',
      body: JSON.stringify({ clientId: client.id, units: 60, days: 90, cpt: 'H2017' }),
    });
    console.log(`PA Network POST /api/prp/prior-auth status=${pa.status} priorAuthId=${pa.json?.priorAuthId}`);
    const paRow = pa.json?.priorAuthId
      ? await prisma.priorAuth.findUnique({ where: { id: pa.json.priorAuthId } })
      : null;
    const paOk =
      pa.status < 300 &&
      paRow &&
      !String(pa.json.priorAuthId).startsWith('PA-LOCAL') &&
      (paRow.cptCodes || []).includes('H2017');

    const specialists = await psych.api('/api/prp/specialists');
    const spec = (specialists.json?.specialists || []).find((s) => s.caseload < s.capacity);

    const enroll = await psych.api('/api/prp/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        clientId: client.id,
        diagnosisCode: 'F33.2',
        diagnosisSource: 'chart',
        eligibilitySnapshot: {
          ok: true,
          active: true,
          prpCovered: true,
          detail: elig.json?.message,
        },
        priorAuthId: pa.json?.priorAuthId,
        specialistId: spec?.id || null,
        startDate: new Date().toISOString().slice(0, 10),
      }),
    });
    console.log(
      `ENROLL Network POST /api/prp/enrollments status=${enroll.status} displayId=${enroll.json?.enrollment?.displayId} id=${enroll.json?.enrollment?.id} err=${enroll.json?.error || ''}`
    );
    const enRow = enroll.json?.enrollment?.id
      ? await prisma.prpEnrollment.findUnique({ where: { id: enroll.json.enrollment.id } })
      : null;

    const pass =
      paOk &&
      enroll.status < 300 &&
      enRow &&
      String(enroll.json?.enrollment?.displayId || '').startsWith('PRP-');
    console.log(
      `DB priorAuthId=${paRow?.id} units=${paRow?.unitsApproved} cpt=${JSON.stringify(paRow?.cptCodes)} enrollmentId=${enRow?.id} displayId=${enRow?.displayId}`
    );
    console.log(pass ? 'LEFTOVER_A_WITH_FLAG=PASS' : 'LEFTOVER_A_WITH_FLAG=FAIL');
    await prisma.$disconnect();
    process.exit(pass ? 0 : 1);
  }

  console.log('usage: set-on | with-flag | set-off | check-blocked');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FATAL', e);
  await prisma.$disconnect();
  process.exit(1);
});
