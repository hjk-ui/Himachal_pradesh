import type { Metadata } from 'next';
import { MarketingDocShell } from '@/components/marketing/MarketingDocShell';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Altrixs collects, uses, and protects clinic and patient information on altrixs.com.',
};

export default function PrivacyPage() {
  return (
    <MarketingDocShell title="Privacy Policy">
      <p className="text-sm text-slate-500">Last updated: October 1, 2026</p>

      <p>
        Altrixs (&quot;we&quot;, &quot;us&quot;) provides behavioral health clinic software at{' '}
        <a href="https://altrixs.com" className="font-medium text-[#5C2D91] hover:underline">
          altrixs.com
        </a>
        . This page explains how we handle information when you use our website, staff dashboard,
        patient experiences, and related services.
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">1. Information we process</h2>
        <p>Depending on how you use Altrixs, we may process:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details (name, email, role, organization)</li>
          <li>Clinic operations data you enter (clients, appointments, notes, billing records)</li>
          <li>Telehealth session metadata and technical logs needed to run video or phone visits</li>
          <li>Device and usage data (IP address, browser type, approximate location, app events)</li>
          <li>Support messages you send to us</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">2. How we use information</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>To provide and improve the Altrixs platform for your clinic</li>
          <li>To authenticate users and protect accounts</li>
          <li>To deliver telehealth, messaging, scheduling, and related features you enable</li>
          <li>To respond to support requests and service notices</li>
          <li>To meet legal, security, and compliance obligations</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">3. Protected health information (PHI)</h2>
        <p>
          When Altrixs is used by a covered entity or business associate under HIPAA, PHI is handled
          under applicable agreements (including a Business Associate Addendum where required) and
          clinic-configured access controls. Clinics remain responsible for their own HIPAA policies,
          workforce training, and how they use the product.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">4. Sharing</h2>
        <p>We do not sell personal information. We may share data with:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Service providers that help host, secure, email, or operate the product (e.g. cloud infrastructure)</li>
          <li>Your organization&apos;s authorized users and roles</li>
          <li>Authorities when required by law or to protect rights and safety</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">5. Security</h2>
        <p>
          We use administrative, technical, and physical safeguards appropriate to a clinical
          operations platform, including encrypted transport (HTTPS), access controls, and audit
          logging for sensitive actions. No method of transmission or storage is 100% secure.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">6. Retention</h2>
        <p>
          We retain information for as long as needed to provide the service, meet contractual and
          legal retention requirements, resolve disputes, and enforce agreements. Clinics may control
          much of their operational data within the product.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">7. Your choices</h2>
        <p>
          Staff and patients should contact their clinic administrator for access, correction, or
          deletion requests related to clinical records. For Altrixs account or website privacy
          questions, use the{' '}
          <a href="/support" className="font-medium text-[#5C2D91] hover:underline">
            Support
          </a>{' '}
          page.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">8. Contact</h2>
        <p>
          Privacy questions: email{' '}
          <a
            href="mailto:privacy@altrixs.com"
            className="font-medium text-[#5C2D91] hover:underline"
          >
            privacy@altrixs.com
          </a>
          .
        </p>
      </section>

      <p className="text-sm text-slate-500">
        This page is a general product privacy notice and is not legal advice. Clinics should review
        their own counsel and BAAs before processing PHI.
      </p>
    </MarketingDocShell>
  );
}
