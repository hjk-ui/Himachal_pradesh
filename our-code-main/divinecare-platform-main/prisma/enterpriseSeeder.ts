import { PrismaClient, ClaimStatus, ClaimDenialStatus } from '@prisma/client';

export async function seedEnterpriseModules(prisma: PrismaClient, orgId: string) {
  console.log('Seeding Enterprise Modules (Oct 1-13 Spec)...');

  // Fetch or find clients to link records
  const clients = await prisma.client.findMany({
    where: { organizationId: orgId },
    take: 12,
  });

  const getClientId = (index: number) => {
    if (clients.length > 0) {
      return clients[index % clients.length].id;
    }
    return undefined;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Seed 14 Residential Beds & 10 Active Resident Stays
  // 8 for ASAM 3.5 (B-201 to B-208) and 6 for ASAM 3.1 (A-101 to A-106)
  // ───────────────────────────────────────────────────────────────────────────
  const existingResidents = await prisma.residentialResident.count();
  if (existingResidents === 0) {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
    const daysAhead = (d: number) => new Date(now.getTime() + d * 86400000);

    const RESIDENTS_DATA = [
      // ── ASAM 3.5 (High-Intensity Residential) ──
      {
        name: 'Marcus Thompson',
        program: '3.5',
        room: 'B-201',
        admitDate: daysAgo(14),
        counselor: 'Sarah Jenkins, LCADC',
        phase: 'Stabilization',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 3, dim2: 2, dim3: 3, dim4: 3, dim5: 3, dim6: 2 },
        paNumber: 'PA-MD-35-8812',
        paUnitsRemaining: 21,
        lastCsrDate: daysAgo(5),
        nextCsrDate: daysAhead(2),
        active: true,
      },
      {
        name: 'Carlos Rivera',
        program: '3.5',
        room: 'B-202',
        admitDate: daysAgo(20),
        counselor: 'Sarah Jenkins, LCADC',
        phase: 'Active Treatment',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 2, dim2: 1, dim3: 3, dim4: 3, dim5: 3, dim6: 3 },
        paNumber: 'PA-MD-35-8819',
        paUnitsRemaining: 14,
        lastCsrDate: daysAgo(6),
        nextCsrDate: daysAhead(1),
        active: true,
      },
      {
        name: 'Tamika Brown',
        program: '3.5',
        room: 'B-203',
        admitDate: daysAgo(28),
        counselor: 'Michael Torres, LMSW',
        phase: 'Transition Prep',
        txPlanStatus: 'overdue',
        orientationDone: true,
        asamScores: { dim1: 1, dim2: 1, dim3: 3, dim4: 3, dim5: 2, dim6: 3 },
        paNumber: 'PA-BCBS-35-9011',
        paUnitsRemaining: 18,
        lastCsrDate: daysAgo(9),
        nextCsrDate: daysAgo(2), // Overdue
        active: true,
      },
      {
        name: 'Jerome Adams',
        program: '3.5',
        room: 'B-204',
        admitDate: daysAgo(4),
        counselor: 'Michael Torres, LMSW',
        phase: 'Intake / Orientation',
        txPlanStatus: 'due',
        orientationDone: false,
        asamScores: { dim1: 3, dim2: 2, dim3: 3, dim4: 4, dim5: 3, dim6: 3 },
        paNumber: null, // PA Missing
        paUnitsRemaining: 0,
        lastCsrDate: null,
        nextCsrDate: daysAhead(3),
        active: true,
      },
      {
        name: 'Lydia Chen',
        program: '3.5',
        room: 'B-205',
        admitDate: daysAgo(35),
        counselor: 'Sarah Jenkins, LCADC',
        phase: 'Transition Prep',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 1, dim2: 1, dim3: 2, dim4: 2, dim5: 2, dim6: 2 },
        paNumber: 'PA-MD-35-8742',
        paUnitsRemaining: 4,
        lastCsrDate: daysAgo(4),
        nextCsrDate: daysAhead(3),
        active: true,
      },
      {
        name: 'Andre Washington',
        program: '3.5',
        room: 'B-206',
        admitDate: daysAgo(11),
        counselor: 'Michael Torres, LMSW',
        phase: 'Active Treatment',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 2, dim2: 1, dim3: 3, dim4: 3, dim5: 3, dim6: 2 },
        paNumber: 'PA-MD-35-8904',
        paUnitsRemaining: 19,
        lastCsrDate: daysAgo(3),
        nextCsrDate: daysAhead(4),
        active: true,
      },
      // ── ASAM 3.1 (Low-Intensity Clinically Managed Residential) ──
      {
        name: 'Maria Santos',
        program: '3.1',
        room: 'A-101',
        admitDate: daysAgo(45),
        counselor: 'David Ross, CAC-AD',
        phase: 'Community Reintegration',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 1, dim2: 1, dim3: 2, dim4: 2, dim5: 2, dim6: 1 },
        paNumber: 'PA-MD-31-4402',
        paUnitsRemaining: 23,
        lastCsrDate: daysAgo(15),
        nextCsrDate: daysAhead(15),
        active: true,
      },
      {
        name: 'Derek Foster',
        program: '3.1',
        room: 'A-102',
        admitDate: daysAgo(52),
        counselor: 'David Ross, CAC-AD',
        phase: 'Vocational Prep',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 0, dim2: 1, dim3: 1, dim4: 2, dim5: 2, dim6: 1 },
        paNumber: 'PA-MD-31-4389',
        paUnitsRemaining: 12,
        lastCsrDate: daysAgo(22),
        nextCsrDate: daysAhead(8),
        active: true,
      },
      {
        name: 'Aisha Johnson',
        program: '3.1',
        room: 'A-103',
        admitDate: daysAgo(30),
        counselor: 'David Ross, CAC-AD',
        phase: 'Active Treatment',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 1, dim2: 1, dim3: 2, dim4: 2, dim5: 2, dim6: 2 },
        paNumber: 'PA-CF-31-7712',
        paUnitsRemaining: 19,
        lastCsrDate: daysAgo(10),
        nextCsrDate: daysAhead(20),
        active: true,
      },
      {
        name: 'James Wilson',
        program: '3.1',
        room: 'A-104',
        admitDate: daysAgo(60),
        counselor: 'David Ross, CAC-AD',
        phase: 'Discharge Planning',
        txPlanStatus: 'current',
        orientationDone: true,
        asamScores: { dim1: 0, dim2: 0, dim3: 1, dim4: 1, dim5: 1, dim6: 1 },
        paNumber: 'PA-MD-31-4190',
        paUnitsRemaining: 0, // PA Exhausted
        lastCsrDate: daysAgo(28),
        nextCsrDate: daysAhead(2),
        active: true,
      },
    ];

    for (const r of RESIDENTS_DATA) {
      const createdResident = await prisma.residentialResident.create({
        data: {
          ...r,
          clientId: getClientId(0),
        },
      });

      // Seed sample shift notes for resident
      await prisma.residentialShiftNote.createMany({
        data: [
          {
            residentId: createdResident.id,
            shift: 'Day',
            author: 'R. Davis, Peer Specialist',
            shiftDate: daysAgo(1),
            milieu: 'Attentive, participated actively in morning relapse prevention group.',
            adherence: 'Medications taken at 08:00 without refusal.',
            sleep: 'Reported 7.5 hours of uninterrupted sleep.',
            notes: 'Resident engaged with counselor regarding vocational goals and transitional housing search.',
          },
          {
            residentId: createdResident.id,
            shift: 'Evening',
            author: 'M. Patel, Residential Tech',
            shiftDate: daysAgo(1),
            milieu: 'Cooperative, attended 12-step meeting in community room.',
            adherence: 'Evening med pass completed with nursing staff.',
            sleep: null,
            notes: 'No behavioral incidents noted. Milieu remained calm and structured.',
          },
        ],
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Seed 6 Crisis Episodes with Timeline Logs
  // ───────────────────────────────────────────────────────────────────────────
  const existingEpisodes = await prisma.crisisEpisode.count();
  if (existingEpisodes === 0) {
    const now = new Date();
    const CRISIS_DATA = [
      {
        episodeNumber: 'MC-2026-0147',
        clientName: 'Marcus Thompson',
        location: '1240 N Calvert St, Apt 3B, Baltimore, MD',
        callerName: 'Landlord (Mr. Vance)',
        callerRelationship: 'Property Manager',
        priority: 1,
        status: 'dispatched',
        assignedTeam: 'Crisis Unit 1 — Central',
        teamMembers: 'K. Osei, LCSW-C + T. Nguyen, CPRS',
        startedAt: new Date(now.getTime() - 25 * 60000),
        dispatchedAt: '14:45',
        arrivedAt: null,
        resolvedAt: null,
        responseMinutes: null,
        disposition: null,
        interventions: ['Zero-PHI Team Paging Initiated', 'Safety Gate Verification'],
        docComplete: false,
        notificationsSent: true,
        followUp24hStatus: 'pending',
        timeline: [
          { time: '14:42', label: 'Call Received', note: 'Caller reports tenant pacing in hallway, agitated, stating people are watching him through electrical outlets.', kind: 'intake' },
          { time: '14:45', label: 'Unit Dispatched', note: 'Mobile Crisis Unit 1 acknowledged dispatch. ETA 18 minutes.', kind: 'dispatch' },
        ],
      },
      {
        episodeNumber: 'MC-2026-0146',
        clientName: 'Rosa Gutierrez',
        location: '3800 E Baltimore St, Baltimore, MD',
        callerName: 'Sister (Elena)',
        callerRelationship: 'Family',
        priority: 2,
        status: 'onscene',
        assignedTeam: 'Crisis Unit 2 — East',
        teamMembers: 'J. Martin, LPC + D. Washington, CPRS',
        startedAt: new Date(now.getTime() - 75 * 60000),
        dispatchedAt: '13:55',
        arrivedAt: '14:18',
        resolvedAt: null,
        responseMinutes: 23,
        disposition: null,
        interventions: ['Verbal De-escalation', 'Collaborative Safety Planning', 'Comfort Kit Provided'],
        mseAppearance: 'Distressed, tearful, appropriately groomed',
        mseMood: 'Severe Anxiety / Panic',
        mseThought: 'Racing thoughts, no active suicidal ideation with intent',
        lraNarrative: 'Least restrictive alternative pursued: in-home stabilization with sister staying overnight. Hospitalization averted.',
        clientVoice: '“I feel much calmer now that my sister is here and we have a concrete safety plan.”',
        docComplete: true,
        notificationsSent: true,
        followUp24hStatus: 'scheduled',
        followUp24hDate: new Date(now.getTime() + 24 * 3600000),
        timeline: [
          { time: '13:50', label: 'Call Received', note: 'Panic attack with severe hyperventilation and tremors.', kind: 'intake' },
          { time: '13:55', label: 'Unit Dispatched', note: 'Unit 2 en route.', kind: 'dispatch' },
          { time: '14:18', label: 'On Scene', note: 'Arrived at residence. Elena met team at porch.', kind: 'onscene' },
          { time: '14:40', label: 'De-escalation Achieved', note: 'Breathing exercises and somatic grounding successful.', kind: 'clinical' },
        ],
      },
      {
        episodeNumber: 'MC-2026-0145',
        clientName: 'Derek Foster',
        location: 'Telehealth Hub (Virtual Crisis Room 4)',
        callerName: 'Outpatient Therapist',
        callerRelationship: 'Treating Clinician',
        priority: 2,
        status: 'resolved',
        assignedTeam: 'Crisis Telehealth Specialist',
        teamMembers: 'Dr. Evelyn Reed, MD',
        startedAt: new Date(now.getTime() - 180 * 60000),
        dispatchedAt: '12:10',
        arrivedAt: '12:12',
        resolvedAt: '12:47',
        responseMinutes: 2,
        disposition: 'Stabilized virtually; outpatient therapy appointment moved up to tomorrow morning.',
        interventions: ['Crisis Psychotherapy (90839)', 'Lethal Means Counseling', 'Prescriber Outreach'],
        docComplete: true,
        notificationsSent: true,
        followUp24hStatus: 'completed',
        followUp24hDate: new Date(now.getTime() - 2 * 3600000),
        timeline: [
          { time: '12:08', label: 'Virtual Transfer', note: 'Warm handoff from outpatient session.', kind: 'intake' },
          { time: '12:12', label: 'Session Started', note: 'Comprehensive risk assessment and safety contract executed.', kind: 'clinical' },
          { time: '12:47', label: 'Episode Resolved', note: 'Client agreed to follow-up and confirmed meds secured.', kind: 'resolved' },
        ],
      },
      {
        episodeNumber: 'MC-2026-0144',
        clientName: 'Aisha Johnson',
        location: '2100 W North Ave, Baltimore, MD',
        callerName: 'Aisha (Self-Referral)',
        callerRelationship: 'Self',
        priority: 2,
        status: 'closed',
        assignedTeam: 'Crisis Unit 3 — West',
        teamMembers: 'L. Brooks, LCSW + S. Vance, Peer',
        startedAt: new Date(now.getTime() - 86400000 * 2),
        dispatchedAt: '10:15',
        arrivedAt: '10:38',
        resolvedAt: '12:14',
        responseMinutes: 23,
        disposition: 'Referred to SUD Outpatient Clinic and provided crisis helpline card.',
        interventions: ['Mobile Crisis Intervention (H2011)', 'Harm Reduction Counseling'],
        docComplete: true,
        notificationsSent: true,
        followUp24hStatus: 'completed',
        followUp72hStatus: 'completed',
        timeline: [
          { time: '10:10', label: 'Intake', note: 'Self-reported alcohol cravings and acute distress.', kind: 'intake' },
          { time: '12:14', label: 'Resolved', note: 'Stabilization complete; warm connection to community peer.', kind: 'resolved' },
        ],
      },
      {
        episodeNumber: 'MC-2026-0143',
        clientName: 'Victor Hamm',
        location: 'Bayview Medical Center ED Waiting Area',
        callerName: 'ED Triage Nurse',
        callerRelationship: 'Emergency Department Staff',
        priority: 3,
        status: 'resolved',
        assignedTeam: 'Crisis Unit 1 — Central',
        teamMembers: 'K. Osei, LCSW-C + T. Nguyen, CPRS',
        startedAt: new Date(now.getTime() - 86400000 * 3),
        dispatchedAt: '09:00',
        arrivedAt: '09:25',
        resolvedAt: '11:10',
        responseMinutes: 25,
        disposition: 'Diversion from psychiatric inpatient admission to Crisis Stabilization Center.',
        interventions: ['Diversion Assessment', 'Peer Transportation to Center'],
        docComplete: true,
        notificationsSent: true,
        followUp24hStatus: 'completed',
        timeline: [
          { time: '09:00', label: 'Dispatched to ED', note: 'ED requested diversion assessment.', kind: 'dispatch' },
          { time: '11:10', label: 'Diversion Accepted', note: 'Transferred to Community Crisis Bed.', kind: 'resolved' },
        ],
      },
      {
        episodeNumber: 'MC-2026-0142',
        clientName: 'Gloria Minton',
        location: '500 E Pratt St, Baltimore, MD',
        callerName: 'Downtown Partnership Ambassador',
        callerRelationship: 'Community Ambassador',
        priority: 2,
        status: 'resolved',
        assignedTeam: 'Crisis Unit 2 — East',
        teamMembers: 'J. Martin, LPC + D. Washington, CPRS',
        startedAt: new Date(now.getTime() - 86400000 * 4),
        dispatchedAt: '15:20',
        arrivedAt: '15:42',
        resolvedAt: '17:05',
        responseMinutes: 22,
        disposition: 'Engaged with homeless outreach team and scheduled intake with PRP clinic.',
        interventions: ['Field Engagement', 'Resource Connection', 'Water & Meal Provision'],
        docComplete: true,
        notificationsSent: true,
        followUp24hStatus: 'completed',
        timeline: [
          { time: '15:20', label: 'Dispatched', note: 'Ambassador observed confusion and disorientation.', kind: 'dispatch' },
          { time: '17:05', label: 'Resolved', note: 'Connected with shelter outreach coordinator.', kind: 'resolved' },
        ],
      },
    ];

    for (const ep of CRISIS_DATA) {
      await prisma.crisisEpisode.create({
        data: {
          ...ep,
          organizationId: orgId,
          clientId: getClientId(1),
        },
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Seed 6 AOT Participants (Maryland Health-General § 10-6A-05)
  // ───────────────────────────────────────────────────────────────────────────
  const existingAot = await prisma.aotParticipant.count();
  if (existingAot === 0) {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
    const daysAhead = (d: number) => new Date(now.getTime() + d * 86400000);

    const AOT_DATA = [
      {
        name: 'Darnell Price',
        age: 42,
        status: 'active',
        county: 'Baltimore City',
        referralSource: 'University Hospital — 3rd inpatient discharge in 14 months',
        diagnosis: 'Schizophrenia (F20.9), medication non-adherence pattern',
        petitionDate: daysAgo(85),
        hearingDate: daysAgo(66),
        orderStart: daysAgo(59),
        orderEnd: daysAhead(121),
        eligibilityData: {
          statute: 'HG § 10-6A-05',
          prongsMet: true,
          hospitalizationsPast3Years: 3,
          detentionPsychServices: false,
          violentActsOrThreats: false,
          leastRestrictiveAlternativeVerified: true,
        },
        psychiatristAffidavit: {
          signed: true,
          doctor: 'Dr. S. Obi, MD',
          examDate: daysAgo(90).toISOString().slice(0, 10),
          testifyWilling: true,
        },
        deadlines: [
          { id: 'd1', label: '90-day status report to court', due: daysAhead(31).toISOString().slice(0, 10), daysLeft: 31, status: 'upcoming', basis: 'Court order condition' },
          { id: 'd2', label: 'Psychiatrist medication review (monthly)', due: daysAhead(3).toISOString().slice(0, 10), daysLeft: 3, status: 'due', basis: 'Treatment plan cadence' },
          { id: 'd3', label: 'Renewal decision — file 30 days before order expiry', due: daysAhead(91).toISOString().slice(0, 10), daysLeft: 91, status: 'upcoming', basis: 'Statutory renewal window' },
        ],
        teamCadence: [
          { role: 'AOT Coordinator', name: 'R. Bennett, LMSW', cadence: 'Weekly', lastContact: daysAgo(4).toISOString().slice(0, 10), nextDue: daysAhead(3).toISOString().slice(0, 10), status: 'current' },
          { role: 'Psychiatrist', name: 'Dr. S. Obi', cadence: 'Monthly', lastContact: daysAgo(27).toISOString().slice(0, 10), nextDue: daysAhead(3).toISOString().slice(0, 10), status: 'due' },
          { role: 'Case Manager', name: 'T. Nguyen', cadence: 'Weekly', lastContact: daysAgo(2).toISOString().slice(0, 10), nextDue: daysAhead(5).toISOString().slice(0, 10), status: 'current' },
        ],
        escalationEvents: [],
      },
      {
        name: 'Monica Reyes',
        age: 35,
        status: 'hearing',
        county: 'Baltimore County',
        referralSource: 'Family petition — mother, with 2 hospitalizations past year',
        diagnosis: 'Bipolar I with psychotic features (F31.2)',
        petitionDate: daysAgo(12),
        hearingDate: daysAhead(3),
        orderStart: null,
        orderEnd: null,
        eligibilityData: {
          statute: 'HG § 10-6A-05',
          prongsMet: true,
          hospitalizationsPast3Years: 2,
        },
        psychiatristAffidavit: {
          signed: true,
          doctor: 'Dr. S. Obi, MD',
          examDate: daysAgo(10).toISOString().slice(0, 10),
          testifyWilling: true,
        },
        deadlines: [
          { id: 'd5', label: 'Hearing — evidence packet to counsel', due: daysAhead(1).toISOString().slice(0, 10), daysLeft: 1, status: 'due', basis: 'Court scheduling order' },
          { id: 'd6', label: 'Physician affidavit finalized & signed', due: daysAgo(2).toISOString().slice(0, 10), daysLeft: -2, status: 'done', basis: 'Petition requirement' },
          { id: 'd8', label: 'Proposed treatment plan drafted for hearing', due: daysAhead(2).toISOString().slice(0, 10), daysLeft: 2, status: 'due', basis: 'Court filing requirement' },
        ],
        teamCadence: [
          { role: 'AOT Coordinator', name: 'R. Bennett, LMSW', cadence: 'Weekly', lastContact: daysAgo(3).toISOString().slice(0, 10), nextDue: daysAhead(4).toISOString().slice(0, 10), status: 'current' },
          { role: 'Psychiatrist (affiant)', name: 'Dr. S. Obi', cadence: 'Pre-hearing', lastContact: daysAgo(5).toISOString().slice(0, 10), nextDue: daysAhead(2).toISOString().slice(0, 10), status: 'due' },
        ],
        escalationEvents: [],
      },
      {
        name: 'Terrence Cole',
        age: 29,
        status: 'active',
        county: 'Baltimore City',
        referralSource: 'Circuit court — diversion from incompetency docket',
        diagnosis: 'Schizoaffective disorder (F25.0), cannabis use',
        petitionDate: daysAgo(160),
        hearingDate: daysAgo(140),
        orderStart: daysAgo(135),
        orderEnd: daysAhead(45),
        eligibilityData: {
          statute: 'HG § 10-6A-05',
          prongsMet: true,
          hospitalizationsPast3Years: 2,
        },
        psychiatristAffidavit: { signed: true, doctor: 'Dr. A. Reyes, MD' },
        deadlines: [
          { id: 'd9', label: 'Non-adherence team review — material non-compliance', due: daysAhead(2).toISOString().slice(0, 10), daysLeft: 2, status: 'due', basis: 'Escalation protocol after 2 missed visits' },
          { id: 'd10', label: 'Renewal decision — file 30 days before order expiry', due: daysAhead(15).toISOString().slice(0, 10), daysLeft: 15, status: 'upcoming', basis: 'Statutory renewal window' },
        ],
        teamCadence: [
          { role: 'AOT Coordinator', name: 'R. Bennett, LMSW', cadence: 'Weekly', lastContact: daysAgo(5).toISOString().slice(0, 10), nextDue: daysAhead(2).toISOString().slice(0, 10), status: 'current' },
          { role: 'Case Manager', name: 'T. Nguyen', cadence: 'Weekly', lastContact: daysAgo(10).toISOString().slice(0, 10), nextDue: daysAgo(3).toISOString().slice(0, 10), status: 'overdue' },
        ],
        escalationEvents: [
          { date: daysAgo(12).toISOString().slice(0, 10), event: 'Missed psychiatrist med appointment (1st)', action: 'Same-day outreach call; rescheduled' },
          { date: daysAgo(5).toISOString().slice(0, 10), event: 'Missed rescheduled appointment (2nd)', action: 'Peer support home visit conducted' },
        ],
      },
      {
        name: 'Sandra Okafor',
        age: 51,
        status: 'referral',
        county: 'Baltimore City',
        referralSource: 'Sister (family referral)',
        diagnosis: '4 psychiatric hospitalizations in 24 months; stops meds after each discharge',
        eligibilityData: { sourceKind: 'family' },
      },
      {
        name: 'Victor Hamm',
        age: 38,
        status: 'referral',
        county: 'Baltimore County',
        referralSource: 'Bayview ED — psychiatric consult',
        diagnosis: 'Repeated ED visits, threats toward neighbor during decompensation (March 2026)',
        eligibilityData: { sourceKind: 'hospital' },
      },
      {
        name: 'Gloria Minton',
        age: 44,
        status: 'referral',
        county: 'Baltimore City',
        referralSource: 'District court — mental health docket',
        diagnosis: 'Trespass charges tied to untreated psychosis; declined voluntary services twice',
        eligibilityData: { sourceKind: 'court' },
      },
    ];

    for (const p of AOT_DATA) {
      await prisma.aotParticipant.create({
        data: {
          ...p,
          clientId: getClientId(2),
        },
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Seed 8 SUD Radar Signals in SudRadarSignal
  // 4 from diagnosis codes, 4 from note keywords with clinical quotes
  // ───────────────────────────────────────────────────────────────────────────
  const existingRadar = await prisma.sudRadarSignal.count();
  if (existingRadar === 0) {
    const RADAR_DATA = [
      // ── 4 from Diagnosis Codes (F10-F19) ──
      {
        detectionSource: 'diagnosis',
        detectedCondition: 'Alcohol Use Disorder, Severe (F10.20)',
        quotedEvidence: 'ICD-10-CM Problem List: Active diagnosis F10.20 documented since 04/12/2026. Prescribed naltrexone 50mg daily.',
        confidencePercent: 99,
        recommendation: 'Step-up to Residential ASAM 3.5 or 3.1 indicated. Continued high consumption despite outpatient therapy.',
        actionLabel: 'Start Residential Admission',
        actionHref: '/dashboard/residential',
      },
      {
        detectionSource: 'diagnosis',
        detectedCondition: 'Opioid Use Disorder, Moderate (F11.20)',
        quotedEvidence: 'Active Buprenorphine/Naloxone 8mg-2mg maintenance. Last toxic screen positive for fentanyl metabolites.',
        confidencePercent: 96,
        recommendation: 'Level of care step-up required. Reassess ASAM multidimensional criteria for intensive residential stabilization.',
        actionLabel: 'Start ASAM 6-Dim Assessment',
        actionHref: '/dashboard/residential',
      },
      {
        detectionSource: 'diagnosis',
        detectedCondition: 'Cannabis Use Disorder, Severe (F12.20)',
        quotedEvidence: 'Problem list entry F12.20 confirmed. Persistent daily heavy smoking causing cognitive clouding and vocational disruption.',
        confidencePercent: 94,
        recommendation: 'Structured outpatient SUD group or ASAM 3.1 low-intensity residential review.',
        actionLabel: 'Review Residential 3.1 Eligibility',
        actionHref: '/dashboard/residential',
      },
      {
        detectionSource: 'diagnosis',
        detectedCondition: 'Sedative, Hypnotic, or Anxiolytic-Related Disorder (F13.10)',
        quotedEvidence: 'ICD-10 F13.10 active. History of polysubstance use complicating PTSD treatment regimen.',
        confidencePercent: 95,
        recommendation: 'Integrated dual diagnosis treatment track. Residential step-up evaluation recommended.',
        actionLabel: 'Start Residential Admission',
        actionHref: '/dashboard/residential',
      },
      // ── 4 from Note Keywords (Unmapped to Problem List) ──
      {
        detectionSource: 'note-keyword',
        detectedCondition: 'Suspected Alcohol Dependency (Missing from Problem List)',
        quotedEvidence: '"Patient discloses drinking 5-6 standard drinks nightly to fall asleep. Reports blackouts on weekends." — Progress Note (Dr. Park, 10/04/2026)',
        confidencePercent: 88,
        recommendation: 'Formal SUD assessment needed. Problem list lacks SUD diagnosis. Administer WHO AUDIT screener immediately.',
        actionLabel: 'Administer AUDIT Screener',
        actionHref: '/dashboard/sdoh',
      },
      {
        detectionSource: 'note-keyword',
        detectedCondition: 'Cannabis Concentrate Use Pattern (Unspecified)',
        quotedEvidence: '"Spouse notes heavy cannabis concentrate use daily (dabbing 4-5 times/day). Impairing executive function and morning attendance."',
        confidencePercent: 82,
        recommendation: 'Diagnostic evaluation for Cannabis Use Disorder (F12.20). Order urine toxicology panel.',
        actionLabel: 'Order Toxicology Lab Panel',
        actionHref: '/dashboard/ehr/labs',
      },
      {
        detectionSource: 'note-keyword',
        detectedCondition: 'Sedative / Anxiolytic Misuse Risk',
        quotedEvidence: '"Requested early refill of alprazolam 1mg; reports obtaining supplementary clonazepam from acquaintance."',
        confidencePercent: 91,
        recommendation: 'PDMP query required under Maryland CRISP. Prescriber review mandatory for benzodiazepine diversion/misuse risk.',
        actionLabel: 'Route Alert to Prescriber',
        actionHref: '/dashboard/sdoh',
      },
      {
        detectionSource: 'note-keyword',
        detectedCondition: 'Stimulant / Cocaine Exposure Mentioned',
        quotedEvidence: '"Patient admitted to recreational cocaine use twice over the weekend while visiting family in Philadelphia."',
        confidencePercent: 85,
        recommendation: 'Immediate harm-reduction counseling, fentanyl test strip provision, and NIDA-Quick screen.',
        actionLabel: 'Open SUD Assessment',
        actionHref: '/dashboard/sdoh',
      },
    ];

    for (let i = 0; i < RADAR_DATA.length; i++) {
      const targetClientId = getClientId(i) || getClientId(0);
      if (targetClientId) {
        await prisma.sudRadarSignal.create({
          data: {
            ...RADAR_DATA[i],
            organizationId: orgId,
            clientId: targetClientId,
          },
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Seed 10 Claims and 6 Denials (with CARC codes: CO-16, CO-45, PR-1, etc.)
  // ───────────────────────────────────────────────────────────────────────────
  const existingClaims = await prisma.claim.count({ where: { organizationId: orgId } });
  if (existingClaims === 0) {
    const CLAIMS_DATA = [
      { cptCode: '90837', units: 1, amountCents: 18000, payer: 'Medicaid (MD)', status: ClaimStatus.DENIED, placeOfService: '11' },
      { cptCode: '90837', units: 1, amountCents: 18000, payer: 'Medicaid (MD)', status: ClaimStatus.DENIED, placeOfService: '11' },
      { cptCode: 'H2017', units: 2, amountCents: 32000, payer: 'Medicare Part B', status: ClaimStatus.DENIED, placeOfService: '11' },
      { cptCode: '90791', units: 1, amountCents: 22000, payer: 'BCBS Maryland', status: ClaimStatus.DENIED, placeOfService: '11' },
      { cptCode: '90847', units: 1, amountCents: 16000, payer: 'Medicaid (MD)', status: ClaimStatus.DENIED, placeOfService: '11' },
      { cptCode: '90834', units: 1, amountCents: 14000, payer: 'Aetna Behavioral Health', status: ClaimStatus.DENIED, placeOfService: '11' },
      { cptCode: '90837', units: 1, amountCents: 18000, payer: 'Medicaid (MD)', status: ClaimStatus.SUBMITTED, placeOfService: '11' },
      { cptCode: 'H0018', units: 1, amountCents: 38500, payer: 'Medicaid (MD)', status: ClaimStatus.SUBMITTED, placeOfService: '55' },
      { cptCode: 'H0019', units: 1, amountCents: 24500, payer: 'Medicaid (MD)', status: ClaimStatus.PAID, placeOfService: '55' },
      { cptCode: 'H2011', units: 4, amountCents: 13600, payer: 'Medicaid (MD)', status: ClaimStatus.PAID, placeOfService: '15' },
    ];

    const createdClaims = [];
    for (let i = 0; i < CLAIMS_DATA.length; i++) {
      const c = CLAIMS_DATA[i];
      const targetClientId = getClientId(i) || getClientId(0);
      if (targetClientId) {
        const claim = await prisma.claim.create({
          data: {
            organizationId: orgId,
            clientId: targetClientId,
            cptCode: c.cptCode,
            units: c.units,
            amountCents: c.amountCents,
            payer: c.payer,
            status: c.status,
            placeOfService: c.placeOfService,
            renderingNpi: '1234567891',
            billingNpi: '1457893210',
          },
        });
        createdClaims.push(claim);
      }
    }

    // Seed 6 Denials attached to the first 6 denied claims
    const DENIALS_DATA = [
      {
        reasonCode: 'CO-97',
        reasonText: 'The benefit for this service is included in the payment/allowance for another service/procedure that has already been adjudicated.',
        carcCode: 'CO-97',
        status: ClaimDenialStatus.APPEALED,
        appealLetterBody: 'Valid authorization #MD-2026-88421 was active on date of service.',
      },
      {
        reasonCode: 'CO-50',
        reasonText: 'These are non-covered services because this is not deemed a medical necessity by the payer.',
        carcCode: 'CO-50',
        status: ClaimDenialStatus.OPEN,
      },
      {
        reasonCode: 'CO-16',
        reasonText: 'Claim lacks information or has submission/billing error(s) which is needed for adjudication. Missing modifier HK.',
        carcCode: 'CO-16',
        status: ClaimDenialStatus.OPEN,
      },
      {
        reasonCode: 'CO-27',
        reasonText: 'Expenses incurred after coverage terminated.',
        carcCode: 'CO-27',
        status: ClaimDenialStatus.WON,
        appealResolutionNote: 'Coverage was active. Submitted EOB from prior carrier. Appeal upheld.',
      },
      {
        reasonCode: 'CO-29',
        reasonText: 'The time limit for filing has expired.',
        carcCode: 'CO-29',
        status: ClaimDenialStatus.LOST,
      },
      {
        reasonCode: 'CO-45',
        reasonText: 'Charge exceeds fee schedule / maximum allowable amount under contractual agreement.',
        carcCode: 'CO-45',
        status: ClaimDenialStatus.OPEN,
      },
    ];

    for (let i = 0; i < Math.min(createdClaims.length, DENIALS_DATA.length); i++) {
      await prisma.claimDenial.create({
        data: {
          organizationId: orgId,
          claimId: createdClaims[i].id,
          reasonCode: DENIALS_DATA[i].reasonCode,
          reasonText: DENIALS_DATA[i].reasonText,
          carcCode: DENIALS_DATA[i].carcCode,
          status: DENIALS_DATA[i].status,
          appealLetterBody: DENIALS_DATA[i].appealLetterBody,
          appealResolutionNote: DENIALS_DATA[i].appealResolutionNote,
        },
      });
    }
  }

  console.log('Enterprise Modules Seed Complete:');
  console.log(`  Residential Residents: ${await prisma.residentialResident.count()}`);
  console.log(`  Crisis Episodes: ${await prisma.crisisEpisode.count()}`);
  console.log(`  AOT Participants: ${await prisma.aotParticipant.count()}`);
  console.log(`  SUD Radar Signals: ${await prisma.sudRadarSignal.count()}`);
  console.log(`  Claims: ${await prisma.claim.count({ where: { organizationId: orgId } })}`);
  console.log(`  Claim Denials: ${await prisma.claimDenial.count({ where: { organizationId: orgId } })}`);
}
