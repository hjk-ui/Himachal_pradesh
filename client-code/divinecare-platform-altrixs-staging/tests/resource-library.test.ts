import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  activationProblem,
  aggregateAssignments,
  aggregateReferrals,
  assignmentIsPart2,
  assignProblem,
  followUpState,
  isSudItem,
  matchesQuery,
  patientAssignmentWhere,
  patientStatusChange,
  recentItemIds,
  resourceNotificationPlan,
  RESOURCE_NOTIFICATION_BODY,
  RESOURCE_NOTIFICATION_TITLE,
  staffWithdrawProblem,
  visibleToPatient,
  type AssignmentFact,
  type ReferralFact,
} from '../src/lib/resources/rules';
import { COMMUNITY_SEEDS, CRISIS_LINES, SEED_ITEMS } from '../src/lib/resources/seedCatalog';
import { REJECTED_CANDIDATES, VERIFIED_SOURCES, verifiedSource } from '../src/lib/resources/verifiedSources';
import { planResourceBlobMigration } from '../src/lib/resources/blobMigration';
import { countyFromText, csvTemplate, directoryDomainsFor, parseAgencyCsv, suggestCommunityResources } from '../src/lib/resources/community';
import {
  canAssignResources,
  canManageResources,
  canManageStaffResources,
  canReviewResources,
  canSeePatientItem,
  canSeeStaffItem,
  canUseResourceLibrary,
} from '../src/lib/resources/access';
import { canAccessApiPath, canAccessPath } from '../src/lib/auth/roleAccess';
import { canReadClinicModule } from '../src/lib/modules/access';
import { REPORTS } from '../src/lib/reports/library/registry';
import { REPORT_LIBRARY_ROLES } from '../src/lib/auth/roleAccess';
import { TOPICS } from '../src/lib/resources/types';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── Assignment flow and portal visibility ──────────────────────────────────

const item = (over: Partial<Parameters<typeof assignProblem>[0]> = {}) => ({
  kind: 'link',
  audience: 'patient',
  status: 'active',
  url: 'https://medlineplus.gov/anxiety.html',
  body: null,
  contactPhone: null,
  fileStoredName: null,
  lastReviewedAt: null,
  ...over,
});

test('assignment flow: only active patient-facing items with their content can be sent', () => {
  assert.equal(assignProblem(item()), null);
  assert.match(assignProblem(item({ status: 'draft' }))!, /active/);
  assert.match(assignProblem(item({ audience: 'staff' }))!, /Staff resources/);
  assert.match(assignProblem(item({ url: null }))!, /link/i);
  // Practice handout: needs the file AND a clinical review
  assert.match(activationProblem(item({ kind: 'handout', url: null }))!, /Upload/);
  assert.match(activationProblem(item({ kind: 'handout', url: null, fileStoredName: 'x.pdf' }))!, /review/);
  assert.equal(activationProblem(item({ kind: 'handout', url: null, fileStoredName: 'x.pdf', lastReviewedAt: new Date() })), null);
  assert.match(activationProblem(item({ kind: 'article', url: null }))!, /article text/);
  assert.equal(activationProblem(item({ kind: 'crisis', url: null, contactPhone: '988' })), null);
});

test('assignment status: sent -> viewed -> completed, never backwards; withdrawn is closed to the patient', () => {
  const now = new Date('2026-10-20T15:00:00Z');
  const v = patientStatusChange({ status: 'sent', viewedAt: null }, 'viewed', now);
  assert.ok(v.ok && v.change?.status === 'viewed' && v.change.viewedAt === now);
  const again = patientStatusChange({ status: 'viewed', viewedAt: now }, 'viewed', now);
  assert.ok(again.ok && again.change === null);
  const done = patientStatusChange({ status: 'sent', viewedAt: null }, 'completed', now);
  assert.ok(done.ok && done.change?.status === 'completed' && done.change.viewedAt === now, 'completing also records the first view');
  const back = patientStatusChange({ status: 'completed', viewedAt: now }, 'viewed', now);
  assert.ok(back.ok && back.change === null, 'completed never goes back to viewed');
  assert.equal(patientStatusChange({ status: 'withdrawn', viewedAt: null }, 'viewed').ok, false);
  assert.equal(staffWithdrawProblem('sent'), null);
  assert.ok(staffWithdrawProblem('completed'));
  assert.ok(staffWithdrawProblem('withdrawn'));
});

