'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import {
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Stethoscope,
  User,
  Users,
} from 'lucide-react';
import {
  BAA_DRAFT_BANNER,
  BAA_LEGAL_REVIEWED,
  BAA_TITLE,
  BAA_VERSION,
  baaAttestation,
  baaPlainText,
} from '@/lib/legal/baa';
import { GET_STARTED } from '@/lib/marketing/homeContent';

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7B4DB5)';
const PURPLE = '#5C2D91';

interface PlanOption {
  id: 'free' | 'solo' | 'professional' | 'practice';
  name: string;
  price: string;
  period: string;
  tagline: string;
  limits: string;
  popular?: boolean;
  features: string[];
}

const PLANS: PlanOption[] = [
  {
    id: 'free',
    name: 'Free Trial',
    price: '$0',
    period: '/mo',
    tagline: 'Basic trial tier',
    limits: 'Up to 5 clients · 1 clinician',
    features: ['5 active clients', 'Progress notes (SOAP/DAP)', 'Basic scheduling', 'HIPAA compliant'],
  },
  {
    id: 'solo',
    name: 'Solo Practice',
    price: '$49',
    period: '/mo',
    tagline: 'Ideal for solo doctors & therapists',
    limits: 'Up to 50 clients · 1 clinician',
    popular: true,
    features: [
      '50 active clients',
      'Full EHR & Treatment Plans',
      'Telehealth Video (Chime SDK)',
      'Self-Scheduling & Public Booking',
      'Client Portal & Messaging',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '$99',
    period: '/mo',
    tagline: 'Growing solo practitioners',
    limits: 'Unlimited clients · 1 clinician',
    features: [
      'Unlimited clients',
      'AI Clinical Note Drafting (SOAP/BIRP)',
      'Outcome Measures (PHQ-9, GAD-7)',
      'Superbill & CMS-1500 Generation',
      'Priority Support',
    ],
  },
  {
    id: 'practice',
    name: 'Practice / Clinic',
    price: '$149',
    period: '/mo',
    tagline: 'Group practices & multi-clinician clinics',
    limits: 'Up to 5 clinicians · Unlimited clients',
    features: [
      'Up to 5 clinicians included',
      'Team & Caseload Management',
      'Insurance Claims & EDI Clearinghouse',
      'Front-Desk Multi-Clinician Calendar',
      'CARF & Compliance Audit Hub',
    ],
  },
];

const CLINICAL_ROLES = [
  { id: 'therapist', label: 'Licensed Therapist / Counselor', group: 'Doctor / Solo Clinician', icon: Stethoscope },
  { id: 'psychiatrist', label: 'Psychiatrist (MD / DO)', group: 'Doctor / Solo Clinician', icon: Stethoscope },
  { id: 'np', label: 'Psychiatric NP / PMHNP', group: 'Doctor / Solo Clinician', icon: Stethoscope },
  { id: 'practice_director', label: 'Practice Director / Owner', group: 'Clinic Leadership', icon: Building2 },
  { id: 'office_manager', label: 'Office Manager / Clinic Admin', group: 'Clinic Leadership', icon: Users },
];

function GetStartedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = searchParams.get('plan');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState<'therapist' | 'psychiatrist' | 'np' | 'practice_director' | 'office_manager'>('therapist');
  const [plan, setPlan] = useState<'free' | 'solo' | 'professional' | 'practice'>('solo');
  const [baaOpen, setBaaOpen] = useState(false);
  const [baaAccepted, setBaaAccepted] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (planParam && ['free', 'solo', 'professional', 'practice'].includes(planParam.toLowerCase())) {
      setPlan(planParam.toLowerCase() as any);
    }
  }, [planParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Form Validations
    if (!name.trim() || name.trim().length < 2) {
      setError('Please enter your full legal or professional name.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid work email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!orgName.trim() || orgName.trim().length < 2) {
      setError('Please enter your practice or organization name.');
      return;
    }
    if (!baaAccepted) {
      setError('You must accept the Business Associate Agreement to create an account.');
      return;
    }
    if (!signerName.trim() || !signerTitle.trim() || !signerEmail.trim()) {
      setError('Signer name, title and email are required to accept the Business Associate Agreement.');
      return;
    }

    setLoading(true);
    try {
      // 1. Create account & organization via /api/auth/register
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          orgName: orgName.trim(),
          role,
          plan,
          baa: {
            accepted: true,
            version: BAA_VERSION,
            signerName: signerName.trim(),
            signerTitle: signerTitle.trim(),
            signerEmail: signerEmail.trim().toLowerCase(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create account.');
      }

      // 2. Sign in immediately via NextAuth
      const signInRes = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (signInRes?.error) {
        // Redirect to login if automated sign-in token had delay
        router.push(`/login?registered=1&email=${encodeURIComponent(email)}`);
        return;
      }

      // Store initial draft in local storage for onboarding wizard
      try {
        localStorage.setItem(
          'altrixs.soloOnboarding',
          JSON.stringify({
            step: 0,
            data: {
              practiceName: orgName.trim(),
              fullName: name.trim(),
            },
          })
        );
      } catch {
        // ignore
      }

      // 3. Handshake directly to /onboarding wizard for practice setup
      router.push('/onboarding');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-50/70 via-white to-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* Brand Header */}
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image
              src="/altrixs-logo.png"
              alt="Altrixs Behavioral Health"
              width={160}
              height={40}
              className="h-9 w-auto"
              priority
            />
          </Link>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            {GET_STARTED.title}
          </h1>
          <p className="mt-2 text-base text-gray-600">{GET_STARTED.subcopy}</p>
          <p className="mt-2 text-sm text-slate-500">{GET_STARTED.trust}</p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-xl sm:p-10 space-y-8"
        >
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          {/* Section 1: Account & Practice Identity */}
          <div className="space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-lg font-bold text-gray-900">1. Account & Practice Information</h2>
              <p className="text-xs text-gray-500">
                Your credentials and clinic name used for secure staff access and client booking.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Full Name *
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dr. Sarah Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Work Email *
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    placeholder="sarah@beaconhealth.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Practice / Clinic Name *
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Beacon Health Therapy"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Password * (min. 8 characters)
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-10 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Clinical Role Selection */}
          <div className="space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-lg font-bold text-gray-900">2. Primary Role in the Clinic</h2>
              <p className="text-xs text-gray-500">
                Determines your initial dashboard layout, caseload tools, and administrative permissions.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CLINICAL_ROLES.map((r) => {
                const isSelected = role === r.id;
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id as any)}
                    className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                      isSelected
                        ? 'border-[#5C2D91] bg-purple-50/60 shadow-xs ring-2 ring-[#5C2D91]/20'
                        : 'border-gray-200 bg-white hover:border-purple-200 hover:bg-gray-50/50'
                    }`}
                  >
                    <span
                      className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl text-xs font-bold ${
                        isSelected ? 'bg-[#5C2D91] text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-gray-900 leading-tight">{r.label}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{r.group}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Pricing Plan Selection */}
          <div className="space-y-4">
            <div className="border-b border-gray-100 pb-2 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">3. Select Practice Plan</h2>
                <p className="text-xs text-gray-500">
                  Select your practice tier. You can switch or upgrade anytime from your dashboard.
                </p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                14-Day Free Trial
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((p) => {
                const isSelected = plan === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setPlan(p.id)}
                    className={`relative cursor-pointer flex flex-col justify-between rounded-2xl border p-4 transition ${
                      isSelected
                        ? 'border-[#5C2D91] bg-purple-50/40 shadow-md ring-2 ring-[#5C2D91]/30'
                        : 'border-gray-200 bg-white hover:border-purple-200 hover:shadow-xs'
                    }`}
                  >
                    {p.popular && (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-[#5C2D91] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-xs">
                        Most Popular
                      </span>
                    )}

                    <div>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-900">{p.name}</h3>
                        <div
                          className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                            isSelected
                              ? 'border-[#5C2D91] bg-[#5C2D91] text-white'
                              : 'border-gray-300 bg-white'
                          }`}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5" />}
                        </div>
                      </div>

                      <div className="mt-2 flex items-baseline">
                        <span className="text-2xl font-black text-gray-900">{p.price}</span>
                        <span className="text-xs font-semibold text-gray-500 ml-1">{p.period}</span>
                      </div>

                      <p className="mt-1 text-[11px] font-bold text-[#5C2D91]">{p.limits}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{p.tagline}</p>

                      <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                        {p.features.map((feat) => (
                          <li key={feat} className="flex items-start gap-1.5 text-[11px] text-gray-600">
                            <Check className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 4: Business Associate Agreement */}
          <div className="space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-lg font-bold text-gray-900">4. Business Associate Agreement</h2>
              <p className="text-xs text-gray-500">
                {BAA_TITLE} · version {BAA_VERSION}
              </p>
            </div>
            {!BAA_LEGAL_REVIEWED ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                {BAA_DRAFT_BANNER}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setBaaOpen((v) => !v)}
                className="rounded-lg border border-[#5C2D91]/30 px-3 py-1.5 text-xs font-semibold text-[#5C2D91]"
              >
                {baaOpen ? 'Hide' : 'Read'} agreement
              </button>
              <a
                href="/legal/baa"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Open in new tab
              </a>
            </div>
            {baaOpen ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {baaPlainText()}
              </pre>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="Signer name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
              />
              <input
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="Signer title"
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
              />
              <input
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                type="email"
                placeholder="Signer email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={baaAccepted}
                onChange={(e) => setBaaAccepted(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-[#5C2D91]"
              />
              <span>{baaAttestation(orgName.trim() || 'this organization')}</span>
            </label>
          </div>

          {/* Submit Action */}
          <div className="border-t border-gray-100 pt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>{GET_STARTED.trust}</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white shadow-md transition disabled:opacity-60 hover:opacity-95"
              style={{ background: GRADIENT }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating Practice Account…
                </>
              ) : (
                <>
                  Continue to Clinical Setup <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Existing account link */}
        <p className="mt-6 text-center text-sm text-gray-600">
          Already have a staff account?{' '}
          <Link href="/login" className="font-bold text-[#5C2D91] hover:underline">
            Sign in here →
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function GetStartedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center py-16 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin text-[#5C2D91]" /> Loading registration…
        </div>
      }
    >
      <GetStartedContent />
    </Suspense>
  );
}
