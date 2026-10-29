'use client';

import { useEffect, useState } from 'react';
import { LabWorklist } from '@/components/labs/LabWorklist';
import { Page, PageHeader } from '@/components/ui';

/** EHR › Labs: practice-wide lab worklist (orders by stage, unreviewed / critical results, standing orders due).
 *  ?clientId= (Visit Guide "Order labs") narrows the worklist to that patient and preselects them on a new order. */
export default function LabsPage() {
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setClientId(new URLSearchParams(window.location.search).get('clientId')?.trim() || undefined);
    setReady(true);
  }, []);
  const clearClient = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setClientId(undefined);
  };
  return (
    <Page>
      <PageHeader title="Lab Orders & Results" description="Ordering, collection, result entry, provider sign-off and portal release" />
      {ready ? <LabWorklist key={clientId ?? 'all'} clientId={clientId} onClearClient={clearClient} /> : null}
    </Page>
  );
}
