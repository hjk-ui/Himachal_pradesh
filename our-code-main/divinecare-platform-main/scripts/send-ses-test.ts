/**
 * Send one SES SMTP test message (sandbox: To must be a verified identity).
 *
 *   SMTP_TEST_TO=you@verified.example.com npm run mail:test
 *
 * Does not print SMTP_PASS.
 */
import 'dotenv/config';
import { sendEmail, verifySmtpConnection } from '../src/lib/email/smtp';

async function main() {
  const to = process.env.SMTP_TEST_TO?.trim();
  if (!to) {
    console.error('Set SMTP_TEST_TO to one verified SES recipient.');
    process.exit(1);
  }

  const verify = await verifySmtpConnection();
  if (!verify.ok) {
    console.error('SMTP verify failed:', verify.error);
    process.exit(1);
  }

  await sendEmail({
    to,
    subject: 'Altrixs SES SMTP test',
    text: 'This is a single test email from Altrixs via Amazon SES SMTP.',
    html: '<p>This is a single test email from Altrixs via Amazon SES SMTP.</p>',
    context: 'ses-smtp-test',
  });

  console.log('Test email accepted by SES SMTP. Check inbox for', to);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
