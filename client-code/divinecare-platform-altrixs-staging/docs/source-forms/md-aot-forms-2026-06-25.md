# Maryland AOT forms (MDH / BHA, revised 06/25/2026)

Reference list of the six Maryland Department of Health (Behavioral Health Administration) Assisted
Outpatient Treatment forms provided by the owner, with each form's sections and fields as listed in the
build request. Altrixs implements each as a structured, versioned form (`src/lib/aot/forms/*.ts`), with a
print / PDF view that follows these sections and shows the MDH form number in the footer.

Nothing is sent to the state automatically. Staff review, sign, print or save as PDF, and send the forms themselves.

| # | Form | MDH number | Altrixs form type | Definition |
|---|------|-----------|-------------------|------------|
| 1 | AOT Treatment Plan | MDH#0001BHA | `treatment_plan` | `src/lib/aot/forms/treatmentPlan.ts` |
| 2 | Psychiatrist Affidavit | MDH#0004BHA | `psychiatrist_affidavit` | `src/lib/aot/forms/affidavit.ts` |
| 3 | Notification of Petition for Emergency Evaluation | MDH#0003BHA | `ep_notification` | `src/lib/aot/forms/epNotification.ts` |
| 4 | Plan for Continued Treatment | (none printed) | `continued_treatment_plan` | `src/lib/aot/forms/continuedPlan.ts` |
| 5 | Non-Responsive Respondent certified letter | MDH#0002BHA | `nonresponsive_letter` | `src/lib/aot/forms/nonresponsiveLetter.ts` |
| 6 | AOT Complaint/Incident Report | (MDH BHA complaint form) | `complaint` | `src/lib/aot/forms/complaint.ts` |

---

## 1. AOT Treatment Plan (MDH#0001BHA)

- Name of testifying psychiatrist
- Date of plan completion
- Respondent represented by counsel (Y/N) + counsel name / office
- Has health care agent (Y/N) + name
- Has legal guardian (Y/N) + name
- Current behavioral health treatment providers (organization name, type; list)

**Respondent information:** first name, last name, alias, DOB, phone, email, street, apt/floor/bldg, city, state, zip.

**Diagnostic information**

1. Has "serious and persistent mental illness" per Health-General §10-6A-01 (Y/N). Statutory definition shown:
   "a mental illness that is severe in degree and persistent in duration, that causes a substantially
   diminished level of functioning in the primary aspects of daily living and an inability to meet the
   ordinary demands of life, and that may lead to an inability to maintain independent functioning in the
   community without intensive treatment and support"
   - 1a. How criteria met
2. Diagnoses and how determined (direct evaluation / records)
3. Other somatic conditions / disabilities

**Engagement**

1. All efforts to engage, including feedback / concerns / barriers
2. Education and materials about the process steps and rights under an AOT order (Y/N) + materials and accessibility efforts
3. Disabilities checklist: None; Deaf/Hard of Hearing; Blind/Visual Impairment; Mobility Disability; ADD/ADHD;
   Autism Spectrum Disorder; Traumatic Brain Injury; Intellectual/Developmental Disabilities; Neurological
   condition with cognitive impairment; Manual Dexterity Disability; Learning disabilities or below 8th grade
   reading level; Non-native English speaker or other language barriers; Other (specify) + accommodations
4. Available and willing to meet CPRS (Y/N) — 4a. dates
5. Case manager (Y/N) — 5a. dates
6. Psychiatrist (Y/N) — 6a. examination dates
7. Individuals given reasonable opportunity to participate: guardian (Yes / None identified), health care
   agent (Yes / None identified), other designated (Yes / None identified) + names + relationships
8. Methods of engagement with them
9. Input from support network

**Health-related social needs (HRSN)**

10. Living situation (single choice): Homeless (street/outdoors, shelter, safe havens, transitional living
    center, low-demand, reception centers, other temporary day/evening facility); Correctional facility;
    Psychiatric inpatient facility; Residential treatment facility; Halfway house/transitional housing;
    Recovery residence; Board and care or group home; Permanent supportive housing; Lease-based housing
    (incl. HUD/subsidized); Relationship-based housing without lease; Homeowner; Other (specify); Unknown
11. Forecasted exit date (Y/N) + date + anticipated housing
12. Transportation description + problems identified (describe) / none / unknown
13. Food security problems (describe) / none / unknown — 13a. SNAP (Y/N/Unknown)
14. Income and benefits (multi): SSI, SSDI, TDAP, VA, employment earnings (each with amount), Housing Choice
    Voucher, other income amount, unknown — 14b. average monthly income
15. Insurance (multi): Medicare, Medicaid, Private/Employer, TRICARE/military, assistance program (Medication
    Assistance Program), Other, None, Unknown
16. How each HRSN was reviewed / addressed and the plan to maintain support (or why no action)

**Advance directives**

17. Valid MENTAL health advance directive (Y/N) + how honored — 17a. conflicts with the proposed plan
18. Valid advance medical directive (Y/N) + how honored; a copy must be attached (attachment reference required when Yes)

