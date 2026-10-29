const fs = require('node:fs');
function edit(path, fn) { const old = fs.readFileSync(path, 'utf8'); fs.writeFileSync(path, fn(old.replace(/\r\n/g, '\n'))); }
edit('src/components/layout/DashboardShell.tsx', s => s.replace("{ href: '/dashboard/ehr/assessments',", "{ href: '/dashboard/ehr/evaluations', label: 'Evaluations', icon: 'clipboard' },\n      { href: '/dashboard/ehr/locus', label: 'LOCUS / CALOCUS', icon: 'chart' },\n      { href: '/dashboard/compliance/mandatory-reporting', label: 'Mandatory Reporting', icon: 'shieldAlert' },\n      { href: '/dashboard/billing/prior-auth', label: 'Electronic Prior Authorization', icon: 'shield' },\n      { href: '/dashboard/ehr/assessments',"));
edit('src/lib/auth/roleAccess.ts', s => s.replace("const PATH_ACCESS: { prefix: string; roles: StaffRole[] }[] = [", "const PATH_ACCESS: { prefix: string; roles: StaffRole[] }[] = [\n  { prefix: '/dashboard/ehr/evaluations', roles: EHR_CLINICAL },\n  { prefix: '/dashboard/ehr/locus', roles: EHR_CLINICAL },\n  { prefix: '/dashboard/ehr/mandatory-reporting', roles: EHR_CLINICAL },\n  { prefix: '/dashboard/compliance/mandatory-reporting', roles: EHR_CLINICAL },\n  { prefix: '/dashboard/billing/prior-auth', roles: [...BILLING_CORE, ...LICENSED] },\n  { prefix: '/dashboard/prior-auth', roles: [...BILLING_CORE, ...LICENSED] },"));
edit('src/app/dashboard/ehr/assessments/page.tsx', s => s
  .replace('adminType: digitalModalInst.adminType,', "administrationType: 'Digital',")
  .replace('adminType: manualModalInst.adminType,', "administrationType: 'Manual',")
  .replace('    } catch {\n      // Fallback local records if API endpoint still expanding\n    }', "    } catch (err) {\n      setAlertNotice(err instanceof Error ? err.message : 'Could not load history');\n    }")
  .replaceAll('console.error(err);', "setAlertNotice(err instanceof Error ? err.message : 'Could not save assessment');")
  .replace('setSubmitting(true);\n    setAlertNotice(null);', "if (!digitalVerified || !digitalModalInst.questions?.every(q => digitalAnswers[q.id] !== undefined)) { setAlertNotice('Answer every question and verify the assessment before saving.'); return; }\n    setSubmitting(true);\n    setAlertNotice(null);")
  .replace('value={manualScore}', 'max={manualModalInst.maxScore} value={manualScore}')
);
for (const [file, path] of [
  ['src/app/api/clinical/evaluations/route.ts', '/dashboard/ehr/evaluations'],
  ['src/app/api/clinical/locus/route.ts', '/dashboard/ehr/locus'],
  ['src/app/api/compliance/mandatory-reporting/route.ts', '/dashboard/compliance/mandatory-reporting'],
  ['src/app/api/clinical/mbc/alerts/route.ts', '/dashboard/mbc'],
]) edit(file, s => s.replace("import { requireOrgContext } from '@/lib/auth/tenant';", "import { requireClinicalContext } from '@/lib/clinical/access';")
  .replaceAll('await requireOrgContext()', `await requireClinicalContext('${path}')`)
  .replaceAll('organizationId: gate.organizationId,\n        ...(clientId', 'organizationId: gate.organizationId,\n        client: gate.clientWhere,\n        ...(clientId')
);
edit('src/app/api/clinical/evaluations/route.ts', s => s
  .replace("import { NextResponse }", "import { EVALUATION_TEMPLATES } from '@/features/ehr/evaluations/templates';\nimport { NextResponse }")
  .replace('const whereClause: any = {', 'const whereClause: import(\'@prisma/client\').Prisma.ClinicalEvaluationRecordWhereInput = {\n      client: gate.clientWhere,')
  .replace('where: { id, organizationId: gate.organizationId },', 'where: { id, organizationId: gate.organizationId, client: gate.clientWhere },')
  .replace("if (existing.status === 'FINALIZED' && amendmentRationale)", "if (['FINALIZED', 'AMENDED'].includes(existing.status) && amendmentRationale?.trim())")
  .replace("formDataJson: JSON.stringify(amendmentContent || content),\n            status: 'AMENDED',", "status: 'AMENDED',")
  .replace('// Standard update of DRAFT or PENDING_SUPERVISOR record', "if (['FINALIZED', 'AMENDED'].includes(existing.status)) {\n        return NextResponse.json({ error: 'Finalized evaluations require an amendment rationale' }, { status: 409 });\n      }\n      // Standard update of DRAFT or PENDING_SUPERVISOR record")
  .replace('// Check if updating existing evaluation or creating amendment', "if (!['DRAFT', 'PENDING_SUPERVISOR', 'FINALIZED'].includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });\n    if (status !== 'DRAFT' && !clinicianSignature?.trim()) return NextResponse.json({ error: 'Clinician signature is required' }, { status: 400 });\n    const template = EVALUATION_TEMPLATES.find(t => t.id === templateId);\n    if (!template) return NextResponse.json({ error: 'Unknown evaluation template' }, { status: 400 });\n    if (status === 'FINALIZED' && template.requiresSupervisorCoSign && !supervisorSignature?.trim()) return NextResponse.json({ error: 'Supervisor co-signature is required' }, { status: 400 });\n    if (supervisorSignature && !['ADMIN', 'DIRECTOR', 'CLINICIAN', 'PSYCHIATRIST', 'NP'].includes(gate.role)) return NextResponse.json({ error: 'Supervisor role required to co-sign' }, { status: 403 });\n    if (status !== 'DRAFT' && template.sections.some(section => section.required && !String(content[section.id] ?? '').trim())) return NextResponse.json({ error: 'Complete the required evaluation fields before signing' }, { status: 400 });\n    // Check if updating existing evaluation or creating amendment")
  .replace('// Create new Evaluation Record', "const patient = await prisma.client.findFirst({ where: { id: clientId, AND: [gate.clientWhere] }, select: { id: true } });\n    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });\n    // Create new Evaluation Record")
  .replace('templateName: r.templateType,', 'templateName: EVALUATION_TEMPLATES.find(t => t.id === r.templateType)?.name ?? r.templateType,')
  .replace('content: r.formDataJson ? JSON.parse(r.formDataJson) : {},', 'content: r.amendments[0]?.changesJson ? JSON.parse(r.amendments[0].changesJson) : JSON.parse(r.formDataJson),')
  .replace('version: i + 1,', 'version: r.amendments.length - i + 1,')
);
edit('src/app/api/clinical/locus/route.ts', s => s
  .replace('import { calculateLocusLevelOfCare }', 'import { LOCUS_DIMENSIONS, calculateLocusLevelOfCare }')
  .replace('// Calculate composite score', "if (!['LOCUS', 'CALOCUS'].includes(assessmentType) || Object.keys(scores).length !== LOCUS_DIMENSIONS.length || !LOCUS_DIMENSIONS.every(d => Number.isInteger(scores[d.id]) && scores[d.id] >= 1 && scores[d.id] <= 5)) return NextResponse.json({ error: 'Provide all seven dimension ratings between 1 and 5' }, { status: 400 });\n    if (overrideLevel && (!/^Level [1-6]$/.test(overrideLevel) || !overrideRationale?.trim())) return NextResponse.json({ error: 'A valid override and rationale are required' }, { status: 400 });\n    const patient = await prisma.client.findFirst({ where: { id: clientId, AND: [gate.clientWhere] }, select: { id: true } });\n    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });\n    // Calculate composite score")
  .replace('recommendedLevelName: r.recommendedLevel,', 'recommendedLevelName: calculateLocusLevelOfCare(r.compositeScore).name,')
);
edit('src/app/api/compliance/mandatory-reporting/route.ts', s => s
  .replace("jurisdictionState: 'MD',", 'jurisdictionState: r.jurisdictionState,')
  .replace('where: { id },', 'where: { id, organizationId: gate.organizationId, client: gate.clientWhere },')
  .replace('// Calculate statutory deadline date', "const patient = await prisma.client.findFirst({ where: { id: clientId, AND: [gate.clientWhere] }, select: { id: true } });\n    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });\n    if (!/^[A-Z]{2}$/.test(jurisdictionState) || !Number.isFinite(Number(statutoryDeadlineHours)) || Number(statutoryDeadlineHours) < 0 || Number(statutoryDeadlineHours) > 8760) return NextResponse.json({ error: 'Invalid jurisdiction or deadline' }, { status: 400 });\n    // Calculate documented follow-up deadline date")
  .replace('category: reportCategory,', 'category: reportCategory,\n        jurisdictionState,')
);
edit('src/app/api/clinical/mbc/alerts/route.ts', s => s
  .replace("import { NextResponse }", "import { isMbcAlert } from '@/features/ehr/assessments/thresholds';\nimport { NextResponse }")
  .replace("OR: [\n          { safetyFlagged: true },\n          { severity: { contains: 'Severe' } },\n          { totalScore: { gte: 15 } },\n        ],", 'client: gate.clientWhere,')
  .replace('flaggedRecords.map', 'flaggedRecords.filter(isMbcAlert).map')
  .replace('prisma.clinicalAssessmentRecord.findUnique', 'prisma.clinicalAssessmentRecord.findFirst')
  .replace('where: { id: assessmentRecordId },', 'where: { id: assessmentRecordId, organizationId: gate.organizationId, client: gate.clientWhere },')
  .replace('const ack = await prisma.mbcAlertAck.create({', "if (!isMbcAlert(assessment)) return NextResponse.json({ error: 'Assessment does not have an active alert' }, { status: 400 });\n    const ack = await prisma.mbcAlertAck.upsert({\n      where: { organizationId_assessmentId: { organizationId: gate.organizationId, assessmentId: assessmentRecordId } },\n      update: {},")
  .replace('data: {\n        organizationId: gate.organizationId,', 'create: {\n        organizationId: gate.organizationId,')
);
edit('prisma/schema.prisma', s => s
 .replace('model MandatoryReportRecord {', 'model MandatoryReportRecord {\n  jurisdictionState String @default("MD")')
 .replace('model MbcAlertAck {', 'model MbcAlertAck {\n  @@unique([organizationId, assessmentId])')
);
for (const file of ['src/app/dashboard/ehr/evaluations/page.tsx', 'src/app/dashboard/ehr/locus/page.tsx', 'src/app/dashboard/compliance/mandatory-reporting/page.tsx', 'src/app/dashboard/mbc/page.tsx', 'src/app/dashboard/billing/prior-auth/page.tsx']) edit(file, s => s
  .replace('  const { clients } = useClients();', "  const { clients } = useClients();\n  const [error, setError] = useState<string | null>(null);")
  .replaceAll('console.error(err);', "setError(err instanceof Error ? err.message : 'Could not save changes');")
  .replace(/} catch \{\s*\/\/ API handles\s*}/g, "} catch (err) { setError(err instanceof Error ? err.message : 'Could not load records'); }")
  .replace('{/* Top Header */}', '{error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}\n      {/* Top Header */}')
);
edit('src/app/dashboard/mbc/page.tsx', s => s.replace('useState(15);', 'useState(20);')
 .replace('const pendingAlerts = alerts.filter', 'const patientAlerts = alerts.filter(a => !selectedClientId || a.clientId === selectedClientId);\n  const pendingAlerts = patientAlerts.filter')
 .replace('const acknowledgedAlerts = alerts.filter', 'const acknowledgedAlerts = patientAlerts.filter')
 .replace('onChange={(e) => setPhq9Threshold(Number(e.target.value))}', 'readOnly')
 .replace('onChange={(e) => setGad7Threshold(Number(e.target.value))}', 'readOnly')
 .replace('Configure Thresholds', 'View Alert Thresholds')
 .replace('[phq9Threshold, setPhq9Threshold]', '[phq9Threshold]')
 .replace('[gad7Threshold, setGad7Threshold]', '[gad7Threshold]')
 .replace('const [gad7Threshold] = useState(20);', 'const [gad7Threshold] = useState(15);')
);

