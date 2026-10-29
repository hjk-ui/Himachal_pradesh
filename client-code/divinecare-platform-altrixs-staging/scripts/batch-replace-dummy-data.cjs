const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
  const fullPath = path.resolve('g:/divinecare-platform', filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(File not found: );
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  let changed = false;
  for (const [target, replacement] of replacements) {
    if (content.includes(target)) {
      content = content.split(target).join(replacement);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(Updated: );
  } else {
    console.log(No changes needed in: );
  }
}

// 1. AOT & Crisis
replaceInFile('src/app/dashboard/aot/page.tsx', [
  [
    const IN_HOUSE_CLIENTS = [\n  'Marcus Thompson', 'Aisha Johnson', 'Carlos Rivera', 'Maria Santos', 'DeShawn Williams',\n  'Priya Kapoor', 'Jerome Carter', 'Derek Foster', 'Tamika Brown', 'Lydia Chen', 'James Wilson', 'Rosa Gutierrez',\n];,
    const IN_HOUSE_CLIENTS = [\n  'Ebony Squire', 'Bernard Hogans', 'Allison Brown', 'Kamil Brown', 'Michael Jusu',\n  'Jon Ryan A Dano', 'Joy Black', 'JANETTA Brett', 'Larry Williams', 'Rebekah Cerame', 'Patricia Yates', 'Cynthia Winstead',\n];
  ]
]);

replaceInFile('src/app/dashboard/crisis/page.tsx', [
  [
    const DEMO_CLIENTS = [\n  'Maria Santos',\n  'James Wilson',\n  'Aisha Johnson',\n  'Carlos Rivera',\n  'Tamika Brown',\n  'Derek Foster',\n  'Lydia Chen',\n  'Marcus Thompson',\n  'Rosa Gutierrez',\n  'Jerome Adams',\n];,
    const DEMO_CLIENTS = [\n  'Ebony Squire',\n  'Bernard Hogans',\n  'Allison Brown',\n  'Kamil Brown',\n  'Michael Jusu',\n  'Jon Ryan A Dano',\n  'Joy Black',\n  'JANETTA Brett',\n  'Larry Williams',\n  'Rebekah Cerame',\n];
  ]
]);

// 2. Residential
replaceInFile('src/app/api/residential/residents/route.ts', [
  [counselor: body.counselor || 'Sarah Jenkins, LCADC', counselor: body.counselor || 'L.Willis, LCADC']
]);

// 3. EHR Pages
replaceInFile('src/app/dashboard/ehr/assessments/sud/page.tsx', [
  [{ id: 'c-005', name: 'James Wilson', prescriber: 'Dr. James Park (Psychiatrist)' }, { id: 'c-005', name: 'Ebony Squire', prescriber: 'Dr. Marcus Johnson (Psychiatrist)' }]
]);

replaceInFile('src/app/dashboard/ehr/diagnoses/page.tsx', [
  [client: 'James Wilson', client: 'Ebony Squire']
]);

replaceInFile('src/app/dashboard/ehr/eligibility/page.tsx', [
  [client: 'Elena Rostova', client: 'Joy Black']
]);

replaceInFile('src/app/dashboard/ehr/labs/page.tsx', [
  [Dr. Sarah Jenkins, MD, Dr. Marcus Johnson, MD]
]);

replaceInFile('src/app/dashboard/ehr/notes/page.tsx', [
  ['James Wilson': { dx: 'PTSD, chronic', issues: 'hypervigilance, avoidance behaviors, occupational stress', pronoun: 'He' }, 'Ebony Squire': { dx: 'PTSD, chronic; ADHD', issues: 'hypervigilance, anxiety, concentration and focus', pronoun: 'She' }],
  [client === 'James Wilson', client === 'Ebony Squire'],
  ['James Wilson', 'Ebony Squire']
]);

replaceInFile('src/app/dashboard/ehr/page.tsx', [
  [client: 'James Wilson', client: 'Ebony Squire'],
  [GAD-7 due for James Wilson, GAD-7 due for Ebony Squire]
]);

replaceInFile('src/app/dashboard/ehr/prescriptions/page.tsx', [
  [client: 'James Wilson', client: 'Ebony Squire']
]);

replaceInFile('src/app/dashboard/ehr/scanner/page.tsx', [
  [id: 'P008', name: 'James Wilson', age: 36,, id: 'P008', name: 'Ebony Squire', age: 36,],
  [patient: 'James Wilson', patientId: 'P008',, patient: 'Ebony Squire', patientId: 'P008',],
  [patient: 'James Wilson', patient: 'Ebony Squire']
]);

// 4. EHR Data Features
replaceInFile('src/features/ehr/aiInsightsData.ts', [
  [client: 'James Wilson', client: 'Ebony Squire']
]);

replaceInFile('src/features/ehr/assessments/catalog.ts', [
  [clientId: 'assess-james-wilson', clientId: 'assess-ebony-squire'],
  [clientName: 'James Wilson', clientName: 'Ebony Squire']
]);

replaceInFile('src/features/ehr/scannerData.ts', [
  ['James Wilson', 'Ebony Squire']
]);

// 5. Analytics & Compliance & Billing seeds
replaceInFile('src/features/analytics/docProductivityData.ts', [
  [patientName: 'Destiny Williams', patientName: 'FELICIA WILLIAMS'],
  [patientName: 'Keisha Brown', patientName: 'Ebony Squire']
]);

replaceInFile('src/features/billing/billingSeeds.ts', [
  [clientName: 'Keisha Brown', clientName: 'Ebony Squire']
]);

replaceInFile('src/features/compliance/incidentsData.ts', [
  [eportedBy: 'Keisha Brown, RN', eportedBy: 'Brenda Williams, RN'],
  [ssignedTo: 'Keisha Brown, RN', ssignedTo: 'Brenda Williams, RN']
]);

// 6. RoleHomes.tsx
replaceInFile('src/features/dashboard/components/RoleHomes.tsx', [
  [clientName: 'Marcus Vance', clientName: 'Ebony Squire'],
  [clientName: 'Sarah Jenkins', clientName: 'Bernard Hogans'],
  [clientName: 'David Kim', clientName: 'Allison Brown'],
  [clientName: 'Eleanor Pena', clientName: 'Kamil Brown'],
  [clientName: 'Jamal Crawford', clientName: 'Michael Jusu'],
  [clientName: 'Chloe Bennett', clientName: 'Joy Black'],
  [clientName: 'Derrick Rose', clientName: 'Larry Williams']
]);

// 7. Clinical Provider & Team references
replaceInFile('src/app/dashboard/appointments/page.tsx', [
  [{ id: 'therapist-jenkins', name: 'Sarah Jenkins, LCSW-C', roleTitle: 'Lead Psychotherapist', initials: 'SJ', color: '#5C2D91', bgLight: '#5C2D9115', room: 'Room 102' }, { id: 'therapist-willis', name: 'L.Willis, LCSW-C', roleTitle: 'Lead Psychotherapist', initials: 'LW', color: '#5C2D91', bgLight: '#5C2D9115', room: 'Room 102' }],
  [{ id: 'psych-vance', name: 'Dr. Marcus Vance, MD', roleTitle: 'Medical Director / Psych', initials: 'MV', color: '#059669', bgLight: '#05966915', room: 'Room 104' }, { id: 'psych-johnson', name: 'Dr. Marcus Johnson, MD', roleTitle: 'Medical Director / Psych', initials: 'MJ', color: '#059669', bgLight: '#05966915', room: 'Room 104' }]
]);

replaceInFile('src/app/dashboard/clients/[id]/page.tsx', [
  [
ame: 'Dr. Sarah Jenkins, MD', 
ame: 'Dr. Marcus Johnson, MD'],
  [
ame: 'Marcus Vance, MSW', 
ame: 'R.Betts-Walker, MSW']
]);

replaceInFile('src/app/api/medical/patients/[id]/chart/route.ts', [
  [	herapist: 'Elena Rostova, LCSW-C', 	herapist: 'R.Betts-Walker, LCSW-C'],
  [psychiatrist: 'Dr. Marcus Vance, MD', psychiatrist: 'Dr. Marcus Johnson, MD']
]);

replaceInFile('src/app/api/projects/tasks/route.ts', [
  [ssigneeName: 'Dr. Marcus Vance', ssigneeName: 'Dr. Marcus Johnson']
]);

replaceInFile('src/app/api/providers/roster/route.ts', [
  [{ id: 'prov-1', name: 'Dr. Sarah Jenkins, MD', email: 's.jenkins@divinecare.com', role: 'Psychiatrist', initials: 'SJ', avatarColor: '#5C2D91' }, { id: 'prov-1', name: 'Dr. Marcus Johnson, MD', email: 'marcus.johnson@divinecounseling.com', role: 'Psychiatrist', initials: 'MJ', avatarColor: '#5C2D91' }],
  [{ id: 'prov-3', name: 'Marcus Vance, MSW', email: 'm.vance@divinecare.com', role: 'Case Manager', initials: 'MV', avatarColor: '#10B981' }, { id: 'prov-3', name: 'R.Betts-Walker, MSW', email: 'rbettswalker@altrixs.com', role: 'Case Manager', initials: 'RB', avatarColor: '#10B981' }]
]);

replaceInFile('src/app/dashboard/communications/page.tsx', [
  [{ name: 'Marcus Vance, LCSW-C', role: 'Lead Therapist', site: 'Lexington Park', ext: 'x103', phone: '+13015550113', avatar: 'MV' }, { name: 'L.Willis, LCSW-C', role: 'Lead Therapist', site: 'Lexington Park', ext: 'x103', phone: '+13015550113', avatar: 'LW' }]
]);

replaceInFile('src/app/dashboard/medical/patients/[id]/page.tsx', [
  [Dr. Marcus Vance, MD, Dr. Marcus Johnson, MD]
]);

replaceInFile('src/app/dashboard/projects/page.tsx', [
  [Dr. Marcus Vance, Dr. Marcus Johnson]
]);

replaceInFile('src/app/dashboard/prp/assessment/page.tsx', [
  [const [counselorSignature, setCounselorSignature] = useState('Sarah Jenkins, CPRP');, const [counselorSignature, setCounselorSignature] = useState('L.Willis, CPRP');],
  [const [supervisorSignature, setSupervisorSignature] = useState('Dr. Marcus Vance, LCSW-C');, const [supervisorSignature, setSupervisorSignature] = useState('Dr. Marcus Johnson, LCSW-C');]
]);

replaceInFile('src/app/dashboard/prp/irp/page.tsx', [
  [counselor: 'Sarah Jenkins, CPRP', counselor: 'L.Willis, CPRP'],
  [supervisor: 'Dr. Marcus Vance, LCSW-C', supervisor: 'Dr. Marcus Johnson, LCSW-C']
]);

replaceInFile('src/lib/labs/manage.ts', [
  [Sarah Jenkins, Dr. Marcus Johnson]
]);

replaceInFile('src/services/labOrderService.ts', [
  [Sarah Jenkins, Dr. Marcus Johnson]
]);

console.log('\n--- Batch replacement completed! ---');