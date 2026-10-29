import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        ...(gate.organizationId ? { organizationId: gate.organizationId } : {}),
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    const palette = ['#5C2D91', '#0284C7', '#10B981', '#7C3AED', '#F59E0B', '#EC4899', '#0891B2', '#5C2D91'];

    const roster = users.map((u, idx) => {
      const parts = (u.name || '').trim().split(' ').filter(Boolean);
      const initials =
        parts.length >= 2
          ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
          : (u.name || 'MD').slice(0, 2).toUpperCase();

      const roleStr = String(u.role || 'CLINICIAN');
      const formattedRole =
        roleStr === 'THERAPIST'
          ? 'Therapist'
          : roleStr === 'PSYCHIATRIST'
          ? 'Psychiatrist'
          : roleStr === 'NP' || roleStr === 'MEDICAL_NP'
          ? 'Nurse Practitioner'
          : roleStr === 'CASE_MANAGER'
          ? 'Case Manager'
          : roleStr === 'PEER_SUPPORT'
          ? 'Peer Support'
          : roleStr === 'PRP_SPECIALIST'
          ? 'PRP Specialist'
          : roleStr === 'PHYSICIAN'
          ? 'Physician'
          : 'Clinician';

      return {
        id: u.id,
        name: u.name || u.email,
        email: u.email,
        role: formattedRole,
        initials,
        avatarColor: palette[idx % palette.length],
      };
    });

    return NextResponse.json({ success: true, roster });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch roster' },
      { status: 500 }
    );
  }
}
