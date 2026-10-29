import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  datasources: { db: { url } },
  log: ['error', 'warn'],
});

async function sanitizeDatabaseForLive() {
  console.log('🚀 Starting Comprehensive Live Database Data Sanitization...');
  console.log('Target: Purging 100% of test/dummy clients, appointments, claims, medical records & notes while preserving Staff/Admins, Organizations, and Practice Locations.');

  const deletedCounts: Record<string, number> = {};

  const safeDelete = async (name: string, fn: () => Promise<{ count: number }>) => {
    try {
      const res = await fn();
      deletedCounts[name] = res.count;
      if (res.count > 0) {
        console.log(`  ✓ Cleared ${res.count} from ${name}`);
      }
    } catch (err: any) {
      console.warn(`  ⚠ Error or table skipped for ${name}:`, err.message);
    }
  };

  // 1. Specialized clinical child records
  console.log('\n--- 1. Specialized Clinical & Crisis Records ---');
  await safeDelete('residentialShiftNote', () => prisma.residentialShiftNote.deleteMany({}));
  await safeDelete('residentialResident', () => prisma.residentialResident.deleteMany({}));
  await safeDelete('specializedBillingCharge', () => prisma.specializedBillingCharge.deleteMany({}));
  await safeDelete('crisisTeamPage', () => prisma.crisisTeamPage.deleteMany({}));
  await safeDelete('crisisEpisode', () => prisma.crisisEpisode.deleteMany({}));
  await safeDelete('aotParticipant', () => prisma.aotParticipant.deleteMany({}));

  // 2. Clinical assessments, alerts, screenings & labs
  console.log('\n--- 2. Clinical Alerts, SUD, Labs & Medications ---');
  await safeDelete('riskAlert', () => prisma.riskAlert.deleteMany({}));
  await safeDelete('sudScreening', () => prisma.sudScreening.deleteMany({}));
  await safeDelete('sudRadarSignal', () => prisma.sudRadarSignal.deleteMany({}));
  await safeDelete('labResult', () => prisma.labResult.deleteMany({}));
  await safeDelete('labOrder', () => prisma.labOrder.deleteMany({}));
  await safeDelete('clientMedication', () => prisma.clientMedication.deleteMany({}));
  await safeDelete('clientTreatmentTeamMember', () => prisma.clientTreatmentTeamMember.deleteMany({}));
  await safeDelete('teamAlert', () => prisma.teamAlert.deleteMany({}));

  // 3. Medical & Ambulatory EHR
  console.log('\n--- 3. Medical & Ambulatory Records ---');
  await safeDelete('medicalCharge', () => prisma.medicalCharge.deleteMany({}));
  await safeDelete('medicalVisit', () => prisma.medicalVisit.deleteMany({}));
  await safeDelete('medicalVital', () => prisma.medicalVital.deleteMany({}));
  await safeDelete('medicalAllergy', () => prisma.medicalAllergy.deleteMany({}));
  await safeDelete('medicalProblem', () => prisma.medicalProblem.deleteMany({}));
  await safeDelete('medicalPatient', () => prisma.medicalPatient.deleteMany({}));

  // 4. Formal Evaluations, LOCUS & Assessments
  console.log('\n--- 4. Formal Evaluations & Assessments ---');
  await safeDelete('assessmentItemAnswer', () => prisma.assessmentItemAnswer.deleteMany({}));
  await safeDelete('clinicalAssessmentRecord', () => prisma.clinicalAssessmentRecord.deleteMany({}));
  await safeDelete('evaluationAmendment', () => prisma.evaluationAmendment.deleteMany({}));
  await safeDelete('clinicalEvaluationRecord', () => prisma.clinicalEvaluationRecord.deleteMany({}));
  await safeDelete('locusAssessmentRecord', () => prisma.locusAssessmentRecord.deleteMany({}));
  await safeDelete('mandatoryReportRecord', () => prisma.mandatoryReportRecord.deleteMany({}));
  await safeDelete('mbcAlertAck', () => prisma.mbcAlertAck.deleteMany({}));

  // 5. Specialized Programs (TMS, Spravato, PRP)
  console.log('\n--- 5. Specialized Programs ---');
  await safeDelete('tmsSession', () => prisma.tmsSession.deleteMany({}));
  await safeDelete('tmsPhq9', () => prisma.tmsPhq9.deleteMany({}));
  await safeDelete('tmsCourse', () => prisma.tmsCourse.deleteMany({}));
  await safeDelete('spravatoSession', () => prisma.spravatoSession.deleteMany({}));
  await safeDelete('spravatoEnrollment', () => prisma.spravatoEnrollment.deleteMany({}));
  await safeDelete('prpEnrollment', () => prisma.prpEnrollment.deleteMany({}));
  await safeDelete('prpReferral', () => prisma.prpReferral.deleteMany({}));
  await safeDelete('prpWorkflow', () => prisma.prpWorkflow.deleteMany({}));

  // 6. Sensitive records & Break-glass
  console.log('\n--- 6. Sensitive Records & Security Audits ---');
  await safeDelete('sensitiveAccessLog', () => prisma.sensitiveAccessLog.deleteMany({}));
  await safeDelete('sensitiveRecord', () => prisma.sensitiveRecord.deleteMany({}));
  await safeDelete('breakTheGlassGrant', () => prisma.breakTheGlassGrant.deleteMany({}));

  // 7. Progress notes & EHR Workflows
  console.log('\n--- 7. Progress Notes & Workflows ---');
  await safeDelete('progressNoteWorkflow', () => prisma.progressNoteWorkflow.deleteMany({}));
  await safeDelete('progressNote', () => prisma.progressNote.deleteMany({}));
  await safeDelete('treatmentPlan', () => prisma.treatmentPlan.deleteMany({}));
  await safeDelete('consentForm', () => prisma.consentForm.deleteMany({}));
  await safeDelete('intakeInvite', () => prisma.intakeInvite.deleteMany({}));
  await safeDelete('waitlistEntry', () => prisma.waitlistEntry.deleteMany({}));
  await safeDelete('eligibilityCheck', () => prisma.eligibilityCheck.deleteMany({}));
  await safeDelete('priorAuth', () => prisma.priorAuth.deleteMany({}));
  await safeDelete('clientOfficeNote', () => prisma.clientOfficeNote.deleteMany({}));
  await safeDelete('documentIntake', () => prisma.documentIntake.deleteMany({}));

  // 8. E-Prescribing (Rcopia & PDMP)
  console.log('\n--- 8. E-Prescribing Records ---');
  await safeDelete('rcopiaRxfillEvent', () => prisma.rcopiaRxfillEvent.deleteMany({}));
  await safeDelete('rcopiaRxchangeRequest', () => prisma.rcopiaRxchangeRequest.deleteMany({}));
  await safeDelete('rcopiaRefillNotification', () => prisma.rcopiaRefillNotification.deleteMany({}));
  await safeDelete('rcopiaMedRecAttestation', () => prisma.rcopiaMedRecAttestation.deleteMany({}));
  await safeDelete('rcopiaPrescription', () => prisma.rcopiaPrescription.deleteMany({}));
  await safeDelete('marylandPdmpAudit', () => prisma.marylandPdmpAudit.deleteMany({}));
  await safeDelete('ehrRefillRequest', () => prisma.ehrRefillRequest.deleteMany({}));
  await safeDelete('ehrPrescription', () => prisma.ehrPrescription.deleteMany({}));

  // 9. Telehealth & Realtime Communication
  console.log('\n--- 9. Telehealth & Communication Records ---');
  await safeDelete('telehealthInCallNote', () => prisma.telehealthInCallNote.deleteMany({}));
  await safeDelete('telehealthVitals', () => prisma.telehealthVitals.deleteMany({}));
  await safeDelete('telehealthBillingDraft', () => prisma.telehealthBillingDraft.deleteMany({}));
  await safeDelete('telehealthChatMessage', () => prisma.telehealthChatMessage.deleteMany({}));
  await safeDelete('telehealthAuditLog', () => prisma.telehealthAuditLog.deleteMany({}));
  await safeDelete('telehealthSession', () => prisma.telehealthSession.deleteMany({}));
  await safeDelete('checkIn', () => prisma.checkIn.deleteMany({}));
  await safeDelete('appointment', () => prisma.appointment.deleteMany({}));
  await safeDelete('threadMessage', () => prisma.threadMessage.deleteMany({}));
  await safeDelete('messageThread', () => prisma.messageThread.deleteMany({}));
  await safeDelete('message', () => prisma.message.deleteMany({}));
  await safeDelete('connectMessage', () => prisma.connectMessage.deleteMany({}));
  await safeDelete('connectCall', () => prisma.connectCall.deleteMany({}));
  await safeDelete('scribeSession', () => prisma.scribeSession.deleteMany({}));
  await safeDelete('clinicalEvent', () => prisma.clinicalEvent.deleteMany({}));
  await safeDelete('textractJob', () => prisma.textractJob.deleteMany({}));

  // 10. RCM Billing, Claims, Financials
  console.log('\n--- 10. RCM Billing & Claims ---');
  await safeDelete('claimDenial', () => prisma.claimDenial.deleteMany({}));
  await safeDelete('claimScrubResult', () => prisma.claimScrubResult.deleteMany({}));
  await safeDelete('claimServiceLine', () => prisma.claimServiceLine.deleteMany({}));
  await safeDelete('paymentBatchLine', () => prisma.paymentBatchLine.deleteMany({}));
  await safeDelete('paymentBatch', () => prisma.paymentBatch.deleteMany({}));
  await safeDelete('payment', () => prisma.payment.deleteMany({}));
  await safeDelete('paymentPlan', () => prisma.paymentPlan.deleteMany({}));
  await safeDelete('claim', () => prisma.claim.deleteMany({}));
  await safeDelete('eStatement', () => prisma.eStatement.deleteMany({}));
  await safeDelete('patientStatement', () => prisma.patientStatement.deleteMany({}));
  await safeDelete('autoPayCharge', () => prisma.autoPayCharge.deleteMany({}));
  await safeDelete('cardOnFile', () => prisma.cardOnFile.deleteMany({}));
  await safeDelete('autopayEnrollment', () => prisma.autopayEnrollment.deleteMany({}));

  // 11. Patient Portal Accounts, Notifications & Device Tokens
  console.log('\n--- 11. Patient Accounts & Notifications ---');
  await safeDelete('patientNotification', () => prisma.patientNotification.deleteMany({}));
  await safeDelete('notificationLog', () => prisma.notificationLog.deleteMany({}));
  await safeDelete('medicationIntakeLog', () => prisma.medicationIntakeLog.deleteMany({}));
  await safeDelete('medicationSchedule', () => prisma.medicationSchedule.deleteMany({}));
  await safeDelete('deviceToken', () => prisma.deviceToken.deleteMany({}));
  await safeDelete('patientAuditLog', () => prisma.patientAuditLog.deleteMany({}));
  await safeDelete('patientAccount', () => prisma.patientAccount.deleteMany({}));

  // 12. Operational Logs & Tasks
  console.log('\n--- 12. Operational Calls & Project Tasks ---');
  await safeDelete('operationalCallLog', () => prisma.operationalCallLog.deleteMany({}));
  await safeDelete('projectComment', () => prisma.projectComment.deleteMany({}));
  await safeDelete('projectSubtask', () => prisma.projectSubtask.deleteMany({}));
  await safeDelete('projectTask', () => prisma.projectTask.deleteMany({}));
  await safeDelete('supervisionLog', () => prisma.supervisionLog.deleteMany({}));
  await safeDelete('supervisionTrack', () => prisma.supervisionTrack.deleteMany({}));

  // 13. All Clients Purge
  console.log('\n--- 13. Purging All Clients ---');
  await safeDelete('client', () => prisma.client.deleteMany({}));

  // 14. Ensure Practice Locations under primary organization
  console.log('\n--- 14. Preserving & Verifying Practice Locations ---');
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
        console.log(`  ✓ Created canonical location: ${loc.name}`);
      } else {
        await prisma.location.update({
          where: { id: existing.id },
          data: {
            active: true,
            code: loc.code,
            city: loc.city,
            state: loc.state,
            isPrimary: loc.isPrimary,
          },
        });
        console.log(`  ✓ Verified active location: ${loc.name}`);
      }
    }
  }

  // 15. Final Audit Verification
  console.log('\n--- 15. Final Post-Sanitization Audit ---');
  const finalClients = await prisma.client.count();
  const finalAppts = await prisma.appointment.count();
  const finalClaims = await prisma.claim.count();
  const finalNotes = await prisma.progressNote.count();
  const finalMedProbs = await prisma.medicalProblem.count();
  const finalPatientAccounts = await prisma.patientAccount.count();
  const finalPatientNotifications = await prisma.patientNotification.count();

  const totalUsers = await prisma.user.count();
  const totalOrgs = await prisma.organization.count();
  const totalLocations = await prisma.location.count({ where: { active: true } });

  console.log(`- Clients Count: ${finalClients} (Expected: 0)`);
  console.log(`- Appointments Count: ${finalAppts} (Expected: 0)`);
  console.log(`- Claims Count: ${finalClaims} (Expected: 0)`);
  console.log(`- Progress Notes Count: ${finalNotes} (Expected: 0)`);
  console.log(`- Medical Problems Count: ${finalMedProbs} (Expected: 0)`);
  console.log(`- Patient Portal Accounts Count: ${finalPatientAccounts} (Expected: 0)`);
  console.log(`- Patient Notifications Count: ${finalPatientNotifications} (Expected: 0)`);
  console.log(`- Preserved Staff/Clinicians: ${totalUsers} (All active logins intact)`);
  console.log(`- Preserved Organizations: ${totalOrgs}`);
  console.log(`- Preserved Active Locations: ${totalLocations}`);

  if (
    finalClients === 0 &&
    finalAppts === 0 &&
    finalClaims === 0 &&
    finalNotes === 0 &&
    finalPatientAccounts === 0 &&
    totalUsers > 0 &&
    totalOrgs > 0 &&
    totalLocations >= 4
  ) {
    console.log('\n🎉 DATABASE FULLY SANITIZED FOR LIVE! ZERO DUMMY CLIENTS/RECORDS REMAIN.');
  } else {
    throw new Error('Post-sanitization audit failed: Counts did not match expected zero state.');
  }
}

sanitizeDatabaseForLive()
  .catch((err) => {
    console.error('❌ Sanitization failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
