/**
 * 2026-10-22 owner: Office Manager is patient-side billing only (no denials queue, A/R, scrubber or
 * clearinghouse; see tests/office-manager-patient-billing.test.ts). Before that, OM was read-only
 * on claims (HIPAA minimum necessary; revenue-cycle separation of duties). Billing roles = ADMIN, DIRECTOR, PRACTICE_DIRECTOR, BILLING. Office Manager still reads
 * the denials queue, A/R, the claim scrubber snapshot and the clearinghouse page, but does not
 * change denial status, send a 276 claim status request, edit / submit / resubmit / re-scrub claims
 * or run ERA sync. Pages hide those controls with the same pure helpers (billingAccess.ts).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BILLING_STAFF_ONLY,
  canEditClaims,
  canReadDenials,
  canUpdateDenialStatus,
  canUpdateMedicalChargeStatus,
  isBillingCore,
  medicalChargeCreateScope,
} from '../src/lib/billing/billingAccess';
import { canAccessClaims, canMutateClaims } from '../src/lib/billing/claims';
import { canAccessDenials, canUpdateDenialStatus as ledgerCanUpdateDenialStatus } from '../src/lib/billing/ledger';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const CORE = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'] as const;
const OTHERS = ['OFFICE_MANAGER', 'FRONT_DESK', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP', 'HR'] as const;

// ─── Pure helpers ────────────────────────────────────────────────────────────

test('claim edits: billing core only; client helper matches the server helper', () => {
  for (const r of CORE) {
    assert.equal(canEditClaims(r), true, r);
    assert.equal(canMutateClaims(r), true, r);
  }
  for (const r of OTHERS) {
    assert.equal(canEditClaims(r), false, r);
    assert.equal(canMutateClaims(r as never), false, r);
  }
  for (const r of [...CORE, ...OTHERS, null, undefined, '']) {
    assert.equal(canEditClaims(r), canAccessClaims(r as never), String(r));
    assert.equal(canEditClaims(r), isBillingCore(r), String(r));
  }
});

test('denials: billing core reads and changes status; Office Manager neither (2026-10-22)', () => {
  for (const r of CORE) {
    assert.equal(canReadDenials(r), true, r);
    assert.equal(canUpdateDenialStatus(r), true, r);
  }
  assert.equal(canReadDenials('OFFICE_MANAGER'), false);
  assert.equal(canAccessDenials('OFFICE_MANAGER'), false, 'GET /api/billing/denials refuses OM (patient-side billing only)');
  assert.equal(canUpdateDenialStatus('OFFICE_MANAGER'), false);
  assert.equal(ledgerCanUpdateDenialStatus('OFFICE_MANAGER'), false);
  for (const r of ['FRONT_DESK', 'THERAPIST', 'PHYSICIAN', 'HR'] as const) {
    assert.equal(canReadDenials(r), false, r);
    assert.equal(canUpdateDenialStatus(r), false, r);
  }
});

test('medical charges: Mark Submitted is billing core; PHY / MNP create own charges only', () => {
  for (const r of ['PHYSICIAN', 'MEDICAL_NP', 'OFFICE_MANAGER'] as const) {
    assert.equal(canUpdateMedicalChargeStatus(r), false, r);
  }
  assert.equal(medicalChargeCreateScope('PHYSICIAN'), 'own_encounter');
  assert.equal(medicalChargeCreateScope('OFFICE_MANAGER'), null);
  for (const r of CORE) assert.equal(canUpdateMedicalChargeStatus(r), true, r);
});

// ─── Routes ──────────────────────────────────────────────────────────────────

test('denial status writes use canUpdateDenialStatus; GET keeps canAccessDenials', () => {
  const put = src('src/app/api/billing/denials/[id]/status/route.ts');
  assert.match(put, /if \(!canUpdateDenialStatus\(gate\.role\)/);
  assert.doesNotMatch(put, /canAccessDenials/);
  assert.match(put, /reason: 'cannot_update_denial_status'/, 'refusal is audited');
  assert.ok(put.indexOf('canUpdateDenialStatus(gate.role)') < put.indexOf('bodySchema.safeParse'), 'role check before the body is parsed');

  const r = src('src/app/api/billing/denials/route.ts');
  const get = r.slice(r.indexOf('export async function GET'), r.indexOf('const patchSchema'));
  const patch = r.slice(r.indexOf('export async function PATCH'));
  assert.match(get, /!canAccessDenials\(gate\.role\)/);
  assert.match(patch, /!canUpdateDenialStatus\(gate\.role\)/);
  assert.doesNotMatch(patch, /canAccessDenials/);
});

test('denial appeal drafting (Bedrock) is billing core only', () => {
  const s = src('src/app/api/billing/denials/appeal/route.ts');
  assert.match(s, /if \(!canUpdateDenialStatus\(gate\.role\)\)/);
  assert.ok(s.indexOf('canUpdateDenialStatus(gate.role)') < s.indexOf('schema.parse'), 'role check before the body is parsed');
});

test('276 claim status request has no Office Manager exception', () => {
  const s = src('src/lib/billing/waystarInbound/claimStatus.ts');
  const fn = s.slice(s.indexOf('export async function requestClaimStatus'));
  assert.match(fn.slice(0, 400), /if \(!canAccessClaims\(actor\.actorRole\)\) throw/);
  assert.doesNotMatch(fn.slice(0, 400), /OFFICE_MANAGER/);
});

// ─── Pages hide controls with the same helpers ───────────────────────────────

const IMPORTS_BILLING_ACCESS = /from '@\/lib\/billing\/billingAccess'/;
const IMPORTS_AUTH = /import \{ useAuth \} from '@\/features\/auth'/;

test('claim editor hides Save for roles that cannot PUT the claim', () => {
  const s = src('src/components/ClaimEditorModal.tsx');
  assert.match(s, IMPORTS_BILLING_ACCESS);
  assert.match(s, IMPORTS_AUTH);
  assert.match(s, /const readOnly = !onSubmit && !canEditClaims\(user\?\.role\)/);
  assert.match(s, /const canSave = !readOnly &&/);
  assert.match(s, /\{!readOnly && \(\s*<button\s+onClick=\{\(\) => void save\(\)\}/);
  assert.match(s, /BILLING_STAFF_ONLY/);
});

test('claim scrubber hides Re-Scrub All and Submit for read-only roles', () => {
  const s = src('src/app/dashboard/billing/claim-scrubber/page.tsx');
  assert.match(s, IMPORTS_BILLING_ACCESS);
  assert.match(s, /const canEdit = canEditClaims\(user\?\.role\)/);
  assert.match(s, /\{canEdit \? \(\s*<button[\s\S]*?Re-Scrub All/);
  assert.match(s, /\{canEdit && \(\s*<button[\s\S]*?Submit to Clearinghouse/);
});

test('A/R control hides Resubmit and Sync ERA; keeps Log Call / Send Statement', () => {
  const s = src('src/app/dashboard/billing/ar-control/page.tsx');
  assert.match(s, IMPORTS_BILLING_ACCESS);
  assert.match(s, /const canEdit = canEditClaims\(user\?\.role\)/);
  assert.match(s, /\{canEdit && \(\s*<button[\s\S]*?Sync ERA/);
  assert.match(s, /\{canEdit && \(\s*<button[\s\S]*?runAction\(row\.claimId, 'resubmit'\)/);
  const logCall = s.indexOf("runAction(row.claimId, 'log_call')");
  assert.ok(logCall > 0);
  assert.doesNotMatch(s.slice(logCall - 300, logCall), /canEdit &&/, 'Log Call stays for Office Manager');
});

test('denials page: Office Manager reads; status controls use canUpdateDenialStatus', () => {
  const s = src('src/app/dashboard/billing/denials/page.tsx');
  assert.match(s, IMPORTS_BILLING_ACCESS);
  assert.match(s, /const canChangeStatus = canUpdateDenialStatus\(user\?\.role\)/);
  assert.match(s, /\{canChangeStatus && <div className="flex gap-3 flex-wrap">/);
  assert.match(s, /\{canChangeStatus && showAppealModal && \(/);
  assert.match(s, /if \(!canChangeStatus\) return;/);
  assert.match(s, /setDenials\(before\)/, 'a refused update is rolled back, not shown as saved');
  assert.match(s, /fetch\('\/api\/billing\/denials'\)/, 'list still loads for every reader');
});

test('clearinghouse page hides retrieval, 276 request and ERA posting for read-only roles', () => {
  const s = src('src/app/dashboard/billing/clearinghouse/page.tsx');
  assert.match(s, IMPORTS_BILLING_ACCESS);
  assert.match(s, /const canEdit = canEditClaims\(user\?\.role\)/);
  assert.match(s, /\{canEdit \? \(\s*<button[\s\S]*?Retrieve now/);
  assert.match(s, /\{canEdit && \(\s*<button[\s\S]*?Request status from Waystar/);
  assert.match(s, /\{canEdit && <div className="mt-3 flex flex-wrap items-end gap-2">[\s\S]*?Post to claim/);
});

test('medical billing hides Mark Submitted for roles the charges PATCH refuses', () => {
  const s = src('src/app/dashboard/medical/billing/page.tsx');
  assert.match(s, IMPORTS_BILLING_ACCESS);
  assert.match(s, /const canMarkSubmitted = canUpdateMedicalChargeStatus\(user\?\.role\)/);
  assert.match(s, /claim\.status === 'Ready' && canMarkSubmitted \?/);
  assert.match(s, /\{canMarkSubmitted && \(\s*<button[\s\S]*?Mark Corrected Claim Resubmitted/);
  assert.match(s, /const canCreateCharge = medicalChargeCreateScope\(user\?\.role\) !== null/);
});

test('billingAccess stays client-safe (no prisma client value import, no server-only)', () => {
  const s = src('src/lib/billing/billingAccess.ts');
  assert.doesNotMatch(s, /^import ['"]server-only['"]/m);
  assert.doesNotMatch(s, /from ['"]@\/lib\/db\/prisma['"]/);
  assert.doesNotMatch(s, /^import \{[^}]*\} from ['"]@prisma\/client['"]/m);
  assert.equal(BILLING_STAFF_ONLY, 'Billing staff only');
});
