# Labs — catalog, ordering, results, review and release

Altrixs records lab orders, prints requisitions, takes manual result entry, routes results to the
ordering provider for sign-off, and releases reviewed results to the patient portal. **There is no
electronic lab interface yet** (no HL7 / Quest / Labcorp ordering or results connection): every order
prints a requisition that travels with the specimen or the patient.

## Where it lives

| Area | Files |
|---|---|
| Built-in catalog (pure) | `src/lib/labs/catalog.ts` |
| Valant import planner (pure) | `src/lib/labs/catalogImport.ts` |
| Per-org catalog (DB) | `src/lib/labs/catalogDb.ts`, model `LabTest` (`lab_tests`) |
| Result flags (pure) | `src/lib/labs/results.ts` |
| Standing orders | `src/lib/labs/standing.ts` (pure), `src/lib/labs/standingDb.ts`, model `LabStandingOrder` |
| Order sets (pure) | `src/lib/labs/orderSets.ts` |
| Workflow stages, inbox rows (pure) | `src/lib/labs/workflow.ts` |
| Role rules (pure) | `src/lib/labs/access.ts` |
| Orders / results / review / release | `src/lib/labs/manage.ts` |
| Requisition | `src/lib/labs/requisition.ts` (HTML), `src/lib/labs/requisitionData.ts` |
| APIs | `/api/labs/orders`, `/api/labs/orders/[id]` (GET, PATCH), `/[id]/review`, `/[id]/send`, `/[id]/requisition-html`, `/api/labs/catalog`, `/api/labs/order-context`, `/api/labs/standing-orders`, `/api/migration/lab-request-types` |
| UI | `src/components/labs/*`, chart tab `src/components/chart/LabChartTab.tsx`, pages `dashboard/ehr/labs`, `dashboard/medical/labs`, migration tab `ValantLabRequestTypesImport.tsx` |
| Migration | `prisma/migrations/20261018_lab_catalog.sql` (idempotent) |
| Tests | `tests/labs-catalog-workflow.test.ts` |

## Workflow

`ordered → collected → sent to lab → resulted → reviewed → released` (cancelled at any point before
results). Stored status keeps the existing enum (`pending` = sent to lab, `critical` = resulted with a
critical value); review and release are timestamps (`reviewedAt`, `releasedAt`).

* **Order** — test search over the org catalog (names, aliases, Valant names, CPT/LOINC), ICD-10-CM
  per test (diagnosis pointers; the client's active chart diagnoses / problem list are suggested; BH
  codes only for roles that may see them), priority (Routine / STAT), fasting, collection (in office /
  patient service center), performing lab (Quest / Labcorp / in-house), bill-to (insurance / patient /
  client bill), manual Medicare ABN flag + note (no automated LCD/NCD check), clinical notes. Signed under
  the ordering prescriber's own NPI (409 when the NPI is missing from the staff profile).
* **Requisition** — patient demographics and insurance from the chart; ordering provider NPI from the
  staff profile; practice name / NPI / phone / fax from Practice settings (location NPI when no practice
  NPI); CLIA from Practice settings or `LAB_FACILITY_CLIA`. Anything missing prints "Not on file".
* **Results** — manual entry per test, panels expand to their components. Value, units, reference
  range, critical limits *as printed by the lab*, collection date, performing lab, scanned report
  (a document already filed to the chart through Smart Document Intake). Flags H / L / HH / LL / A are
  computed from the entered ranges; staff can choose the lab's printed flag instead (recorded as
  `flagSource = lab`). No reference or critical range is ever defaulted.
* **Review** — prescribers only. Critical results need a review note (who was contacted, plan).
  Editing results after sign-off clears the review (amended result) and sends it back to the inbox.
  Released results are locked.
* **Release** — prescribers only, after review: secure portal message; email/SMS notification without
  result values.
* **Inbox** — section "Lab results to review": resulted, unreviewed orders the viewer placed; critical
  = urgent, abnormal = high. Part 2 rows are masked like other sections.
* **Trends** — chart Labs tab plots lithium, valproate, carbamazepine, clozapine, nortriptyline,
  risperidone, lamotrigine levels and ANC, with the reference band printed on the latest result.

## Roles

