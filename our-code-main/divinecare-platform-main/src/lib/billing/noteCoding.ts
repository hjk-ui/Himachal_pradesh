import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { CPT_CATALOG } from '@/features/billing/billingHubData';

export function extractNoteCpt(body: string, appointmentType?: string | null) {
  const metadata = parseNoteMeta(body);
  const selected = metadata.billingCode?.toUpperCase();
  if (selected && (Object.hasOwn(CPT_CATALOG, selected) || /^(90[0-9]{3}|96[0-9]{3}|99[0-9]{3}|[HT][0-9]{4})$/i.test(selected))) return selected;
  const match = metadata.displayBody.match(/\b(90[0-9]{3}|96[0-9]{3}|99[0-9]{3}|[HT][0-9]{4})\b/i);
  if (match) return match[1].toUpperCase();
  const type = (appointmentType || '').toLowerCase();
  if (type.includes('eval') || type.includes('intake')) return '90791';
  if (type.includes('family')) return '90847';
  if (type.includes('prp')) return 'H2017';
  return '90834';
}
