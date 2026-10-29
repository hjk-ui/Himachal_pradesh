import type { Metadata } from 'next';
import { TRIAL_DAYS } from '@/lib/billing/plans';

export const metadata: Metadata = {
  title: { absolute: 'Get Started | Altrixs Behavioral Health EHR' },
  description: `Start a ${TRIAL_DAYS}-day free trial of Altrixs, the behavioral health EHR with AI Scribe, e-prescribing, telehealth, billing and primary care in one chart.`,
};

export default function GetStartedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