| Action | Roles |
|---|---|
| View orders / results | `/dashboard/ehr/labs` roles (leadership, psychiatrist, NP, therapist, case manager, clinician) and primary care roles (physician, medical NP, medical assistant) via `/dashboard/medical/labs`. Rows are scoped by org, caseload / care team (`clientAccessWhere`) and Part 2 (`lockedSensitiveClientIds`). |
| Order, standing orders | PSYCHIATRIST, NP, PHYSICIAN, MEDICAL_NP (+ NPI on profile) |
| Collect / sent / enter results / attach | prescribers, MEDICAL_ASSISTANT, CLINICIAN, leadership |
| Review & sign off, release to portal | prescribers only |
| Catalog import | PRACTICE_DIRECTOR, ADMIN |

The primary care Labs page shows only primary-care patients (`primaryCarePatientWhere`).

## Valant lab request types → Altrixs catalog

Source: Valant export `DataGrid (9).xlsx` (40 rows; all "Is Lab Panel? = No", LOINC blank, Active).
40 names → **37 orderable tests** (3 merges). "Code needed" = deliberately blank (see notes).

| Valant name | Altrixs test (key) | Relation | CPT | LOINC |
|---|---|---|---|---|
| 10-Panel Urine Drug Test + EtG | 10-Panel Urine Drug Test + EtG (`uds-10-etg`) | same | code needed (lab-specific panel / method) | code needed |
| 25-hydroxyvitamin D (25(OH)D) | Vitamin D, 25-Hydroxy (`vit-d`) | alias | 82306 | 62292-8 |
| Acute Hepatitis Panel | Acute Hepatitis Panel (`hep-acute`) | same | 80074 | 24363-4 |
| Buprenorphine MAT | Buprenorphine MAT Monitoring (urine) (`bup-mat`) | alias | code needed | code needed |
| Carbamazepine, Serum | Carbamazepine Level, Total (`carbamazepine`) | alias (merged with Tegretol Level) | 80156 | 3432-2 |
| Tegretol Level | Carbamazepine Level, Total (`carbamazepine`) | alias | 80156 | 3432-2 |
| CBC | CBC with Differential / Platelets (`cbc`) | alias | 85025 | 57021-8 |
| Chemistry 7 | Basic Metabolic Panel (BMP) (`bmp`) | alias (see question 3) | 80048 | 24321-2 |
| Clozapine | Clozapine Level (`clozapine`) | alias | 80159 | 6896-5 |
| Comprehensive Metabolic Panel | Comprehensive Metabolic Panel (CMP) (`cmp`) | alias | 80053 | 24323-8 |
| Depakote | Valproic Acid Level, Total (`valproic`) | alias (merged with Valproic Acid, Serum) | 80164 | 4086-5 |
| Valproic Acid, Serum | Valproic Acid Level, Total (`valproic`) | alias | 80164 | 4086-5 |
| EKG | EKG, 12-lead (`ekg`) — **in-office procedure, category procedure** | alias | 93000 (PFS) | 11524-6 |
| Fasting Blood Glucose | Glucose, Fasting (`glucose-fasting`) | alias | 82947 | 1558-6 |
| Fasting Lipid Panel | Lipid Panel (`lipid`, fasting) | alias | 80061 | 24331-1 |
| Ferritin | Ferritin (`ferritin`) | same | 82728 | 2276-4 |
| Folic Acid (Folate) | Folate, Serum (`folate`) | alias | 82746 | 2284-8 |
| Gamma Glutamyl Transferase (GGT) | Gamma-Glutamyl Transferase (GGT) (`ggt`) | same | 82977 | 2324-2 |
| Hemoglobin A1C | Hemoglobin A1c (`a1c`) | same | 83036 | 4548-4 |
| Hepatic Function Panel | Hepatic Function Panel (`lft`) | same (merged with LFTs) | 80076 | 24325-3 |
| Liver Function Tests (LFTs) | Hepatic Function Panel (`lft`) | alias | 80076 | 24325-3 |
| HIV Antibodies, preliminary with confirmation | same name (`hiv-ab-confirm`) | same | code needed (see question 5) | code needed |
| Human Chorionic Gonadotropin (HCG) | hCG, Serum (`hcg-serum`) | alias | code needed (quant 84702 vs qual 84703) | code needed |
| Iron, Serum | Iron, Serum (`iron`) | same | 83540 | 2498-4 |
| Lithium, Serum | Lithium Level, Serum (`lithium`) | alias | 80178 | 14334-7 |
| Magnesium, Serum | Magnesium, Serum (`magnesium`) | same | 83735 | 19123-9 |
| Nortriptyline, Serum | Nortriptyline Level, Serum (`nortriptyline`) | alias | code needed (80335 not on CLFS; Medicare G0480–G0483) | 3872-9 |
| Phosphate | Phosphorus (Phosphate), Serum (`phosphate`) | alias | 84100 | 2777-1 |
| Prolactin | Prolactin (`prolactin`) | same | 84146 | 2842-3 |
| Risperidone | Risperidone + 9-Hydroxyrisperidone Level (`risperidone`) | alias | code needed (80342 not on CLFS) | 9394-8 |
| Routine Urine Drug Abuse Profile, with confirmation | Urine Drug Abuse Profile, with confirmation (`uds-confirm`) | alias | code needed (80305–80307 + G0480–G0483 by method) | code needed |
| Routine Urine Drug Abuse Profile, without confirmation | Urine Drug Abuse Profile, without confirmation (`uds`) | alias | code needed (80305–80307 by method) | code needed |
| T4 | T4 (Thyroxine), Total (`t4-total`) | alias (see question 4) | 84436 | 3026-2 |
| Testosterone, Free | Testosterone, Free (`testosterone-free`) | same | 84402 | 2991-8 |
| Testosterone, Total | Testosterone, Total (`testosterone`) | same | 84403 | 2986-8 |
| Thyroid-stimulating Hormone Level | TSH (`tsh`) | alias | 84443 | 3016-3 |
| TSH Reflex | TSH with Reflex to Free T4 (`tsh-reflex`) — **distinct from TSH** | alias | 84443 (+84439 only if reflexed) | code needed (lab-specific order code) |
| Total Iron Binding Capacity | Total Iron Binding Capacity (TIBC) (`tibc`) | alias | 83550 | 2500-7 |
| Urine Pregnancy Test | Pregnancy Test, Urine (hCG) (`hcg-urine`) | alias | 81025 (in-office kit; lab qualitative = 84703) | 2106-3 |
| Vitamin B12 | Vitamin B12 (`b12`) | same | 82607 | 2132-9 |