test('portal scoping: a client sees only their own, non-withdrawn assignments in their organization', () => {
  const me = { organizationId: 'org-a', clientId: 'client-1' };
  const rows = [
    { id: '1', organizationId: 'org-a', clientId: 'client-1', status: 'sent' },
    { id: '2', organizationId: 'org-a', clientId: 'client-1', status: 'completed' },
    { id: '3', organizationId: 'org-a', clientId: 'client-1', status: 'withdrawn' },
    { id: '4', organizationId: 'org-a', clientId: 'client-2', status: 'sent' },
    { id: '5', organizationId: 'org-b', clientId: 'client-1', status: 'sent' },
  ];
  assert.deepEqual(visibleToPatient(rows, me).map((r) => r.id), ['1', '2']);
  const where = patientAssignmentWhere(me);
  assert.equal(where.organizationId, 'org-a');
  assert.equal(where.clientId, 'client-1');
  assert.deepEqual(where.status.in, ['sent', 'viewed', 'completed']);
});

test('portal routes take the client id from the session only, and every portal read / download is audited', () => {
  const store = read('src/lib/resources/store.ts');
  // Every portal query goes through patientAssignmentWhere (org + client + visible statuses)
  for (const fn of ['listPatientResources', 'patientRow']) {
    const body = store.slice(store.indexOf(`function ${fn}`), store.indexOf(`function ${fn}`) + 600);
    assert.match(body, /patientAssignmentWhere\(/, `${fn} must scope with patientAssignmentWhere`);
  }
  for (const rel of ['src/app/api/patient/resources/route.ts', 'src/app/api/patient/resources/[id]/route.ts', 'src/app/api/patient/resources/[id]/file/route.ts']) {
    const src = read(rel);
    assert.match(src, /ctx\.clientId/, `${rel} scopes by the signed-in patient`);
    assert.doesNotMatch(src, /searchParams\.get\('clientId'\)|body\.clientId/, `${rel} never takes a client id from the request`);
    assert.match(src, /writeAuditLog/, `${rel} is audited`);
  }
});

// ─── Part 2 and notification wording ────────────────────────────────────────

test('Part 2: SUD content, a Part 2 chart or an SUD context flags the assignment', () => {
  assert.equal(isSudItem({ topics: ['sud_recovery'] }), true);
  assert.equal(isSudItem({ topics: ['anxiety'], sudRelated: true }), true);
  assert.equal(isSudItem({ topics: ['anxiety'] }), false);
  assert.equal(assignmentIsPart2({ itemSud: true, clientPart2: false }), true);
  assert.equal(assignmentIsPart2({ itemSud: false, clientPart2: true }), true);
  assert.equal(assignmentIsPart2({ itemSud: false, clientPart2: false, contextPart2: true }), true);
  assert.equal(assignmentIsPart2({ itemSud: false, clientPart2: false }), false);
});

test('notification wording: identical generic text for Part 2 and non-Part 2; no title, no SMS or email', () => {
  const sudTitle = 'Opioids and Opioid Use Disorder (MedlinePlus)';
  const a = resourceNotificationPlan({ assignmentId: 'a1', part2: true, deviceCount: 2, portalAccount: true });
  const b = resourceNotificationPlan({ assignmentId: 'a2', part2: false, deviceCount: 2, portalAccount: true });
  assert.equal(a.title, b.title);
  assert.equal(a.body, b.body);
  assert.equal(a.body, 'You have a new resource in your portal.');
  assert.equal(a.title, RESOURCE_NOTIFICATION_TITLE);
  assert.equal(a.body, RESOURCE_NOTIFICATION_BODY);
  for (const p of [a, b]) {
    const blob = JSON.stringify(p).toLowerCase();
    assert.ok(!blob.includes(sudTitle.toLowerCase()) && !/opioid|alcohol|substance|sud|recovery|naloxone/.test(blob), 'nothing SUD-revealing');
    assert.equal(p.sms, false);
    assert.equal(p.email, false);
    assert.equal(p.portal, true);
    assert.deepEqual(Object.keys(p.data).sort(), ['assignmentId', 'type']);
  }
  assert.equal(resourceNotificationPlan({ assignmentId: 'x', part2: false, deviceCount: 0, portalAccount: true }).push, false);
  assert.equal(resourceNotificationPlan({ assignmentId: 'x', part2: false, deviceCount: 3, portalAccount: false }).push, false);
  // The store sends exactly the plan's title / body; no SMS or email helper is imported
  const store = read('src/lib/resources/store.ts');
  assert.match(store, /title: plan\.title, body: plan\.body/);
  assert.doesNotMatch(store, /@\/lib\/sms|@\/lib\/email|@\/lib\/mail|sendSms|sendEmail/);
});

// ─── SDOH domain -> community resource suggestion ───────────────────────────

const dir = [
  { id: 'r211', name: '211 Maryland', domains: ['general', 'food', 'housing'], counties: ['statewide'], active: true, lastVerifiedAt: '2026-10-20' },
  { id: 'pantry-pg', name: 'PG food pantry', domains: ['food'], counties: ['prince_georges'], active: true, lastVerifiedAt: '2026-09-01' },
  { id: 'pantry-moco', name: 'MoCo food pantry', domains: ['food'], counties: ['montgomery'], active: true, lastVerifiedAt: '2026-09-01' },
  { id: 'dv', name: 'DV program', domains: ['domestic_violence'], counties: ['baltimore_city'], active: true, lastVerifiedAt: null },
  { id: 'old', name: 'Closed pantry', domains: ['food'], counties: ['prince_georges'], active: false, lastVerifiedAt: null },
  { id: 'housing-noarea', name: 'Housing help', domains: ['housing'], counties: [], active: true, lastVerifiedAt: null },
];

test('SDOH suggestion: a positive domain suggests matching active resources, county first, then statewide lines', () => {
  const [food] = suggestCommunityResources(['food'], dir, 'prince_georges');
  assert.deepEqual(food!.resources.map((r) => r.id), ['pantry-pg', 'r211'], 'other-county and inactive entries are left out; 211 (all needs) after the specific match');
  const [housing] = suggestCommunityResources(['housing_instability'], dir, 'prince_georges');
  assert.deepEqual(housing!.resources.map((r) => r.id), ['r211', 'housing-noarea']);
  const [safety] = suggestCommunityResources(['safety'], dir, 'baltimore_city');
  assert.deepEqual(safety!.resources.map((r) => r.id), ['dv', 'r211'], 'safety maps to domestic violence services, then the all-needs line');
  assert.deepEqual(directoryDomainsFor('safety'), ['safety', 'domestic_violence']);
  assert.deepEqual(suggestCommunityResources([], dir, null), []);
  // No county on the chart: all active matches, ranked
  assert.deepEqual(suggestCommunityResources(['food'], dir, null)[0]!.resources.map((r) => r.id).sort(), ['pantry-moco', 'pantry-pg', 'r211']);
  assert.equal(countyFromText("Prince George's County"), 'prince_georges');
  assert.equal(countyFromText('St. Mary\'s'), 'st_marys');
  assert.equal(countyFromText('Baltimore City'), 'baltimore_city');
  assert.equal(countyFromText('Baltimore County'), null, 'Baltimore County is not Baltimore City');
});

test('SDOH loop: referral type, follow-up date and follow-up state', () => {
  const today = new Date('2026-10-20T12:00:00Z');
  const base = { status: 'open', followUpCompletedAt: null } as const;
  assert.equal(followUpState({ ...base, followUpDate: null }, today), 'none');
  assert.equal(followUpState({ ...base, followUpDate: new Date('2026-10-25T00:00:00Z') }, today), 'scheduled');
  assert.equal(followUpState({ ...base, followUpDate: new Date('2026-10-19T00:00:00Z') }, today), 'overdue');
  assert.equal(followUpState({ status: 'open', followUpDate: new Date('2026-10-19T00:00:00Z'), followUpCompletedAt: today }, today), 'done');
  assert.equal(followUpState({ status: 'closed', followUpDate: new Date('2026-10-19T00:00:00Z'), followUpCompletedAt: null }, today), 'done');
  const sql = read('prisma/migrations/20261020_resource_library.sql');
  for (const col of ['"referralType"', '"followUpDate"', '"followUpCompletedAt"', '"counties"']) assert.ok(sql.includes(col), `migration adds ${col}`);
});

test('community CSV: template has the header and no sample agencies; rows are validated, never guessed', () => {
  const t = csvTemplate();
  assert.match(t.split('\n')[0]!, /^name,categories,counties,/);
  assert.equal(parseAgencyCsv(t).rows.length, 0, 'the template has no data rows');
  const csv = [
    'name,categories,counties,phone,website,last_verified,languages',
    'Pantry A,food,prince_georges,301-555-0100,https://example.org,2026-10-01,English|Spanish',
    ',food,montgomery,,,,',
    'Bad Cat,groceries,montgomery,,,,',
    'Bad County,food,anne_arundel,,,,',
    'Bad Date,food,montgomery,,,10/01/2026,',
  ].join('\n');
  const r = parseAgencyCsv(csv);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0]!.languages, ['English', 'Spanish']);
  assert.equal(r.rows[0]!.lastVerifiedAt?.toISOString().slice(0, 10), '2026-10-01');
  assert.equal(r.errors.length, 4);
});

