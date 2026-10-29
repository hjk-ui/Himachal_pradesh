/**
 * Transactional email — Amazon SES SMTP via Nodemailer.
 * @see src/lib/email/smtp.ts
 */
export { sendEmail, isSmtpConfigured, verifySmtpConnection } from '@/lib/email/smtp';
export type { SendEmailInput, SendEmailResult } from '@/lib/email/smtp';
