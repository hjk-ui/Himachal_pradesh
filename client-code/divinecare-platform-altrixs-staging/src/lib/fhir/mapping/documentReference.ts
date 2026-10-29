import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { SYSTEMS, fhirDateTime, fhirId, ref, type FhirResource } from './common';
import { finalize, type MapContext } from './meta';
import type { ProgressNoteRow } from './types';

/** Only signed or locked notes leave the EHR; drafts never do. */
export function isFinalNote(note: Pick<ProgressNoteRow, 'workflow'>): boolean {
  const s = note.workflow?.status;
  return s === 'SIGNED' || s === 'LOCKED';
}

/** Part 2 flag: column, or the legacy hidden part2="true" body comment. */
export function isPart2Note(note: Pick<ProgressNoteRow, 'part2' | 'body'>): boolean {
  return note.part2 || parseNoteMeta(note.body).sudConfidential === true;
}

/** The signed text: workflow snapshot (what was signed) without the legacy meta comment, plus addenda. */
export function signedNoteText(note: ProgressNoteRow): string {
  const signed = parseNoteMeta(note.workflow?.body || note.body).displayBody.trim();
  const addenda = [...note.addenda]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(
      (a) =>
        `--- Addendum (${a.reason}) ${a.createdAt.toISOString()}${a.authorName ? ` by ${a.authorName}` : ''} ---\n${a.text.trim()}`
    );
  return [signed, ...addenda].join('\n\n');
}

/**
 * Signed / locked ProgressNote -> DocumentReference (LOINC 11506-3 Progress note), note text as
 * base64 attachment data. Returns null for drafts.
 */
export function mapProgressNoteDocument(note: ProgressNoteRow, ctx: MapContext): FhirResource | null {
  if (!isFinalNote(note)) return null;
  const wf = note.workflow!;
  const body = signedNoteText(note);
  const signedAt = wf.signedAt || wf.lockedAt || note.createdAt;
  const author = wf.signedById || note.clinicianId;
  return finalize(
    {
      resourceType: 'DocumentReference',
      id: fhirId('note', note.id),
      identifier: [{ system: 'urn:altrixs:progress-note', value: note.id }],
      status: 'current',
      docStatus: note.addenda.length ? 'amended' : 'final',
      type: {
        coding: [{ system: SYSTEMS.loinc, code: '11506-3', display: 'Progress note' }],
        text: note.noteType ? `Progress note (${note.noteType})` : 'Progress note',
      },
      category: [{ coding: [{ system: SYSTEMS.usCoreDocCategory, code: 'clinical-note', display: 'Clinical Note' }] }],
      subject: ref('Patient', note.clientId),
      date: fhirDateTime(signedAt),
      author: author ? [ref('Practitioner', author)] : undefined,
      authenticator: wf.signedById ? ref('Practitioner', wf.signedById) : undefined,
      custodian: ref('Organization', ctx.organizationId),
      content: [
        {
          attachment: {
            contentType: 'text/plain; charset=utf-8',
            language: 'en-US',
            data: Buffer.from(body, 'utf8').toString('base64'),
            title: note.noteType ? `${note.noteType} progress note` : 'Progress note',
            creation: fhirDateTime(signedAt),
          },
        },
      ],
      context: note.dateOfService ? { period: { start: fhirDateTime(note.dateOfService) } } : undefined,
    },
    ctx
  );
}