**Goals:** table of Area of Need (Somatic Health, Education, Employment, Housing/Living Arrangements,
Finances, Benefits, Family, Relationships + custom rows) × Goal/Objective (in the respondent's own words, in
quotes, if they participated) × Time frame.

**Recommended services:** ACT (team includes psychiatrist / CM / CPRS checkboxes) and/or separate Psychiatrist
Services, Case Management, CPRS Services, Additional service types — each: organization name, contact person,
tel, address, known/possible barriers, contingencies (alternative level of care + recommended provider).

Rules:
- The plan must include at minimum psychiatrist services, case management and CPRS services (via ACT or separately).
- Every listed service must identify a community-based provider that has agreed to provide it (Health-General
  §10-6A-06) — Altrixs captures "provider agreed" Y + date.
- Information sharing among plan providers is required.

**Medication Worksheet** (optional: only if medication is determined essential): rows of medication, class,
dosage range, route, administration (self vs authorized personnel), reason/indication, contingency/alternative
(e.g. if X ineffective after trial period, Y).
1. Beneficial and detrimental physical / cognitive / emotional / behavioral side effects
2. Discussed with respondent (and guardian / HCA) — text
3. Reasonable alternatives considered — 3a. risks/benefits recommended vs alternatives; 3b. alternatives
   acceptable to both; 3c. respondent's reason for refusal
4. Medication recommended for maintenance of health and safety (Y/N)

**Closing statement:** the CCT shall provide a plan for continued treatment within 30 days before order expiration.

**Signature:** testifying psychiatrist's signature + date (Altrixs: PSYCHIATRIST role or the verified Medical Director).

---

## 2. Psychiatrist Affidavit (MDH#0004BHA)

"I ___ hereby, under penalty of perjury, affirm that":

1. I personally examined [respondent] on [date];
2. the respondent meets the criteria of Health-General §10-6A-05:
   - a. at least 18 (Altrixs checks from the DOB; blocked if under 18);
   - b. serious and persistent mental illness;
   - c. lack of adherence — at least one of:
     - (i) at least twice in the past 36 months the SPMI was a significant factor necessitating inpatient
       psychiatric admission over 48 hours or receipt of psychiatric services in a correctional facility + details;
     - (ii) at least once within the 36 months immediately preceding the petition filing the SPMI resulted in
       serious violent behavior toward self/others or patterns/threats/attempts of serious physical harm + details;
   - d. needs AOT to prevent relapse/deterioration creating a substantial risk of serious harm to self or others;
   - e. unlikely to adequately adhere voluntarily, shown by non-adherence in the prior 36 months not due to
     financial, transportation, or language access issues;
3. willing and able to testify;
4. not related by blood or marriage to the respondent;
5. not related to [petitioner name];
6. either no financial interest, or the financial interest is described and disclosed to the respondent.

Psychiatrist name, signature, date. Only the PSYCHIATRIST role signs (a Medical Director signs only when their active role is Psychiatrist).

---

## 3. Notification of Petition for Emergency Evaluation (MDH#0003BHA)

- I. Regional AOT Program; CCT contact information
- II. Participant name, DOB, date of emergency petition, reasons for evaluation, findings of evaluation;
  staff name, title, signature, date

Altrixs also logs the EP as an escalation event on the participant and flags it on the caseboard.

---

## 4. Plan for Continued Treatment

Completed by the CCT prior to order expiration (Altrixs flags it due ≥30 days before the order end date).

- Date of original referral, date of plan completion, participant ID, regional AOT program, CCT contact info
- Participant info: first, MI, last, aka, DOB, phone, best contact (Text / Call / other), email, primary
  address / cross streets, apt, city, ZIP
- Diagnoses same as treatment plan (Y/N) + changes
- HRSN same as previously identified (Y/N) + interventions; HRSN tracker table (Barrier, Intervention, Status, Notes)
- Goal changes / updates
- Services and providers same (Y/N) + changes
- Signatures: CCT psychiatrist name/title, CCT case manager name/title, staff name/title, date (each signs separately)

---

## 5. Non-Responsive Respondent certified letter (MDH#0002BHA)

**Wording verified** word for word against MDH#0002BHA-Revised 06/25/2026. All fixed text below is printed
verbatim and is not editable in Altrixs; staff fill in only the blanks (marked _[blank]_).

- Letterhead "MARYLAND ASSISTED OUTPATIENT TREATMENT (AOT) PROGRAM", regional office address / city / phone / email _[blanks]_
- "SENT VIA CERTIFIED MAIL", date _[blank]_, To: respondent name / mailing address _[blanks]_
- Re: AOT Program – Outreach and Opportunity to Participate in Treatment Plan Development

Body (verbatim):

