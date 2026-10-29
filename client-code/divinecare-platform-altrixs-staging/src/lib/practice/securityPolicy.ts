/**
 * What the current build actually enforces for staff sign-in and sessions. Shown on
 * Admin › Security and Practice settings › Users & security. Keep in step with
 * src/lib/auth/config.ts and the auth API routes — never list a control that is not built.
 */
export type PolicyRow = { label: string; value: string; gap?: boolean };
export type PolicySection = { title: string; items: PolicyRow[] };

export const SECURITY_POLICY: PolicySection[] = [
  {
    title: 'Password policy',
    items: [
      { label: 'Length', value: '12 to 128 characters (new accounts, invites, resets, changes)' },
      { label: 'Common passwords', value: 'Rejected: top 10,000 list (bundled, no network) and common words with digits added' },
      { label: 'Personal information', value: 'Must not contain your name or email address' },
      { label: 'Existing passwords', value: 'Keep working; the rule applies at the next change' },
      { label: 'Password expiry', value: 'None (NIST SP 800-63B)' },
      { label: 'Storage', value: 'bcrypt hash' },
    ],
  },
  {
    title: 'Session security',
    items: [
      { label: 'Sign-in methods', value: 'Email + password, or email one-time code' },
      { label: 'Multi-factor authentication', value: 'Required for all staff (practice setting, on by default): authenticator app (TOTP) or a one-time recovery code' },
      { label: 'Remember this device', value: '30 days, optional; revoked by an admin 2FA reset or a password change' },
      { label: 'Failed-login lockout', value: '5 wrong passwords or 2FA codes: 15-minute lock; 20 attempts per 15 min per network address' },
      { label: 'Email one-time codes', value: 'Expire in 2 minutes; void after 5 wrong guesses; 5 requests per 15 min' },
      { label: 'Idle (automatic) logoff', value: '15 minutes, with a 60-second warning (a live call or recording counts as activity)' },
      { label: 'Maximum session length', value: '12 hours, then sign in again' },
      { label: 'Single sign-on (SSO)', value: 'Not configured' },
    ],
  },
  {
    title: 'Audit & access',
    items: [
      { label: 'PHI access controls', value: 'Role-based (RBAC), organization scoped' },
      { label: 'Audit log', value: 'Append-only, retained 6 years (164.316(b)(2))' },
      { label: 'Break-the-glass access', value: 'Logged with reason' },
    ],
  },
  {
    title: 'Encryption & attestations',
    items: [
      { label: 'Data in transit', value: 'HTTPS (TLS) at the load balancer' },
      { label: 'Content Security Policy', value: 'Enforced on every page (per-request nonce)' },
      { label: 'Data at rest', value: 'Verify database volume / S3 KMS encryption in AWS', gap: true },
      { label: 'Third-party audit (SOC 2 / HITRUST)', value: 'None on file' },
      { label: '42 CFR Part 2 designation', value: 'Set in Practice settings › Compliance' },
    ],
  },
];
