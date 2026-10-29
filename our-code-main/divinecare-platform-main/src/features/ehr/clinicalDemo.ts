import type { Client, EhrProgressNote } from '@/features/clients/types';
import type { TreatmentPlanRecord } from './treatmentPlansApi';
import { SCANNER_PATIENTS } from './scannerData';
import { NOTE_TYPES, NOTE_SECTIONS } from '@/lib/ehr/noteTemplates';
import { EMPTY_PLAN_CARE, PRACTICE_TEMPLATES, DIAGNOSIS_OPTIONS } from '@/lib/ehr/planLibrary';

export const CLINICAL_DEMO_CLIENTS: Client[] = SCANNER_PATIENTS.map((patient) => ({
  id: patient.id,
  name: patient.name,
  email: '',
  phone: '',
  assignedSince: '2026-09-01',
  lastCheckIn: '2026-09-10',
  avgMood: null,
  avgStress: null,
  streak: 0,
  risk: 'low',
  totalSessions: 0,
  primaryDiagnosis: patient.diagnosis,
}));
export const CLINICAL_DEMO_NOTES: EhrProgressNote[] =
  CLINICAL_DEMO_CLIENTS.length > 0
    ? NOTE_TYPES.map((type, index) => {
        const client = CLINICAL_DEMO_CLIENTS[index % CLINICAL_DEMO_CLIENTS.length];
        return {
          id: `preview-note-${index}`,
          clientId: client.id,
          clientName: client.name,
          body: NOTE_SECTIONS[type]
            .map(
              (section) =>
                `${section}\n${section === 'Plan' || section === 'Next Steps' ? 'Review goals with the client at the next scheduled contact.' : `Illustrative ${section.toLowerCase()} documentation for ${client.name}. Personalize this draft after clinical review.`}`,
            )
            .join('\n\n'),
          createdAt: '2026-09-10T09:00:00.000Z',
          clinicianName: 'Demo clinician',
          noteType: type,
          durationMinutes: 50,
          billingCode: index % 2 ? '90834' : '90837',
          telehealth: type === 'Telephone',
          placeOfService: type === 'Telephone' ? '10' : '11',
          sudConfidential: type === 'SUD',
          workflowStatus: 'Draft',
        };
      })
    : [];

export const CLINICAL_DEMO_PLANS: TreatmentPlanRecord[] =
  CLINICAL_DEMO_CLIENTS.length > 0
    ? PRACTICE_TEMPLATES.map((template, index) => ({
        id: `preview-plan-${index}`,
        clientId: CLINICAL_DEMO_CLIENTS[index]?.id || '',
        clientName: CLINICAL_DEMO_CLIENTS[index]?.name || '',
        clinicianId: null,
        clinicianName: 'Demo clinician',
        title: DIAGNOSIS_OPTIONS.find((dx) => dx.icd === template.icd)?.dsm || template.name,
        diagnosisCodes: [template.icd],
        status: 'ACTIVE',
        reviewDueAt: '2026-12-01T00:00:00.000Z',
        startDate: '2026-09-02',
        strengths: 'Engaged in collaborative planning; identified community support.',
        presentingProblems: 'Illustrative care plan for demonstration.',
        secondaryDx: null,
        clientSigned: false,
        clinicalDetails: {
          ...EMPTY_PLAN_CARE,
          planType: template.planType,
          levelOfCare: 'Outpatient',
          serviceFrequency: 'Weekly',
          expectedDuration: '90 days',
          coordinationOfCare: 'Coordinate with PCP and family with appropriate consent.',
          barriersToTreatment: 'Transportation and scheduling; review support options.',
        },
        goals: template.goals.map((goal, goalIndex) => ({
          ...goal,
          objectives: [...goal.objectives],
          interventions: [...goal.interventions],
          id: `preview-goal-${index}-${goalIndex}`,
          progress: 25,
          targetDate: '2026-12-01',
        })),
      }))
    : [];
