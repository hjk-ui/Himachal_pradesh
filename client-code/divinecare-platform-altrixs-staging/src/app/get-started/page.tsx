'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { finishStaffSignIn, startStaffSignIn } from '@/features/auth/api/authApi';
import { PASSWORD_MIN_LENGTH, passwordLengthError } from '@/lib/auth/passwordRules';
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
import { SALES_CONTACT_HREF, TIERS, TRIAL_DAYS, TRIAL_RULE, tierFromLegacyPlan, type BillingInterval } from '@/lib/billing/plans';
import { IntervalToggle, ProposedPricingNotice, TierPrice } from '@/components/marketing/PricingPlans';
import {
  BaaAcceptanceFields,
  EMPTY_BAA_ACCEPTANCE,
  baaClientError,
  baaRequestBody,
  type BaaAcceptanceValue,
} from '@/components/legal/BaaAcceptanceFields';

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7C3AED)';

type SelfServeTier = 'starter' | 'professional' | 'clinic';
const SIGNUP_TIERS: SelfServeTier[] = ['starter', 'professional', 'clinic'];

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
  const [plan, setPlan] = useState<SelfServeTier>('starter');
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [baa, setBaa] = useState<BaaAcceptanceValue>(EMPTY_BAA_ACCEPTANCE);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tier = tierFromLegacyPlan(planParam?.toLowerCase());
    if (tier && tier !== 'enterprise') setPlan(tier);
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
    const lengthError = passwordLengthError(password);
    if (lengthError) {
      setError(lengthError);
      return;
    }
    if (!orgName.trim() || orgName.trim().length < 2) {
      setError('Please enter your practice or organization name.');
      return;
    }
    // Registration is blocked until an authorized signer accepts the BAA (the API enforces it too).
    const baaError = baaClientError(baa);
    if (baaError) {
      setError(baaError);
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
          baa: baaRequestBody(baa),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create account.');
      }

      // 2. Sign in immediately via NextAuth
      // Two-factor sign-in is required for staff: the login page walks through authenticator setup
      const loginUrl = `/login?registered=1&email=${encodeURIComponent(email.trim().toLowerCase())}`;
      try {
        const step = await startStaffSignIn(email, password);
        if (step.next !== 'done') {
          router.push(loginUrl);
          return;
        }
        await finishStaffSignIn(step.ticket);
      } catch {
        router.push(loginUrl);
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
    <div className="min-h-[100dvh] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-50/70 via-white to-slate-50 py-10 px-4 sm:px-6 lg:px-8">
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
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            Start your free trial
          </h1>
          <p className="mt-2 text-base text-gray-600">
            Set up your practice on the Altrixs behavioral health EHR. Built for solo clinicians, group practices and multi-site clinics.
          </p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-3xl border border-gray-200 bg-white p-4 shadow-xl sm:p-10 space-y-8"
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
                Your credentials and clinic name, used for secure staff access and client booking.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Full Name *
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dr. Sarah Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 min-h-11 text-base text-gray-900 outline-none transition sm:text-sm focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Work Email *
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-500" />
                  <input
                    type="email"
                    required
                    placeholder="sarah@beaconhealth.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 min-h-11 text-base text-gray-900 outline-none transition sm:text-sm focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Practice / Clinic Name *
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Beacon Health Therapy"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 min-h-11 text-base text-gray-900 outline-none transition sm:text-sm focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Password * (min. {PASSWORD_MIN_LENGTH} characters)
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-gray-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-10 py-2.5 min-h-11 text-base text-gray-900 outline-none transition sm:text-sm focus:border-[#5C2D91] focus:bg-white focus:ring-4 focus:ring-purple-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:text-gray-600"
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
            <div className="border-b border-gray-100 pb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">3. Select Practice Plan</h2>
                <p className="text-xs text-gray-500">
                  Your {TRIAL_DAYS}-day free trial starts on the plan you pick. No card needed now; you can change plans any time.
                </p>
              </div>
              <IntervalToggle value={interval} onChange={setBillingInterval} />
            </div>

            <ProposedPricingNotice />

            <div className="grid gap-4 md:grid-cols-3">
              {SIGNUP_TIERS.map((id) => {
                const t = TIERS[id];
                const isSelected = plan === id;
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setPlan(id)}
                    aria-pressed={isSelected}
                    className={`relative flex flex-col rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-[#5C2D91] bg-purple-50/40 shadow-md ring-2 ring-[#5C2D91]/30'
                        : 'border-gray-200 bg-white hover:border-purple-200'
                    }`}
                  >
                    {t.popular ? (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-[#5C2D91] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white">
                        Most popular
                      </span>
                    ) : null}
                    <span className="flex items-center justify-between">
                      <span className="text-sm font-bold text-gray-900">{t.name}</span>
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                          isSelected ? 'border-[#5C2D91] bg-[#5C2D91] text-white' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="h-2.5 w-2.5" />}
                      </span>
                    </span>
                    <span className="mt-0.5 text-[11px] font-bold text-[#5C2D91]">{t.audience}</span>
                    <span className="mt-2 block">
                      <TierPrice tier={id} interval={interval} />
                    </span>
                    <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
                      {t.highlights.map((feat) => (
                        <li key={feat} className="flex items-start gap-1.5 text-[11px] text-gray-600">
                          <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-relaxed text-gray-500">
              {TRIAL_RULE} Need 25+ clinicians, a CCBHC contract or custom integrations?{' '}
              <a href={SALES_CONTACT_HREF} className="font-bold text-[#5C2D91] hover:underline">
                Ask about Enterprise
              </a>
              . <Link href="/pricing" className="font-bold text-[#5C2D91] hover:underline">Compare all features</Link>.
            </p>
          </div>

          {/* Business Associate Agreement (click-through, src/lib/legal/baa.ts) */}
          <div className="space-y-3 border-t border-gray-100 pt-6">
            <h2 className="text-lg font-bold text-gray-900">4. Business Associate Agreement</h2>
            <BaaAcceptanceFields organizationName={orgName} value={baa} onChange={setBaa} />
          </div>

          {/* Submit Action */}
          <div className="border-t border-gray-100 pt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>Role-based access, two-factor sign-in and audit logging from day one</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white shadow-md sm:w-auto transition disabled:opacity-60 hover:opacity-95"
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
        <div className="flex min-h-[100dvh] items-center justify-center py-16 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin text-[#5C2D91]" /> Loading registration…
        </div>
      }
    >
      <GetStartedContent />
    </Suspense>
  );
}
