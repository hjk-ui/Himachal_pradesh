// Test-only browser harness: the actual page components, with framework shell mocked.
import { createRoot } from 'react-dom/client';
import NotesPage from '../../src/app/dashboard/ehr/notes/page';
import TreatmentPlansPage from '../../src/app/dashboard/ehr/treatment-plans/page';
import BillingPage from '../../src/app/dashboard/billing/page';
import AppointmentsPage from '../../src/app/dashboard/appointments/page';
import ServiceEligibilityScanner from '../../src/components/clinical/ServiceEligibilityScanner';
const view = new URLSearchParams(window.location.search).get('view');
const Page =
  view === 'notes'
    ? NotesPage
    : view === 'plans'
      ? TreatmentPlansPage
      : view === 'billing'
        ? BillingPage
        : view === 'appointments'
          ? AppointmentsPage
          : ServiceEligibilityScanner;
createRoot(document.getElementById('root')!).render(
  <main className="mx-auto max-w-screen-2xl p-4 sm:p-8">
    <Page />
  </main>,
);
