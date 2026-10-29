/**
 * Phase 0 parity audit — nav + page existence + crude wire check.
 */
const fs = require('fs');
const path = require('path');

const routes = [
  '/dashboard',
  '/dashboard/tasks',
  '/dashboard/clients',
  '/dashboard/clients/waitlist',
  '/dashboard/clients/intake',
  '/dashboard/alerts',
  '/dashboard/appointments',
  '/dashboard/telehealth',
  '/dashboard/communications',
  '/dashboard/ehr',
  '/dashboard/ehr/notes',
  '/dashboard/ehr/evaluations',
  '/dashboard/ehr/treatment-plans',
  '/dashboard/ehr/assessments',
  '/dashboard/ehr/assessments/cssrs',
  '/dashboard/ehr/diagnoses',
  '/dashboard/ehr/prescriptions',
  '/dashboard/ehr/labs',
  '/dashboard/ehr/consents',
  '/dashboard/ehr/eligibility',
  '/dashboard/ehr/scanner',
  '/dashboard/ehr/prior-auths',
  '/dashboard/ehr/group-sessions',
  '/dashboard/ehr/session-ai',
  '/dashboard/ehr/supervisor-review',
  '/dashboard/ehr/note-builder',
  '/dashboard/ehr/goal-bank',
  '/dashboard/ehr/part2',
  '/dashboard/ehr/safety-plan',
  '/dashboard/ehr/tms-spravato',
  '/dashboard/ehr/locus',
  '/dashboard/ehr/mandatory-reporting',
  '/dashboard/ehr/discharge',
  '/dashboard/ehr/healthlake',
  '/dashboard/ehr/hie',
  '/dashboard/mbc',
  '/dashboard/mbc/outcomes',
  '/dashboard/scribe',
  '/dashboard/ai-insights',
  '/dashboard/coding',
  '/dashboard/analytics/schedule',
  '/dashboard/analytics/productivity',
  '/dashboard/analytics/surveys',
  '/dashboard/reports',
  '/dashboard/population',
  '/dashboard/sdoh',
  '/dashboard/resources',
  '/dashboard/qi',
  '/dashboard/incidents',
  '/dashboard/grievances',
  '/dashboard/compliance',
  '/dashboard/peer-support',
  '/dashboard/prp',
  '/dashboard/prp/referral',
  '/dashboard/prp/enroll',
  '/dashboard/protected-records',
  '/dashboard/enterprise',
  '/dashboard/billing',
  '/dashboard/billing/denials',
  '/dashboard/billing/autopay',
  '/dashboard/billing/superbills',
  '/dashboard/billing/payments',
  '/dashboard/billing/panels',
  '/dashboard/billing/ar-control',
  '/dashboard/billing/claim-scrubber',
  '/dashboard/billing/statements',
  '/dashboard/admin/scheduling-settings',
  '/dashboard/hr',
  '/dashboard/hr/credentialing',
  '/dashboard/hr/supervision',
  '/dashboard/hr/training',
  '/dashboard/admin',
  '/dashboard/admin/migration',
  '/onboarding',
  '/dashboard/subscription',
  '/dashboard/community',
  '/dashboard/community/referrals',
  '/dashboard/pr',
  '/schedule',
];

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'src/components/layout/DashboardShell.tsx'), 'utf8');
const roleAccess = fs.readFileSync(path.join(root, 'src/lib/auth/roleAccess.ts'), 'utf8');

