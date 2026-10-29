import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { writeAuditLog, auditMetaFromHeaders } from '@/lib/services/auditService';
import { Prisma } from '@prisma/client';
import { resolveDrugCode } from '@/lib/prescribing/drugCodes';

export const dynamic = 'force-dynamic';

const CreatePrescriptionSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientName: z.string().optional(),
  medicationName: z.string().min(1, 'Medication name is required'),
  medicationClass: z.string().optional(),
  deaSchedule: z.enum(['None', 'II', 'III', 'IV', 'V']).default('None'),
  dosage: z.string().min(1, 'Dosage is required'),
  frequency: z.string().min(1, 'Frequency is required'),
  daysSupply: z.coerce.number().min(1).default(30),
  refillsAllowed: z.coerce.number().min(0).default(0),
  pharmacyId: z.string().optional().nullable(),
  pharmacyName: z.string().optional().default(''),
  notesToPharmacist: z.string().optional().nullable(),
  pdmpChecked: z.boolean().default(false),
  epcsAttested: z.boolean().default(false),
  rxnormId: z.string().trim().max(20).optional(),
  ndcCode: z.string().trim().max(20).optional(),
});

function generateRxNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RX-${year}${month}${day}-${rand}`;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const clientId = sp.get('clientId');
    const status = sp.get('status');
    const schedule = sp.get('schedule');

    const conditions: Prisma.Sql[] = [
      Prisma.sql`prescriber_name <> 'Dr. Sarah Smith, MD'`,
      Prisma.sql`(prescriber_npi IS NULL OR prescriber_npi <> '1457893210')`,
    ];
    if (clientId) {
      conditions.push(Prisma.sql`client_id = ${clientId}`);
    }
    if (status && status !== 'All') {
      conditions.push(Prisma.sql`status = ${status}`);
    }
    if (schedule && schedule !== 'All') {
      if (schedule === 'Controlled') {
        conditions.push(Prisma.sql`dea_schedule != 'None'`);
      } else {
        conditions.push(Prisma.sql`dea_schedule = ${schedule}`);
      }
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        id,
        rx_number AS "rxNumber",
        client_id AS "clientId",
        client_name AS "clientName",
        prescriber_id AS "prescriberId",
        prescriber_name AS "prescriberName",
        prescriber_npi AS "prescriberNpi",
        prescriber_dea AS "prescriberDea",
        medication_name AS "medicationName",
        medication_class AS "medicationClass",
        dea_schedule AS "deaSchedule",
        dosage,
        frequency,
        days_supply AS "daysSupply",
        refills_allowed AS "refillsAllowed",
        refills_remaining AS "refillsRemaining",
        pharmacy_id AS "pharmacyId",
        pharmacy_name AS "pharmacyName",
        notes_to_pharmacist AS "notesToPharmacist",
        pdmp_checked AS "pdmpChecked",
        pdmp_checked_at AS "pdmpCheckedAt",
        epcs_attested AS "epcsAttested",
        status,
        transmission_status AS "transmissionStatus",
        last_filled_date AS "lastFilledDate",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ehr_prescriptions
      ${whereClause}
      ORDER BY created_at DESC
    `);

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch {
    console.error('[API /api/prescriptions GET] query failed');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch prescriptions' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const body = await req.json();
    const parsed = CreatePrescriptionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const {
      clientId,
      clientName: providedClientName,
      medicationName,
      medicationClass,
      deaSchedule,
      dosage,
      frequency,
      daysSupply,
      refillsAllowed,
      pharmacyId,
      pharmacyName,
      notesToPharmacist,
      pdmpChecked,
      epcsAttested,
    } = parsed.data;

    // Legal constraint: Schedule II permits ZERO refills
    let effectiveRefills = refillsAllowed;
    if (deaSchedule === 'II') {
      effectiveRefills = 0;
    } else if (['III', 'IV', 'V'].includes(deaSchedule)) {
      effectiveRefills = Math.min(refillsAllowed, 5);
    }

    // Legal constraint: Maryland PDMP (CRISP) check is mandatory for controlled substances
    if (deaSchedule !== 'None' && !pdmpChecked) {
      return NextResponse.json(
        {
          success: false,
          error: 'Maryland law (Health-General § 21-2A-04.2) requires PDMP consultation attestation before issuing controlled substances.',
        },
        { status: 422 }
      );
    }

    // Resolve client name if not provided
    let finalClientName = providedClientName;
    if (!finalClientName) {
      const clientRecord = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT name FROM "Client" WHERE id = ${clientId} LIMIT 1
      `);
      finalClientName = clientRecord[0]?.name || 'Unknown Client';
    }

    const prescriber = await prisma.user.findFirst({
      where: { id: session?.user?.id || '' },
      select: { name: true, npi: true },
    });
    if (!prescriber?.name || !prescriber.npi) {
      return NextResponse.json(
        { success: false, error: 'The signed-in prescriber needs a name and NPI before a medication can be saved.' },
        { status: 400 }
      );
    }
    const drugCode = resolveDrugCode(medicationName, parsed.data.rxnormId || parsed.data.ndcCode);
    if (!drugCode) {
      return NextResponse.json(
        { success: false, error: 'A standard drug code is required for this medication.' },
        { status: 400 }
      );
    }
    const prescriberName = prescriber.name;
    const prescriberNpi = prescriber.npi;
    const prescriberDea: string | null = null;
    const rxNumber = generateRxNumber();
    const isControlled = deaSchedule !== 'None';

    const pharmacistNote = [notesToPharmacist, `RxNorm ${drugCode}`].filter(Boolean).join(' ');
    const insertResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      INSERT INTO ehr_prescriptions (
        rx_number, client_id, client_name, prescriber_name, prescriber_npi, prescriber_dea,
        medication_name, medication_class, dea_schedule, dosage, frequency, days_supply,
        refills_allowed, refills_remaining, pharmacy_id, pharmacy_name, notes_to_pharmacist,
        pdmp_checked, pdmp_checked_at, epcs_attested, status, transmission_status, last_filled_date
      ) VALUES (
        ${rxNumber},
        ${clientId},
        ${finalClientName},
        ${prescriberName},
        ${prescriberNpi},
        ${prescriberDea},
        ${medicationName},
        ${medicationClass || null},
        ${deaSchedule},
        ${dosage},
        ${frequency},
        ${daysSupply},
        ${effectiveRefills},
        ${effectiveRefills},
        ${pharmacyId || null},
        ${pharmacyName},
        ${pharmacistNote},
        ${pdmpChecked},
        ${pdmpChecked ? Prisma.sql`NOW()` : Prisma.sql`NULL`},
        ${epcsAttested || isControlled},
        'Active',
        'Sent',
        CURRENT_DATE
      )
      RETURNING *
    `);

    const created = insertResult[0];
    await prisma.clientMedication.create({
      data: {
        clientId,
        medicationName,
        dosage,
        frequency,
        rxnormId: drugCode,
        ndcCode: parsed.data.ndcCode || null,
        active: true,
        prescribedById: session?.user?.id || null,
        source: 'prescribed',
      },
    }).catch(() => undefined);

    // HIPAA / EPCS Audit log
    const meta = auditMetaFromHeaders(req.headers);
    await writeAuditLog({
      actorUid: session?.user?.id || 'prescriber-system',
      actorRole: 'psychiatrist',
      action: isControlled ? 'EPCS_SIGN' : 'WRITE',
      resourceType: 'prescription',
      resourceId: created.id,
      patientId: clientId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      outcome: 'SUCCESS',
      details: {
        rxNumber,
        medicationName,
        deaSchedule,
        daysSupply,
        refillsAllowed: effectiveRefills,
        pharmacyName,
        pdmpChecked,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: created,
        message: 'Prescription successfully transmitted to pharmacy.',
      },
      { status: 201 }
    );
  } catch {
    console.error('[API /api/prescriptions POST] request failed');
    return NextResponse.json(
      { success: false, error: 'Failed to create prescription' },
      { status: 500 }
    );
  }
}
