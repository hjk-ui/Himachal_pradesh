import { awsClientConfig } from '@/lib/aws/clientConfig';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const CLINICAL_EVENT_TYPES = [
  { id: 'crisis-flag', label: 'Crisis Flag', description: 'C-SSRS high/imminent or other acute safety crisis' },
  { id: 'phq9-alert', label: 'PHQ-9 Alert', description: 'PHQ-9 score at or above clinical threshold' },
] as const;

export type ClinicalEventTypeId = (typeof CLINICAL_EVENT_TYPES)[number]['id'];

export function isEventBridgeConfigured(): boolean {
  return Boolean(process.env.AWS_EVENTBRIDGE_BUS_NAME?.trim());
}

async function publishEventBridge(detailType: string, detail: Record<string, unknown>): Promise<boolean> {
  const busName = process.env.AWS_EVENTBRIDGE_BUS_NAME?.trim();
  if (!busName) return false;
  try {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const region =
      process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
    const client = new EventBridgeClient({ region, ...awsClientConfig() });
    await client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: busName,
            Source: 'divinecare.clinical',
            DetailType: detailType,
            Detail: JSON.stringify(detail),
          },
        ],
      })
    );
    return true;
  } catch (err) {
    console.error('[clinical-events] EventBridge publish failed', err);
    return false;
  }
}

export async function recordClinicalEvent(input: {
  organizationId: string;
  eventType: ClinicalEventTypeId | string;
  clientId?: string | null;
  clientName?: string | null;
  payload: Record<string, unknown>;
  createdById?: string | null;
}) {
  const demoMode = !isEventBridgeConfigured();
  const published = demoMode
    ? false
    : await publishEventBridge(input.eventType, {
        organizationId: input.organizationId,
        clientId: input.clientId,
        clientName: input.clientName,
        ...input.payload,
      });

  const row = await prisma.clinicalEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      clientId: input.clientId ?? null,
      clientName: input.clientName ?? null,
      payloadJson: input.payload as Prisma.InputJsonValue,
      demoMode: demoMode || !published,
      createdById: input.createdById ?? null,
    },
  });

  return { event: row, demoMode: row.demoMode };
}
