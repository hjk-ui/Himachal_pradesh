# DrFirst certification requirements (as provided by DrFirst, received 2026-10-20)

Verbatim list from DrFirst's "DrFirst Certification" page, supplied by the owner. The final test script is
based on the APIs Altrixs integrates. Use these IDs in README.md (status + evidence per requirement).

## General Requirements (Mandatory)
- GM1. Partners must always identify individual records by ExternalID and/or RcopiaID.
- GM2. If RcopiaID is not used as a unique identifier, the Partner application should send records that are defined uniquely with a combination of "Practice Username", "System Name" and "External ID".
- GM3. External IDs must not be reused for multiple records of the same type within a practice.
- GM4. API versioning must be implemented. The version number must be stored as a configurable database for ease of ongoing management.
- GM5. Partner application must be able to handle one vendor account per practice.
- GM6. Partner application must be able to handle and log all error messages generated through the response to an API call.
- GM7. The partner application must store the LastUpdateDate within their application. This value must be updated after each download request. A subsequent download request must send the LastUpdateDate value provided in response to the last successful download request.
- GM8. If using a polling interval, all update_* API calls should only be made once every 5 minutes.
- GM9. The partner application should demonstrate the capability to handle special or restricted characters by escape coding them while making API calls.
- GM10. Partner application must make all upload API calls for the patient prior to an SSO request.
- GM11. Partner with an embedded browser, iframe, or non-conventional browser type must make an SSO request with the allow_popup_screen parameter set to 'n'.
- GM12. Partner application must be able to log/store the XML response payload for successful API calls and the request for API calls that fail due to a connection error. These may be requested as part of any API-based production support by DrFirst.
- GM13. Partner application must be able to log/store the SSO requests for each attempt to launch into DrFirst. These may be requested as part of any SSO-based production support by DrFirst.

## Upload (send_*) Requirements
- UM1. For on-demand model: API must be triggered for new and/or edited records only.
- UM2. For polling model: API must include new and/or edited records since the last poll attempt.
- UM3. For the polling model: The minimum acceptable polling gap is 5 minutes.
- UR1 (recommended). For on-demand model: Partners must synchronize records as soon as they are created / updated in the Partner system to avoid sending large updates just prior to launching Rcopia.

### Patient Demographics Upload
- PDUM1. Partner must not upload a patient without First Name, Last Name, Gender, Date Of Birth, and Zip Code.
- PDUM2. Partner must send patient address (Address Line 1, City, State, and Zip) for electronic prescribing. If a patient's address is not known, Address Line 1 can be valued with "HOMELESS" or "UNKNOWN" as appropriate. City, State and Zip can be set to the practice or clinic values.
- PDUM3. Partner must be capable of sending Home Phone and Mobile Phone when adding or updating a patient record if they are captured in the partner application.
- PDUM4. A patient's demographics must be synchronized with Rcopia to match what is in the partner application prior to launching Rcopia for the patient.
- PDUM5. Partners must send a patient's demographics record only when it is either created within the EMR or when it is subsequently updated. A record must be considered as updated when details synched via the API are altered in the partner application.
- PDUR1 (recommended). Partner must identify a new patient with an External ID that is unique to the practice and system name.
- PDUR2 (recommended). Placeholder values must not be sent for phone numbers. Placeholder values include any number with all digits the same and known invalid area codes.

### Diagnoses Upload
- DURM1. If the partner application is capable of recording patient diagnoses, then all diagnoses must be sent for any patient that is uploaded to Rcopia.
- DURM2. Diagnoses must be coded using ICD-9, ICD-10, or SNOMED.
- DURM3. A patient's diagnoses must be synchronized with Rcopia to match what is in the partner application prior to launching Rcopia for the patient.
- DURM4. Partners must send a diagnosis record only when it is either created within the EMR or when it is subsequently updated. A record must be considered as updated when details synched via the API are altered in the partner application.

### Allergy Upload
- AUM1. If the partner application is capable of recording patient allergies, then all allergy records must be sent for any patient that is uploaded to Rcopia.
- AUM2. The partner must identify a drug allergy in the send_allergy API call with one of: NDCID, Rxnorm CUI, FirstDataBank (FDB) MedID, RcopiaID for the drug (if known).
- AUM3. The drug allergy identifier used in the send_allergy call must be from a valid drug database that is updated at least once a month.
- AUM4. A patient's allergies must be synchronized with Rcopia to match what is in the partner application prior to launching Rcopia for the patient.
- AUM5. Partners must send an allergy record only when it is either created within the EMR or when it is subsequently updated.
- AUR1 (recommended). If the drug allergy is identified by NDC, when available, the partner must send multiple NDCs.

