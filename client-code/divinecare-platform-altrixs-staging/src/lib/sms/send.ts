import { awsClientConfig } from '@/lib/aws/clientConfig';
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { normalizeToE164 } from '@/lib/sms/phone';
import { publishSnsSms } from '@/lib/sms/sns';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

export type SendSmsInput = {
  to: string;
  body: string;
  /** Logged only — never secrets */
  context?: string;
  /** Integration log only (Admin > Integrations > Logs): practice and patient the text was for */
  organizationId?: string | null;
  clientId?: string | null;
};

export type SendSmsResult = { mode: 'sms' | 'sns' | 'console' | 'skipped'; messageId?: string };

function smsConfig() {
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  const origination = process.env.SNS_SMS_ORIGINATION_NUMBER?.trim();
  // AWS End User Messaging: the registered sending number (E.164, phone-number id or ARN)
  const originationIdentity = process.env.SMS_ORIGINATION_IDENTITY?.trim();
  const configurationSet = process.env.SMS_CONFIGURATION_SET?.trim();
  return { region, accessKeyId, secretAccessKey, sessionToken, origination, originationIdentity, configurationSet };
}

/** End User Messaging from a registered number, with static keys or the server's instance role (AWS_LIVE=true) */
function isEndUserMessagingConfigured() {
  const { accessKeyId, secretAccessKey, originationIdentity } = smsConfig();
  return Boolean(originationIdentity && ((accessKeyId && secretAccessKey) || process.env.AWS_LIVE === 'true'));
}

export function isSnsSmsConfigured() {
  const { accessKeyId, secretAccessKey } = smsConfig();
  return isEndUserMessagingConfigured() || Boolean(accessKeyId && secretAccessKey);
}

/** True when a text was actually handed to AWS (either channel) */
export function smsWasSent(result: SendSmsResult) {
  return result.mode === 'sms' || result.mode === 'sns';
}

let eumClient: PinpointSMSVoiceV2Client | null = null;
function endUserMessagingClient(region: string) {
  // Without static keys the SDK's default chain uses the instance role
  eumClient ??= new PinpointSMSVoiceV2Client({ region, ...awsClientConfig() });
  return eumClient;
}

/** Phone numbers are PHI: logs keep only the last 4 digits */
const maskPhone = (e164: string) => `***${e164.slice(-4)}`;

function logSms(level: 'info' | 'error', context: string, message: string) {
  const line = `[sms:${context}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

/**
 * Sends a transactional text. Prefers AWS End User Messaging from the registered number
 * (SMS_ORIGINATION_IDENTITY; IAM sms-voice:SendTextMessage), falls back to SNS publish with static keys.
 * Dev without either: console dump. Production without either: throw.
 * Invalid / missing destination: skipped (no throw).
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const context = input.context || 'transactional';
  const phone = normalizeToE164(input.to);
  if (!phone) {
    logSms('info', context, 'skipped — missing or invalid phone');
    return { mode: 'skipped' };
  }

  const body = input.body.trim();
  if (!body) {
    logSms('info', context, 'skipped — empty body');
    return { mode: 'skipped' };
  }

  if (!isSnsSmsConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      logSms('error', context, 'SMS is not configured. Message was not sent.');
      throw new Error('SMS delivery is not configured.');
    }
    console.log('\n========== SMS (dev fallback, SMS unset) ==========');
    console.log(`context: ${context}`);
    console.log(`To: ${phone}`);
    console.log(body);
    console.log('===================================================\n');
    return { mode: 'console' };
  }

  const { region, accessKeyId, secretAccessKey, sessionToken, origination, originationIdentity, configurationSet } =
    smsConfig();
  // Integration log: template (context) + delivery outcome only; never the body or the number
  const startedAt = new Date();
  const logSend = (status: 'success' | 'error', extra: { channel: 'sms' | 'sns'; messageId?: string; error?: unknown }) =>
    recordIntegrationCall({
      integration: 'sms', operation: 'send_sms', direction: 'outbound', status, startedAt,
      organizationId: input.organizationId ?? null, clientId: input.clientId ?? null,
      correlationId: extra.messageId ?? null, vendorStatus: status === 'success' ? 'accepted' : 'failed',
      errorCode: extra.error && typeof extra.error === 'object' && 'name' in extra.error ? String((extra.error as { name?: unknown }).name) : null,
      errorMessage: extra.error ?? null,
      metadata: { template: context, channel: extra.channel },
    });
  try {
    if (isEndUserMessagingConfigured()) {
      const res = await endUserMessagingClient(region).send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: phone,
          OriginationIdentity: originationIdentity,
          MessageBody: body,
          MessageType: 'TRANSACTIONAL',
          ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
        })
      );
      logSms('info', context, `sent via End User Messaging to=${maskPhone(phone)} id=${res.MessageId ?? '?'}`);
      await logSend('success', { channel: 'sms', messageId: res.MessageId });
      return { mode: 'sms', messageId: res.MessageId };
    }
    await publishSnsSms({
      region,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      sessionToken,
      phoneNumber: phone,
      message: body,
      originationNumber: origination,
    });
    logSms('info', context, `sent via SNS region=${region} to=${maskPhone(phone)}`);
    await logSend('success', { channel: 'sns' });
    return { mode: 'sns' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown SMS error';
    await logSend('error', { channel: isEndUserMessagingConfigured() ? 'sms' : 'sns', error: err });
    logSms('error', context, `send failed to=${maskPhone(phone)}: ${detail}`);
    throw new Error(`SMS could not be sent (${context}). ${detail}`);
  }
}
