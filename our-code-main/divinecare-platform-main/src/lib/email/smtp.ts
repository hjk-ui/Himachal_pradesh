import nodemailer from 'nodemailer';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Logged only — never secrets */
  context?: string;
};

export type SendEmailResult = { mode: 'smtp' | 'console' };

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM?.trim() || 'Altrixs <no-reply@altrixs.com>';
  return { host, port, user, pass, from };
}

export function isSmtpConfigured() {
  const { host, user, pass } = smtpConfig();
  return Boolean(host && user && pass);
}

function createTransport() {
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

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html ?? `<pre>${input.text}</pre>`,
    });
    logMail(
      'info',
      context,
      `sent via SES SMTP host=${host} port=${port} to=${toList} subject=${input.subject}`
    );
    return { mode: 'smtp' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown SMTP error';
    logMail('error', context, `send failed: ${detail}`);
    throw new Error(`Email could not be sent (${context}). ${detail}`);
  }
}

export async function verifySmtpConnection() {
  if (!isSmtpConfigured()) {
    return { ok: false as const, error: 'SMTP_HOST, SMTP_USER, and SMTP_PASS are required' };
  }
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
