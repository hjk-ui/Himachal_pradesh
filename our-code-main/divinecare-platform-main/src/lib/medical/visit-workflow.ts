import { getRooming, computeVitalFlags, scheduleChip, type RoomingRecord } from '@/lib/medical/rooming';
import { listCareGaps, type CareGapRow } from '@/lib/medical/care-gaps';
import { listReferrals, warmHandoffIndicated, type MedicalReferral } from '@/lib/medical/referrals';
import { listStandingOrders, approvedStandingOrdersOnly } from '@/lib/medical/standing-orders';
import { listMedicalTasks, type MedicalTask } from '@/lib/medical/tasks';

export type EmSuggestion = {
  code: string;
  label: string;
  basis: 'mdm' | 'time' | 'preventive' | 'awv';
};

/** E/M suggestions only — provider picks. No auto-assign. */
export function suggestEmCodes(input: {
  ageYears: number | null;
  medicare: boolean;
  minutes?: number | null;
}): EmSuggestion[] {
  const out: EmSuggestion[] = [
    { code: '99212', label: 'Office visit, established, straightforward MDM', basis: 'mdm' },
    { code: '99213', label: 'Office visit, established, low MDM', basis: 'mdm' },
    { code: '99214', label: 'Office visit, established, moderate MDM', basis: 'mdm' },
    { code: '99215', label: 'Office visit, established, high MDM', basis: 'mdm' },
  ];
  if (typeof input.minutes === 'number' && input.minutes >= 40) {
    out.push({ code: '99215', label: 'Time-based (≥40 min total)', basis: 'time' });
  } else if (typeof input.minutes === 'number' && input.minutes >= 30) {
    out.push({ code: '99214', label: 'Time-based (30–39 min total)', basis: 'time' });
  } else if (typeof input.minutes === 'number' && input.minutes >= 20) {
    out.push({ code: '99213', label: 'Time-based (20–29 min total)', basis: 'time' });
  }
  if (typeof input.ageYears === 'number') {
    if (input.ageYears >= 65) {
      out.push({ code: '99397', label: 'Preventive visit, established, 65+', basis: 'preventive' });
    } else if (input.ageYears >= 40) {
      out.push({ code: '99396', label: 'Preventive visit, established, 40–64', basis: 'preventive' });
    } else if (input.ageYears >= 18) {
      out.push({ code: '99395', label: 'Preventive visit, established, 18–39', basis: 'preventive' });
    }
  }
  if (input.medicare) {
    out.push({ code: 'G0439', label: 'Medicare Annual Wellness Visit (subsequent)', basis: 'awv' });
    out.push({ code: 'G0438', label: 'Medicare Annual Wellness Visit (initial)', basis: 'awv' });
  }
  return out;
}

export type VisitWorkflowPayload = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  ageYears: number | null;
  medicare: boolean;
  prepare: {
    rooming: RoomingRecord | null;
    scheduleChip: string | null;
    vitalFlags: ReturnType<typeof computeVitalFlags>;
    chiefComplaint: string;
    reviews: {
      allergyReviewed: boolean;
      medicationReviewed: boolean;
      pharmacyReview: string | null;
      pharmacyChangedCopy: string | null;
    };
    screenings: RoomingRecord['screenings'] | null;
    approvedPoc: Array<{ id: string; name: string; cpt: string }>;
    bhSignal: { warmHandoff: boolean; reason: string | null };
    resultsAwaiting: string[];
  };
  during: {
    careGaps: CareGapRow[];
    warmHandoff: boolean;
    referrals: MedicalReferral[];
    drFirstPdmpPrompt: string;
    tasks: MedicalTask[];
  };
  wrapUp: {
    emSuggestions: EmSuggestion[];
    selectedCode: string | null;
  };
};

export async function buildVisitWorkflow(
  organizationId: string,
  input: {
    appointmentId: string;
    clientId: string;
    clientName: string;
    ageYears?: number | null;
    medicare?: boolean;
    minutes?: number | null;
    phq9?: number | null;
    gad7?: number | null;
  }
): Promise<VisitWorkflowPayload> {
  const rooming = await getRooming(organizationId, input.appointmentId);
  const careGaps = await listCareGaps(organizationId, input.clientId);
  const referrals = await listReferrals(organizationId, input.clientId);
  const orders = await listStandingOrders(organizationId);
  const approved = approvedStandingOrdersOnly(orders);
  const tasks = await listMedicalTasks(organizationId, { clientId: input.clientId });

  // Warm handoff uses explicit scores when provided; otherwise none on file
  const warm = warmHandoffIndicated(input.phq9 ?? null, input.gad7 ?? null);

  const pocIds = new Set(rooming?.pocOrderIds || []);
  const approvedPoc = approved
    .filter((o) => pocIds.size === 0 || pocIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name, cpt: o.cpt }));

  return {
    appointmentId: input.appointmentId,
    clientId: input.clientId,
    clientName: input.clientName,
    ageYears: input.ageYears ?? null,
    medicare: Boolean(input.medicare),
    prepare: {
      rooming,
      scheduleChip: rooming ? scheduleChip(rooming) : null,
      vitalFlags: rooming ? computeVitalFlags(rooming) : [],
      chiefComplaint: rooming?.chiefComplaint || '',
      reviews: {
        allergyReviewed: Boolean(rooming?.allergyReviewed),
        medicationReviewed: Boolean(rooming?.medicationReviewed),
        pharmacyReview: rooming?.pharmacyReview || null,
        pharmacyChangedCopy:
          rooming?.pharmacyReview === 'changed'
            ? 'Update it in DrFirst before the provider prescribes.'
            : null,
      },
      screenings: rooming?.screenings || null,
      approvedPoc,
      bhSignal: {
        warmHandoff: warm,
        reason: warm
          ? 'PHQ-9 or GAD-7 ≥10'
          : input.phq9 == null && input.gad7 == null
            ? 'none on file'
            : null,
      },
      resultsAwaiting: [],
    },
    during: {
      careGaps,
      warmHandoff: warm,
      referrals,
      drFirstPdmpPrompt:
        'Open DrFirst to prescribe and complete Maryland PDMP (CRISP) review before controlled substances.',
      tasks: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress'),
    },
    wrapUp: {
      emSuggestions: suggestEmCodes({
        ageYears: input.ageYears ?? null,
        medicare: Boolean(input.medicare),
        minutes: input.minutes ?? null,
      }),
      selectedCode: null,
    },
  };
}
