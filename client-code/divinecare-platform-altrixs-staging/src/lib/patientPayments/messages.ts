/**
 * Patient-facing payment messages (pure; tests/patient-autopay.test.ts). No PHI: no service, visit,
 * provider, diagnosis or balance. The account notice says only that something is in the portal; the
 * receipt names the amount, card and receipt number, sent to the patient's own email address.
 */

export const NEUTRAL_SENDER = 'Your care team';

export function senderLine(name: string | null | undefined): string {
  return (name ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60) || NEUTRAL_SENDER;
}

/** SMS (sent through the patient SMS consent gate, purpose portal_notice). */
export function accountUpdateSms(from: string): string {
  return `${from}: There's an update about your account in the patient portal. Please sign in to view it. Reply STOP to opt out.`;
}

export const ACCOUNT_UPDATE_EMAIL = {
  subject: 'Account update',
  text: (from: string) => `${from}\n\nThere's an update about your account in the patient portal. Please sign in to view it.\n\nThis is an automated message. Please do not reply.`,
};

export const RECEIPT_EMAIL_SUBJECT = 'Payment receipt';

export function receiptEmailText(input: { from: string; amountCents: number; cardBrand: string | null; cardLast4: string | null; paidOn: string; receiptNumber: string }): string {
  const card = input.cardLast4 ? `${input.cardBrand ? input.cardBrand.charAt(0).toUpperCase() + input.cardBrand.slice(1) : 'Card'} ending ${input.cardLast4}` : 'Card on file';
  return [
    input.from,
    '',
    'Payment received. Thank you.',
    '',
    `Amount: $${(input.amountCents / 100).toFixed(2)}`,
    `Paid with: ${card}`,
    `Date: ${input.paidOn}`,
    `Receipt number: ${input.receiptNumber}`,
    '',
    'You can see your payments and receipts in the patient portal. Questions about this payment? Contact the billing office.',
  ].join('\n');
}

export const BILLING_REVIEW_EMAIL = {
  subject: 'AutoPay charge needs review',
  text: 'An automatic patient payment is held for review in Altrixs (Billing > AutoPay > Charges). No patient details are included in this email.',
};
