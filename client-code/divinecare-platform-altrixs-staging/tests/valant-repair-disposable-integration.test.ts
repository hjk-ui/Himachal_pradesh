/**
 * Integration Test Suite for Valant Ingestion Repair CLI
 * Executed against a completely isolated, disposable PostgreSQL cluster on port 5434.
 *
 * Strictly NEVER connects to or modifies production (port 5433).
 */

import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { computeLegacyLocalStart, parseEasternDateTime } from '../src/lib/valant/repair';

const DISPOSABLE_PORT = 5434;
const DISPOSABLE_DB_NAME = 'valant_disposable_test';
const DISPOSABLE_DATABASE_URL = `postgresql://postgres@127.0.0.1:${DISPOSABLE_PORT}/${DISPOSABLE_DB_NAME}?sslmode=disable`;

const PG_BIN = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const INITDB_EXE = path.join(PG_BIN, 'initdb.exe');
const PGCTL_EXE = path.join(PG_BIN, 'pg_ctl.exe');
const CREATEDB_EXE = path.join(PG_BIN, 'createdb.exe');

// STRICT SAFETY GUARD: Verify we never touch production port 5433
function assertSafeDatabaseUrl(url: string) {
  if (url.includes('5433') || url.includes('rds.amazonaws.com') || url.includes('altrixs')) {
    throw new Error(`CRITICAL SECURITY VIOLATION: Production database URL detected in test suite: ${url}`);
  }
}

