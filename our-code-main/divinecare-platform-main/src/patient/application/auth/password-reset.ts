import { hash } from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { rateLimit } from '@/lib/security/rateLimit';
import { sendEmail } from '@/lib/mail/sendEmail';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { PatientAppError } from '@/patient/domain';
import { assertPatientPassword } from '@/patient/domain/password-policy';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { sendPatientInviteEmail } from '@/patient/infrastructure/notifications/email';
import {
  hashInviteToken,
  inviteExpiry,
  matchesPatientCredential,
  newInviteToken,
  signPatientPasswordReset,
  verifyPatientPasswordReset,
} from '@/patient/infrastructure/security/tokens';

export const PASSWORD_RESET_MESSAGE = 'If an active patient account exists for this email, password reset instructions will be sent.';

export type PatientPasswordResetRequestResult =
  | { outcome: 'sent' }
  | { outcome: 'rate_limited' | 'account_not_eligible' | 'delivery_failed' };

function passwordResetLogId(email: string) {
  // A stable identifier lets operators correlate failures without writing a
  // patient's email address to application logs.
  return hashInviteToken(email).slice(0, 12);
}

export async function requestPatientPasswordReset(rawEmail: string): Promise<PatientPasswordResetRequestResult> {
  const email = rawEmail.trim().toLowerCase();
  const logId = passwordResetLogId(email);
  // Same response for unknown, invited, disabled and throttled accounts.
  if (!rateLimit(`patient-password-email:${hashInviteToken(email)}`, 3, 15 * 60 * 1000).ok) {
    console.warn(`[patient password reset:${logId}] Request suppressed by per-email rate limit`);
    return { outcome: 'rate_limited' };
  }

  // 1. Look up directly by email in PatientAccount
  let account = await prisma.patientAccount.findUnique({
    where: { email },
    include: { client: { select: { active: true, status: true, name: true, email: true } } },
  });

  // 2. Self-healing fallback: If not found, check if a Client record has this email
  // (handles clients whose demographic email was updated in the EHR prior to sync)
  if (!account && typeof (prisma.client as any)?.findFirst === 'function') {
    const client = await (prisma.client as any).findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { patientAccount: true },
    });
    if (client?.patientAccount) {
      try {
        account = await prisma.patientAccount.update({
          where: { id: client.patientAccount.id },
          data: { email },
          include: { client: { select: { active: true, status: true, name: true, email: true } } },
        });
      } catch (err) {
        console.error('[forgot-password self-heal failed]', err);
      }
    }
  }

  if (!account?.passwordHash || account.status !== 'ACTIVE' ||
      !account.client.active || account.client.status === 'DISCHARGED') {
    console.info(`[patient password reset:${logId}] No eligible active patient account`);
    return { outcome: 'account_not_eligible' };
  }

  const token = await signPatientPasswordReset(account.id, account.clientId, account.passwordHash);
  const url = new URL('/patient/accept', getAppBaseUrl());
  url.searchParams.set('mode', 'reset');
  url.searchParams.set('token', token);
  try {
    const resetUrl = url.toString();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 32px 16px;">
          <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <div style="background-color: #141C34; padding: 24px 32px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.02em;">Altrixs Health</h1>
            </div>
            <div style="padding: 32px;">
              <h2 style="color: #0F172A; margin-top: 0; font-size: 18px; font-weight: 600;">Reset your patient password</h2>
              <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 16px 0 24px 0;">
                You recently requested to reset your password for your Altrixs patient account. Tap the button below to set a new password:
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${resetUrl}" style="background-color: #6868D0; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(104, 104, 208, 0.35);">
                  Reset Password
                </a>
              </div>
              <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0;" />
              <p style="color: #94A3B8; font-size: 12px; line-height: 1.5; margin: 0;">
                This link will expire in <strong>30 minutes</strong> and can only be used once.<br />
                If you did not request this reset, you can safely ignore this email.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
    await sendEmail({
      to: account.email,
      subject: 'Reset your Altrixs patient password',
      text: `Open this link to reset your patient password:\n\n${resetUrl}\n\nThis link expires in 30 minutes and works once. If you did not request a reset, you can ignore this email.`,
      html,
      context: 'patient-password-reset',
    });
    await logPatientAudit({ clientId: account.clientId, accountId: account.id, action: 'password_reset.requested' });
    return { outcome: 'sent' };
  } catch (err) {
    // Do not disclose account existence or mail provider details in the response.
    const detail = err instanceof Error ? err.message : 'Unknown email delivery error';
    console.error(`[patient password reset:${logId}] Email delivery failed: ${detail}`);
    return { outcome: 'delivery_failed' };
  }
}

export async function resetPatientPassword(token: string, password: string) {
  assertPatientPassword(password);
  const invalid = () => new PatientAppError('Reset link is invalid, expired or already used', 400, 'invalid_token');
  let proof: Awaited<ReturnType<typeof verifyPatientPasswordReset>>;
  try { proof = await verifyPatientPasswordReset(token); } catch { throw invalid(); }
  const account = await prisma.patientAccount.findFirst({
    where: { id: proof.accountId, clientId: proof.clientId, status: 'ACTIVE' },
    include: { client: { select: { active: true, status: true } } },
  });
  if (!account?.passwordHash || !account.client.active || account.client.status === 'DISCHARGED' ||
      !matchesPatientCredential(proof.credential, account.passwordHash)) throw invalid();

  const passwordHash = await hash(password, 12);
  // Compare-and-swap makes concurrent uses of the same link single-use, too.
  const changed = await prisma.patientAccount.updateMany({
    where: {
      id: account.id,
      clientId: account.clientId,
      status: 'ACTIVE',
      passwordHash: account.passwordHash,
      client: { active: true, status: { not: 'DISCHARGED' } },
    },
    data: { passwordHash },
  });
  if (changed.count !== 1) throw invalid();
  await logPatientAudit({ clientId: account.clientId, accountId: account.id, action: 'password_reset.completed' });
}