// ─── Blob migration (dry run) ───────────────────────────────────────────────

test('blob migration dry run: uploads become drafts without files, built-in titles become retired placeholders, history is kept as not delivered', () => {
  const uploads = [
    { id: 'up-1', title: 'Our sleep handout', type: 'Worksheet', category: 'Anxiety', description: 'Clinic-uploaded resource', uploaded: true },
    { id: 'up-2', title: '   ' },
  ];
  const assignments = [
    { id: 'asg-1', resourceId: 'up-1', resourceTitle: 'Our sleep handout', clientId: 'c1', clientName: 'Jane Doe', message: 'Try this', dueDate: '2026-10-30', assignedAt: '2026-10-01T10:00:00Z' },
    { id: 'asg-2', resourceId: 9, resourceTitle: 'SMART Recovery — Substance Use Workbook', clientId: 'c1', clientName: 'Jane Doe', message: '', dueDate: '', assignedAt: '2026-10-02T10:00:00Z' },
    { id: 'asg-3', resourceId: 9, resourceTitle: 'SMART Recovery — Substance Use Workbook', clientId: 'c2', clientName: 'John Roe' },
    { id: 'asg-4', resourceId: 'up-404', resourceTitle: 'Gone', clientId: 'c1', clientName: 'Jane Doe' },
    { id: 'asg-5', resourceId: 'up-1', resourceTitle: 'x', clientId: 'not-a-client', clientName: 'Other Org' },
    { id: 'asg-6', resourceId: 'up-1', clientId: 'c1' },
  ];
  const ctx = { clientIds: new Set(['c1', 'c2']), existingItemLegacyIds: new Set<string>(), existingAssignmentLegacyIds: new Set(['assignment:asg-6']) };
  const plan = planResourceBlobMigration(uploads, assignments, ctx);
  assert.equal(plan.counts.uploadsFound, 2);
  assert.equal(plan.counts.uploadsPlanned, 1);
  assert.equal(plan.counts.uploadsSkippedInvalid, 1);
  assert.equal(plan.counts.placeholdersPlanned, 1, 'one placeholder per distinct built-in id');
  assert.equal(plan.counts.assignmentsPlanned, 3);
  assert.equal(plan.counts.assignmentsSkippedUnknownResource, 1);
  assert.equal(plan.counts.assignmentsSkippedUnknownClient, 1);
  assert.equal(plan.counts.assignmentsAlreadyMigrated, 1);
  const upload = plan.items.find((i) => i.legacySourceId === 'upload:up-1')!;
  assert.equal(upload.status, 'draft');
  assert.equal(upload.summary, null, 'the old form default text is not treated as content');
  const placeholder = plan.items.find((i) => i.placeholder)!;
  assert.equal(placeholder.status, 'retired');
  assert.equal(placeholder.summary, null, 'nothing invented for the placeholder');
  // Client names never leave the blob
  assert.ok(!JSON.stringify(plan).includes('Jane Doe') && !JSON.stringify(plan).includes('John Roe'));
  assert.equal(plan.assignments.find((a) => a.legacySourceId === 'assignment:asg-2')!.dueDate, null);
  // Idempotent: re-planning with everything recorded plans nothing new
  const again = planResourceBlobMigration(uploads, assignments, {
    clientIds: ctx.clientIds,
    existingItemLegacyIds: new Set(plan.items.map((i) => i.legacySourceId)),
    existingAssignmentLegacyIds: new Set([...plan.assignments.map((a) => a.legacySourceId), 'assignment:asg-6']),
  });
  assert.equal(again.items.length, 0);
  assert.equal(again.assignments.length, 0);
  // The script is a dry run unless --apply, writes legacy rows as withdrawn / not delivered, and prints counts only
  const script = read('scripts/migrate-resource-library-blob.ts');
  assert.match(script, /const APPLY = args\.includes\('--apply'\)/);
  assert.match(script, /if \(!APPLY\) return counts;/);
  assert.match(script, /withdrawnReason: 'legacy_not_delivered'/);
  assert.doesNotMatch(script, /clientName/);
});