Merged: LFTs + Hepatic Function Panel; Depakote + Valproic Acid, Serum; Tegretol Level + Carbamazepine,
Serum. Valant marks CMP, CBC, Hepatic Function Panel, Lipid Panel and Acute Hepatitis Panel as
"not a panel"; Altrixs treats them as panels (components from the CPT panel definitions) and the
dry-run lists each difference.

Built-in tests kept from the earlier hard-coded list (not in Valant): BMP, sodium, urinalysis, ANC,
PT/INR, ESR, Free T4, Free T3, AM cortisol, lamotrigine level, EtG/EtS, ethanol, cotinine, HIV Ag/Ab
(87389 / 56888-1), hepatitis C Ab, HBsAg, RPR, QuantiFERON, ANA, CRP, RF, CYP450 panel, HLA-B*15:02.
Removed: "Iron Panel / Ferritin" (replaced by separate iron / TIBC / ferritin), "hCG, Qualitative
(Serum/Urine)" (replaced by serum and urine hCG), "Atypical Antipsychotic Metabolic Monitoring"
(now an order set), HLA-B*5801.

## Code sources

* **LOINC** — Regenstrief LOINC 2.82, looked up on the HL7 terminology server
  (`https://tx.fhir.org/r4/CodeSystem/$lookup?system=http://loinc.org&code=<code>`), status ACTIVE,
  long common names checked. loinc.org blocked automated lookup; re-check on loinc.org in a browser.
  Correction found: clozapine is **6896-5** (3483-5 is cimetidine).
* **CPT/HCPCS** — CMS Clinical Laboratory Fee Schedule CY2026 Q4,
  `https://www.cms.gov/files/zip/26clabq4.zip` (landing page
  `https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs/files/26clabq4`).
  93000 from the CMS Physician Fee Schedule RVU file `https://www.cms.gov/files/zip/rvu26d.zip`.
  80321, 80335, 80342, 80348 are **not on the CLFS** (OPPS Addendum B only); Medicare definitive drug
  testing bills G0480–G0483 — so those tests are left "code needed".
* Panel components = CPT panel definitions (80053, 80048, 80076, 80061, 80074). CBC components are
  the standard automated CBC with differential.
