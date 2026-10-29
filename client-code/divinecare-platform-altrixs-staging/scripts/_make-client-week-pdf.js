/**
 * Client handoff PDF — 18 Sep (Fri evening) → 28 Sep 2026
 * Hinglish (Roman script). No PHI.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(
  __dirname,
  '..',
  'docs',
  'Altrixs-Client-Week-Report-18-to-28-Sep-2026.pdf'
);

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 48, bottom: 52, left: 52, right: 52 },
  info: {
    Title: 'Altrixs — Pichle Week Ka Kaam (18–28 Sep 2026)',
    Author: 'Altrixs Engineering',
    Subject: 'Client delivery report — features, flows, how to use',
  },
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

const PURPLE = '#5C2D91';
const MUTED = '#475569';
const LINE = '#E2E8F0';

function ensureSpace(h = 80) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - h) {
    doc.addPage();
  }
}

function hr() {
  ensureSpace(20);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(LINE)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.6);
}

function h1(t) {
  ensureSpace(60);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(PURPLE).text(t);
  doc.moveDown(0.35);
  doc.fillColor('#0f172a');
}

function h2(t) {
  ensureSpace(50);
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(PURPLE).text(t);
  doc.moveDown(0.25);
  doc.fillColor('#0f172a');
}

function h3(t) {
  ensureSpace(40);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text(t);
  doc.moveDown(0.15);
}

function p(t) {
  ensureSpace(36);
  doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(t, {
    align: 'left',
    lineGap: 2,
  });
  doc.moveDown(0.35);
}

function bullet(items) {
  for (const item of items) {
    ensureSpace(28);
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(`•  ${item}`, {
      indent: 8,
      lineGap: 1.5,
    });
  }
  doc.moveDown(0.35);
}

function step(n, title, body) {
  ensureSpace(55);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(PURPLE)
    .text(`Step ${n}: ${title}`);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#0f172a')
    .text(body, { indent: 12, lineGap: 1.5 });
  doc.moveDown(0.35);
}

function featureBlock(title, kya, flow, kaise) {
  h2(title);
  h3('Kya banaya / kya change hua');
  if (Array.isArray(kya)) bullet(kya);
  else p(kya);
  h3('Flow (kaise chalta hai)');
  if (Array.isArray(flow)) {
    flow.forEach((f, i) => {
      if (typeof f === 'string') step(i + 1, '', f.replace(/^Step \d+:\s*/i, '') || f);
      else step(f.n || i + 1, f.t, f.b);
    });
  } else p(flow);
  h3('Clinic team kaise use kare');
  if (Array.isArray(kaise)) bullet(kaise);
  else p(kaise);
  hr();
}

// ─── COVER ─────────────────────────────────────────────────────────
doc.font('Helvetica-Bold').fontSize(22).fillColor(PURPLE).text('Altrixs Clinic Platform', {
  align: 'center',
});
doc.moveDown(0.4);
doc
  .font('Helvetica-Bold')
  .fontSize(14)
  .fillColor('#0f172a')
  .text('Pichle Week Ka Delivery Report', { align: 'center' });
doc.moveDown(0.25);
doc
  .font('Helvetica')
  .fontSize(11)
  .fillColor(MUTED)
  .text('18 September 2026 (Friday sham)  →  28 September 2026', {
    align: 'center',
  });
doc.moveDown(0.15);
doc
  .font('Helvetica')
  .fontSize(10)
  .fillColor(MUTED)
  .text('Client handoff — features, end-to-end flows, aur use guide (Hinglish)', {
    align: 'center',
  });
doc.moveDown(1);
hr();

p(
  'Yeh document batata hai ki pichle week Altrixs production repo mein kya-kya live-ready kaam hua, har feature ka asli flow kya hai, aur clinic staff usko screen pe kaise chalaye. Demo-only / fake success ko live truth nahi maana gaya — jahan AWS/Availity keys nahi hain wahan system honestly demoMode ya fail-closed dikhata hai.'
);

