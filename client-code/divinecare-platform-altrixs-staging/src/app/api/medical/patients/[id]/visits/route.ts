import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  errorMessage,
  isMedicalProvider,
  MEDICAL_RULE,
  noLinkedClientResponse,
  providerOnlyResponse,
  requireMedicalPatient,
} from '../../../_lib/patientContext';
import { vitalColumns, vitalsSchema } from '../../../_lib/vitals';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadCurrentPcp } from '@/lib/medical/pcpAssignmentDb';
import { pcpSuggestionAfterVisit } from '@/lib/medical/pcpAssignment';

export const runtime = 'nodejs';

const signSchema = z.object({
  visitType: z.string().trim().min(1).max(80),
  isTelehealth: z.boolean().default(false),
  chiefComplaint: z.string().trim().max(500).optional().nullable(),
  subjective: z.string().trim().min(1, 'Document the HPI before signing').max(20000),
  objective: z.string().trim().max(20000).optional().nullable(),
  assessment: z.string().trim().max(20000).optional().nullable(),
  plan: z.string().trim().max(20000).optional().nullable(),
  cptCode: z.string().trim().max(10).optional().nullable(),
  icd10Codes: z.array(z.string().trim().min(1).max(16)).max(24).default([]),
  /** Measured vitals; optional only when the MA already filed this appointment's vitals at rooming */
  vitals: vitalsSchema.optional(),
  /** Primary care appointment the visit documents (links the MA rooming record) */
  appointmentId: z.string().trim().max(64).optional().nullable(),
});

/**
 * Sign & lock a medical visit. Creates a signed MedicalVisit (no update route exists, so it
 * is immutable from the app) and the visit's measured vitals as a MedicalVital row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = await requireMedicalPatient(id, { req, action: 'CREATE', resourceType: 'medicalVisit', rule: MEDICAL_RULE.visits });
  if (!scope.ok) return scope.response;
  if (!isMedicalProvider(scope.gate.role)) {
    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      outcome: 'DENIED',
      resourceType: 'medicalVisit',
      resourceId: null,
      patientId: scope.clientId,
      metadata: { medicalPatientId: scope.medicalPatientId, reason: 'not_medical_provider' },
    });
    return providerOnlyResponse();
  }
  if (!scope.clientId) return noLinkedClientResponse();
  const clientId = scope.clientId;

  try {
    const body = signSchema.parse(await req.json());
    const signer = await prisma.user.findUnique({
      where: { id: scope.gate.userId },
      select: { id: true, name: true, credentials: true, role: true, roles: true, status: true },
    });
    const now = new Date();
    // Vitals filed by the MA at rooming for this appointment are not entered twice
    const rooming = body.appointmentId
      ? await prisma.medicalRooming.findFirst({ where: { appointmentId: body.appointmentId, clientId, organizationId: scope.gate.organizationId }, select: { vitalIds: true } }).catch(() => null)
      : null;
    const roomingVitals = Boolean(rooming?.vitalIds.length);
    if (!body.vitals && !roomingVitals) {
      return NextResponse.json({ success: false, error: 'Enter the visit vitals before signing' }, { status: 400 });
    }
    const vitalsToFile = body.vitals && !roomingVitals ? body.vitals : null;

    const [visit, vital] = await prisma.$transaction([
      prisma.medicalVisit.create({
        data: {
          clientId,
          providerId: scope.gate.userId,
          providerName: signer?.name || null,
          visitDate: now,
          visitType: body.visitType,
          chiefComplaint: body.chiefComplaint || null,
          subjective: body.subjective,
          objective: body.objective || null,
          assessment: body.assessment || null,
          plan: body.plan || null,
          cptCode: body.cptCode || null,
          cptModifiers: body.isTelehealth ? ['95'] : [],
          icd10Codes: body.icd10Codes.map((c) => c.toUpperCase()),
          signedAt: now,
          status: 'SIGNED',
        },
      }),
      ...(vitalsToFile
        ? [
            prisma.medicalVital.create({
              data: {
                clientId,
                patientId: scope.medicalPatientId,
                recordedById: scope.gate.userId,
                recordedAt: now,
                ...vitalColumns(vitalsToFile),
              },
            }),
          ]
        : []),
    ]);

    await auditPhiAccess({
      gate: scope.gate,
      req,
      action: 'CREATE',
      resourceType: 'medicalVisit',
      resourceId: visit.id,
      patientId: clientId,
      metadata: {
        medicalPatientId: scope.medicalPatientId,
        status: 'SIGNED',
        vitalsId: vital?.id ?? null,
        vitalsFrom: vitalsToFile ? 'visit' : 'rooming',
        appointmentId: body.appointmentId ?? null,
        isTelehealth: body.isTelehealth,
        fields: Object.keys(body),
      },
    });

    // No PCP on the chart: suggest the signing physician / medical NP (staff confirm; never auto-assigned)
    const pcpSuggestion = await loadCurrentPcp(scope.gate.organizationId, clientId)
      .then((current) =>
        pcpSuggestionAfterVisit({
          current,
          signer: signer ? { ...signer, role: String(signer.role), roles: signer.roles.map(String), status: String(signer.status) } : null,
        })
      )
      .catch(() => null);

    return NextResponse.json({ success: true, visit, clientId, pcpSuggestion }, { status: 201 });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : 500;
    console.error('[medical/visits POST]', scope.medicalPatientId, err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: errorMessage(err, 'Could not sign visit') },
      { status }
    );
  }
}
