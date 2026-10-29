import { createHash, randomBytes } from 'crypto';
import { hash } from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/mail/sendEmail';
import { assignUserToLocation } from '@/lib/org/locations';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { normalizeUserRoles, pickPrimaryRole } from '@/lib/auth/userRoles';
import type { StaffRole } from '@/types/roles';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getAppBaseUrl() {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function hashInviteToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

function newInviteToken() {
  return randomBytes(32).toString('hex');
}

type InviteInput = {
  name: string;
  email: string;
  role: Role;
  roles?: Role[];
  invitedById: string;
  organizationId: string;
  locationId?: string | null;
};

function resolveRoles(input: { role: Role; roles?: Role[] }) {
  const roles = normalizeUserRoles(input.role, input.roles) as Role[];
  const primary = pickPrimaryRole(roles as StaffRole[], input.role as StaffRole) as Role;
  return { role: primary, roles };
}

export async function createStaffInvite(input: InviteInput) {
  if (input.role === 'SUPER_ADMIN' || input.roles?.includes('SUPER_ADMIN')) {
    return { ok: false as const, error: 'Cannot invite platform admins via clinic invite', status: 400 };
  }

  const { role, roles } = resolveRoles(input);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.status === 'ACTIVE' && existing.passwordHash) {
      return { ok: false as const, error: 'A user with this email already exists', status: 409 };
    }
    if (existing.status === 'DEACTIVATED') {
      return {
        ok: false as const,
        error: 'This account is deactivated. Reactivate it instead of inviting again.',
        status: 409,
      };
    }
    if (existing.organizationId && existing.organizationId !== input.organizationId) {
      return {
        ok: false as const,
        error: 'This email belongs to another organization',
        status: 409,
      };
    }
    // Re-invite pending user — refresh name/role/location then resend
    const locationId =
      input.locationId || (await getPrimaryLocationId(input.organizationId));
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        role,
        roles,
        organizationId: input.organizationId,
        primaryLocationId: locationId,
      },
    });
    if (locationId) {
      await assignUserToLocation(existing.id, locationId, true, input.organizationId);
    }
    return resendStaffInvite(existing.id, input.invitedById, input.organizationId);
  }

  const rawToken = newInviteToken();
  const inviteTokenHash = hashInviteToken(rawToken);
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const locationId =
    input.locationId || (await getPrimaryLocationId(input.organizationId));

  const user = await prisma.user.create({
    data: {
      name,
      email,
      role,
      roles,
      status: 'INVITED',
      passwordHash: null,
      inviteTokenHash,
      inviteExpiresAt,
      invitedById: input.invitedById,
      organizationId: input.organizationId,
      primaryLocationId: locationId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
      status: true,
      createdAt: true,
      inviteExpiresAt: true,
    },
  });

  if (locationId) {
    await assignUserToLocation(user.id, locationId, true, input.organizationId);
  }

  const mail = await sendInviteEmail({
    to: email,
    name,
    role,
    rawToken,
  });

  return {
    ok: true as const,
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
      inviteExpiresAt: user.inviteExpiresAt?.toISOString() ?? null,
    },
    emailMode: mail.mode,
  };
}

export async function resendStaffInvite(
  userId: string,
  invitedById: string,
  organizationId?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }
  if (organizationId && user.organizationId !== organizationId) {
    return { ok: false as const, error: 'User not found', status: 404 };
  }
  if (user.status === 'DEACTIVATED') {
    return { ok: false as const, error: 'Cannot invite a deactivated user', status: 400 };
  }
  if (user.status === 'ACTIVE' && user.passwordHash) {
    return { ok: false as const, error: 'User already activated', status: 400 };
  }

  const rawToken = newInviteToken();
  const inviteTokenHash = hashInviteToken(rawToken);
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'INVITED',
      passwordHash: null,
      inviteTokenHash,
      inviteExpiresAt,
      invitedById,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      inviteExpiresAt: true,
    },
  });

  const mail = await sendInviteEmail({
    to: updated.email,
    name: updated.name || 'there',
    role: updated.role,
    rawToken,
  });

  return {
    ok: true as const,
    user: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      inviteExpiresAt: updated.inviteExpiresAt?.toISOString() ?? null,
    },
    emailMode: mail.mode,
  };
}

export async function getInviteByToken(rawToken: string) {
  if (!rawToken || rawToken.length < 20) {
    return { ok: false as const, error: 'Invalid invite link' };
  }

  const inviteTokenHash = hashInviteToken(rawToken);
  const user = await prisma.user.findFirst({
    where: { inviteTokenHash, status: 'INVITED' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      inviteExpiresAt: true,
    },
  });

  if (!user) {
    return { ok: false as const, error: 'Invite not found or already used' };
  }
  if (!user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now()) {
    return { ok: false as const, error: 'This invite has expired. Ask your admin to resend it.' };
  }

  return {
    ok: true as const,
    invite: {
      name: user.name,
      email: user.email,
      role: user.role,
      expiresAt: user.inviteExpiresAt.toISOString(),
    },
  };
}

export async function acceptStaffInvite(rawToken: string, password: string) {
  if (password.length < 8) {
    return { ok: false as const, error: 'Password must be at least 8 characters' };
  }

  const inviteTokenHash = hashInviteToken(rawToken);
  const user = await prisma.user.findFirst({
    where: { inviteTokenHash, status: 'INVITED' },
  });

  if (!user) {
    return { ok: false as const, error: 'Invite not found or already used' };
  }
  if (!user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now()) {
    return { ok: false as const, error: 'This invite has expired. Ask your admin to resend it.' };
  }

  const passwordHash = await hash(password, 12);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      status: 'ACTIVE',
      inviteTokenHash: null,
      inviteExpiresAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });

  return { ok: true as const, user: updated };
}

async function sendInviteEmail(input: {
  to: string;
  name: string;
  role: Role;
  rawToken: string;
}) {
  const link = `${getAppBaseUrl()}/invite/accept?token=${input.rawToken}`;
  const roleLabel = input.role.replace(/_/g, ' ');

  const text = [
    `Hi ${input.name},`,
    '',
    `You've been invited to join Altrixs as ${roleLabel}.`,
    '',
    'Open this link to set your password and activate your account:',
    link,
    '',
    'This invite expires in 7 days.',
    '',
    'If you did not expect this email, you can ignore it.',
  ].join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px;color:#6868D0">You're invited to Altrixs</h2>
      <p style="margin:0 0 16px;color:#475569">Hi ${escapeHtml(input.name)},</p>
      <p style="margin:0 0 16px;color:#475569">
        You've been invited to join the staff portal as
        <strong>${escapeHtml(roleLabel)}</strong>.
      </p>
      <p style="margin:0 0 20px">
        <a href="${link}"
           style="display:inline-block;background:#6868D0;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">
          Set password &amp; join
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b">Or copy this link:</p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#6868D0">${link}</p>
      <p style="margin:0;font-size:12px;color:#94a3b8">This invite expires in 7 days.</p>
    </div>
  `;

  return sendEmail({
    to: input.to,
    subject: 'You are invited to Altrixs',
    text,
    html,
    context: 'staff-invite',
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
