import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingDocShell } from '@/components/marketing/MarketingDocShell';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with Altrixs clinic software, telehealth, billing, and account access.',
};

export default function SupportPage() {
  return (
    <MarketingDocShell title="Support">
      <p>
        Need help with Altrixs? Use the options below. For clinical emergencies, contact local
        emergency services — Altrixs support is not a crisis line.
      </p>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Contact us</h2>
        <p>
          Email:{' '}
          <a
            href="mailto:support@altrixs.com"
            className="font-semibold text-[#5C2D91] hover:underline"
          >
            support@altrixs.com
          </a>
        </p>
        <p className="text-sm text-slate-500">
          Typical response within 1 business day (Mon–Fri). Include your clinic name, login email,
          and a short description of the issue.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Common topics</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium text-slate-900">Staff login / access</span> — reset password
            from the login page, or ask your clinic admin to re-invite your user.
          </li>
          <li>
            <span className="font-medium text-slate-900">Telehealth video</span> — use Telehealth →
            Start → Launch Chime; allow camera and mic in the browser. Patients join via the secure
            link or app notification.
          </li>
          <li>
            <span className="font-medium text-slate-900">Phone visits</span> — place calls from
            Telehealth or Communications when Amazon Connect is configured for your clinic.
          </li>
          <li>
            <span className="font-medium text-slate-900">Scheduling</span> — public booking is at{' '}
            <Link href="/schedule" className="font-medium text-[#5C2D91] hover:underline">
              /schedule
            </Link>
            .
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Quick links</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <Link href="/login" className="font-medium text-[#5C2D91] hover:underline">
              Staff sign in
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="font-medium text-[#5C2D91] hover:underline">
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link href="/" className="font-medium text-[#5C2D91] hover:underline">
              Altrixs home
            </Link>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Crisis resources</h2>
        <p>
          If you or someone else is in immediate danger, call your local emergency number. In the
          U.S., you can also dial or text <strong>988</strong> (Suicide &amp; Crisis Lifeline).
        </p>
      </section>
    </MarketingDocShell>
  );
}
