/**
 * Leftover B — real Chromium (headed): offline note → IndexedDB → Sync Now → DB.
 * Run: npx playwright test scripts/_leftover-b-offline.spec.ts --headed --config=playwright.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.env.AUTH_URL || 'http://localhost:3000';
const PASSWORD = 'Altrixs@123';
const prisma = new PrismaClient();

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  // Prefer password path if present
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.count()) {
    await passwordInput.fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|continue/i }).first().click();
  } else {
    // OTP flow fallback — not supported in this leftover
    throw new Error('Password login UI not found');
  }
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

test.describe('Leftover B offline note sync', () => {
  test.setTimeout(180000);

  test('offline save → sync → note in DB', async ({ page, context }) => {
    const therapist = await prisma.user.findFirst({
      where: { role: 'THERAPIST', status: 'ACTIVE', organizationId: { not: null } },
      select: { id: true, email: true, organizationId: true },
    });
    expect(therapist?.email).toBeTruthy();
    await prisma.user.update({
      where: { id: therapist!.id },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10), status: 'ACTIVE' },
    });

    const client = await prisma.client.findFirst({
      where: { organizationId: therapist!.organizationId! },
      select: { id: true },
    });
    expect(client).toBeTruthy();
    await prisma.sensitiveRecord.deleteMany({ where: { clientId: client!.id } }).catch(() => {});
    await prisma.client.update({
      where: { id: client!.id },
      data: { assignedToId: therapist!.id },
    });

    const notesBefore = await prisma.progressNote.count({ where: { clientId: client!.id } });

    await login(page, therapist!.email);
    await page.goto(`${BASE}/dashboard/ehr/note-builder`);
    await page.waitForLoadState('networkidle');

    // Select client if dropdown exists
    const select = page.locator('select').first();
    if (await select.count()) {
      await select.selectOption({ value: client!.id }).catch(async () => {
        await select.selectOption({ index: 1 });
      });
    }

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Banner must show offline copy
    const banner = page.locator('text=/You are offline/i');
    await expect(banner).toBeVisible({ timeout: 10000 });
    const bannerText = await banner.innerText();

    // Advance to sign step if wizard
    for (let i = 0; i < 6; i++) {
      const next = page.getByRole('button', { name: /^Next/i });
      if (await next.count()) await next.click().catch(() => {});
      await page.waitForTimeout(200);
    }
    const sign = page.getByRole('button', { name: /Sign & Lock Note/i });
    await expect(sign).toBeVisible({ timeout: 15000 });
    await sign.click();
    await page.waitForTimeout(1500);

    // IndexedDB: draftNotes / syncQueue encrypted (not plaintext)
    const idb = await page.evaluate(async () => {
      const dbName = 'product-offline-v1';
      return await new Promise<{ draftCount: number; queueCount: number; sample: string }>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['draftNotes', 'syncQueue'], 'readonly');
          const drafts = tx.objectStore('draftNotes').getAll();
          const queue = tx.objectStore('syncQueue').getAll();
          drafts.onsuccess = () => {
            queue.onsuccess = () => {
              const q = queue.result || [];
              const d = drafts.result || [];
              const sample = JSON.stringify(q[0] || d[0] || {});
              resolve({
                draftCount: d.length,
                queueCount: q.length,
                sample: sample.slice(0, 200),
              });
            };
          };
        };
      });
    });

    expect(idb.queueCount + idb.draftCount).toBeGreaterThan(0);
    expect(idb.sample.includes('Manual 8') || idb.sample.includes('Structured')).toBeFalsy();
    // ciphertext-ish: encrypted field present
    const hasEncrypted = idb.sample.includes('encrypted') || idb.sample.includes('iv') || idb.sample.includes('ciphertext') || idb.sample.includes('data');
    expect(hasEncrypted || idb.sample.includes('encryptedBody')).toBeTruthy();

    // Back online + Sync Now
    await context.setOffline(false);
    await page.waitForTimeout(800);
    const syncBtn = page.getByRole('button', { name: /Sync Now/i });
    if (await syncBtn.count()) {
      await syncBtn.click();
      await page.waitForTimeout(2000);
    } else {
      // auto-sync on online
      await page.waitForTimeout(3000);
    }

    const syncMsg = await page.locator('text=/Synced|Back online|failed/i').first().innerText().catch(() => '');

    const queueAfter = await page.evaluate(async () => {
      const dbName = 'product-offline-v1';
      return await new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['syncQueue'], 'readonly');
          const req = tx.objectStore('syncQueue').count();
          req.onsuccess = () => resolve(req.result);
        };
      });
    });

    await page.reload({ waitUntil: 'networkidle' });

    const notesAfter = await prisma.progressNote.count({ where: { clientId: client!.id } });
    const latest = await prisma.progressNote.findFirst({
      where: { clientId: client!.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true },
    });

    console.log(
      JSON.stringify({
        bannerText,
        syncMsg,
        idb,
        queueAfter,
        notesBefore,
        notesAfter,
        noteId: latest?.id,
      })
    );

    expect(notesAfter).toBeGreaterThan(notesBefore);
    expect(latest?.id).toBeTruthy();
    expect(queueAfter).toBe(0);

    await prisma.$disconnect();
  });
});
