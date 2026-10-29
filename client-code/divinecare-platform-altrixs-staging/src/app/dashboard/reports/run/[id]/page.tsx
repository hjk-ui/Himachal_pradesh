'use client';

import { useParams } from 'next/navigation';
import { Alert, LoadingState, Page } from '@/components/ui';
import { ReportRunner } from '@/features/reports/ReportRunner';
import { useReportLibrary } from '@/features/reports/libraryClient';

/** /dashboard/reports/run/[id]: one library report (parameters, results, exports, definitions). */
export default function ReportRunPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useReportLibrary();
  if (error) {
    return (
      <Page width="narrow">
        <Alert tone="danger">{error}</Alert>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page>
        <LoadingState label="Loading report" />
      </Page>
    );
  }
  return <ReportRunner id={String(params.id ?? '')} library={data} />;
}
