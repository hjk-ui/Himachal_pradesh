import { redirect } from 'next/navigation';

/** Legacy placeholder — send staff to the real dashboard */
export default function ClinicianPage() {
  redirect('/dashboard');
}