h2('1. Week ka summary (ek nazar mein)');
bullet([
  'Clinical modules: TMS + Spravato (GAD-7, SpO₂), assessments (RMS, C-SSRS), evaluations (CAGE-AID + ASAM widgets).',
  'Privacy & compliance: PII mask (therapist vs PD/Admin), Protected Records + Break-the-Glass (24h grant).',
  'PRP: qualifying Dx, referral, enroll steps — Availity eligibility fail-closed (fake “eligible” nahi).',
  'Ops: public Schedule + admin Scheduling Settings, Labs orders/results, A/R Control, Claim Scrubber, eStatements.',
  'Comms & AI assists: Telehealth Phone (Call firstName, number hide), Communications (SMS/call thread), Notes smart phrases (.cbt) + copy-forward + Comprehend, Scribe, HealthLake, Textract insurance scan, Personalize home insights, Ctrl+K command palette.',
  'Data: naya Prisma schema Postgres pe apply; forms APIs se DB mein save; local runtime manuals M1–M14 PASS prove kiye.',
]);

h2('2. Important rules (client ke liye clear)');
bullet([
  'Static DEMO_* arrays in slices ka live source of truth nahi hain.',
  'PRP_ELIGIBILITY_TEST_PASS production pe true mat lagana — test shortcut hai.',
  'AWS (Connect / HealthLake / Comprehend / Textract / Personalize) keys na hon to demoMode / fail-closed — yeh bug nahi, honest mode hai.',
  'Live deploy se pehle production DB pe prisma schema sync zaroori hai.',
]);
hr();

// ─── FEATURES ──────────────────────────────────────────────────────
h1('3. Feature-by-feature — kya, flow, kaise use kare');

featureBlock(
  '3.1 TMS & Spravato clinical module',
  [
    'TMS courses / sessions + PHQ-9 (aur GAD-7 field) persist.',
    'Spravato enrollment + sessions; SpO₂ / side-effects fields.',
    'Role gate: therapist ko TMS write pe 403 jahan allowed nahi.',
  ],
  [
    { t: 'Open module', b: 'Dashboard → EHR → TMS / Spravato page kholo.' },
    { t: 'Select patient course/enrollment', b: 'Existing course ya naya enrollment choose / create karo — data API se Postgres mein jata hai.' },
    { t: 'Session + scores', b: 'Session save, PHQ-9 / GAD-7, Spravato vitals (jaise SpO₂) enter karo → Save. Refresh ke baad wahi rows dikhni chahiye.' },
  ],
  [
    'Psych / NP / authorized clinical roles se chalayein.',
    'Refresh karke confirm karein ke scores gayab nahi hue (DB persist).',
  ]
);

featureBlock(
  '3.2 PWA offline notes (encrypted draft → sync)',
  [
    'Offline banner + encrypted IndexedDB drafts.',
    'Online hone pe Sync Now → ProgressNote DB mein; queue clear.',
  ],
  [
    { t: 'Offline', b: 'Network band / offline mode mein note draft save hota hai (encrypted local).' },
    { t: 'Back online', b: 'Banner se Sync Now → server API note create/update → Postgres ProgressNote.' },
  ],
  ['Field clinicians ke liye: pehle short note offline, clinic wi‑fi pe Sync Now dabayein.']
);

featureBlock(
  '3.3 EHR Migration import (10 platforms)',
  [
    'Admin Migration: Valant etc. CSV import.',
    'dryRun = zero Client/User/MigrationJob writes; live import pe MigrationJob + rows.',
  ],
  [
    { t: 'Dry run', b: 'Admin → Migration → platform choose → Dry run. Preview counts; DB mein job/client create nahi.' },
    { t: 'Live import', b: 'Confirm ke baad import → MigrationJob history + imported clients.' },
  ],
  ['Pehle hamesha dry run. Live sirf jab mapping sahi lage.']
);

featureBlock(
  '3.4 PII mask (phone / email / address)',
  [
    'Therapist (aur non-PD roles) pe masked bullets (••••).',
    'Practice Director + Admin ko clear values.',
  ],
  [
    { t: 'Therapist login', b: 'Client open → phone/email masked JSON/UI.' },
    { t: 'PD/Admin login', b: 'Same client → clear contact fields.' },
  ],
  ['Front-line staff ko full PHI tabhi jab role allow kare; emergency pe Break-the-Glass.']
);

