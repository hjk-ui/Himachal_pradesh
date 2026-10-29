import { normalizeToE164 } from '@/lib/sms/phone';
import { publishSnsSms } from '@/lib/sms/sns';
import { patientSmsAllowed } from '@/lib/sms/patient-gate';

export type SendSmsInput = {
  to: string;
  body: string;
  clientId?: string | null;
  /**
   * Staff / system phones bypass the patient SMS consent gate.
   * Never set this for patient destinations.
   */
  bypassPatientGate?: boolean;
  /** Logged only — never secrets */
  context?: string;
};

export type SendSmsResult = { mode: 'sns' | 'console' | 'skipped' };

function smsConfig() {
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  const origination = process.env.SNS_SMS_ORIGINATION_NUMBER?.trim();
  return { region, accessKeyId, secretAccessKey, sessionToken, origination };
}

export function isSnsSmsConfigured() {
  const { accessKeyId, secretAccessKey } = smsConfig();
  return Boolean(accessKeyId && secretAccessKey);
}

function logSms(level: 'info' | 'error', context: string, message: string) {
  const line = `[sms:${context}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

/**
 * Amazon SNS SMS. IAM: sns:Publish. Not SES SMTP credentials.
 * Dev without SNS: console dump. Production without SNS: throw.
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
  if (/\b(F\d{2}(?:\.\d+)?|diagnos\w*|medication|prescription|mg\b|cssrs|suicid\w*|substance use)\b/i.test(body)) {
    logSms('error', context, 'refused — body includes clinical detail');
    throw new Error('SMS cannot include diagnosis, medication, or other clinical detail.');
  }
  if (input.clientId && !input.bypassPatientGate) {
    const gate = await patientSmsAllowed(input.clientId);
    if (!gate.allowed) {
      logSms('info', context, `skipped — patient SMS gate (${gate.reason || 'blocked'})`);
      return { mode: 'skipped' };
    }
  }

  if (!isSnsSmsConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      logSms('error', context, 'SNS SMS is not configured. Message was not sent.');
      throw new Error('SMS delivery is not configured.');
    }
    console.log('\n========== SMS (dev fallback, SNS unset) ==========');
    console.log(`context: ${context}`);
    console.log(`To: ${phone}`);
    console.log(body);
    console.log('===================================================\n');
    return { mode: 'console' };
  }

  const { region, accessKeyId, secretAccessKey, sessionToken, origination } = smsConfig();
  try {
    await publishSnsSms({
      region,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      sessionToken,
      phoneNumber: phone,
      message: body,
      originationNumber: origination,
    });
    logSms('info', context, `sent via SNS region=${region} to=${phone}`);
    return { mode: 'sns' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown SNS error';
    logSms('error', context, `send failed: ${detail}`);
    throw new Error(`SMS could not be sent (${context}). ${detail}`);
  }
}
