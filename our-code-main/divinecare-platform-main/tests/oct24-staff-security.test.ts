import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateStaffPassword } from '../src/lib/security/passwordPolicy';

const root = join(__dirname, '..');
function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('staff-security-hardening', () => {
  it('password policy requires 12 chars and rejects weak patterns', () => {
    assert.equal(validateStaffPassword('short').ok, false);
    assert.equal(validateStaffPassword('aaaaaaaaaaaa').ok, false);
    const strong = validateStaffPassword('Qx9!mK2#vL8pNw', { email: 'a@b.com' });
    assert.equal(strong.ok, true, strong.error || 'expected strong password ok');
  });

  it('idle heartbeat never calls useSession().update({ activity: true })', () => {
    const guard = read('src/components/auth/IdleSessionGuard.tsx');
    assert.match(guard, /POST \/api\/auth\/session/);
    assert.match(guard, /activity:\s*true/);
    assert.match(guard, /Still there\?/);
    assert.match(guard, /Stay signed in/);
    assert.match(guard, /Sign out/);
    assert.doesNotMatch(guard, /useSession\(\)\.update\(\s*\{\s*activity:\s*true/);
    assert.doesNotMatch(guard, /\.update\(\s*\{\s*activity:\s*true/);
  });

  it('MFA copy and practice default mfaRequired', () => {
    const messages = read('src/lib/mfa/messages.ts');
    assert.match(messages, /Two-factor sign-in/);
    assert.match(messages, /6-digit code/);
    const practice = read('src/lib/mfa/practiceSetting.ts');
    assert.match(practice, /mfaRequired/);
    assert.match(practice, /true/);
  });
});

describe('caseload-access-consistency', () => {
  it('care-team deny copy and caseload-counts route exist', () => {
    const care = read('src/lib/clients/careTeam.ts');
    assert.match(care, /CARE_TEAM_CHANGE_DENIED/);
    assert.match(care, /Ask the primary clinician or leadership to change the care team/);
    const route = read('src/app/api/clients/[id]/care-team/route.ts');
    assert.match(route, /canChangeCareTeam/);
    const counts = read('src/app/api/clients/caseload-counts/route.ts');
    assert.match(counts, /caseload-counts/);
  });
});

describe('client-list-standard', () => {
  it('compact table 960px and letter bar', () => {
    const page = read('src/app/dashboard/clients/page.tsx');
    assert.match(page, /min-w-\[960px\]/);
    assert.match(page, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
    assert.match(page, /No clients match your filters|No clients in your clinic yet/);
  });
});

describe('visit-type-change', () => {
  it('API and locked/billed copy', () => {
    const lib = read('src/lib/appointments/visitType.ts');
    assert.match(lib, /The note is signed; the visit type is final/);
    assert.match(lib, /Visit already billed — use a charge correction/);
    const route = read('src/app/api/appointments/[id]/visit-type/route.ts');
    assert.match(route, /PATCH|GET/);
  });
});