featureBlock(
  '3.5 PRP — Dx codes, referral, enroll (+ Availity)',
  [
    'Qualifying ICD-10 Dx tab.',
    'Referral create (e.g. PRP-#### style ids).',
    'Multi-step enroll; PriorAuth happy path jab eligibility clear ho.',
    'Default: Availity down/unconfigured → 502 fail-closed (fake eligible nahi).',
  ],
  [
    { t: 'Referral', b: 'PRP → Referral → client + dx → submit → referral row DB.' },
    { t: 'Enroll', b: 'Enroll wizard steps; eligibility call Availity.' },
    { t: 'If blocked', b: '502 / not eligible = payer config ya live Availity keys chahiye — product ne jhoothi green light nahi di.' },
  ],
  [
    'Demo clinic mein enroll step 2 block ho sakta hai bina Availity config ke — expected.',
    'Production pe real Availity credentials + payer mapping set karein.',
  ]
);

featureBlock(
  '3.6 Protected Records + Break-the-Glass (BTG)',
  [
    'SensitiveRecord protection.',
    'Unauthorized GET → 403 SENSITIVE_RECORD.',
    'BTG grant 24h → phir chart access; audit log.',
    'Client detail page pe bhi Break-the-Glass form (roster + detail).',
  ],
  [
    { t: 'Protect', b: 'PD/Admin Protected Records se client protect.' },
    { t: 'Blocked access', b: 'Clinician chart khole → 403 / BTG UI.' },
    { t: 'Grant', b: 'Reason (≥15 chars) → Confirm → 24h grant → reload → PHI dikhe; log mein entry.' },
  ],
  ['BTG sirf emergency. Reason clinical/audit-ready likhein.']
);

featureBlock(
  '3.7 Assign Clinician + 187 payers + Waystar / HIE (earlier slices, ab repo mein)',
  [
    'Unassigned clients pe purple Assign Clinician CTA; assigned pe Warm Handoff.',
    '187 payers / 9 categories intake + matching.',
    'Waystar dual-clearinghouse (claims) + Availity eligibility split.',
    'SMART on FHIR + CRISP HIE page.',
  ],
  [
    { t: 'Assign', b: 'Clients list → Assign Clinician → clinician choose → treatment team save.' },
    { t: 'Payer', b: 'Intake / insurance dropdown se payer group select.' },
    { t: 'HIE', b: 'EHR → HIE → query portal (configured env ke saath).' },
  ],
  ['Billing team claims Waystar path; eligibility Availity — dono mix mat samjhein.']
);

featureBlock(
  '3.8 Public Schedule + Admin Scheduling Settings',
  [
    'Admin settings save → public /schedule unauthenticated booking.',
    'Confirmation code AC-###### Appointment row mein.',
    'embed=true chrome hide; iframe headers.',
    'Fix: public scheduling APIs pehle auth se 401 the — ab public allowlist.',
  ],
  [
    { t: 'Admin save', b: 'Dashboard → Admin → Scheduling Settings → hours/services/rules → Save (DB).' },
    { t: 'Public book', b: 'Website /schedule (ya embed) → service → slot → patient details + HIPAA → Book.' },
    { t: 'Confirm', b: 'Patient ko AC-###### milta hai; staff Appointments mein row dekhe.' },
  ],
  [
    'Website embed ke liye org slug / booking URL settings se copy karein.',
    'Test book karke confirmation code DB/UI dono mein verify karein.',
  ]
);

featureBlock(
  '3.9 Labs (orders + results)',
  [
    'Labs page real clients se.',
    'ICD multi + panels + Other/custom panel.',
    'orderedBy = current user; refresh ke baad order rehti hai.',
  ],
  [
    { t: 'New order', b: 'EHR → Labs → client → ICD + panel (ya Other text) → Submit.' },
    { t: 'Persist', b: 'POST /api/labs/orders → LabOrder row; list refresh.' },
  ],
  ['Custom panel “Other” mein type karke bhi order banaya ja sakta hai.']
);

featureBlock(
  '3.10 Billing — A/R Control, Claim Scrubber, eStatements',
  [
    'A/R KPIs claims DB se (hardcoded demo KPIs nahi).',
    'Claim scrub: errors pe submit block.',
    'eStatements generate → PatientStatement rows.',
  ],
  [
    { t: 'A/R', b: 'Billing → A/R Control → aging / worklist dekho (DB-backed).' },
    { t: 'Scrub', b: 'Claim Scrubber → scrub → agar errors hain to submit disabled.' },
    { t: 'Statements', b: 'Statements → period + delivery → Generate → DB rows + list.' },
  ],
  ['Clearinghouse live keys alag track; scrubber pehle local quality gate hai.']
);

