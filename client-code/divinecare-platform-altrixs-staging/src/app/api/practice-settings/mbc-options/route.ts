import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendableInstruments } from '@/lib/measures/instruments';
import { practiceError, practiceGate } from '../_lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDER_ROLES = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'CASE_MANAGER'] as Role[];

/**
 * GET: choices for the Measurement-based care rules (Practice settings > Clinical policy): the
 * measures a patient can complete from a link, intensive programs and providers. No PHI.
 */
export async function GET() {
  const g = await practiceGate('read');
  if (!g.ok) return g.response;
  try {
    const [programs, providers] = await Promise.all([
      prisma.intensiveProgram.findMany({ where: { organizationId: g.actor.organizationId, active: true }, select: { id: true, name: true, programType: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        where: { organizationId: g.actor.organizationId, status: 'ACTIVE', role: { in: PROVIDER_ROLES } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
    ]);
    return NextResponse.json({
      success: true,
      instruments: sendableInstruments().map((i) => ({ id: i.id, name: i.name, fullName: i.fullName })),
      programs,
      providers: providers.map((u) => ({ id: u.id, name: u.name || u.email, role: String(u.role) })),
    });
  } catch (error) {
    return practiceError(error, 'Could not load measurement-based care options');
  }
}
