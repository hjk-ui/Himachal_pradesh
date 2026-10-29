/**
 * MedicalPatient -> Client reconciliation (one patient record). Pure classifier used by
 * scripts/medical-patient-reconciliation.ts. It only REPORTS; it never links, merges or deletes.
 *
 *  linked_primary_care : linked client (bhClientId or same MRN) has a visit / vitals / charge
 *  linked_no_records   : linked client has no primary-care record. Many of these were copied
 *                        from the client list by the old roster backfill (removed); review them.
 *  unlinked_candidates : no linked client, but a client with the same name AND date of birth
 *                        exists. A person must confirm the match; names are not unique.
 *  unlinked_no_match   : no linked client and no same-name / same-DOB client.
 */

export type ReconMedicalPatient = {
  id: string;
  mrn: string;
  name: string;
  dob: string | null; // YYYY-MM-DD, null when only the placeholder DOB is stored
  bhClientId: string | null;
};

export type ReconClient = {
  id: string;
  mrn: string | null;
  name: string;
  legalFirstName: string | null;
  legalLastName: string | null;
  dob: string | null;
  hasPrimaryCareRecords: boolean;
};

export type ReconRow = {
  medicalPatientId: string;
  mrn: string;
  status: 'linked_primary_care' | 'linked_no_records' | 'unlinked_candidates' | 'unlinked_no_match';
  clientId: string | null;
  candidateClientIds: string[];
};

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function reconcileMedicalPatients(patients: ReconMedicalPatient[], clients: ReconClient[]): ReconRow[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const byMrn = new Map(clients.filter((c) => c.mrn).map((c) => [c.mrn as string, c]));
  return patients.map((p) => {
    const linked = (p.bhClientId ? byId.get(p.bhClientId) : undefined) ?? byMrn.get(p.mrn);
    if (linked) {
      return {
        medicalPatientId: p.id,
        mrn: p.mrn,
        status: linked.hasPrimaryCareRecords ? 'linked_primary_care' : 'linked_no_records',
        clientId: linked.id,
        candidateClientIds: [],
      };
    }
    const name = norm(p.name);
    const candidates = p.dob
      ? clients.filter(
          (c) =>
            c.dob === p.dob &&
            (norm(c.name) === name || (c.legalFirstName && c.legalLastName && norm(`${c.legalFirstName} ${c.legalLastName}`) === name))
        )
      : [];
    return {
      medicalPatientId: p.id,
      mrn: p.mrn,
      status: candidates.length ? 'unlinked_candidates' : 'unlinked_no_match',
      clientId: null,
      candidateClientIds: candidates.map((c) => c.id),
    };
  });
}
