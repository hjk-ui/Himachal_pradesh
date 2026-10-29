import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/layout/PlatformShell';
import { requireSession } from '@/lib/auth/requireSession';

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gate = await requireSession();
  if (!gate.ok) {
    // Layouts cannot modify cookies — proxy clears session on ?error=
    redirect('/login?error=SessionExpired');
  }
  if (gate.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  return <PlatformShell>{children}</PlatformShell>;
}
