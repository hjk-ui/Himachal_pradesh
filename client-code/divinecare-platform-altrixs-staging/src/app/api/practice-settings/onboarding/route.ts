import { NextResponse } from 'next/server';
import { saveOnboardingProgress } from '@/lib/practice/store';
import { practiceError, practiceGate } from '../_lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PUT { step, complete }: setup-wizard resume point; completion is audited. Leadership only. */
export async function PUT(request: Request) {
  const g = await practiceGate('write', 'practice_onboarding_write');
  if (!g.ok) return g.response;
  try {
    const settings = await saveOnboardingProgress(g.actor, await request.json().catch(() => ({})));
    return NextResponse.json({ success: true, onboardingStep: settings.onboardingStep, onboardingCompletedAt: settings.onboardingCompletedAt });
  } catch (error) {
    return practiceError(error, 'Could not save setup progress');
  }
}
