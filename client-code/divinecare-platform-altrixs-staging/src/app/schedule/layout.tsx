import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Schedule an Appointment',
  description: 'Book an appointment online with Altrixs.',
  robots: { index: true, follow: true },
};

/** Public booking surface — no DashboardShell / auth chrome. */
export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
