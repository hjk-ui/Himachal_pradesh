import { SchedulingThreadNotice } from '@/components/dashboard/OpenCheckNotices';

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SchedulingThreadNotice />
      {children}
    </>
  );
}
