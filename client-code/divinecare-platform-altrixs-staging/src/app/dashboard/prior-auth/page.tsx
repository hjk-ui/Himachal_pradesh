import { redirect } from 'next/navigation';
import { legacyRedirectUrl } from '@/components/layout/navRedirects';

/** Merged into /dashboard/billing/authorizations; kept so bookmarks keep working. */
export default async function LegacyPriorAuthRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyRedirectUrl('/dashboard/prior-auth', await searchParams));
}
