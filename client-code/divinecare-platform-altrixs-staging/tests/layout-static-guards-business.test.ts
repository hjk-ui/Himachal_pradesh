/**
 * Static layout guards for the business, programs, admin and patient-facing pages
 * (Oct 2026 responsive pass: desktop with the sidebar open, tablet, and 375-430px phones).
 *
 * These are source-level checks for patterns that caused clipped tables, squeezed filter bars
 * and pages wider than a phone. They do not render anything; they keep the patterns from
 * creeping back in. Clinical pages, the app shell and shared UI have their own owners and are
 * not scanned here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(__dirname, '..');

const STAFF_DIRS = [
  'src/app/dashboard/billing',
  'src/app/dashboard/statements',
  'src/app/dashboard/hr',
  'src/app/dashboard/admin',
  'src/app/dashboard/settings',
  'src/app/dashboard/practice-setup',
  'src/app/dashboard/enterprise',
  'src/app/dashboard/subscription',
  'src/app/dashboard/reports',
  'src/app/dashboard/analytics',
  'src/app/dashboard/population',
  'src/app/dashboard/mbc',
  'src/app/dashboard/qi',
  'src/app/dashboard/coding',
  'src/app/dashboard/marketing',
  'src/app/dashboard/community',
  'src/app/dashboard/pr',
  'src/app/dashboard/projects',
  'src/app/dashboard/tasks',
  'src/app/dashboard/compliance',
  'src/app/dashboard/grievances',
  'src/app/dashboard/incidents',
  'src/app/dashboard/notifications',
  'src/app/dashboard/communications',
  'src/app/dashboard/protected-records',
  'src/app/dashboard/resources',
  'src/app/dashboard/sdoh',
  'src/app/dashboard/crisis',
  'src/app/dashboard/residential',
  'src/app/dashboard/prp',
  'src/app/dashboard/programs',
  'src/app/dashboard/aot',
  'src/app/dashboard/peer-support',
  'src/app/platform',
  'src/components/hr',
  'src/components/billing',
  'src/components/aot',
  'src/components/ClaimEditorModal.tsx',
  'src/features/billing',
  'src/features/staff',
  'src/features/locations',
  'src/features/peerSupport',
  'src/features/reports',
  'src/features/insights',
  'src/features/community',
  'src/features/pr',
  'src/features/resources',
  'src/features/sdoh',
];

const PATIENT_DIRS = [
  'src/app/patient',
  'src/app/p',
  'src/app/m',
  'src/app/intake',
  'src/app/invite',
  'src/app/onboarding',
  'src/app/book',
  'src/app/schedule',
  'src/app/get-started',
  'src/app/telehealth/join',
  'src/features/patient',
];

function walk(rel: string, out: string[]) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isFile()) {
    if (rel.endsWith('.tsx')) out.push(rel);
    return;
  }
  for (const f of fs.readdirSync(full)) walk(`${rel}/${f}`, out);
}

function filesIn(dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) walk(d, out);
  return out;
}

const STAFF = filesIn(STAFF_DIRS);
const PATIENT = filesIn(PATIENT_DIRS);
const ALL = [...STAFF, ...PATIENT];
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Known exceptions, each with its reason. Keep this list short.
 */
const ALLOW = {
  // Not mounted by any route (legacy HR corner page); tables are hidden behind md:table.
  deadCode: new Set(['src/features/hr/HrCornerPage.tsx']),
  // Tables inside a template string for a print window, not React markup.
  printHtml: new Set(['src/app/dashboard/hr/supervision/page.tsx']),
  // Faithful copy of the paper MDH AOT form (signature rows); read on the print page.
  paperForm: new Set(['src/components/aot/forms/FormDocument.tsx']),
};

const SCROLL_MARKER = /overflow-x-auto|overflow-auto|overflow-x-scroll|clinic-scroll-x|TABLE_SCROLL|TABLE_WRAP|<Section\b/;

test('scope is discovered (guards are not vacuous)', () => {
  assert.ok(STAFF.length > 150, `staff files: ${STAFF.length}`);
  assert.ok(PATIENT.length > 10, `patient files: ${PATIENT.length}`);
});