featureBlock(
  '3.11 Telehealth — Phone platform (privacy Call)',
  [
    'Platform PHONE support.',
    'Connect modal: “Call {firstName}” — phone digits DOM mein nahi.',
    'Upcoming tab pe bhi phone rows ke liye Call {firstName}.',
  ],
  [
    { t: 'Schedule / start', b: 'Telehealth → phone session → Start/Call → consent note → Call FirstName.' },
    { t: 'Privacy', b: 'Number tel: link pe rehta hai, screen pe print nahi.' },
  ],
  ['Call se pehle verbal consent confirm karein (UI pe reminder hai).']
);

featureBlock(
  '3.12 Intake — Homeless + First Visit Note',
  [
    'Homeless checkbox → public form pe address required nahi.',
    'First Visit Note → ProgressNote save.',
    'Telehealth FVN pe verbal consent rule.',
  ],
  [
    { t: 'Invite', b: 'Staff Intake → homeless flag / appointment type → send link.' },
    { t: 'Patient form', b: 'Token URL → homeless pe address waive → submit.' },
    { t: 'FVN', b: 'Staff First Visit Note likh kar save → ProgressNote.' },
  ],
  ['Homeless clients ke liye address force mat karein — flag sahi set karein.']
);

featureBlock(
  '3.13 RMS (Rapid Mood Screener) — 10 YES/NO',
  [
    'Full 10-item instrument catalog mein.',
    'Score ≥ 5 → Screen Positive — Bipolar I; AssessmentScore/ClinicalAssessmentRecord DB.',
  ],
  [
    { t: 'Open', b: 'EHR → Assessments → RMS.' },
    { t: 'Complete', b: '10 YES/NO → submit (clinician verified).' },
    { t: 'Result', b: '≥5 yes → Screen Positive toast/severity + DB row.' },
  ],
  ['Positive screen pe MDQ / psych referral clinical judgement se follow-up.']
);

featureBlock(
  '3.14 C-SSRS + crisis-flag event',
  [
    'C-SSRS Brief page; signature / verified gate.',
    'Imminent / high path → ClinicalEvent crisis-flag (+ EventBridge jab configured).',
  ],
  [
    { t: 'Administer', b: 'Assessments → C-SSRS → items + signature → save.' },
    { t: 'Escalate', b: 'High/imminent → crisis-flag API → ClinicalEvent row.' },
  ],
  ['High risk pe local crisis protocol follow karein — system flag support hai, replacement nahi.']
);

featureBlock(
  '3.15 Communications (Connect SMS / Call)',
  [
    'Communications page → SMS / call / thread.',
    'Rows ConnectMessage / ConnectCall; AWS na ho to demoMode OK.',
  ],
  [
    { t: 'Open', b: 'Dashboard → Communications → client.' },
    { t: 'SMS', b: 'Message type → Send → thread refresh pe row.' },
  ],
  ['Live SMS ke liye AWS Connect / SMS env chahiye; warna demo Mode dikhega.']
);

featureBlock(
  '3.16 Notes — smart phrases, copy-forward, Comprehend',
  [
    '`.cbt` (aur phrases) expand.',
    'Copy-forward last SOAP same client.',
    'Comprehend analyze panel (demoMode if no AWS).',
  ],
  [
    { t: 'Phrase', b: 'Notes editor mein .cbt type → phrase insert.' },
    { t: 'Copy-forward', b: 'Same client ki last note se pull.' },
    { t: 'Comprehend', b: 'Analyze → Network POST /api/comprehend/analyze.' },
  ],
  ['Demo Preview mode notes pe band rakhein jab asl chart likh rahe hon.']
);

