import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/** Admin "Edit email" on Users & Roles: changeStaffEmail rules (src/lib/staff/manage.ts). */
type Row = { id: string; email: string; name: string | null; role: string; status: string; passwordHash: string | null; organizationId: string };

function load(rows: Row[]) {
  const calls = { resend: [] as string[], notice: [] as { oldEmail: string; newEmail: string }[], audit: [] as any[], invalidated: [] as string[] };
  const serial = (r: Row) => ({
    ...r,
    roles: [],
    image: null,
    inviteExpiresAt: null,
    primaryLocationId: null,
    createdAt: new Date('2026-10-01'),
    rcopiaUsername: null,
    isMedicalDirector: false,
    medicalDirectorScope: null,
    primaryLocation: null,
  });
  const db = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        rows.find((r) => (where.id ? r.id === where.id : r.email === where.email)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => serial(rows.find((r) => r.id === where.id)!),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/requireSession') return { invalidateSessionUser: (u: string) => void calls.invalidated.push(u) };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: unknown) => void calls.audit.push(e) };
    if (id === '@/lib/org/locations') return { assignUserToLocation: async () => ({ ok: true }) };
    if (id === './invite')
      return {
        resendStaffInvite: async (u: string) => {
          calls.resend.push(u);
          return { ok: true, user: {}, emailMode: 'ses' };
        },
        sendEmailChangeNotice: async (n: { oldEmail: string; newEmail: string }) => void calls.notice.push(n),
      };
    return original.call(this, id, ...args);
  };
  try {
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve('../src/lib/staff/manage')];
    const mod = require('../src/lib/staff/manage') as typeof import('../src/lib/staff/manage');
    return { mod, calls };
  } finally {
    loader._load = original;
  }
}

const base = (o: Partial<Row>): Row => ({ id: 'u', email: 'x@altrixs.test', name: 'Pat', role: 'THERAPIST', status: 'ACTIVE', passwordHash: 'h', organizationId: 'org1', ...o });

test('invited user: email is changed (lowercased) and the invite is resent to the new address', async () => {
  const rows = [base({ id: 'u1', email: 'wrong@altrixs.test', status: 'INVITED', passwordHash: null })];
  const { mod, calls } = load(rows);
  const r = await mod.changeStaffEmail('u1', 'admin', 'org1', '  Right@Altrixs.test ');
  assert.equal(r.ok, true);
  assert.equal(rows[0].email, 'right@altrixs.test');
  assert.deepEqual(calls.resend, ['u1']);
  assert.equal(calls.notice.length, 0);
  assert.equal(calls.audit[0].action, 'STAFF_EMAIL_CHANGE');
  assert.equal(calls.audit[0].metadata.oldEmail, 'wrong@altrixs.test');
  assert.deepEqual(calls.invalidated, ['u1']);
});

test('active user: keeps password, both addresses are notified, no invite', async () => {
  const rows = [base({ id: 'u2', email: 'old@altrixs.test' })];
  const { mod, calls } = load(rows);
  const r = await mod.changeStaffEmail('u2', 'admin', 'org1', 'new@altrixs.test');
  assert.equal(r.ok, true);
  assert.equal(rows[0].passwordHash, 'h');
  assert.equal(calls.resend.length, 0);
  assert.deepEqual(calls.notice, [{ name: 'Pat', oldEmail: 'old@altrixs.test', newEmail: 'new@altrixs.test' }]);
});

test('refuses: email used by another account, own account, deactivated, other org, unchanged', async () => {
  const rows = [
    base({ id: 'a', email: 'a@altrixs.test' }),
    base({ id: 'b', email: 'b@altrixs.test' }),
    base({ id: 'd', email: 'd@altrixs.test', status: 'DEACTIVATED' }),
    base({ id: 'o', email: 'o@altrixs.test', organizationId: 'org2' }),
  ];
  const { mod, calls } = load(rows);
  const dup = await mod.changeStaffEmail('a', 'admin', 'org1', 'B@altrixs.test');
  assert.equal(dup.ok, false);
  assert.equal(!dup.ok && dup.status, 409);
  assert.equal((await mod.changeStaffEmail('a', 'a', 'org1', 'z@altrixs.test')).ok, false);
  assert.equal((await mod.changeStaffEmail('d', 'admin', 'org1', 'z@altrixs.test')).ok, false);
  const other = await mod.changeStaffEmail('o', 'admin', 'org1', 'z@altrixs.test');
  assert.equal(!other.ok && other.status, 404);
  assert.equal((await mod.changeStaffEmail('a', 'admin', 'org1', 'A@altrixs.test')).ok, false);
  assert.equal(rows[0].email, 'a@altrixs.test');
  assert.equal(calls.audit.length, 0);
});

test('admins can edit a staff member name: validated, audited, signed notes keep their snapshot', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/staff/[id]/route.ts'), 'utf8');
  const manage = fs.readFileSync(path.join(process.cwd(), 'src/lib/staff/manage.ts'), 'utf8');
  const modal = fs.readFileSync(path.join(process.cwd(), 'src/features/staff/components/ManageStaffModal.tsx'), 'utf8');
  assert.match(route, /name: z\.string\(\)\.trim\(\)\.min\(2/);
  assert.match(route, /requireFullAdmin/);
  assert.match(manage, /action: 'STAFF_NAME_CHANGE'/);
  assert.match(manage, /if \(input\.name !== undefined\)/);
  assert.match(modal, /htmlFor="staff-name"/);
  assert.match(modal, /signed keep the name they were signed with/);
});
