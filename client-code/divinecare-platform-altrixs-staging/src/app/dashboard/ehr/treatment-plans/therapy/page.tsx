'use client';

import { Suspense } from 'react';
import { TherapyPlanEditor } from '@/components/therapy/TherapyPlanEditor';

/** Treatment Plan template (initial / review): /dashboard/ehr/treatment-plans/therapy?clientId=&planId=&kind=Review&fromNoteId= */
export default function TherapyTreatmentPlanPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <TherapyPlanEditor />
    </Suspense>
  );
}
