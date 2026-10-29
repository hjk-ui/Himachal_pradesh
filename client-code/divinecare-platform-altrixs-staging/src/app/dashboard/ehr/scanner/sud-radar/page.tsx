import Link from 'next/link';
import { ScanSearch } from 'lucide-react';
import SudReferralRadar from '@/components/clinical/SudReferralRadar';
import { PageHeader, buttonClasses } from '@/components/ui';

export default function SudReferralRadarPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="SUD Referral Radar"
        description="F10–F19 diagnoses on the chart and problem list, and substance-use language in signed notes and filed documents"
        actions={<>
          <Link
          href="/dashboard/ehr/scanner"
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
        >
          <ScanSearch size={14} aria-hidden /> Service Eligibility Scanner
        </Link>
        </>}
      />

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <ScanSearch size={18} className="mt-0.5 shrink-0 text-blue-600" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-blue-800">Clinical decision support — not a clinical determination</p>
          <p className="mt-0.5 text-xs text-blue-700">
            The SUD Referral Radar scans real chart data — F10–F19 diagnosis codes on the chart and problem list, and substance-use
            language in signed notes and filed documents with no SUD diagnosis charted. Everything shown is a screening suggestion — a
            licensed clinician must conduct a full assessment before initiating any referral or treatment.
          </p>
        </div>
      </div>

      <SudReferralRadar />
    </div>
  );
}