function pageExists(r) {
  const rel = r.replace(/^\//, '');
  const cands = [
    path.join(root, 'src/app', rel, 'page.tsx'),
    path.join(root, 'src/app', rel, 'page.ts'),
    path.join(root, 'src/app', rel, 'page.jsx'),
  ];
  // alternate paths known in this repo
  if (r === '/dashboard/ehr/mandatory-reporting') {
    cands.push(path.join(root, 'src/app/dashboard/compliance/mandatory-reporting/page.tsx'));
  }
  if (r === '/onboarding') {
    cands.push(path.join(root, 'src/app/onboarding/page.tsx'));
    cands.push(path.join(root, 'src/app/dashboard/practice-setup/page.tsx'));
  }
  for (const c of cands) if (fs.existsSync(c)) return path.relative(root, c).replace(/\\/g, '/');
  return null;
}

function navPresent(r) {
  if (r === '/schedule') return 'PUBLIC';
  if (r === '/onboarding') {
    // Practice Setup maps to /dashboard/practice-setup in nav
    if (shell.includes("/dashboard/practice-setup") || shell.includes("'/onboarding'")) return 'MAPPED';
    return 'NO';
  }
  if (r === '/dashboard/ehr/mandatory-reporting') {
    if (shell.includes('/dashboard/compliance/mandatory-reporting') || shell.includes(r)) return 'ALT_HREF';
  }
  if (r === '/dashboard/prp/referral' || r === '/dashboard/prp/enroll') {
    // may only be CTAs on PRP page, not sidebar
    if (shell.includes(`'${r}'`) || shell.includes(`"${r}"`)) return 'YES';
    return 'NO_SIDEBAR';
  }
  return shell.includes(`href: '${r}'`) || shell.includes(`href: "${r}"`) ? 'YES' : 'NO';
}

const demoRe =
  /\b(DEMO_AR|DEMO_STATEMENTS|TODAY_SESSIONS|INSIGHTS_BY_ROLE|TMS_PATIENTS|SPRAVATO_PATIENTS|DEMO_ELG|DEMO_RECORDS|DEMO_HISTORY)\b/;

const rows = [];
for (const r of routes) {
  const nav = navPresent(r);
  const pg = pageExists(r);
  let wired = 'NO';
  let gap = '';
  let ui = '—';
  if (!pg) {
    wired = 'NO';
    gap = 'page missing';
  } else {
    const txt = fs.readFileSync(path.join(root, pg), 'utf8');
    const hasApi = /apiJson\s*<|apiJson\(|fetch\s*\(\s*[`'"]\/api\//.test(txt);
    const hasDemoLive = demoRe.test(txt);
    ui = txt.length > 800 ? '~' + Math.round(txt.length / 1000) + 'kB' : 'thin';
    if (hasDemoLive) {
      wired = 'PARTIAL';
      gap = 'DEMO_* symbol in page';
    } else if (hasApi) {
      wired = 'YES';
    } else {
      wired = 'STATIC?';
      gap = 'no obvious /api call in page';
    }
  }

  let status = 'MISSING';
  if (!pg) status = 'MISSING';
  else if (nav === 'NO' || nav === 'NO_SIDEBAR') {
    status = 'PARTIAL';
    gap = (gap ? gap + '; ' : '') + (nav === 'NO_SIDEBAR' ? 'nav CTA/link missing in sidebar' : 'nav missing');
  } else if (nav === 'ALT_HREF') {
    status = 'PARTIAL';
    gap = (gap ? gap + '; ' : '') + 'nav href differs from required path';
  } else if (nav === 'MAPPED') {
    status = 'PARTIAL';
    gap = (gap ? gap + '; ' : '') + 'Practice Setup maps to /dashboard/practice-setup not /onboarding';
  } else if (wired === 'PARTIAL' || wired === 'STATIC?') status = 'PARTIAL';
  else status = 'PASS';

  // Role gate mention
  const inRoleFile = roleAccess.includes(r) || roleAccess.includes(r.replace('/dashboard', ''));

  rows.push({ r, nav, page: pg ? 'YES' : 'NO', pagePath: pg || '', ui, wired, status, gap, inRoleFile });
}

console.log('Route|Nav|Page|UI|Wired|Status|Gap');
for (const x of rows) {
  console.log([x.r, x.nav, x.page, x.ui, x.wired, x.status, x.gap || ''].join('|'));
}

const c = { PASS: 0, PARTIAL: 0, MISSING: 0 };
for (const x of rows) c[x.status] = (c[x.status] || 0) + 1;
console.log('\nCOUNTS', JSON.stringify(c));

// shell extras
function find(pattern) {
  let hits = [];
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.next') continue;
        walk(p);
      } else if (/\.(tsx|ts|jsx|js)$/.test(name)) {
        const t = fs.readFileSync(p, 'utf8');
        if (pattern.test(t)) hits.push(path.relative(root, p).replace(/\\/g, '/'));
      }
    }
  }
  walk(path.join(root, 'src'));
  return hits.slice(0, 15);
}

const offline = find(/OfflineBanner/);
const cmdk = find(/DashboardCommandSearch|fetchClients/);
const entity = find(/Clear Horizon|Honey B|multi-entity|entitySwitcher|MBH/);
const demoGrep = find(demoRe);

console.log('\nSHELL OfflineBanner:', offline.length ? offline.join(', ') : 'NOT FOUND');
console.log('SHELL CommandSearch/fetchClients:', cmdk.filter((f) => /CommandSearch|clientsApi|DashboardShell/.test(f)).join(', ') || cmdk.slice(0, 5).join(', '));
console.log('SHELL multi-entity:', entity.length ? entity.join(', ') : 'NOT FOUND');
console.log('DEMO live symbols in src:', demoGrep.length ? demoGrep.join(', ') : 'NONE');

fs.writeFileSync(
  path.join(root, '_phase0-audit.json'),
  JSON.stringify({ counts: c, rows, offline, entity, demoGrep }, null, 2)
);
console.log('\nWrote _phase0-audit.json');
