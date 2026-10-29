import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  patientAccountHandler,
  patientOk,
  patientOptions,
  readPatientJson,
} from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

const registerTokenSchema = z.object({
  token: z.string().trim().min(10, 'Device token must be at least 10 characters').max(512),
  platform: z.enum(['ios', 'android']),
});

const unregisterTokenSchema = z.object({
  token: z.string().trim().min(10, 'Device token must be at least 10 characters').max(512),
});

/**
 * POST /api/patient/device-token
 * Registers or updates an FCM device token for the authenticated patient.
 */
export const POST = patientAccountHandler(async ({ req, me }) => {
  const json = await readPatientJson(req);
  const data = registerTokenSchema.parse(json);

  await prisma.deviceToken.upsert({
    where: { token: data.token },
    create: {
      clientId: me.clientId,
      token: data.token,
      platform: data.platform,
      lastUsedAt: new Date(),
    },
    update: {
      clientId: me.clientId,
      platform: data.platform,
      lastUsedAt: new Date(),
    },
  });

  return patientOk({ registered: true, platform: data.platform });
});

/**
 * DELETE /api/patient/device-token
 * Unregisters the device token upon logout.
 */
export const DELETE = patientAccountHandler(async ({ req, me }) => {
  const json = await readPatientJson(req);
  const data = unregisterTokenSchema.parse(json);

  const deleted = await prisma.deviceToken.deleteMany({
    where: {
      clientId: me.clientId,
      token: data.token,
    },
  });

  return patientOk({ removed: deleted.count > 0 });
});