test('the old blobs are no longer readable by the browser', () => {
  assert.equal(canReadClinicModule('ADMIN', 'resource-assignments'), false);
  assert.equal(canReadClinicModule('THERAPIST', 'resource-uploads'), false);
  const page = read('src/app/dashboard/resources/page.tsx');
  assert.doesNotMatch(page, /useModuleList|resource-assignments|MD Behavioral Health Clinical Team/);
});

// ─── Seeds: only verified sources ───────────────────────────────────────────

const PHONEISH = /\b1-\d{3}-\d{3}-\d{4}\b|\b\d{3}-\d{3}-\d{4}\b|\b741741\b|\b988\b|\b211\b/g;

test('seeds: every seeded URL is in the verified list, and every phone / text number appears on its verified page', () => {
  assert.ok(SEED_ITEMS.length >= 40);
  const keys = new Set<string>();
  for (const s of SEED_ITEMS) {
    assert.ok(!keys.has(s.seedKey), `duplicate seedKey ${s.seedKey}`);
    keys.add(s.seedKey);
    const src = verifiedSource(s.url);
    assert.ok(src, `${s.seedKey}: ${s.url} is not in VERIFIED_SOURCES`);
    assert.equal(s.publisher, src!.publisher, `${s.seedKey}: publisher must be the verified publisher`);
    assert.ok(s.licenseNote && /Linked, not copied/.test(s.licenseNote), `${s.seedKey}: license note says it is linked, not copied`);
    for (const t of s.topics) assert.ok((TOPICS as readonly string[]).includes(t), `${s.seedKey}: unknown topic ${t}`);
    const text = [s.summary, s.contactPhone ?? '', s.contactText ?? '', s.title].join(' ');
    const numbers = (text.match(PHONEISH) ?? []).map((n) => n.replace(/^1-(?=\d{3}-\d{3}-\d{4}$)/, '1-'));
    const contacts = (src!.contacts ?? []).join(' ');
    for (const n of numbers) assert.ok(contacts.includes(n) || contacts.includes(`1-${n}`), `${s.seedKey}: ${n} is not a verified contact for ${s.url}`);
  }
  for (const r of REJECTED_CANDIDATES) assert.ok(!SEED_ITEMS.some((s) => s.url === r.url), `rejected candidate seeded: ${r.url}`);
  for (const v of VERIFIED_SOURCES) {
    assert.match(v.url, /^https:\/\//);
    assert.ok(v.evidence.length > 10 && v.checkedOn === '2026-10-20');
  }
  // Allowed publishers only (public-domain / openly published authoritative sources)
  const hosts = new Set(SEED_ITEMS.map((s) => new URL(s.url).host));
  for (const h of hosts) {
    assert.ok(
      ['988lifeline.org', 'www.crisistextline.org', 'www.samhsa.gov', 'findtreatment.gov', 'health.maryland.gov', '211md.org', 'www.nimh.nih.gov', 'www.ptsd.va.gov', 'www.cdc.gov', 'medlineplus.gov'].includes(h),
      `unexpected host ${h}`,
    );
  }
  // Required anchors are present
  const urls = new Set(SEED_ITEMS.map((s) => s.url));
  for (const u of ['https://988lifeline.org/', 'https://www.samhsa.gov/find-help/helplines/national-helpline', 'https://www.crisistextline.org/', 'https://211md.org/']) assert.ok(urls.has(u), `missing ${u}`);
  assert.equal(SEED_ITEMS.find((s) => s.seedKey === 'samhsa-national-helpline')!.contactPhone, '1-800-662-4357');
  assert.equal(SEED_ITEMS.find((s) => s.seedKey === 'crisis-text-line')!.contactText, 'Text HOME to 741741');
});

test('crisis lines and community seeds use verified numbers only', () => {
  for (const l of CRISIS_LINES) {
    if (l.key === '911') { assert.equal(l.href, 'tel:911'); continue; }
    const src = verifiedSource(l.url!);
    assert.ok(src, `${l.key}: ${l.url} unverified`);
    const digits = l.href.replace(/^tel:|^sms:/, '').replace(/\?.*$/, '').replace(/\D/g, '');
    const ok = (src!.contacts ?? []).some((c) => c.replace(/\D/g, '').endsWith(digits) || digits.endsWith(c.replace(/\D/g, '')));
    assert.ok(ok, `${l.key}: ${l.href} not on the verified page`);
  }
  for (const c of COMMUNITY_SEEDS) {
    assert.ok(verifiedSource(c.website), `${c.seedKey} website unverified`);
    assert.ok(verifiedSource(c.website)!.contacts!.includes(c.phone));
  }
});

// ─── Role access ────────────────────────────────────────────────────────────

test('role access: library, assign, manage, review and staff resources', () => {
  for (const r of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER', 'PEER_SUPPORT', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']) {
    assert.equal(canUseResourceLibrary(r), true, r);
    assert.equal(canAssignResources(r), true, r);
    assert.equal(canAccessPath(r, '/dashboard/resources'), true, `${r} page`);
  }
  for (const r of ['HR', 'BILLING', 'FRONT_DESK']) {
    assert.equal(canUseResourceLibrary(r), false, r);
    assert.equal(canAccessPath(r, '/dashboard/resources'), false, `${r} page`);
    assert.equal(canAccessPath(r, '/dashboard/resources/staff'), true, `${r} staff page`);
  }
  assert.equal(canAccessApiPath('HR', '/api/resources/assignments', 'GET'), false, 'HR never reaches assignment PHI');
  assert.equal(canUseResourceLibrary('OFFICE_MANAGER'), true);
  assert.equal(canAssignResources('OFFICE_MANAGER'), false, 'office manager curates but does not send to clients');
  assert.equal(canManageResources('OFFICE_MANAGER'), true);
  assert.equal(canReviewResources('OFFICE_MANAGER'), false, 'clinical review is clinicians only');
  assert.equal(canReviewResources('THERAPIST'), true);
  assert.equal(canManageResources('PEER_SUPPORT'), false);
  assert.equal(canManageStaffResources('HR'), true);
  assert.equal(canManageStaffResources('THERAPIST'), false);
  assert.equal(canSeeStaffItem('BILLING', []), true);
  assert.equal(canSeeStaffItem('BILLING', ['THERAPIST']), false);
  assert.equal(canSeeStaffItem('therapist', ['THERAPIST']), true);
  assert.equal(canSeeStaffItem('HR', ['THERAPIST']), true, 'managers see every staff item');
  assert.equal(canSeePatientItem('CASE_MANAGER', 'draft'), false, 'drafts only for content managers');
  assert.equal(canSeePatientItem('CASE_MANAGER', 'active'), true);
  assert.equal(canSeePatientItem('PSYCHIATRIST', 'draft'), true);
  // Staff routes check the role inside the store; assignment routes are audited
  const store = read('src/lib/resources/store.ts');
  assert.match(store, /if \(!canAssignResources\(actor\.role\)\)/);
  assert.match(store, /clientAccessWhere\(/);
  assert.match(store, /assertClientPhiAccess\(/);
});

// ─── Reports ────────────────────────────────────────────────────────────────

test('reports: registered, roles inside the library gate, and counts equal the underlying lists', () => {
  for (const id of ['resources-assigned', 'community-referrals']) {
    const r = REPORTS.find((x) => x.id === id);
    assert.ok(r, `${id} registered`);
    for (const role of r!.access.roles) if (!['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'MEDICAL_ASSISTANT', 'CRISIS_RESPONDER'].includes(role)) assert.ok((REPORT_LIBRARY_ROLES as string[]).includes(role), `${id}: ${role}`);
  }
  const d = (s: string) => new Date(s);
  const facts: AssignmentFact[] = [
    { id: '1', status: 'sent', topics: ['anxiety'], assignedById: 'u1', createdAt: d('2026-09-02T12:00:00Z') },
    { id: '2', status: 'viewed', topics: ['anxiety', 'sleep'], assignedById: 'u1', createdAt: d('2026-09-15T12:00:00Z') },
    { id: '3', status: 'completed', topics: ['sud_recovery'], assignedById: 'u2', createdAt: d('2026-10-01T12:00:00Z') },
    { id: '4', status: 'withdrawn', topics: [], assignedById: null, createdAt: d('2026-10-03T12:00:00Z') },
    { id: '5', status: 'completed', topics: ['sleep'], assignedById: 'u2', createdAt: d('2026-10-05T12:00:00Z') },
  ];
  for (const dim of ['clinician', 'month'] as const) {
    const agg = aggregateAssignments(facts, dim);
    assert.equal(agg.reduce((t, a) => t + a.assigned, 0), facts.length, `${dim}: assigned total = list length`);
    assert.equal(agg.reduce((t, a) => t + a.completed, 0), facts.filter((f) => f.status === 'completed').length);
    assert.equal(agg.reduce((t, a) => t + a.withdrawn, 0), 1);
    for (const a of agg) assert.equal(a.open + a.completed + a.withdrawn, a.assigned);
  }
  const byTopic = aggregateAssignments(facts, 'topic');
  const anxiety = byTopic.find((a) => a.key === 'anxiety')!;
  assert.equal(anxiety.assigned, facts.filter((f) => f.topics.includes('anxiety')).length);
  assert.equal(anxiety.viewed, 1);
  assert.equal(byTopic.find((a) => a.key === '')!.assigned, 1, 'no-topic bucket');
  const u2 = aggregateAssignments(facts, 'clinician').find((a) => a.key === 'u2')!;
  assert.equal(u2.completionRate, 100);

  const today = d('2026-10-20T12:00:00Z');
  const refs: ReferralFact[] = [
    { id: 'a', domain: 'food', status: 'open', referralType: 'referral_made', followUpDate: d('2026-10-10T00:00:00Z'), followUpCompletedAt: null, closeReason: null },
    { id: 'b', domain: 'food', status: 'closed', referralType: 'resource_given', followUpDate: null, followUpCompletedAt: null, closeReason: 'need_met' },
    { id: 'c', domain: 'housing_instability', status: 'connected', referralType: 'referral_made', followUpDate: d('2026-10-30T00:00:00Z'), followUpCompletedAt: null, closeReason: null },
    { id: 'e', domain: 'utilities', status: 'open', referralType: 'referral_made', followUpDate: null, followUpCompletedAt: null, closeReason: null },
  ];
  for (const dim of ['domain', 'followUp'] as const) {
    const agg = aggregateReferrals(refs, dim, today);
    assert.equal(agg.reduce((t, a) => t + a.referrals, 0), refs.length, `${dim}: total = list length`);
    assert.equal(agg.reduce((t, a) => t + a.closed, 0), 1);
    for (const a of agg) {
      assert.equal(a.resourceGiven + a.referralMade, a.referrals);
      assert.equal(a.open + a.connected + a.closed, a.referrals);
      assert.equal(a.followUpScheduled + a.followUpOverdue + a.followUpDone + a.noFollowUp, a.referrals);
    }
  }
  assert.equal(aggregateReferrals(refs, 'followUp', today).find((a) => a.key === 'overdue')!.referrals, 1);
  assert.equal(aggregateReferrals(refs, 'domain', today).find((a) => a.key === 'food')!.needMet, 1);
});

test('library helpers: search and recently used', () => {
  const it = { title: 'Healthy Sleep (MedlinePlus)', summary: 'Habits that support good sleep.', publisher: 'MedlinePlus', topics: ['sleep'] };
  assert.equal(matchesQuery(it, 'sleep medline', (t) => t), true);
  assert.equal(matchesQuery(it, 'diabetes', (t) => t), false);
  assert.equal(matchesQuery(it, '', (t) => t), true);
  assert.deepEqual(
    recentItemIds([
      { itemId: 'a', lastUsedAt: new Date('2026-10-01') },
      { itemId: 'b', lastUsedAt: null },
      { itemId: 'c', lastUsedAt: new Date('2026-10-05') },
    ]),
    ['c', 'a'],
  );
});

test('every resource API route is audited; uploads go to private storage served only by audited routes', () => {
  const files = [
    'src/app/api/resources/items/route.ts',
    'src/app/api/resources/items/[id]/route.ts',
    'src/app/api/resources/items/[id]/file/route.ts',
    'src/app/api/resources/items/[id]/used/route.ts',
    'src/app/api/resources/assignments/route.ts',
    'src/app/api/resources/assignments/[id]/route.ts',
    'src/app/api/resources/seed/route.ts',
  ];
  for (const f of files) {
    const src = read(f);
    if (/export async function (POST|PATCH|PUT)/.test(src) && !f.endsWith('favorite/route.ts')) assert.match(src, /auditPhiAccessResource\(/, `${f} audits writes`);
  }
  assert.match(read('src/app/api/resources/items/[id]/file/route.ts'), /RESOURCE_FILE_DOWNLOAD/);
  assert.match(read('src/app/api/resources/assignments/route.ts'), /RESOURCE_ASSIGN/);
  const storage = read('src/lib/storage/privateUploads.ts');
  assert.match(storage, /export function resourceFilePath/);
  assert.doesNotMatch(storage.match(/UPLOAD_KINDS = \[[^\]]*\]/)![0], /resource/, 'not an /api/files kind');
});