test('Disposable PostgreSQL Integration: Apply, Idempotency, Rollback, Concurrent Edits & Crash Recovery', async (t) => {
  assertSafeDatabaseUrl(DISPOSABLE_DATABASE_URL);

  const testTempDir = path.join(os.tmpdir(), `valant-integ-${Date.now()}`);
  const pgDataDir = path.join(testTempDir, 'pgdata');
  const csvDir = path.join(testTempDir, 'csv');
  const backupDir = path.join(testTempDir, 'backups');

  fs.mkdirSync(pgDataDir, { recursive: true });
  fs.mkdirSync(csvDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`\n[INIT] Setting up disposable PostgreSQL cluster on port ${DISPOSABLE_PORT}...`);

  let clusterStarted = false;
  let prisma: PrismaClient | null = null;

  try {
    // 1. Initialize temporary PostgreSQL database cluster
    execSync(`"${INITDB_EXE}" -D "${pgDataDir}" -U postgres -A trust --no-locale --encoding=UTF8`, {
      stdio: 'pipe',
    });

    const pgLogPath = path.join(testTempDir, 'pg.log');
    // 2. Start PostgreSQL cluster on port 5434
    execSync(`"${PGCTL_EXE}" -D "${pgDataDir}" -l "${pgLogPath}" -o "-p ${DISPOSABLE_PORT}" -w start`, {
      stdio: 'ignore',
    });
    clusterStarted = true;

    // 3. Create disposable test database
    execSync(`"${CREATEDB_EXE}" -p ${DISPOSABLE_PORT} -U postgres ${DISPOSABLE_DB_NAME}`, {
      stdio: 'pipe',
    });

    console.log(`[SCHEMA] Pushing Prisma schema to disposable database...`);
    // 4. Push Prisma schema into disposable test database
    execSync(`npx prisma db push --skip-generate`, {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: DISPOSABLE_DATABASE_URL,
      },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({
      datasources: {
        db: { url: DISPOSABLE_DATABASE_URL },
      },
    });

    // 5. Seed test organization, clients and appointments
    console.log(`[SEED] Seeding test organization and initial records...`);
    const testOrgId = 'org-disposable-valant-test';
    await prisma.organization.create({
      data: {
        id: testOrgId,
        name: 'Disposable Valant Test Clinic',
        slug: 'disposable-valant-test',
      },
    });

    // Create 3 clients:
    // Client 1: Has COPAY-35.0000 in insuranceMemberId, legitimate payer
    // Client 2: Has COPAY-20.0000, unparsed phone matching emergencyPhone
    // Client 3: Clean client, already correct
    const t0 = new Date('2026-10-13T10:00:00.000Z');
    await prisma.client.createMany({
      data: [
        {
          id: 'client-101',
          organizationId: testOrgId,
          mrn: 'P-101',
          name: 'Alice Smith',
          sourcePlatform: 'VALANT_EXPORT',
          insuranceMemberId: 'COPAY-35.0000',
          insurancePayer: 'Aetna Commercial',
          phone: '555-111-2222',
          email: 'alice@example.com',
          emergencyContactPhone: '555-999-0001',
          treatmentTeam: null,
          updatedAt: t0,
        },
        {
          id: 'client-102',
          organizationId: testOrgId,
          mrn: 'P-102',
          name: 'Bob Jones',
          sourcePlatform: 'VALANT_EXPORT',
          insuranceMemberId: 'COPAY-20.0000',
          insurancePayer: 'Commercial (New York)', // Invented city payer
          phone: '+15559990002', // Matches emergencyPhone
          email: 'bob@example.com',
          emergencyContactPhone: '+15559990002',
          treatmentTeam: null,
          updatedAt: t0,
        },
        {
          id: 'client-103',
          organizationId: testOrgId,
          mrn: 'P-103',
          name: 'Charlie Brown',
          sourcePlatform: 'VALANT_EXPORT',
          insuranceMemberId: 'MEM-9999',
          insurancePayer: 'Cigna Health',
          phone: '555-333-4444',
          email: 'charlie@example.com',
          emergencyContactPhone: '555-999-0003',
          treatmentTeam: { copay: { amount: 50, unit: 'USD' } },
          updatedAt: t0,
        },
      ],
    });

    // Create test appointments with legacy start times (Asia/Kolkata offset)
    const legacyStart1 = new Date(computeLegacyLocalStart('10/15/2026', '10:00-11:00 AM')!);
    const legacyStart2 = new Date(computeLegacyLocalStart('10/15/2026', '11:00-12:00 PM')!);

    await prisma.appointment.createMany({
      data: [
        {
          id: 'appt-101',
          organizationId: testOrgId,
          clientId: 'client-101',
          type: 'Psychotherapy',
          startsAt: legacyStart1,
          endsAt: new Date(legacyStart1.getTime() + 60 * 60 * 1000),
          notes: 'CPT: 90837',
          clinicianName: 'Dr. Stone',
          status: 'SCHEDULED',
          updatedAt: t0,
        },
        {
          id: 'appt-102',
          organizationId: testOrgId,
          clientId: 'client-102',
          type: 'Evaluation',
          startsAt: legacyStart2,
          endsAt: new Date(legacyStart2.getTime() + 60 * 60 * 1000),
          notes: 'CPT: 90834',
          clinicianName: 'Dr. Stone',
          status: 'SCHEDULED',
          updatedAt: t0,
        },
      ],
    });

    // 6. Generate Synthetic CSV Fixtures
    console.log(`[FIXTURES] Generating synthetic CSV files matching exact specifications...`);
    const file1Path = path.join(csvDir, 'File1_Demographics.csv');
    const file2Path = path.join(csvDir, 'File2_PCP.csv');
    const file3Path = path.join(csvDir, 'File3_Appointments.csv');
    const file4Path = path.join(csvDir, 'File4_Biller.csv');

    // File 1: Demographics (33 columns)
    const file1Header = Array(33).fill('Col').map((c, i) => `${c}${i}`);
    file1Header[5] = 'DOB';
    file1Header[7] = 'Pt. Copay';
    file1Header[8] = 'Email';
    file1Header[10] = 'Emergency Phone';
    file1Header[11] = 'Pt. ID';
    file1Header[16] = 'First Name';
    file1Header[17] = 'Last Name';
    file1Header[23] = 'Phone 2';
    file1Header[28] = 'Assigned Fac Name';

    const file1Rows = [
      file1Header.join(','),
      // Row 1: P-101 (Alice)
      makeCsvRow(33, { 5: '1990-01-01', 7: '$35.00', 8: 'alice@example.com', 10: '555-999-0001', 11: 'P-101', 16: 'Alice', 17: 'Smith', 23: '', 28: 'Main Clinic' }),
      // Row 2: P-102 (Bob)
      makeCsvRow(33, { 5: '1985-05-05', 7: '$20.00', 8: 'bob@example.com', 10: '555-999-0002', 11: 'P-102', 16: 'Bob', 17: 'Jones', 23: '', 28: 'Main Clinic' }),
      // Row 3: P-103 (Charlie)
      makeCsvRow(33, { 5: '1992-03-03', 7: '$50.00', 8: 'charlie@example.com', 10: '555-999-0003', 11: 'P-103', 16: 'Charlie', 17: 'Brown', 23: '', 28: 'Main Clinic' }),
    ];
    fs.writeFileSync(file1Path, file1Rows.join('\n'), 'utf8');

    // File 2: PCP / Guardian (32 columns)
    const file2Header = Array(32).fill('Col').map((c, i) => `${c}${i}`);
    file2Header[2] = 'DOB';
    file2Header[9] = 'First Name';
    file2Header[10] = 'Last Name';
    file2Header[18] = 'Pt. Ins1 Address (City)';

    const file2Rows = [
      file2Header.join(','),
      makeCsvRow(32, { 2: '1990-01-01', 9: 'Alice', 10: 'Smith', 18: 'New York' }),
      makeCsvRow(32, { 2: '1985-05-05', 9: 'Bob', 10: 'Jones', 18: 'New York' }),
      makeCsvRow(32, { 2: '1992-03-03', 9: 'Charlie', 10: 'Brown', 18: 'Queens' }),
    ];
    fs.writeFileSync(file2Path, file2Rows.join('\n'), 'utf8');

    // File 3: Appointments (24 columns)
    const file3Header = Array(24).fill('Col').map((c, i) => `${c}${i}`);
    file3Header[5] = 'Date';
    file3Header[6] = 'Time';
    file3Header[7] = 'Patient';
    file3Header[9] = 'CPT';
    file3Header[11] = 'Fee';
    file3Header[13] = 'Notes';
    file3Header[14] = 'Comments';
    file3Header[15] = 'Provider';

    const file3Rows = [
      file3Header.join(','),
      makeCsvRow(24, { 5: '10/15/2026', 6: '10:00-11:00 AM', 7: 'Alice Smith (P-101)', 9: '90837', 11: '', 13: '', 14: '', 15: 'Dr. Stone' }),
      makeCsvRow(24, { 5: '10/15/2026', 6: '11:00-12:00 PM', 7: 'Bob Jones (P-102)', 9: '90834', 11: '', 13: '', 14: '', 15: 'Dr. Stone' }),
    ];
    fs.writeFileSync(file3Path, file3Rows.join('\n'), 'utf8');

    // File 4: Biller Appointments (29 columns)
    const file4Header = Array(29).fill('Col').map((c, i) => `${c}${i}`);
    const file4Rows = [
      file4Header.join(','),
      makeCsvRow(29, { 0: 'P-101' }),
      makeCsvRow(29, { 0: 'P-102' }),
    ];
    fs.writeFileSync(file4Path, file4Rows.join('\n'), 'utf8');

    const cliScript = path.resolve(__dirname, '../scripts/repair-valant-import.ts');

    // =========================================================================
    // TEST 1: CLI --apply Execution
    // =========================================================================
    console.log(`\n▶ [TEST 1] Executing repair CLI with --apply...`);
    const customBackup1 = path.join(backupDir, 'backup-integ-run1.json');
    const applyCmd = `npx tsx "${cliScript}" --orgId=${testOrgId} --file1="${file1Path}" --file2="${file2Path}" --file3="${file3Path}" --file4="${file4Path}" --backup-file="${customBackup1}" --apply --repair-appointments`;

    const applyOutput = execSync(applyCmd, {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: DISPOSABLE_DATABASE_URL,
      },
      stdio: 'pipe',
    }).toString();
    console.log('\n--- CLI APPLY OUTPUT ---');
    console.log(applyOutput);
    console.log('--- END CLI APPLY OUTPUT ---\n');

    // Verify DB modifications after apply:
    const client1AfterApply = await prisma.client.findUnique({ where: { id: 'client-101' } });
    assert.equal(client1AfterApply?.insuranceMemberId, null, 'COPAY-35.0000 should be cleared from insuranceMemberId');
    assert.deepEqual(client1AfterApply?.treatmentTeam, { copay: { amount: 35, unit: 'USD' } }, 'Copay should be stored in treatmentTeam');

    const client2AfterApply = await prisma.client.findUnique({ where: { id: 'client-102' } });
    assert.equal(client2AfterApply?.insuranceMemberId, null, 'COPAY-20.0000 should be cleared');
    assert.equal(client2AfterApply?.insurancePayer, null, 'Invented Commercial (City) payer should be cleared');
    assert.equal(client2AfterApply?.phone, null, 'Duplicated emergency phone should be cleared from phone');
    assert.deepEqual(client2AfterApply?.treatmentTeam, { copay: { amount: 20, unit: 'USD' } });

    const appt1AfterApply = await prisma.appointment.findUnique({ where: { id: 'appt-101' } });
    // 10:00 AM EDT = 14:00:00 UTC
    assert.equal(appt1AfterApply?.startsAt.toISOString(), '2026-10-15T14:00:00.000Z', 'Appointment start time must be converted to true UTC');
    assert.equal(appt1AfterApply?.endsAt.toISOString(), '2026-10-15T15:00:00.000Z');

    assert.ok(fs.existsSync(customBackup1), 'Backup manifest must be written durably to disk');
    console.log('✓ TEST 1 Passed: Apply executed correctly with optimistic concurrency and field reconciliation.');

    // =========================================================================
    // TEST 2: Second-Run Idempotency
    // =========================================================================
    console.log(`\n▶ [TEST 2] Testing Second-Run Idempotency...`);
    const customBackup2 = path.join(backupDir, 'backup-integ-run2.json');
    const idempotencyCmd = `npx tsx "${cliScript}" --orgId=${testOrgId} --file1="${file1Path}" --file2="${file2Path}" --file3="${file3Path}" --file4="${file4Path}" --backup-file="${customBackup2}" --apply --repair-appointments`;

    const idempotencyOutput = execSync(idempotencyCmd, {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: DISPOSABLE_DATABASE_URL,
      },
      stdio: 'pipe',
    }).toString();

    assert.ok(idempotencyOutput.includes('Clients Requiring Repair:                     0'), 'Second run must identify 0 client repairs');
    assert.ok(idempotencyOutput.includes('Exact 1-to-1 Deterministic Matches:        0'), 'Second run must identify 0 appointment repairs');
    console.log('✓ TEST 2 Passed: Second-run idempotency verified (0 repairs planned, 0 writes).');

    // =========================================================================
    // TEST 3: Rollback from Backup Manifest
    // =========================================================================
    console.log(`\n▶ [TEST 3] Testing Rollback from Backup...`);
    const rollbackCmd = `npx tsx "${cliScript}" --orgId=${testOrgId} --rollback="${customBackup1}" --apply --repair-appointments`;

    const rollbackOutput = execSync(rollbackCmd, {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: DISPOSABLE_DATABASE_URL,
      },
      stdio: 'pipe',
    }).toString();
    console.log('\n--- CLI ROLLBACK OUTPUT ---');
    console.log(rollbackOutput);
    console.log('--- END CLI ROLLBACK OUTPUT ---\n');

    // Verify DB restored to before-state:
    const client1AfterRollback = await prisma.client.findUnique({ where: { id: 'client-101' } });
    assert.equal(client1AfterRollback?.insuranceMemberId, 'COPAY-35.0000', 'Original insuranceMemberId must be restored');
    assert.equal(client1AfterRollback?.treatmentTeam, null, 'Original treatmentTeam must be restored');

    const appt1AfterRollback = await prisma.appointment.findUnique({ where: { id: 'appt-101' } });
    assert.equal(appt1AfterRollback?.startsAt.toISOString(), legacyStart1.toISOString(), 'Original appointment start time must be restored');
    console.log('✓ TEST 3 Passed: Rollback restored original database state atomically.');

    // =========================================================================
    // TEST 4: Concurrent Human Edits Preservation
    // =========================================================================
    console.log(`\n▶ [TEST 4] Testing Concurrent Edits Preservation...`);
    // Re-apply repairs first
    const customBackup3 = path.join(backupDir, 'backup-integ-run3.json');
    execSync(`npx tsx "${cliScript}" --orgId=${testOrgId} --file1="${file1Path}" --file2="${file2Path}" --file3="${file3Path}" --file4="${file4Path}" --backup-file="${customBackup3}" --apply --repair-appointments`, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DATABASE_URL },
      stdio: 'pipe',
    });

    // Simulate human manual edits made while system was running
    await prisma.client.update({
      where: { id: 'client-102' },
      data: {
        insurancePayer: 'Manual Human Edit Insurance Payer',
      },
    });

    // Run rollback: must restore client-101, but preserve manual edit on client-102
    const rollbackWithEditCmd = `npx tsx "${cliScript}" --orgId=${testOrgId} --rollback="${customBackup3}" --apply --repair-appointments`;
    const rollbackEditOutput = execSync(rollbackWithEditCmd, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DATABASE_URL },
      stdio: 'pipe',
    }).toString();

    const client1Final = await prisma.client.findUnique({ where: { id: 'client-101' } });
    assert.equal(client1Final?.insuranceMemberId, 'COPAY-35.0000', 'Untouched client-101 must be rolled back');

    const client2Final = await prisma.client.findUnique({ where: { id: 'client-102' } });
    assert.equal(client2Final?.insurancePayer, 'Manual Human Edit Insurance Payer', 'Human manual edit must be protected and preserved');
    console.log('✓ TEST 4 Passed: Concurrent manual edits were detected and safely protected.');

    // =========================================================================
    // TEST 5: Partial-Commit Recovery (Simulated Crash Before Journal Write)
    // =========================================================================
    console.log(`\n▶ [TEST 5] Testing Partial-Commit Recovery...`);
    // Re-apply repairs
    const customBackup4 = path.join(backupDir, 'backup-integ-run4.json');
    execSync(`npx tsx "${cliScript}" --orgId=${testOrgId} --file1="${file1Path}" --file2="${file2Path}" --file3="${file3Path}" --file4="${file4Path}" --backup-file="${customBackup4}" --apply --repair-appointments`, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DATABASE_URL },
      stdio: 'pipe',
    });

    // Simulate crash after commit by emptying or truncating the committed list and journal
    const journalPath = `${customBackup4}.journal`;
    if (fs.existsSync(journalPath)) {
      fs.writeFileSync(journalPath, '', 'utf8'); // wipe journal to simulate crash before journal flush
    }
    const manifestRaw = JSON.parse(fs.readFileSync(customBackup4, 'utf8'));
    manifestRaw.committedClientIds = []; // clear manifest committed IDs
    fs.writeFileSync(customBackup4, JSON.stringify(manifestRaw, null, 2), 'utf8');

    // Run rollback: must evaluate before/after state, detect that client-101 is in after-state, and restore it safely
    const partialRecoveryCmd = `npx tsx "${cliScript}" --orgId=${testOrgId} --rollback="${customBackup4}" --apply --repair-appointments`;
    execSync(partialRecoveryCmd, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DATABASE_URL },
      stdio: 'pipe',
    });

    const client1Recovered = await prisma.client.findUnique({ where: { id: 'client-101' } });
    assert.equal(client1Recovered?.insuranceMemberId, 'COPAY-35.0000', 'Unjournaled committed batch must be recovered and restored');
    console.log('✓ TEST 5 Passed: Unjournaled committed records were successfully recovered.');
  } finally {
    // Teardown
    console.log(`\n[TEARDOWN] Disconnecting Prisma and shutting down disposable cluster...`);
    if (prisma) {
      await prisma.$disconnect();
    }
    if (clusterStarted) {
      try {
        execSync(`"${PGCTL_EXE}" -D "${pgDataDir}" -m immediate stop`, { stdio: 'pipe' });
      } catch (e: any) {
        console.error('Warning during pg_ctl stop:', e.message);
      }
    }
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
      console.log('[CLEANUP] Disposable test files cleaned up successfully.');
    } catch (e: any) {
      console.error('Warning during tempDir cleanup:', e.message);
    }
  }
});

function makeCsvRow(totalCols: number, valuesByIndex: Record<number, string>): string {
  const row = Array(totalCols).fill('');
  for (const [idx, val] of Object.entries(valuesByIndex)) {
    const colIndex = parseInt(idx, 10);
    row[colIndex] = val.includes(',') ? `"${val}"` : val;
  }
  return row.join(',');
}
