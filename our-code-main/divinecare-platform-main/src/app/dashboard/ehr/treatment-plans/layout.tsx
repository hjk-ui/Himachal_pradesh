import { LivePlanNotice } from '@/components/dashboard/OpenCheckNotices';

export default function TreatmentPlansLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LivePlanNotice />
      {children}
    </>
  );
}
