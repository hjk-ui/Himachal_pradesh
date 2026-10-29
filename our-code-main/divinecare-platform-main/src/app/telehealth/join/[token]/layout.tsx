import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Join visit',
};

export default function TelehealthJoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
