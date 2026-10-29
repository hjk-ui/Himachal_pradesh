import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { allocateNextMrn } from '@/lib/clients/mrn';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { describeColumns, resolveClientFields, rowHeaders, type PlatformId } from '@/lib/migration/fieldMaps';
import { validateClient, type ValidatedClient } from '@/lib/migration/validate';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { importAssigneeId, resolveImportProvider, type ImportStaffRef } from '@/lib/migration/providers';
import { buildProviderCodeMap, type ProviderCodeMap } from '@/lib/migration/valantProviderMap';
import { planClientFacilityUpdates, VALANT_SOURCE_PLATFORMS } from '@/lib/migration/clientFacility';
import { CONTACT_FIELDS, planClientContactUpdates, type ContactUpdate } from '@/lib/migration/clientContact';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const bodySchema = z.object({
  platform: z.string().trim().min(1).max(40).default('generic'),
  dryRun: z.boolean().optional().default(false),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
  // Large files arrive in chunks: rowOffset keeps row numbers file-relative,
  // and jobId adds this chunk's counts to the job the first chunk created
  rowOffset: z.number().int().min(0).optional().default(0),
  jobId: z.string().min(1).max(64).optional(),
  // Refresh patients already imported from the same platform (matched by source id)
  updateExisting: z.boolean().optional().default(false),
  // Valant re-import that only sets Client.valantFacility (assigned facility) on clients already in Altrixs
  facilityOnly: z.boolean().optional().default(false),
  // Valant re-import that changes one group of fields on clients already in Altrixs and never creates any:
  // 'facility' = Client.valantFacility (same as facilityOnly); 'contact' = contact & demographics, empty fields only
  updateScope: z.enum(['facility', 'contact']).optional(),
});

/** Guard for a fill-only write: the field still holds what the plan read (else another edit won; skip) */
function contactGuard(u: ContactUpdate): Prisma.ClientWhereInput[] {
  return u.fields.map((f) => {
    const was = u.expected[f];
    if (f === 'race') return Array.isArray(was) && was.length ? { race: { equals: was as string[] } } : { race: { isEmpty: true } };
    return { [f]: was ?? null } as Prisma.ClientWhereInput;
  });
}

/** {field: n} as [{field, count}] so the audit scrubber (which drops keys like "phone") keeps it */
const fieldCounts = (m: Record<string, number | undefined>) =>
  Object.entries(m).filter(([, n]) => n).map(([field, count]) => ({ field, count: count as number }));

const IMPORT_TAG = 'valant-import';

const COVERAGE_NOTE_AUTHOR = 'Valant import';

/** Pinned Billing office note with the source's deductible/coinsurance text; a re-import replaces it */
async function setCoverageNote(tx: Prisma.TransactionClient, clientId: string, text: string | null) {
  if (!text) return;
  await tx.clientOfficeNote.deleteMany({ where: { clientId, category: 'Billing', authorName: COVERAGE_NOTE_AUTHOR } });
  await tx.clientOfficeNote.create({
    data: {
      clientId,
      category: 'Billing',
      noteText: `Coverage (from Valant): ${text}`,
      authorName: COVERAGE_NOTE_AUTHOR,
      authorRole: 'Migration',
      isPinned: true,
    },
  });
}

/** Standard demographic columns present in the row (null = column absent / blank: never written) */
function demographicFields(v: ValidatedClient) {
  return {
    legalMiddleName: v.legalMiddleName,
    administrativeSex: v.administrativeSex,
    sexAtBirth: v.sexAtBirth,
    genderIdentity: v.genderIdentity,
    sexualOrientation: v.sexualOrientation,
    pronouns: v.pronouns,
    race: v.race.length ? v.race : null,
    ethnicity: v.ethnicity,
    preferredLanguage: v.preferredLanguage,
    interpreterNeeded: v.interpreterNeeded,
    maritalStatus: v.maritalStatus,
    county: v.county,
    phoneType: v.phoneType,
    phoneSecondaryType: v.phoneSecondaryType,
    emergencyContactRelationship: v.emergencyContactRelationship,
    guardianName: v.guardianName,
    guardianRelationship: v.guardianRelationship,
    guardianPhone: v.guardianPhone,
    guarantorFirstName: v.guarantorFirstName,
    guarantorLastName: v.guarantorLastName,
    guarantorRelationship: v.guarantorRelationship,
    guarantorDateOfBirth: v.guarantorDateOfBirth,
    guarantorPhone: v.guarantorPhone,
    guarantorAddressLine1: v.guarantorAddressLine1,
    guarantorAddressLine2: v.guarantorAddressLine2,
    guarantorCity: v.guarantorCity,
    guarantorState: v.guarantorState,
    guarantorPostalCode: v.guarantorPostalCode,
    medicaidId: v.medicaidId,
    deceasedAt: v.deceasedAt,
  };
}

