import { redirect } from 'next/navigation';

export default function StatementsRedirect() {
  redirect('/dashboard/billing/statements');
}
