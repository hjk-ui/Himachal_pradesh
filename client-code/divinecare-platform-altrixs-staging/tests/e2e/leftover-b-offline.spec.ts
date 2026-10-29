/**
 * Leftover B — Chromium headed: Offline → encrypted IndexedDB → Sync Now → DB note.
 * Uses navigator.onLine + API abort (not context.setOffline) so Chrome does not
 * replace the SPA with ERR_INTERNET_DISCONNECTED / dino interstitial.
 */
import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.env.PLAYWRIGHT_BASE_URL || process.env.AUTH_URL || 'http://localhost:3000';
const PASSWORD = 'Altrixs@123';
/**
 * This spec WRITES to the database it reaches through DATABASE_URL (resets a therapist password,
 * deletes the client's SensitiveRecord rows, updates the client, creates notes). It refuses to run
 * unless explicitly allowed AND the database is clearly a local / test one.
 */
const DB_URL = process.env.DATABASE_URL || '';
const DB_MUTATION_ALLOWED =
  process.env.E2E_ALLOW_DB_MUTATION === '1' && (DB_URL.includes('localhost') || DB_URL.includes('test'));
const DB_MUTATION_REFUSAL =
  'Refusing to run: this spec mutates the database. Set E2E_ALLOW_DB_MUTATION=1 and point DATABASE_URL at a localhost or test database.';
if (!DB_MUTATION_ALLOWED) console.warn(`[leftover-b-offline] ${DB_MUTATION_REFUSAL}`);
// No client (and no connection) unless allowed.
const prisma = (DB_MUTATION_ALLOWED ? new PrismaClient() : null) as PrismaClient;

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="staff-password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /Sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 90000 });
}

async function setAppOffline(page: Page, offline: boolean) {
  if (offline) {
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  } else {
    await page.unroute('**/api/**');
  }
  await page.evaluate((isOffline) => {
    try {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => !isOffline,
      });
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(isOffline ? 'offline' : 'online'));
  }, offline);
}