* Specimen / container / handling are typical requirements; the UI and requisition say to follow the
  performing lab's directory of services.

## Order sets (suggestions; the prescriber confirms each test)

| Set | Tests | Schedule | Sources |
|---|---|---|---|
| Clozapine | CBC (ANC), clozapine level (optional), A1c, lipids; weight/BMI, waist, BP | ANC baseline; weekly months 0–6; every 2 weeks months 6–12; monthly after 12 months (general population; BEN thresholds differ). REMS ended in 2025; FDA still recommends ANC monitoring per labeling. | FDA Drug Safety Communication, *FDA removes REMS program for the antipsychotic drug clozapine* (effective June 13, 2025): https://www.fda.gov/drugs/drug-safety-and-availability/fda-removes-risk-evaluation-and-mitigation-strategy-rems-program-antipsychotic-drug-clozapine ; clozapine prescribing information; ADA/APA 2004 |
| Lithium | lithium level (12-h trough), BMP (renal, electrolytes, calcium), TSH; pregnancy test and EKG optional | level after start / dose change, then every 3–6 months when stable; renal + TSH (+ calcium) baseline and every 6–12 months | APA Practice Guideline for Bipolar Disorder (2002); lithium prescribing information |
| Valproate | level, hepatic function panel, CBC (platelets); pregnancy test optional | LFTs and CBC baseline and periodically (closely in the first 6 months) | divalproex / valproic acid prescribing information (boxed warnings); APA 2002 |
| Carbamazepine | level, CBC, sodium, hepatic function panel; HLA-B*15:02 baseline for at-risk ancestry | baseline and periodically | carbamazepine prescribing information (boxed warnings); APA 2002 |
| Antipsychotic metabolic | fasting glucose or A1c, lipid panel, prolactin (if symptomatic); weight/BMI, waist, BP | weight baseline, 4, 8, 12 weeks then quarterly; waist baseline and yearly; BP and fasting glucose baseline, 12 weeks, yearly; lipids baseline, 12 weeks, every 5 years if normal (APA 2020: A1c/glucose and lipids baseline, 4 months, yearly) | ADA/APA/AACE/NAASO Consensus, *Diabetes Care* 2004;27(2):596–601; APA Practice Guideline for Schizophrenia, 3rd ed. (2020) |
| Buprenorphine (MAT) | MAT urine drug test; baseline LFTs, hepatitis panel, HIV, pregnancy test optional | UDS at intake and periodically, individualized (more often early) | SAMHSA TIP 63 (2021 update); ASAM National Practice Guideline, 2020 Focused Update |

Order sets are offered as suggestions when an active medication matches (`suggestedOrderSets`).
Standing orders track the next due date; each later order is placed and signed by a prescriber.

## Owner questions

1. Which reference lab(s) do the clinics use (Quest, Labcorp, a hospital lab)? Lab client account
   numbers per clinic for the requisition? Any in-office CLIA-waived testing (urine cups, pregnancy,
   fingerstick A1c)?
2. Practice CLIA number and group NPI in Practice settings — requisitions print "Not on file" until set.
3. "Chemistry 7" is mapped to BMP (CPT 80048 includes calcium; a classic Chem-7 does not). OK, or keep
   a separate 7-analyte test?
4. Valant "T4" is mapped to **total** T4 (84436). Did the practice mean Free T4 (84439)?
5. Valant "Human Chorionic Gonadotropin (HCG)": quantitative or qualitative serum? "HIV Antibodies,
   preliminary with confirmation": is it the 4th-generation Ag/Ab algorithm (87389)?
6. Drug screens (10-panel + EtG, profiles with/without confirmation, buprenorphine MAT): which classes,
   cutoffs and method (cup / analyzer / send-out)? These decide the CPT/HCPCS codes.
7. Valant "CBC": with differential (85025, needed for clozapine ANC) or without (85027)?
8. Should leadership (practice director / admin) enter results from faxed reports, and should
   CLINICIAN keep result entry? Should therapists and case managers keep view access?
9. Critical-result policy: who is called and within what time; should a critical result also page
   the on-call prescriber when the ordering provider is out?
10. Audit log labels for "lab_review_signoff" / "lab_portal_release" (recorded as UPDATE with an
    event in metadata) — add dedicated labels in the audit log UI?