> The Maryland Assisted Outpatient Treatment (AOT) Program is writing to document our efforts to contact you regarding participation in the treatment plan development process associated with your AOT matter.
>
> **Outreach Attempts / Participation Status**
>
> The AOT Team attempted to contact you regarding an initial engagement meeting on the following dates:
>
> | Date | Method (Phone / Mail / In-Person / Other) | Result |  _[table rows]_
>
> ☐ You declined to participate at this time.
> ☐ We did not receive a response to our outreach attempts.
> ☐ Other: ____ _[blank]_
>
> **Orientation to the AOT Program**
>
> Assisted Outpatient Treatment (AOT) is a court-based outpatient treatment process intended to support individuals with behavioral health needs in remaining safely in the community while connected to treatment and services. Program goals include reducing crises, hospitalization, homelessness, and interruptions in care, while promoting recovery, stability, and access to community-based supports.
>
> The AOT Regional Program Director helps oversee the local AOT program, coordinates communication, and assists with addressing barriers to services. The Care Coordination Team (CCT) may include clinical, case management, psychiatric, and peer support staff who assist with treatment planning, referrals, and coordination of care.
>
> **Opportunity to Share Your Preferences in Writing**
>
> Even if you choose not to meet at this time, you may still share your treatment planning preferences in writing. You may provide information regarding:
>
> - Whether you would like to participate in future meetings
> - Preferred method of contact (phone, mail, email, attorney, guardian, etc.)
> - Preferred providers or services
> - Individuals you would like involved in planning (family, support person, attorney, guardian, etc.)
> - Any treatment goals, concerns, or accommodations you would like the team to know
>
> Please return written preferences to the address above or contact our office directly.
>
> **Contact Information**
>
> If you have questions, concerns, or would like to speak with the AOT Team, please contact:
>
> AOT Program Contact: _[blank]_ · Phone: _[blank]_ · Email: _[blank]_
>
> We remain available to answer questions and to work with you respectfully throughout this process.
>
> Sincerely,
> _[Name]_
> AOT Regional Program Director
> Maryland Assisted Outpatient Treatment Program
>
> Enclosures: Optional Initial Engagement Meeting Form/ Return Envelope
> cc: Counsel for Respondent

Footer: Maryland Department of Health · Behavioral Health Administration · 201 W. Preston Street · Baltimore, MD 21201 · maryland.gov/TryAOT · Toll Free: 1-877-463-3464 · Deaf and Hard of Hearing Use Relay · MDH#0002BHA-Revised 06/25/2026

Signer: AOT Regional Program Director (Altrixs: Practice Director / Director / Admin). Altrixs adds a
certified-mail tracking number and mailed date, recorded after signing and logged as an outreach attempt.

---

## 6. AOT Complaint/Incident Report (MDH BHA complaint form)

Submitted by staff to bha.aotpetitions@maryland.gov.

Purpose and routing notes: not for COMAR 10.63 licensed program grievances (use the BHA 10.63 complaint form);
individual clinician complaints go to the licensing board; hospital / FQHC / residential go to OHCQ; does not
replace mandatory reporting to law enforcement, APS, CPS, licensing boards.

- **Section I — Reporter:** internal tracking # (Altrixs incident number), date of report, name,
  organization/agency, title/role (AOT CCT staff, Provider, Family Member, Participant/Respondent, Attorney,
  Judge/Court Staff, Hospital, Law Enforcement, Community Member, Other), telephone cell / business, email,
  may MDH contact (Y/N)
- **Section II — Participant:** name, alias, DOB, region (Anne Arundel, Baltimore City, Eastern Shore, Phase II
  Region, Other; picked manually by staff, no county-to-region auto-mapping), county, current AOT status (Pending Petition, Active AOT Order, Voluntary Agreement, Discharged)
- **Section III — Type (check all):** Care Coordination Team Issue, Development of Treatment Plan, Failure to
  Implement Treatment Plan, Access to Recommended Services, Participant Rights Concern, Communication Concern,
  Conflict of Interest (incl. dual relationships)
- **Section IV — Description:** date and time of incident, location, individuals involved, what occurred,
  witnesses, law enforcement contacted (Y/N) + agency, emergency medical assistance (Y/N), sent to hospital
  (Y/N/Unknown) + name, admitted (Y/N/Unknown) + name
- **Section V:** immediate actions taken; lessons learned and steps to improve / reduce repeat risk
- **Section VI — Notifications (each with date):** MDH AOT Regional Coordinator, MDH AOT Program Director, CCT
  Program Director, Treating Psychiatrist, Case Manager, CPRS, Participant's Attorney, Guardian, Family Member,
  Hospital, Law Enforcement, APS, CPS, Local Health Department, Other
- **Section VII — Attachments:** Incident Reports, Medical Documentation, Police Reports, Witness Statements,
  Treatment Plan, Court Documents, Photographs, Other
- Certification: "I certify that the information contained in this report is true and complete to the best of
  my knowledge." — name / signature / date
- **Section X — MDH use only** (printed blank)

Confidentiality notice printed on the report: "CONFIDENTIALITY NOTICE: This document contains confidential
information. Disclosure of any information therein could be a violation of Maryland Confidentiality of Medical
Records Law. REDISCLOSURE IS STRICTLY PROHIBITED unless made pursuant to HG 4-302(d) of the Annotated Code of
Maryland."

Any APS / CPS / law enforcement item prompts: "Mandatory reporting is separate — confirm it was made."
