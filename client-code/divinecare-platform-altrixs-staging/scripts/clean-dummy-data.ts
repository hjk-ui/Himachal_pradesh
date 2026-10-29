import { PrismaClient } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL;
let datasourceUrl = rawUrl;
if (rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === '127.0.0.1' && url.port === '5433') {
      url.searchParams.set('connection_limit', '5');
      url.searchParams.set('pool_timeout', '60');
      url.searchParams.set('connect_timeout', '30');
      url.searchParams.set('sslaccept', 'accept_invalid_certs');
    }
    datasourceUrl = url.toString();
  } catch {
    datasourceUrl = rawUrl;
  }
}

const prisma = new PrismaClient({
  datasourceUrl,
  log: ['error', 'warn'],
});

// Alias practiceLocation to location for seamless compatibility
if (!(prisma as any).practiceLocation) {
  Object.defineProperty(prisma, 'practiceLocation', {
    get() {
      return (this as any).location;
    },
    configurable: true,
  });
}

async function cleanDummyData() {
  console.log('🧹 Starting safe dummy data purge...');

  await prisma.$transaction(
    async (tx) => {
      // 1. Delete specialized clinical child records
      const shiftNotes = await tx.residentialShiftNote.deleteMany({});
      const residentialStays = await tx.residentialResident.deleteMany({});
      const specCharges = await tx.specializedBillingCharge.deleteMany({});
      console.log(`- Cleared ${shiftNotes.count} shift notes & ${residentialStays.count} residential stays`);
      console.log(`- Cleared ${specCharges.count} specialized billing charges`);

      // Reset bed occupancy (all residents cleared => all beds 100% unoccupied)
      console.log('- Reset all residential beds to unoccupied');

      // 2. Delete crisis & AOT child records
      const crisisPages = await tx.crisisTeamPage.deleteMany({});
      const crisis = await tx.crisisEpisode.deleteMany({});
      const aot = await tx.aotParticipant.deleteMany({});
      console.log(`- Cleared ${crisis.count} crisis episodes (${crisisPages.count} team pages) & ${aot.count} AOT participants`);

      // 3. Delete clinical assessments, alerts & safety monitors
      const alerts = await tx.riskAlert.deleteMany({});
      const screenings = await tx.sudScreening.deleteMany({});
      const radar = await tx.sudRadarSignal.deleteMany({});
      const labResults = await tx.labResult.deleteMany({});
      const labs = await tx.labOrder.deleteMany({});
      const meds = await tx.clientMedication.deleteMany({});
      const careTeam = await tx.clientTreatmentTeamMember.deleteMany({});
      const teamAlerts = await tx.teamAlert.deleteMany({});

      // Medical & ambulatory child records
      const medCharges = await tx.medicalCharge.deleteMany({});
      const medVisits = await tx.medicalVisit.deleteMany({});
      const medVitals = await tx.medicalVital.deleteMany({});
      const medAllergies = await tx.medicalAllergy.deleteMany({});
      const medProblems = await tx.medicalProblem.deleteMany({});
      const medPatients = await tx.medicalPatient.deleteMany({});

      // Formal assessments, evaluations, LOCUS & reports
      const answers = await tx.assessmentItemAnswer.deleteMany({});
      const assessments = await tx.clinicalAssessmentRecord.deleteMany({});
      const evalAmendments = await tx.evaluationAmendment.deleteMany({});
      const evals = await tx.clinicalEvaluationRecord.deleteMany({});
      const locus = await tx.locusAssessmentRecord.deleteMany({});
      const mandReports = await tx.mandatoryReportRecord.deleteMany({});
      const mbcAcks = await tx.mbcAlertAck.deleteMany({});

      // TMS, Spravato, PRP specialized programs
      const tmsSessions = await tx.tmsSession.deleteMany({});
      const tmsPhq9 = await tx.tmsPhq9.deleteMany({});
      const tmsCourses = await tx.tmsCourse.deleteMany({});
      const spraSessions = await tx.spravatoSession.deleteMany({});
      const spraEnrollments = await tx.spravatoEnrollment.deleteMany({});
      const prpEnrollments = await tx.prpEnrollment.deleteMany({});
      const prpReferrals = await tx.prpReferral.deleteMany({});

      // Sensitive records & audits
      const sensLogs = await tx.sensitiveAccessLog.deleteMany({});
      const sensRecords = await tx.sensitiveRecord.deleteMany({});
      const breakGlass = await tx.breakTheGlassGrant.deleteMany({});

      console.log(
        `- Cleared ${alerts.count} alerts, ${screenings.count} SUD screens, ${radar.count} radar signals, ${meds.count} meds, ${careTeam.count} team links`
      );
      console.log(
        `- Cleared ${labs.count} lab orders, ${medPatients.count} medical charts, ${assessments.count} assessments, ${evals.count} evaluations`
      );

      // 4. Delete EHR progress notes, telehealth, appointments & intake records
      const noteWorkflows = await tx.progressNoteWorkflow.deleteMany({});
      const notes = await tx.progressNote.deleteMany({});

      const teleNotes = await tx.telehealthInCallNote.deleteMany({});
      const teleVitals = await tx.telehealthVitals.deleteMany({});
      const teleDrafts = await tx.telehealthBillingDraft.deleteMany({});
      const teleChats = await tx.telehealthChatMessage.deleteMany({});
      const teleAudits = await tx.telehealthAuditLog.deleteMany({});
      const teleSessions = await tx.telehealthSession.deleteMany({});

      const checkIns = await tx.checkIn.deleteMany({});
      const appointments = await tx.appointment.deleteMany({});
      const treatmentPlans = await tx.treatmentPlan.deleteMany({});
      const consentForms = await tx.consentForm.deleteMany({});
      const intakeInvites = await tx.intakeInvite.deleteMany({});
      const waitlist = await tx.waitlistEntry.deleteMany({});
      const eligibility = await tx.eligibilityCheck.deleteMany({});
      const priorAuths = await tx.priorAuth.deleteMany({});

      const threadMsgs = await tx.threadMessage.deleteMany({});
      const threads = await tx.messageThread.deleteMany({});
      const msgs = await tx.message.deleteMany({});
      const connectMsgs = await tx.connectMessage.deleteMany({});
      const connectCalls = await tx.connectCall.deleteMany({});
      const scribeSessions = await tx.scribeSession.deleteMany({});
      const clinicalEvents = await tx.clinicalEvent.deleteMany({});
      const textractJobs = await tx.textractJob.deleteMany({});

      console.log(
        `- Cleared ${notes.count} progress notes, ${teleSessions.count} telehealth sessions, ${appointments.count} appointments, ${checkIns.count} check-ins`
      );

      // 5. Delete RCM billing & financial records
      const batchLines = await tx.paymentBatchLine.deleteMany({});
      const batches = await tx.paymentBatch.deleteMany({});
      const denials = await tx.claimDenial.deleteMany({});
      const scrubResults = await tx.claimScrubResult.deleteMany({});
      const claimLines = await tx.claimServiceLine.deleteMany({});
      const payments = await tx.payment.deleteMany({});
      const claims = await tx.claim.deleteMany({});

      const statements = await tx.eStatement.deleteMany({});
      const patientStatements = await tx.patientStatement.deleteMany({});
      const autopayCharges = await tx.autoPayCharge.deleteMany({});
      const cardsOnFile = await tx.cardOnFile.deleteMany({});
      const autopay = await tx.autopayEnrollment.deleteMany({});

      console.log(
        `- Cleared ${claims.count} claims, ${claimLines.count} claim lines, ${denials.count} denials, ${batches.count} payment batches, ${statements.count + patientStatements.count} statements`
      );

      // 6. Delete patient accounts, device tokens & notification logs
      const notifLogs = await tx.notificationLog.deleteMany({});
      const medLogs = await tx.medicationIntakeLog.deleteMany({});
      const medScheds = await tx.medicationSchedule.deleteMany({});
      const deviceTokens = await tx.deviceToken.deleteMany({});
      const patientAudits = await tx.patientAuditLog.deleteMany({});
      const patientAccounts = await tx.patientAccount.deleteMany({});
      console.log(`- Cleared ${patientAccounts.count} patient portal accounts & associated logs`);

      // 7. Delete operational logs & test project tasks
      const calls = await tx.operationalCallLog.deleteMany({});
      const comments = await tx.projectComment.deleteMany({});
      const subtasks = await tx.projectSubtask.deleteMany({});
      const tasks = await tx.projectTask.deleteMany({});
      console.log(`- Cleared ${calls.count} operational calls & ${tasks.count} project tasks (${subtasks.count} subtasks)`);

      // 8. Delete all dummy clients
      const clients = await tx.client.deleteMany({});
      console.log(`- Cleared ${clients.count} dummy client profiles`);

      // 9. Delete non-admin test staff (Preserve Practice Director / Admin / Super Admin / Director / Office Manager)
      // Clean up foreign-key restricted models first:
      await tx.supervisionLog.deleteMany({});
      await tx.supervisionTrack.deleteMany({});

      const testStaff = await tx.user.deleteMany({
        where: {
          role: {
            notIn: ['SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'OFFICE_MANAGER'],
          },
        },
      });
      console.log(`- Cleared ${testStaff.count} test staff members (Preserved administrative accounts)`);
    },
    { timeout: 180000 }
  );

  // 10. Ensure the 4 Practice Locations (Bowie, Silver Spring, Lexington Park, Baltimore) exist under the primary organization
  const primaryOrg =
    (await prisma.organization.findUnique({ where: { slug: 'altrixs' } })) ||
    (await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } }));

  if (primaryOrg) {
    const canonicalLocations = [
      { name: 'Baltimore', code: 'BALTIMORE', city: 'Baltimore', state: 'MD', isPrimary: true },
      { name: 'Bowie', code: 'BOWIE', city: 'Bowie', state: 'MD', isPrimary: false },
      { name: 'Silver Spring', code: 'SILVER_SPRING', city: 'Silver Spring', state: 'MD', isPrimary: false },
      { name: 'Lexington Park', code: 'LEXINGTON_PARK', city: 'Lexington Park', state: 'MD', isPrimary: false },
    ];

    for (const loc of canonicalLocations) {
      const existing = await prisma.location.findFirst({
        where: {
          organizationId: primaryOrg.id,
          name: { equals: loc.name, mode: 'insensitive' },
        },
      });

      if (!existing) {
        await prisma.location.create({
          data: {
            organizationId: primaryOrg.id,
            name: loc.name,
            code: loc.code,
            city: loc.city,
            state: loc.state,
            isPrimary: loc.isPrimary,
            active: true,
          },
        });
        console.log(`- Ensured Practice Location: ${loc.name} (${loc.city}, ${loc.state})`);
      } else {
        await prisma.location.update({
          where: { id: existing.id },
          data: {
            code: loc.code,
            city: loc.city,
            state: loc.state,
            active: true,
            isPrimary: loc.isPrimary,
          },
        });
        console.log(`- Preserved Practice Location: ${loc.name} (${loc.city}, ${loc.state})`);
      }
    }
  }

  // 11. Verification Audit
  console.log('\n🔎 Running Verification Audit...');
  const clientCount = await prisma.client.count();
  const claimCount = await prisma.claim.count();
  const sudCount = await prisma.sudScreening.count();
  const locationList = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, name: true, city: true, state: true },
  });
  const adminStaffCount = await prisma.user.count({
    where: {
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'OFFICE_MANAGER'] },
    },
  });

  console.log(`- prisma.client.count() = ${clientCount}`);
  console.log(`- prisma.claim.count() = ${claimCount}`);
  console.log(`- prisma.sudScreening.count() = ${sudCount}`);
  console.log(`- prisma.practiceLocation.count() = ${locationList.length} locations intact:`);
  locationList.forEach((l) => console.log(`   • ${l.name} (${l.city || 'MD'})`));
  console.log(`- Preserved administrative leadership staff accounts: ${adminStaffCount}`);

  if (clientCount === 0 && claimCount === 0 && sudCount === 0 && locationList.length >= 4) {
    console.log('\n✅ DATABASE SANITIZED SUCCESSFULLY! Ready for clean Excel import.');
  } else {
    throw new Error('Verification failed: Counts did not match expected zero state.');
  }
}

cleanDummyData()
  .catch((e) => {
    console.error('❌ Error during purge:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