featureBlock(
  '3.17 HealthLake + Textract + Personalize + Ctrl+K',
  [
    'HealthLake page: status GET + import POST (toast-only nahi).',
    'Scanner: Textract insurance scan job.',
    'Home widgets: psychiatrist vs peer_support alag insight copy/roleKey.',
    'Ctrl/Cmd+K palette real clients fetchClients se.',
  ],
  [
    { t: 'HealthLake', b: 'EHR → HealthLake → Status; Import jab datastore configured ho.' },
    { t: 'Textract', b: 'Scanner → insurance image → analyze.' },
    { t: 'Personalize', b: 'Role home pe Caseload Health / Insights cards.' },
    { t: 'Palette', b: 'Ctrl+K → client name search → jump.' },
  ],
  ['AWS missing = DEMO badge / fail-closed — credentials ke baad live enrich.']
);

featureBlock(
  '3.18 Evaluations — CAGE-AID + ASAM (+ AI Draft disabled)',
  [
    'SUD / ASAM template pe CAGE-AID + ASAM widgets.',
    'Save → ClinicalEvaluationRecord.',
    'AI Draft honestly disabled jab model nahi (fake draft nahi).',
  ],
  [
    { t: 'New eval', b: 'EHR → Evaluations → Substance / ASAM template.' },
    { t: 'Fill widgets', b: 'CAGE-AID + ASAM dimensions → Save draft.' },
  ],
  ['AI Draft tab enable hoga jab model/env intentionally on ho.']
);

// ─── HOW TO VERIFY / DEPLOY ────────────────────────────────────────
h1('4. Clinic / Admin — week ka kaam kaise verify kare (short checklist)');
bullet([
  'Login PD + Therapist dono se — PII mask farq dikhna chahiye.',
  'Public /schedule se ek test book → AC-###### confirmation.',
  'Labs mein Other panel order → refresh → row maujood.',
  'RMS ≥5 yes → Screen Positive; C-SSRS high → crisis event.',
  'Homeless intake invite → address skip; FVN note save.',
  'Telehealth phone → Call FirstName, number screen pe nahi.',
  'Billing Statements generate → list mein statement.',
  'Ctrl+K se real client open.',
]);

h1('5. Live deploy pe zaroori (warna pehle wala code toot sakta hai)');
step(1, 'Schema', 'Production Postgres pe prisma schema sync (naye tables: labs, statements, connect, healthlake, etc.).');
step(2, 'Env', 'Existing auth/DB/SMTP rakhein. PRP_ELIGIBILITY_TEST_PASS true mat. AWS keys optional — bina unke demo/fail-closed.');
step(3, 'Deploy app', 'Build + release; server restart.');
step(4, 'Smoke', 'Section 4 checklist live pe 10–15 min.');
hr();

h1('6. Is week prove kiya gaya (engineering evidence)');
bullet([
  'Local Postgres (SSH tunnel 5433) pe schema sync.',
  'npm/next production build exit 0.',
  'API smoke 200: migration, TMS, labs, A/R, PRP, sensitive-records, HealthLake status, scheduling settings.',
  'Manuals M1–M14 sab PASS — har persist flow ke DB ids ke saath.',
]);

h1('7. Abhi alag track / intentional limits');
bullet([
  'Waystar/Availity “full live clearinghouse day-2 ops” credentials clinic pe depend.',
  'AWS Connect/HealthLake/Personalize/Textract bina keys ke demoMode.',
  'PRP enroll Availity ke bina fail-closed — yeh safety hai.',
]);
hr();

doc.font('Helvetica-Bold').fontSize(11).fillColor(PURPLE).text('Closing');
doc.moveDown(0.3);
p(
  'Pichle week (18 Sep Friday sham se 28 Sep) ka focus yeh tha: clinic ke real workflows ko is production Altrixs repo mein same flow + UI ke saath lana, data Postgres mein save karna, aur jahan bahar ki service missing ho wahan jhoothi success ki jagah honest mode rakhna. Upar har module ka use-flow clinic team seedha follow kar sakti hai; live pe schema + env ke baad yeh slices ship-ready hain.'
);

doc
  .font('Helvetica')
  .fontSize(9)
  .fillColor(MUTED)
  .text('Document generated for client handoff — Altrixs · 18–28 Sep 2026 · No patient PHI in this file.', {
    align: 'center',
  });

doc.end();

stream.on('finish', () => {
  console.log('WROTE', OUT);
  console.log('BYTES', fs.statSync(OUT).size);
});
