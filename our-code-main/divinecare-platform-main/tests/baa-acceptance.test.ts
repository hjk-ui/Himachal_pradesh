import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  BAA_DRAFT_BANNER,
  BAA_LEGAL_REVIEWED,
  BAA_MISSING_SIGNER,
  BAA_MUST_ACCEPT,
  BAA_REQUIRED_CODE,
  BAA_TITLE,
  BAA_VERSION,
  baaAttestation,
  baaTextSha256,
} from '../src/lib/legal/baa';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('baa-acceptance', () => {
  it('draft version and attestation copy', () => {
    assert.equal(BAA_VERSION, '2026-10-26-draft');
    assert.equal(BAA_LEGAL_REVIEWED, false);
    assert.equal(BAA_TITLE, 'Altrixs Business Associate Agreement');
    assert.equal(BAA_DRAFT_BANNER, 'Draft — pending legal review');
    assert.match(baaAttestation('Acme Clinic'), /I am authorized to sign for Acme Clinic/);
    assert.match(baaAttestation('Acme Clinic'), new RegExp(BAA_VERSION));
    assert.equal(baaTextSha256().length, 64);
    assert.equal(BAA_REQUIRED_CODE, 'BAA_REQUIRED');
    assert.match(BAA_MUST_ACCEPT, /must accept/);
    assert.match(BAA_MISSING_SIGNER, /Signer name, title and email/);
  });

  it('register and admin routes require acceptance', () => {
    const register = read('src/app/api/auth/register/route.ts');
    assert.match(register, /BAA_REQUIRED/);
    assert.match(register, /baaAcceptance\.create/);
    const admin = read('src/app/api/admin/baa/route.ts');
    assert.match(admin, /PRACTICE_DIRECTOR/);
    assert.match(admin, /via:\s*'admin'/);
    const getStarted = read('src/app/get-started/page.tsx');
    assert.match(getStarted, /4\. Business Associate Agreement/);
    const legal = read('src/app/legal/baa/page.tsx');
    assert.match(legal, /BAA_DRAFT_BANNER/);
  });
});
