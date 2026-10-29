import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Join session',
};

export default function GroupTelehealthJoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
