import { awsClientConfig } from '@/lib/aws/clientConfig';
import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe / List-Unsubscribe-Post (RFC 8058 one-click) */
  headers?: Record<string, string>;
  /** Logged only — never secrets */
  context?: string;
  /** Integration log only (Admin > Integrations > Logs): practice and patient the email was for */
  organizationId?: string | null;
  clientId?: string | null;
};

export type SendEmailResult = { mode: 'smtp' | 'ses' | 'console' };

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM?.trim() || 'Altrixs <no-reply@altrixs.com>';
  return { host, port, user, pass, from };
}

function hasSmtpCredentials() {
  const { host, user, pass } = smtpConfig();
  return Boolean(host && user && pass);
}

/** SES API with the instance role (AWS_LIVE=true) when no SMTP credentials are set */
function usesSesApi() {
  return !hasSmtpCredentials() && process.env.AWS_LIVE === 'true';
}

/** Email delivery is configured: SES SMTP credentials, or the SES API via the instance role */
export function isSmtpConfigured() {
  return hasSmtpCredentials() || usesSesApi();
}

function createTransport() {
  if (usesSesApi()) {
    const sesClient = new SESv2Client({
      ...awsClientConfig(),
      region: process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1',
    });
    return nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } });
  }
  const { host, port, user, pass } = smtpConfig();
  if (!host || !user || !pass) {
    throw new Error('Email delivery is not configured.');
  }

  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(port === 587 ? { requireTLS: true } : {}),
  });
}

function logMail(level: 'info' | 'error', context: string, message: string) {
  const line = `[mail:${context}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

/**
 * Amazon SES SMTP (Nodemailer). No Resend.
 * Dev without SMTP: console dump. Production without SMTP: throw.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const context = input.context || 'transactional';
  const { host, port, from } = smtpConfig();
  const toList = Array.isArray(input.to) ? input.to.join(', ') : input.to;

  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      logMail('error', context, 'SMTP is not configured. Message was not sent.');
      throw new Error('Email delivery is not configured.');
    }
    console.log('\n========== EMAIL (dev fallback, SMTP unset) ==========');
    console.log(`context: ${context}`);
    console.log(`To: ${toList}`);
    console.log(`Subject: ${input.subject}`);
    console.log(input.text);
    console.log('======================================================\n');
    return { mode: 'console' };
  }

  // Integration log: template (context) + outcome only; never the subject, body or addresses
  const startedAt = new Date();
  const logSend = (status: 'success' | 'error', extra: { messageId?: string; error?: unknown }) =>
    recordIntegrationCall({
      integration: 'email', operation: 'send_email', direction: 'outbound', status, startedAt,
      organizationId: input.organizationId ?? null, clientId: input.clientId ?? null,
      correlationId: extra.messageId ?? null, vendorStatus: status === 'success' ? 'accepted' : 'failed',
      errorCode: extra.error && typeof extra.error === 'object' && 'code' in extra.error ? String((extra.error as { code?: unknown }).code) : null,
      errorMessage: extra.error ?? null,
      metadata: {
        template: context,
        channel: usesSesApi() ? 'ses_api' : 'ses_smtp',
        recipientCount: (Array.isArray(input.to) ? input.to.length : 1) + (Array.isArray(input.cc) ? input.cc.length : input.cc ? 1 : 0) + (Array.isArray(input.bcc) ? input.bcc.length : input.bcc ? 1 : 0),
      },
    });
  try {
    const transporter = createTransport();
    const info = await transporter.sendMail({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html ?? `<pre>${input.text}</pre>`,
      ...(input.headers ? { headers: input.headers } : {}),
    });
    const via = usesSesApi() ? 'SES API (instance role)' : `SES SMTP host=${host} port=${port}`;
    logMail('info', context, `sent via ${via} to=${toList} subject=${input.subject}`);
    await logSend('success', { messageId: typeof info?.messageId === 'string' ? info.messageId : undefined });
    return { mode: usesSesApi() ? 'ses' : 'smtp' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown SMTP error';
    await logSend('error', { error: err });
    logMail('error', context, `send failed: ${detail}`);
    throw new Error(`Email could not be sent (${context}). ${detail}`);
  }
}

export async function verifySmtpConnection() {
  if (!isSmtpConfigured()) {
    return { ok: false as const, error: 'SMTP_HOST, SMTP_USER, and SMTP_PASS are required (or AWS_LIVE=true for the SES API)' };
  }
  // The SES API transport has no connection to verify
  if (usesSesApi()) return { ok: true as const };
  try {
    const transporter = createTransport();
    await transporter.verify();
    return { ok: true as const };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'verify failed';
    logMail('error', 'verify', detail);
    return { ok: false as const, error: detail };
  }
}
