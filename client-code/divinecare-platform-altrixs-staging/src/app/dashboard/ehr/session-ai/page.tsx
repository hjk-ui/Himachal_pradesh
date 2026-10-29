import { redirect } from 'next/navigation';
import { legacyRedirectUrl } from '@/components/layout/navRedirects';

/**
 * AI Session Notes was folded into AI Scribe ("Paste or import"): one AI documentation workflow,
 * every sentence grounded with citations, signing only in Notes. Old links and bookmarks land on
 * the scribe in paste mode with their query parameters (clientId …) and a one-line notice.
 */
export default async function LegacySessionAiRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyRedirectUrl('/dashboard/ehr/session-ai', await searchParams));
}
