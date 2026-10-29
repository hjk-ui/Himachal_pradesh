/**
 * Whether AWS integrations run for real or in DEMO MODE.
 *
 * Servers that authenticate with static keys set AWS_ACCESS_KEY_ID (production today).
 * Servers that use an EC2 instance role have no key in the environment, so they
 * opt in with AWS_LIVE=true (staging, and production once it moves to a role).
 */
export const AWS_LIVE = !!process.env.AWS_ACCESS_KEY_ID || process.env.AWS_LIVE === 'true';
