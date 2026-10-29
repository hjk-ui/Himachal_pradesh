import { Page, PageHeader, StatusBadge } from '@/components/ui';
import { LeadsWorkspace } from '../_components/LeadsWorkspace';

export const metadata = { title: 'Lead inbox' };

/** Lead pipeline + conversations for intake staff (Front Desk) and marketing roles. */
export default function LeadInboxPage() {
  return (
    <Page width="full">
      <PageHeader
        title="Lead inbox"
        description="Prospective clients from web forms, calls, partners and events. Respond fast, keep notes minimum necessary, convert to a client in one step."
        badges={<StatusBadge tone="brand">Prospective clients</StatusBadge>}
      />
      <LeadsWorkspace />
    </Page>
  );
}
