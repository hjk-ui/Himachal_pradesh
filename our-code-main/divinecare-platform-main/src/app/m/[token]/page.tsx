import type { Metadata } from 'next';
import { PatientMeasureForm } from '@/components/measures/PatientMeasureForm';

// The URL carries a one-time-use secret: keep it out of indexes and referrers.
export const metadata: Metadata = {
  title: 'Questionnaire',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function MeasurePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PatientMeasureForm token={token} />;
}