/** Primary insurance columns; nothing from a policy the source marks inactive */
function insuranceFields(v: ValidatedClient) {
  if (v.insuranceInactive) return {};
  // Valant fills Pt. Copay with 0 for everyone; without a payer in the row that 0 says nothing
  const copayAmount = v.copayAmount === 0 && !v.insurancePayer ? null : v.copayAmount;
  return {
    insurancePayer: v.insurancePayer,
    insuranceMemberId: v.insuranceMemberId,
    insuranceGroupNumber: v.insuranceGroupNumber,
    insuranceType: v.insuranceType,
    insuranceCoverageType: v.insuranceCoverageType,
    insurancePayerPhone: v.insurancePayerPhone,
    insuranceEffectiveFrom: v.insuranceEffectiveFrom,
    insuranceEffectiveTo: v.insuranceEffectiveTo,
    copayAmount,
  };
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import clients' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const platform = body.platform.toLowerCase() as PlatformId;
    const dryRun = body.dryRun === true;
    const scope = body.updateScope ?? (body.facilityOnly ? 'facility' : null);
    // Which headers the field map recognizes / ignores (shown in every mode's preview)
    const columns = describeColumns(rowHeaders(body.rows), scope ? 'valant' : platform);

    if (scope === 'contact') {
      const fields = body.rows.map((row) => resolveClientFields(row, 'valant'));
      const ids = [...new Set(fields.map((f) => f.sourceId?.trim()).filter((v): v is string => !!v))];
      const select = Object.fromEntries(
        ['id', 'mrn', 'sourceId', 'legalFirstName', 'legalLastName', 'dateOfBirth', ...CONTACT_FIELDS].map((k) => [k, true])
      ) as Prisma.ClientSelect;
      const existing = ids.length
        ? await prisma.client.findMany({
            where: { organizationId: gate.organizationId, sourcePlatform: { in: [...VALANT_SOURCE_PLATFORMS] }, sourceId: { in: ids } },
            select,
          })
        : [];
      // Client.email is unique across all organizations: an address on another chart is never copied
      const fileEmails = [...new Set(fields.map((f) => f.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
      const owners = fileEmails.length
        ? await prisma.client.findMany({ where: { email: { in: fileEmails } }, select: { id: true, email: true } })
        : [];
      const plan = planClientContactUpdates(
        fields.map((f, i) => ({ row: body.rowOffset + i + 1, fields: f })),
        existing as unknown as Parameters<typeof planClientContactUpdates>[1],
        new Map(owners.map((o) => [String(o.email).toLowerCase(), o.id]))
      );

      let written = 0;
      let changedSinceRead = 0;
      const writeErrors: { row: number; error: string }[] = [];
      if (!dryRun) {
        for (const u of plan.updates) {
          try {
            // One guarded statement per client: applies only if every field still holds what was read
            const res = await prisma.client.updateMany({
              where: { id: u.clientId, organizationId: gate.organizationId, AND: contactGuard(u) },
              data: u.data as Prisma.ClientUpdateManyMutationInput,
            });
            if (res.count === 1) {
              written += 1;
              await auditPhiAccess({
                gate, req, action: 'UPDATE', resourceType: 'client', resourceId: u.clientId, patientId: u.clientId,
                metadata: { source: 'valant_contact_reimport', fieldsSet: u.fields },
              });
            } else {
              changedSinceRead += 1;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() : 'update failed';
            writeErrors.push({ row: 0, error: `Client ${u.mrn ?? u.clientId}: ${msg}` });
          }
        }
      }
      await auditPhiAccess({
        gate, req, action: dryRun ? 'READ' : 'UPDATE', resourceType: 'migrationJob',
        outcome: writeErrors.length && !written && !dryRun ? 'FAILURE' : 'SUCCESS',
        metadata: {
          importType: 'clients_contact', platform: 'valant', dryRun, totalRows: body.rows.length, matched: plan.matched,
          clientsToUpdate: plan.updates.length, clientsUpdated: written, changedSinceRead, writeErrors: writeErrors.length,
          unchanged: plan.unchanged, notFound: plan.notFound.length, ambiguous: plan.ambiguous.length, noSourceId: plan.noSourceId,
          emailInUse: plan.emailInUse, conflicts: plan.conflicts.length,
          filled: fieldCounts(plan.filled), formatFixed: fieldCounts(plan.formatFixed),
          conflictsByField: fieldCounts(plan.conflictsByField), invalid: fieldCounts(plan.invalid),
          clientIds: plan.updates.slice(0, 50).map((u) => u.clientId),
        },
      });
      return NextResponse.json({
        success: true,
        updateScope: 'contact',
        dryRun,
        totalRows: body.rows.length,
        matched: plan.matched,
        clientsToUpdate: plan.updates.length,
        clientsUpdated: written,
        changedSinceRead,
        unchanged: plan.unchanged,
        notFound: plan.notFound.length,
        ambiguous: plan.ambiguous.length,
        noSourceId: plan.noSourceId,
        emailInUse: plan.emailInUse,
        filled: plan.filled,
        formatFixed: plan.formatFixed,
        conflictsByField: plan.conflictsByField,
        invalid: plan.invalid,
        // Field and client id / MRN only (no values) for staff review
        conflicts: plan.conflicts.slice(0, 200),
        unmatchedIds: plan.notFound.slice(0, 100).map((n) => n.sourceId),
        warnings: plan.warnings.slice(0, 50).map((w) => ({ row: w.row, warning: `${w.field}: ${w.reason}` })),
        warningCount: plan.warnings.length,
        columns,
        errors: [
          ...writeErrors.slice(0, 25),
          ...plan.ambiguous.slice(0, 25).map((a) => ({ row: a.row, error: `Valant patient ${a.sourceId} matches ${a.clients} clients; skipped` })),
        ],
      });
    }

    if (scope === 'facility') {
      // Only Client.valantFacility changes; matched by Valant patient id across the Valant import platforms
      const fields = body.rows.map((row) => resolveClientFields(row, 'valant'));
      if (!fields.some((f) => f.valantFacility)) {
        return NextResponse.json(
          { success: false, error: 'The file has no assigned facility column (Assigned Fac Id / Assigned Fac Name). Use the Valant client export.' },
          { status: 400 }
        );
      }
      const ids = [...new Set(fields.map((f) => f.sourceId?.trim()).filter((v): v is string => !!v))];
      const existing = ids.length
        ? await prisma.client.findMany({
            where: { organizationId: gate.organizationId, sourcePlatform: { in: [...VALANT_SOURCE_PLATFORMS] }, sourceId: { in: ids } },
            select: { id: true, sourceId: true, valantFacility: true },
          })
        : [];
      const plan = planClientFacilityUpdates(
        fields.map((f, i) => ({ row: body.rowOffset + i + 1, sourceId: f.sourceId ?? null, valantFacility: f.valantFacility ?? null })),
        existing
      );
      if (!dryRun && plan.updates.length) {
        const byValue = new Map<string, string[]>();
        for (const u of plan.updates) byValue.set(u.to, [...(byValue.get(u.to) ?? []), u.clientId]);
        await prisma.$transaction(
          [...byValue.entries()].map(([value, clientIds]) =>
            prisma.client.updateMany({ where: { organizationId: gate.organizationId, id: { in: clientIds } }, data: { valantFacility: value } })
          )
        );
      }
      const values: Record<string, number> = {};
      for (const u of plan.updates) values[u.to] = (values[u.to] ?? 0) + 1;
      await auditPhiAccess({
        gate, req, action: dryRun ? 'READ' : 'UPDATE', resourceType: 'migrationJob',
        metadata: {
          importType: 'clients_facility', platform: 'valant', dryRun, totalRows: body.rows.length, facilitySet: plan.updates.length,
          unchanged: plan.unchanged, notFound: plan.notFound.length, noFacility: plan.noFacility, ambiguous: plan.ambiguous.length,
          clientIds: plan.updates.slice(0, 50).map((u) => u.clientId),
        },
      });
      return NextResponse.json({
        success: true,
        facilityOnly: true,
        updateScope: 'facility',
        dryRun,
        totalRows: body.rows.length,
        facilitySet: plan.updates.length,
        unchanged: plan.unchanged,
        notFound: plan.notFound.length,
        noFacility: plan.noFacility,
        noSourceId: plan.noSourceId,
        ambiguous: plan.ambiguous.length,
        values,
        columns,
        errors: [
          ...plan.notFound.slice(0, 25).map((n) => ({ row: n.row, error: `Valant patient ${n.sourceId} is not in Altrixs (import clients first)` })),
          ...plan.ambiguous.slice(0, 25).map((a) => ({ row: a.row, error: `Valant patient ${a.sourceId} matches ${a.clients} clients; skipped` })),
        ],
      });
    }

    const primaryLocationId = await getPrimaryLocationId(gate.organizationId);
    const locations = await prisma.location.findMany({
      where: { organizationId: gate.organizationId, active: true },
      select: { id: true, name: true, city: true },
    });
    const unmatchedLocations = new Set<string>();
    const resolveLocationId = (source: string | null) => {
      if (!source) return primaryLocationId;
      const want = source.trim().toLowerCase();
      const hit =
        locations.find((l) => l.name.toLowerCase() === want || l.city?.toLowerCase() === want) ||
        locations.find((l) => l.name.toLowerCase().includes(want));
      if (!hit) unmatchedLocations.add(source.trim());
      return hit?.id ?? primaryLocationId;
    };

    const fieldsByRow = body.rows.map((row) => resolveClientFields(row, platform));
    const hasProviders = fieldsByRow.some((f) => f.assignedProviders);
    const staff: ImportStaffRef[] = hasProviders
      ? (
          await prisma.user.findMany({
            where: { organizationId: gate.organizationId, status: { not: 'DEACTIVATED' } },
            select: { id: true, name: true, role: true, roles: true },
          })
        ).map((u) => ({ ...u, role: String(u.role), roles: u.roles.map(String) }))
      : [];
    // Person-made Valant provider code mappings win over name matching (same as the appointment import)
    const codeMap: ProviderCodeMap = hasProviders
      ? buildProviderCodeMap(
          await prisma.valantProviderMap
            .findMany({ where: { organizationId: gate.organizationId }, select: { codeKey: true, userId: true } })
            .catch((err: unknown) => {
              console.error('[migration clients] provider map load failed', err);
              return [] as { codeKey: string; userId: string }[];
            })
        )
      : new Map();
    const unlinkedProviders: Record<string, number> = {};
    let teamsSet = 0;
    const buildTeam = (v: ValidatedClient) => {
      const members = v.assignedProviders.map((raw, idx) => {
        const r = resolveImportProvider(raw, staff, codeMap);
        if (!r.staff) unlinkedProviders[r.name] = (unlinkedProviders[r.name] || 0) + 1;
        return {
          providerId: r.staff?.id ?? null,
          name: r.staff?.name || r.name,
          role: r.role,
          credentials: r.credentials || null,
          isPrimary: idx === 0,
          initials: (r.staff?.name || r.name).split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
          assignedBy: IMPORT_TAG,
        };
      });
      // Primary = first linked provider with a caseload role; never the importing user
      return { members, firstLinked: importAssigneeId(members, staff) };
    };
    const sourceIds = fieldsByRow.map((f) => f.sourceId?.trim()).filter((id): id is string => !!id);
    const existingBySource = new Map(
      (sourceIds.length
        ? await prisma.client.findMany({
            where: { organizationId: gate.organizationId, sourcePlatform: platform, sourceId: { in: sourceIds } },
            select: { id: true, sourceId: true },
          })
        : []
      ).map((c) => [String(c.sourceId), c.id])
    );

    // Client.email is unique, but families often share one address; later patients import without it
    const chunkEmails = fieldsByRow
      .map((f) => f.email?.trim().toLowerCase())
      .filter((e): e is string => !!e);
    const emailOwner = new Map(
      (chunkEmails.length
        ? await prisma.client.findMany({ where: { email: { in: chunkEmails } }, select: { id: true, email: true } })
        : []
      ).map((c) => [String(c.email), c.id])
    );
    const warnings: { row: number; warning: string }[] = [];
    let updated = 0;
    const touchedClientIds: string[] = [];

    const errors: { row: number; field?: string; error: string; value?: string }[] = [];
    let imported = 0;
    let skippedRows = 0;
    let validClients = 0;
    const preview: Record<string, unknown>[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const rowNumber = body.rowOffset + i + 1;
      const validated = validateClient(fieldsByRow[i]);
      if (validated.ok === false) {
        errors.push({
          row: rowNumber,
          field: validated.field,
          error: validated.error,
        });
        continue;
      }
      const v = validated.value;
      validClients += 1;
      // Values outside the standard code sets are not imported; staff record them on the chart
      for (const u of v.unmapped.slice(0, 5)) {
        warnings.push({ row: rowNumber, warning: `${u.field} "${u.value}" is not a standard code; not imported (set it on the chart)` });
      }
      if (v.needsNameReview) {
        warnings.push({ row: rowNumber, warning: `Legal name not split (${v.nameReviewReason}); imported for staff review` });
      }

      let existing = null as { id: string } | null;
      if (v.sourceId && existingBySource.has(v.sourceId)) existing = { id: existingBySource.get(v.sourceId)! };
      if (!existing && v.mrn && v.dateOfBirth) {
        existing = await prisma.client.findFirst({
          where: {
            organizationId: gate.organizationId,
            mrn: v.mrn,
            dateOfBirth: v.dateOfBirth,
          },
          select: { id: true },
        });
      }

      const locationId = resolveLocationId(v.location);
      const ownerOfEmail = v.email ? emailOwner.get(v.email) : undefined;
      const email = v.email && (!ownerOfEmail || ownerOfEmail === existing?.id) ? v.email : null;
      if (v.email && !email) {
        warnings.push({ row: rowNumber, warning: 'Email is already used by another patient; imported without email' });
      }

      if (existing && body.updateExisting && v.sourceId && existingBySource.has(v.sourceId)) {
        updated += 1;
        if (preview.length < 10) preview.push({ row: rowNumber, name: v.name, action: 'update' });
        if (dryRun) {
          // Report which providers would link, without writing
          if (v.assignedProviders.length) {
            buildTeam(v);
            teamsSet += 1;
          }
          continue;
        }
        // Only overwrite with values the source actually has
        // Legal names only when the row gives them unambiguously; a flagged row never clears names
        // staff already confirmed (the review flag is set below only when the chart has none)
        const data: Prisma.ClientUpdateInput = v.namesMissing
          ? {}
          : v.firstName && v.lastName
            ? { name: v.name, legalFirstName: v.firstName, legalLastName: v.lastName, needsNameReview: false, nameReviewReason: null }
            : {};
        // Only columns the file actually has: a partial export must not reset status or DOB
        if (v.dateOfBirth) data.dateOfBirth = v.dateOfBirth;
        if (v.inactive !== null) {
          data.status = v.inactive ? 'INACTIVE' : 'ACTIVE';
          data.active = !v.inactive;
        }
        const optional = {
          middleInitial: v.middleInitial, preferredName: v.preferredName, nameSuffix: v.nameSuffix,
          email, phone: v.phone, gender: v.gender,
          addressLine1: v.addressLine1, addressLine2: v.addressLine2, city: v.city, state: v.state,
          postalCode: v.postalCode, emergencyContactName: v.emergencyContactName,
          emergencyContactPhone: v.emergencyContactPhone,
          primaryDiagnosis: v.primaryDiagnosis, primaryDiagnosisCode: v.primaryDiagnosisCode,
          phoneSecondary: v.phoneSecondary,
          ...insuranceFields(v),
          ...demographicFields(v),
        };
        for (const [k, val] of Object.entries(optional)) if (val != null) (data as Record<string, unknown>)[k] = val;
        if (v.location && locationId) data.location = { connect: { id: locationId } };
        if (v.valantFacility) data.valantFacility = v.valantFacility;
        const team = v.assignedProviders.length ? buildTeam(v) : null;
        if (team?.firstLinked) data.assignedTo = { connect: { id: team.firstLinked } };
        try {
          await prisma.$transaction(async (tx) => {
            await tx.client.update({ where: { id: existing!.id }, data });
            if (v.needsNameReview) {
              await tx.client.updateMany({
                where: { id: existing!.id, OR: [{ legalFirstName: null }, { legalLastName: null }] },
                data: { needsNameReview: true, nameReviewReason: v.nameReviewReason },
              });
            }
            await setCoverageNote(tx, existing!.id, v.coverageNote);
            if (team) {
              // Replace only what an earlier import created; members added in Altrixs stay
              await tx.clientTreatmentTeamMember.deleteMany({ where: { clientId: existing!.id, assignedBy: IMPORT_TAG } });
              await tx.clientTreatmentTeamMember.createMany({
                data: team.members.map((m) => ({ ...m, clientId: existing!.id })),
              });
            }
          });
          if (team) teamsSet += 1;
          if (email) emailOwner.set(email, existing.id);
          touchedClientIds.push(existing.id);
        } catch (err) {
          updated -= 1;
          errors.push({ row: rowNumber, error: err instanceof Error ? err.message.split('\n').filter(Boolean).pop() || 'Update failed' : 'Update failed' });
        }
        continue;
      }

      if (existing) {
        skippedRows += 1;
        if (preview.length < 10) {
          preview.push({
            row: rowNumber,
            name: v.name,
            action: 'skip',
            reason: 'duplicate',
          });
        }
        continue;
      }

      if (email) emailOwner.set(email, 'pending');

      if (preview.length < 10) {
        preview.push({
          row: rowNumber,
          firstName: v.firstName,
          lastName: v.lastName,
          name: v.name,
          dob: v.dateOfBirth?.toISOString().slice(0, 10) ?? null,
          email,
          phone: v.phone,
          mrn: v.mrn,
          status: v.inactive ? 'INACTIVE' : 'ACTIVE',
          location: locations.find((l) => l.id === locationId)?.name ?? null,
          action: 'create',
        });
      }

      if (v.namesMissing) {
        errors.push({ row: rowNumber, field: 'name', error: `Patient ${v.sourceId} is not in Altrixs yet and the file has no name` });
        validClients -= 1;
        continue;
      }
      if (!v.dateOfBirth) {
        errors.push({ row: rowNumber, field: 'dob', error: `Patient ${v.sourceId} is not in Altrixs yet and the file has no date of birth` });
        validClients -= 1;
        continue;
      }
      const dateOfBirth = v.dateOfBirth;

      if (dryRun) {
        imported += 1;
        continue;
      }

      try {
        const team = v.assignedProviders.length ? buildTeam(v) : null;
        const createdId = await prisma.$transaction(async (tx) => {
          const mrn = v.mrn || (await allocateNextMrn(gate.organizationId, tx));
          const created = await tx.client.create({
            data: {
              name: v.name,
              email,
              phone: v.phone,
              organizationId: gate.organizationId,
              mrn,
              sourcePlatform: platform,
              sourceId: v.sourceId,
              importedAt: new Date(),
              dateOfBirth,
              gender: v.gender,
              addressLine1: v.addressLine1,
              addressLine2: v.addressLine2,
              city: v.city,
              state: v.state,
              postalCode: v.postalCode,
              legalFirstName: v.firstName,
              middleInitial: v.middleInitial,
              legalLastName: v.lastName,
              needsNameReview: v.needsNameReview,
              nameReviewReason: v.nameReviewReason,
              ...Object.fromEntries(Object.entries(demographicFields(v)).filter(([, val]) => val != null)),
              preferredName: v.preferredName,
              nameSuffix: v.nameSuffix,
              emergencyContactName: v.emergencyContactName,
              emergencyContactPhone: v.emergencyContactPhone,
              ...insuranceFields(v),
              phoneSecondary: v.phoneSecondary,
              primaryDiagnosis: v.primaryDiagnosis,
              primaryDiagnosisCode: v.primaryDiagnosisCode,
              locationId,
              valantFacility: v.valantFacility,
              // No (linkable) provider in Valant: leave unassigned (never default to the importing user)
              assignedToId: team?.firstLinked ?? null,
              status: v.inactive ? 'INACTIVE' : 'ACTIVE',
              active: !v.inactive,
            },
          });
          if (team) {
            await tx.clientTreatmentTeamMember.createMany({
              data: team.members.map((m) => ({ ...m, clientId: created.id })),
            });
          }
          await setCoverageNote(tx, created.id, v.coverageNote);
          return created.id;
        });
        touchedClientIds.push(createdId);
        if (team) teamsSet += 1;
        imported += 1;
      } catch (err) {
        // Prisma messages are multi-line; the last line names the cause
        const msg = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() || 'Create failed' : 'Create failed';
        errors.push({ row: rowNumber, error: msg });
        validClients -= 1;
      }
    }

    const totalRows = body.rows.length;
    const errorClients = errors.length;
    // Updates of patients already in Altrixs count as written rows, not just new patients
    const written = imported + updated;
    const status =
      errorClients === 0 ? 'success' : written > 0 ? 'partial' : 'failed';

    // dryRun: validate only — zero Client inserts and zero MigrationJob rows
    if (dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'clients', platform, dryRun: true, totalRows, skippedRows, validClients, errorClients, imported: 0, wouldImport: imported, updated, teamsSet, warningCount: warnings.length, unlinkedProviderCount: Object.keys(unlinkedProviders).length, unmatchedLocationCount: unmatchedLocations.size },
      });
      return NextResponse.json({
        success: true,
        platform,
        totalRows,
        skippedRows,
        validClients,
        errorClients,
        imported: 0,
        dryRun: true,
        preview: preview.slice(0, 10),
        errors: errors.slice(0, 50),
        updated,
        teamsSet,
        unlinkedProviders,
        warnings: warnings.slice(0, 50),
        warningCount: warnings.length,
        unmatchedLocations: [...unmatchedLocations],
        columns,
        jobId: null,
        status: 'dry_run',
      });
    }

    const prior = body.jobId
      ? await prisma.migrationJob.findFirst({
          where: { id: body.jobId, organizationId: gate.organizationId, type: 'clients' },
        })
      : null;
    const job = prior
      ? await prisma.migrationJob.update({
          where: { id: prior.id },
          data: {
            total: { increment: totalRows },
            imported: { increment: written },
            errors: { increment: errorClients },
            status: prior.status === 'success' && status === 'success' ? 'success'
              : prior.imported + written > 0 ? 'partial' : 'failed',
            errorJson: errors.length
              ? ([...(Array.isArray(prior.errorJson) ? prior.errorJson : []), ...errors].slice(0, 100) as Prisma.InputJsonValue[])
              : undefined,
          },
        })
      : await prisma.migrationJob.create({
          data: {
            organizationId: gate.organizationId,
            type: 'clients',
            platform,
            total: totalRows,
            imported: written,
            errors: errorClients,
            status,
            createdById: gate.userId,
            errorJson: errors.length ? errors.slice(0, 100) : undefined,
          },
        });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: {
        importType: 'clients', platform, dryRun: false, jobId: job.id, status,
        totalRows, skippedRows, validClients, errorClients, imported: imported, updated, teamsSet, warningCount: warnings.length, unlinkedProviderCount: Object.keys(unlinkedProviders).length, unmatchedLocationCount: unmatchedLocations.size,
        clientIds: touchedClientIds.slice(0, 50),
      },
    });

    return NextResponse.json({
      success: true,
      platform,
      totalRows,
      skippedRows,
      validClients,
      errorClients,
      imported,
      dryRun: false,
      preview: preview.slice(0, 10),
      errors: errors.slice(0, 50),
      updated,
      teamsSet,
      unlinkedProviders,
      warnings: warnings.slice(0, 50),
      warningCount: warnings.length,
      unmatchedLocations: [...unmatchedLocations],
      columns,
      jobId: job.id,
      status,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid import payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[migration/clients POST]', err);
    return NextResponse.json(
      { success: false, error: 'Client import failed' },
      { status: 500 }
    );
  }
}