test.describe('Leftover B offline note sync', () => {
  test.skip(!DB_MUTATION_ALLOWED, DB_MUTATION_REFUSAL);
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

    const marker = `OFFLINE-SYNC-${Date.now()}`;
    const notesBefore = await prisma.progressNote.count({ where: { clientId: client!.id } });

    await login(page, therapist!.email!);

    // Unregister SW so offline fetch handlers cannot force a document failure
    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return;
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    });

    await page.waitForTimeout(1000);

    await page.goto(`${BASE}/dashboard/ehr/note-builder`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    const select = page.locator('select').first();
    if (await select.count()) {
      try {
        await select.selectOption({ value: client!.id });
      } catch {
        await select.selectOption({ index: 1 });
      }
    }
    const textareas = page.locator('textarea');
    if (await textareas.count()) {
      await textareas.first().fill(marker);
    }

    await setAppOffline(page, true);
    await page.waitForTimeout(1500);

    const banner = page.getByText(/You are offline/i);
    await expect(banner).toBeVisible({ timeout: 20000 });
    const bannerText = (await banner.innerText()).trim();

    for (let i = 0; i < 8; i++) {
      const next = page.getByRole('button', { name: /^Next/i });
      if ((await next.count()) && (await next.isEnabled())) {
        await next.click();
        await page.waitForTimeout(250);
      }
    }

    const sign = page.getByRole('button', { name: /Sign & Lock Note/i });
    await expect(sign).toBeVisible({ timeout: 20000 });
    await sign.click();
    await page.waitForTimeout(2500);

    const idb = await page.evaluate(async () => {
      const dbName = 'product-offline-v1';
      return await new Promise<{
        draftCount: number;
        queueCount: number;
        sample: string;
        plaintextLeak: boolean;
      }>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error || new Error('idb open failed'));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('syncQueue')) {
            resolve({ draftCount: 0, queueCount: 0, sample: '', plaintextLeak: false });
            return;
          }
          const tx = db.transaction(
            ['draftNotes', 'syncQueue'].filter((n) => db.objectStoreNames.contains(n)),
            'readonly'
          );
          const draftsReq = db.objectStoreNames.contains('draftNotes')
            ? tx.objectStore('draftNotes').getAll()
            : ({ result: [] } as IDBRequest);
          const queueReq = tx.objectStore('syncQueue').getAll();
          const finish = () => {
            const q = (queueReq as IDBRequest).result || [];
            const d =
              draftsReq && 'result' in draftsReq ? (draftsReq as IDBRequest).result || [] : [];
            const sample = JSON.stringify(q[0] || d[0] || {});
            const plaintextLeak =
              /OFFLINE-SYNC-|Structured session note|chiefComplaint/i.test(sample) &&
              !/encryptedBody|encrypted/.test(sample);
            resolve({
              draftCount: d.length,
              queueCount: q.length,
              sample: sample.slice(0, 240),
              plaintextLeak,
            });
          };
          if (draftsReq && 'onsuccess' in draftsReq) {
            (draftsReq as IDBRequest).onsuccess = () => {
              (queueReq as IDBRequest).onsuccess = finish;
            };
          } else {
            (queueReq as IDBRequest).onsuccess = finish;
          }
        };
      });
    });

    expect(idb.queueCount + idb.draftCount).toBeGreaterThan(0);
    expect(idb.plaintextLeak).toBeFalsy();
    expect(idb.sample).toMatch(/encrypted|encryptedBody|iv/i);

    await setAppOffline(page, false);
    await page.waitForTimeout(1500);

    // Dismiss Next.js issues overlay if it steals clicks / matches loose text
    await page.keyboard.press('Escape').catch(() => {});

    const syncBtn = page.getByRole('button', { name: /^Sync Now$/i });
    let syncMsg = '';
    if (await syncBtn.isVisible().catch(() => false)) {
      await syncBtn.click();
      await page.waitForTimeout(4000);
      syncMsg = await page
        .locator('text=/^Synced \\d+/')
        .first()
        .innerText()
        .catch(() => '');
    } else {
      await page.waitForTimeout(5000);
      syncMsg = await page
        .locator('text=/^Synced \\d+|Back online/')
        .first()
        .innerText()
        .catch(() => 'auto-sync');
    }

    // Poll until queue drains (auto-sync + Sync Now)
    let queueAfter = 1;
    for (let i = 0; i < 15; i++) {
      queueAfter = await page.evaluate(async () => {
        const dbName = 'product-offline-v1';
        return await new Promise<number>((resolve, reject) => {
          const open = indexedDB.open(dbName);
          open.onerror = () => reject(open.error || new Error('idb'));
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('syncQueue')) {
              resolve(0);
              return;
            }
            const tx = db.transaction(['syncQueue'], 'readonly');
            const req = tx.objectStore('syncQueue').count();
            req.onsuccess = () => resolve(req.result);
          };
        });
      });
      if (queueAfter === 0) break;
      if (await syncBtn.isVisible().catch(() => false)) {
        await syncBtn.click().catch(() => {});
      }
      await page.waitForTimeout(1000);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const notesAfter = await prisma.progressNote.count({ where: { clientId: client!.id } });
    const latest = await prisma.progressNote.findFirst({
      where: { clientId: client!.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, body: true },
    });

    // eslint-disable-next-line no-console
    console.log(
      'LEFTOVER_B_EVIDENCE',
      JSON.stringify({
        bannerText,
        syncMsg,
        queueBefore: idb.queueCount,
        draftBefore: idb.draftCount,
        sampleEncrypted: idb.sample.slice(0, 120),
        queueAfter,
        notesBefore,
        notesAfter,
        noteId: latest?.id,
        bodyHasMarker: latest?.body?.includes(marker) ?? false,
      })
    );

    expect(notesAfter).toBeGreaterThan(notesBefore);
    expect(latest?.id).toBeTruthy();
    expect(queueAfter).toBe(0);

    await prisma.$disconnect();
  });
});