### Medication Upload
- MUM1. If the partner application is capable of recording medications, then all medication records must be sent for any patient that is uploaded to Rcopia.
- MUM2. The partner must identify a codified drug in the send_medication API call with one of: NDCID, Rxnorm CUI, FDB MedID, RcopiaID for the drug (if known).
- MUM3. The identifier must come from a drug database that is updated at least once a month.
- MUM4. For codified drugs, the Name (BrandName or GenericName), Form and Strength must all be included along with the drug code.
- MUM5. Partners must not send latin abbreviations as part of the sig information for medications.
- MUM6. A patient's medications must be synchronized with Rcopia to match what is in the partner application prior to launching Rcopia for the patient.
- MUM7. Partners must send a medication record only when it is either created within the EMR or when it is subsequently updated.
- MUR1 (recommended). If identified by NDC, send multiple NDCs when available.
- MUR2 (recommended). Send sig elements in discrete fields (Action, Dose, DoseUnit, Route, DoseTiming, DoseOther) when they map; PatientNotes only for sigs that don't map or extra sig data. See Sig Picklist Values.
- MUR3 (recommended). Do not include patient instructions or clinical data in OtherNotes (non-clinical notes to the pharmacist only).

### DischargeRx Upload (HIS workflows only)
- DPUM1. Only to send discharge prescriptions from a hospital information system for review/transmission, or to delete a prescription created in Rcopia when the deletion is initiated by the partner system.
- DPUM2. Partner must be able to handle modifications made to discharge prescriptions within Rcopia.
- DPUM3. <Quantity> must not permit 0.
- DPUM4. Decimal fields: no trailing ".0" for whole numbers; leading zero for values < 1 (e.g. "0.5").
- DPUM5. QuantityUnit from the Sig Picklist Quantity Unit list or an NCPDP FMT QuantityUnitOfMeasurement code (v19.12e).
- DPUR1/DPUR2 (recommended). Send provider, drug (names, form, strength, NDC/FDB), all sig info codified, quantity/unit, refills, substitution, patient/pharmacy/other notes.

## Download (update_*) Requirements
- DR1. Store LastUpdateDate; update after each download; send the value from the last successful download.
- DR2. For polling: minimum polling gap 5 minutes.

### Patient Demographics Download
- PDDM1. update_patient must be integrated as a polling call if choosing Multi Patient Mode.
- PDDM2. Store/round-trip LastUpdateDate for update_patient.
- PDDR1 (recommended). It is highly recommended that Partners implement this call in Single Patient Mode (pharmacy renewals for patients not in the practice can make Rcopia create a new patient).

### Diagnoses Download
- DDM1. If the partner UI lets users add/edit diagnoses, implement update_problem (unless suppressed via private labeling).
- DDM2. Handle modifications to diagnoses made within Rcopia.
- DDM3. Store/round-trip LastUpdateDate for update_problem (per patient for patient-level calls; per practice for practice-level calls).

### Allergy Download
- ADM1. If the partner UI lets users add/edit allergies, implement update_allergy (unless suppressed via private labeling).
- ADM2. Handle modifications to allergies made within Rcopia.
- ADM3. Store/round-trip LastUpdateDate for update_allergy (per patient / per practice).

### Medication Download
- MDM1. If the partner UI lets users add/edit medications, implement update_medication.
- MDM2. Handle modifications to medications made within Rcopia.
- MDM3. Store/round-trip LastUpdateDate for update_medication (per patient / per practice).

### Patient Office Visit Download
- POVDM1. Practice-level update_patient_office_visits: store/round-trip LastUpdateDate (per patient / per practice).

### Pharmacy-Initiated Renewals Download
- PIRDM1. Store/round-trip LastUpdateDate for update_notification (per patient / per practice).

### Prescription Download
- PDM1. Partner must maintain the prescription list separate from the medication list.
- PDM2. Store/round-trip LastUpdateDate for update_prescription (per patient / per practice).
- PDR1 (recommended). Distinguish pending prescription records from sent prescription records.

### Prescription Events Download
- PEDM1. Store/round-trip LastUpdateDate for update_prescription_events.
- PEDM2. Max 200 prescription IDs per request; round-robin if more.
- PEDM3. A given set of prescriptions may be polled no more than once every 5 minutes.
- PEDM4. Stop polling once a terminal status is reached (EDV, FDV, UM, CEDV, CFDV, CUN, XEDV).

### Prescription Status Download
- PSDM1. Max 200 prescription IDs per request; round-robin if more.
- PSDM2. A given set polled no more than once every 5 minutes.
- PSDM3. Stop polling once a terminal status is reached (EDV, FDV, UM).

### Notification Count Download
- NCDM1. get_notification_count should be made only once in a 15 minute period.
- NCDM2. Display counts for pending prescriptions (rx_pending), pending renewals (refills), pending prescription change requests (rxchange), and prescriptions that need signing (rx_needs_signing).
- NCDM3. Permit users to launch into the "message" and "report" screens in Rcopia's Limited Multi Patient Mode.

### Update Drug History (HIS only)
- UDH1. Only triggered by user action, not auto-retrieved on screen launch.
- UDH2. Acute (HIS) setting only. (Not applicable to Altrixs outpatient.)

### Patient Medication List Review Status Download
- PMLRSDM1. Store/round-trip LastUpdateDate for get_review_status (per patient / per practice).
