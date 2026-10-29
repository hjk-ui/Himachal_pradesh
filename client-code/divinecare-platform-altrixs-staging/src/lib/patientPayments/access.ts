/**
 * Who may do what with patient AutoPay (pure; tests/patient-autopay.test.ts).
 *   Front office (front desk, office manager) + billing / leadership: capture a card in the office with
 *   the patient present, and turn a client's AutoPay on or off.
 *   Billing / leadership only: retry, approve held, void and refund charges.
 *   Practice leadership only: AutoPay settings (master switch, charge rules, caps).
 */
const LEADERSHIP = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'] as const;

export const CARD_DESK_ROLES = [...LEADERSHIP, 'BILLING', 'OFFICE_MANAGER', 'FRONT_DESK'] as const;
export const CHARGE_ADMIN_ROLES = [...LEADERSHIP, 'BILLING'] as const;
export const SETTINGS_ADMIN_ROLES = LEADERSHIP;

const has = (list: readonly string[], role: string | null | undefined) => Boolean(role && list.includes(String(role).toUpperCase()));

/** Capture / replace / remove a card in the office, and turn a client's AutoPay on or off */
export const canManageAutopayEnrollment = (role: string | null | undefined) => has(CARD_DESK_ROLES, role);
/** Retry, approve a held charge, void, refund */
export const canAdministerCharges = (role: string | null | undefined) => has(CHARGE_ADMIN_ROLES, role);
/** Master switch, charge rules, caps, statement descriptor, receipt sender */
export const canEditPatientPaymentSettings = (role: string | null | undefined) => has(SETTINGS_ADMIN_ROLES, role);
