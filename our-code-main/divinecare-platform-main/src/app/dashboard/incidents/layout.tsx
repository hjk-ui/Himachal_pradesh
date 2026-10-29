import { IncidentNarrativeNotice } from '@/components/dashboard/OpenCheckNotices';

export default function IncidentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <IncidentNarrativeNotice />
      {children}
    </>
  );
}
