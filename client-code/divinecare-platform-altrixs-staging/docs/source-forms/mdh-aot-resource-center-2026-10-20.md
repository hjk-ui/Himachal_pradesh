# MDH AOT Resource Center (owner-provided copy, 2026-10-20)

Facts from the Maryland Department of Health (MDH) Assisted Outpatient Treatment (AOT) Resource Center
page, as pasted by the owner on 2026-10-20. Quotes are verbatim (including MDH's spelling). No URLs from
the page were provided, so none are recorded here. Where Altrixs applies each fact is listed below it.

Helpers: `src/lib/aot/mdh.ts` (pure). Tests: `tests/aot-forms.test.ts`.

---

## 1. Operational Care Coordination Team (CCT) regions

> "MDH AOT Care Coordination Teams (CCT) are currently operational in Baltimore City; Anne Arundel County; and the Eastern Shore Region (Kent County, Queen Anne's County, Caroline County, Dorchester County, Wicomico County, Somerset County, Worcester County, Cecil County & Talbot County)."

Altrixs:
- `countyToCctRegion()` maps Baltimore City to Baltimore City, Anne Arundel to Anne Arundel, and the nine
  listed counties to Eastern Shore. Any other county (including Baltimore County) maps to none.
- The AOT Complaint/Incident Report prefills **Region** from the participant's county when it maps. The
  field stays editable. For any other county, Region is left unselected and the field note reads
  "Phase II / other: select manually".
- The eligibility screen (venue county) and the caseboard / Court Workflow show an information note when
  MDH lists no operational CCT for the county.

## 2. Psychiatrist's affidavit and filing

> "completion of the AOT Psychiatrist's Affidavit by a psychiatrist who has examined the individual atleast 30 days prior to the petition filing and is willing to attest to the individual's eligibility in court. The psychiatrist's affidavit must be filed along with the petition in the Circuit Court in the county the respondent resides in or was last known to reside in."

Altrixs:
- The exam-date check stays a **warning only**, never a block (Psychiatrist Affidavit form, Psychiatric
  Eval worksheet, participant create API). The warning quotes the sentence above and adds:
  "The MDH wording ('at least 30 days prior') may mean within 30 days before filing; confirm with counsel."
- The participant create API used to reject an exam older than 30 days (HTTP 422). It now saves the
  record and returns the same text in `warnings`.

## 3. Order term

> "AOT Participant - An individual who is court ordered to follow the treatment plan ordered by the court for a term not to exceed one year."

Altrixs: on participant save (create and update), the order end date must be on or before order start +
365 days (+ 366 when a February 29 falls in that span). Otherwise the API returns HTTP 400 with a plain
message. The Court Workflow tab shows the latest allowed end date.

## 4. Petitioner

> "Petitioner - An individual who files an AOT petition in Maryland. This can be the director of a State-funded mental health program or any individual at least 18 years old who has a legitimate interest in the wellbeing of the respondent."

Altrixs: the eligibility screen records the petitioner type (`program_director` | `individual`), the
relationship to the respondent (required) and, for the individual type, a required attestation that the
petitioner is at least 18. The petitioner name still prefills the affidavit.

## 5. Petition steps (Court Workflow checklist)

The owner's summary of the Resource Center's petition steps. Each step records done, date and by. Open steps
show as caseboard flags while the case is at the petition or hearing stage. They are stored in
`eligibilityData.petitionChecklist`.

1. Petition for Assisted Outpatient Treatment (Maryland Court Forms) filed in the Circuit Court of the
   county where the respondent resides or last resided.
2. AOT Psychiatrist's Affidavit filed with the petition.
3. Office of the County Attorney notified of the petition filing.
4. MDH (the Department) notified of the petition filing.
5. Respondent counsel identified (Office of the Public Defender or private attorney).
6. Motion for Remote Participation filed for providers: "the department highly encourages the submission of a Motion for Remote Participation".
7. Respondent given the opportunity to work with the CCT on the treatment plan and to agree to it before
   the hearing. Recorded as agreed, declined or no response, with the date.
8. CCT includes at minimum a Psychiatrist, a Case Manager and a Certified Peer Recovery Specialist.

## 6. Terminology

Altrixs screen labels say **Respondent** before an order is granted (referral, screening, petition and
hearing stages) and **Participant** after it (active, renewal and step-down stages). MDH form text keeps
each form's own wording.

## 7. Contacts

> "For questions about Maryland's Assisted Outpatient Treatment (AOT) Program reach out to MDH.AOT@Maryland.gov."

Complaint submission: bha.aotpetitions@maryland.gov (already on the AOT Complaint/Incident Report).

> "AOT is not for everyone, if you or someone you know needs to talk, call or text 988."

These are shown in the help panel at the bottom of the AOT page.

## 8. Resources listed

- 988 Suicide & Crisis Lifeline: call or text 988. This is already in the resource library as `crisis-988`, with a verified link.
- NAMI Family Caregiver HelpLine: Monday–Friday 10:00 AM–10:00 PM ET; call 1-800-950-NAMI (6264) and press 4; text 'Family' to 62640; email helpline@nami.org
- Maryland AOT E-Learning Portal (MDH): free training for anyone with a role in AOT
- Maryland AOT Toolkits (MDH BHA): roadmaps, petitioning guidance, eligibility, provider guides, FAQs, multiple languages
- Treatment Advocacy Center: AOT information, anosognosia resources, SMI one-pagers
- NAMI Maryland: local affiliates, peer-led support groups and classes

Altrixs: the last five are seeded into the resource library (`AOT_RESOURCE_SEEDS` in
`src/lib/resources/seedCatalog.ts`) as **drafts with no link**. Staff must add and verify the link before
a draft can be activated. No links were invented.
