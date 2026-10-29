import { redirect } from 'next/navigation';
import ServiceEligibilityScanner from '@/components/clinical/ServiceEligibilityScanner';
import { radarRedirectTarget } from '@/lib/clinical/serviceEligibility/routes';

export default async function ServiceScannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const target = radarRedirectTarget(await searchParams);
  if (target) redirect(target);
  return (
    <div className="mx-auto max-w-6xl">
      <ServiceEligibilityScanner />
    </div>
  );
}
