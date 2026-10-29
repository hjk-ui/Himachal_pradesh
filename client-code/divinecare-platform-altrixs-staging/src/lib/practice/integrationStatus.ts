import 'server-only';

/**
 * Read-only integration health for the practice settings panel. Derived from the same
 * env-based detection each integration uses at runtime; never returns a secret, key or
 * account identifier — only configured / partial / demo / error and a short reason.
 */
import { waystarSftpConfig } from '@/lib/services/waystarSftpService';
import { isDemoMode as chimeDemo } from '@/lib/services/chimeService';
import { stripeConfigured, stripeKeyMode } from '@/lib/stripe/config';
import { isSnsSmsConfigured } from '@/lib/sms/send';
import { isSmtpConfigured } from '@/lib/email/smtp';
import { healthLakeConfig } from '@/lib/healthlake/config';
import type { IntegrationStatus } from './checklist';

const has = (name: string) => Boolean(process.env[name]?.trim());

function safe(key: IntegrationStatus['key'], label: string, fn: () => Omit<IntegrationStatus, 'key' | 'label'>): IntegrationStatus {
  try {
    return { key, label, ...fn() };
  } catch {
    return { key, label, state: 'error', detail: 'Configuration could not be read' };
  }
}

export function practiceIntegrationStatuses(): IntegrationStatus[] {
  return [
    safe('waystar', 'Waystar clearinghouse (SFTP)', () => {
      const cfg = waystarSftpConfig();
      if (cfg.live) {
        return {
          state: 'configured',
          detail: cfg.usageIndicator === 'P' ? 'Live — production claims (ISA15 = P)' : 'Live — test mode (ISA15 = T); switch to P at go-live',
        };
      }
      if (cfg.configured) return { state: 'partial', detail: 'Connector set but AWS credentials are off (demo mode)' };
      return { state: 'demo', detail: 'No SFTP connector configured — claims are not transmitted' };
    }),
    safe('drfirst', 'DrFirst e-prescribing', () => {
      const vendor = has('DRFIRST_VENDOR_USERNAME') && has('DRFIRST_VENDOR_PASSWORD');
      if (!vendor) return { state: 'demo', detail: 'Vendor credentials not set — Rcopia runs in demo mode' };
      if (!has('DRFIRST_PRACTICE_USERNAME')) return { state: 'partial', detail: 'Practice username not set' };
      const staging = /staging/i.test(process.env.DRFIRST_ENGINE_URL || 'staging');
      return { state: 'configured', detail: staging ? 'Connected to DrFirst staging' : 'Connected to DrFirst production' };
    }),
    safe('stripe', 'Stripe payments', () => {
      if (!stripeConfigured()) return { state: 'demo', detail: 'No Stripe secret key — card payments disabled' };
      const mode = stripeKeyMode();
      return mode === 'live' ? { state: 'configured', detail: 'Live key' } : { state: 'partial', detail: `Stripe ${mode} key` };
    }),
    safe('sms', 'SMS (AWS End User Messaging)', () => {
      if (!isSnsSmsConfigured()) return { state: 'demo', detail: 'Not configured — texts are logged, not sent' };
      if (!has('SMS_ORIGINATION_IDENTITY')) return { state: 'partial', detail: 'No registered origination number (toll-free registration pending)' };
      return { state: 'configured', detail: 'Sending from a registered number' };
    }),
    safe('email', 'Email (Amazon SES)', () =>
      isSmtpConfigured() ? { state: 'configured', detail: 'SES delivery configured' } : { state: 'demo', detail: 'No SES / SMTP credentials — email is not sent' }
    ),
    safe('chime', 'Telehealth (Amazon Chime SDK)', () =>
      chimeDemo() ? { state: 'demo', detail: 'AWS credentials off — meetings are simulated' } : { state: 'configured', detail: 'Live meetings (us-east-1)' }
    ),
    safe('healthlake', 'AWS HealthLake (FHIR)', () => {
      const cfg = healthLakeConfig();
      if (cfg.configured) return { state: 'configured', detail: 'Data store configured' };
      return { state: 'demo', detail: `Missing: ${cfg.missing.map((m) => m.split(' ')[0]).join(', ')}` };
    }),
  ];
}
