'use client';

import MedicalNavHeader from '@/features/medical/components/MedicalNavHeader';
import { LabWorklist } from '@/components/labs/LabWorklist';

/**
 * Primary care › Labs: the same lab worklist as EHR › Labs, limited to primary-care patients
 * (medicalProgram.primaryCarePatientWhere) and the viewer's care-team scope.
 */
export default function MedicalLabsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 pb-16">
      <MedicalNavHeader
        title="Primary Care Labs"
        subtitle="Lab orders, results review and sign-off for primary-care patients"
        badge="Requisitions print; no electronic lab interface yet"
      />
      <div className="min-w-0">
        <LabWorklist program="medical" />
      </div>
    </div>
  );
}