test('every <table> sits inside a horizontal scroll wrapper', () => {
  const bad: string[] = [];
  for (const f of ALL) {
    if (ALLOW.deadCode.has(f) || ALLOW.printHtml.has(f) || ALLOW.paperForm.has(f)) continue;
    const lines = read(f).split('\n');
    lines.forEach((l, i) => {
      if (!/<table\b/.test(l)) return;
      // Two-column key/value tables with table-fixed wrap their cells instead of scrolling.
      if (/\btable-fixed\b/.test(l)) return;
      const back = lines.slice(Math.max(0, i - 40), i + 1).join('\n');
      if (!SCROLL_MARKER.test(back)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'tables without an overflow-x-auto / clinic-scroll-x wrapper clip columns on narrow screens');
});

test('a scroll wrapper is never cancelled by overflow-hidden on the same element', () => {
  const bad: string[] = [];
  for (const f of ALL) {
    read(f)
      .split('\n')
      .forEach((l, i) => {
        for (const m of l.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          const cls = m[1] ?? m[2] ?? '';
          const tokens = cls.split(/\s+/);
          if (tokens.includes('clinic-scroll-x') && tokens.includes('overflow-hidden')) bad.push(`${f}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(bad, []);
});

test('no unprefixed multi-column grids (grid-cols-3+) except 7-day calendars', () => {
  const bad: string[] = [];
  for (const f of ALL) {
    if (ALLOW.paperForm.has(f) || ALLOW.deadCode.has(f)) continue;
    read(f)
      .split('\n')
      .forEach((l, i) => {
        for (const m of l.matchAll(/(?<![:\w-])grid-cols-(\d+)\b/g)) {
          const n = Number(m[1]);
          if (n >= 3 && n !== 7) bad.push(`${f}:${i + 1} grid-cols-${n}`);
        }
      });
  }
  // Valant aging buckets: 3 columns of short numbers on phones, 5 from sm.
  const allowed = bad.filter((b) => !b.startsWith('src/components/billing/ValantReferenceCard.tsx'));
  assert.deepEqual(allowed, [], 'use grid-cols-1 / grid-cols-2 on phones and step up with sm:/md:/lg:');
});

test('arbitrary grid templates use minmax(0,…) for flexible columns', () => {
  const bad: string[] = [];
  for (const f of ALL) {
    if (ALLOW.deadCode.has(f)) continue;
    read(f)
      .split('\n')
      .forEach((l, i) => {
        for (const m of l.matchAll(/grid-cols-\[([^\]]+)\]/g)) {
          // Split on top-level underscores; a bare "1fr" segment can grow past its track.
          const segs = m[1].replace(/\([^)]*\)/g, (x) => x.replace(/_/g, ' ')).split('_');
          if (segs.some((s) => /^\d*\.?\d+fr$/.test(s))) bad.push(`${f}:${i + 1} [${m[1]}]`);
        }
      });
  }
  assert.deepEqual(bad, [], 'a bare 1fr track is minmax(auto,1fr) and lets tables/long text overflow the page');
});

test('centred modal overlays cap the panel height for phones', () => {
  const bad: string[] = [];
  for (const f of ALL) {
    const lines = read(f).split('\n');
    lines.forEach((l, i) => {
      if (!/fixed inset-0/.test(l) || !/justify-center|items-center/.test(l)) return;
      if (/overflow-y-auto/.test(l)) return; // the overlay itself scrolls
      const fwd = lines.slice(i, i + 12).join('\n');
      if (!/max-h-|overflow-y-auto/.test(fwd)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'modal panels need w-full max-w-* max-h-[90dvh] overflow-y-auto');
});

test('no fixed action bars with a hard-coded sidebar offset', () => {
  const bad = ALL.filter((f) => /\bfixed\b[^"`]*\blg:pl-64\b|\blg:pl-64\b[^"`]*\bfixed\b/.test(read(f)));
  assert.deepEqual(bad, [], 'the sidebar can be collapsed: use sticky bottom-0 inside the content column');
});

test('no fixed pixel widths of 400px+ on non-table containers', () => {
  const bad: string[] = [];
  for (const f of ALL) {
    read(f)
      .split('\n')
      .forEach((l, i) => {
        const m = l.match(/(?<![:\w-])w-\[(\d{3,})px\]/);
        if (m && Number(m[1]) >= 400 && !/max-w-/.test(l)) bad.push(`${f}:${i + 1}`);
      });
  }
  assert.deepEqual(bad, []);
});

test('patient-facing pages use dynamic viewport height, not h-screen/min-h-screen', () => {
  const bad = PATIENT.filter((f) => /(?<![:\w-])(min-h-screen|h-screen)\b/.test(read(f)));
  assert.deepEqual(bad, [], 'use min-h-[100dvh] so mobile browser bars do not cut off the page');
});

test('billing tables share the sticky column / filter bar layout helpers', () => {
  const src = read('src/features/billing/tableLayout.ts');
  for (const name of ['TABLE_SCROLL', 'STICKY_FIRST_TH', 'STICKY_FIRST_TD', 'STICKY_ACTIONS_TH', 'STICKY_ACTIONS_TD', 'FILTER_BAR', 'FILTER_SEARCH']) {
    assert.match(src, new RegExp(`export const ${name}\\b`));
  }
  const users = STAFF.filter((f) => read(f).includes("@/features/billing/tableLayout'"));
  assert.ok(users.length >= 5, `tableLayout used by ${users.length} files`);
});
