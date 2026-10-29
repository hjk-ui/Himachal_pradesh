/**
 * Printable / releasable progress note: the body exactly as signed (workflow snapshot), the
 * signature block with credentials and times, co-signature, late-entry label, addenda. Psychotherapy
 * notes are a separate record and are never loaded here.
 */
import { prisma } from '@/lib/db/prisma';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { getServiceDetail } from '@/lib/notes/serviceDetail';
import { normalizeNoteType } from '@/lib/ehr/noteTemplates';
import { prpDetailPrintSections } from '@/lib/prp/progressNote';
import { getPrpNoteDetail } from '@/lib/prp/progressNoteDb';
import { buildPrintableNote, type PrintableNote } from '@/lib/notes/standard';

export async function loadPrintableNote(noteId: string): Promise<
  { ok: true; printable: PrintableNote; clientId: string; status: string } | { ok: false; status: number; error: string }
> {
  const note = await prisma.progressNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      body: true,
      noteType: true,
      dateOfService: true,
      durationMinutes: true,
      cptCode: true,
      addOnCptCode: true,
      placeOfService: true,
      telehealth: true,
      audioOnly: true,
      part2: true,
      aiDrafted: true,
      clientId: true,
      client: { select: { name: true, dateOfBirth: true, mrn: true } },
      workflow: true,
      addenda: { orderBy: { createdAt: 'asc' }, select: { reason: true, text: true, authorName: true, createdAt: true } },
    },
  });
  if (!note) return { ok: false, status: 404, error: 'Note not found' };
  const wf = note.workflow;
  if (!wf || wf.status === 'DRAFT') {
    return { ok: false, status: 409, error: 'Only signed notes can be printed or released. Sign the note first.' };
  }
  const [detail, signer, cosigner, stamp] = await Promise.all([
    getServiceDetail(note.id),
    wf.signedById ? prisma.user.findUnique({ where: { id: wf.signedById }, select: { credentials: true } }) : null,
    wf.cosignedById ? prisma.user.findUnique({ where: { id: wf.cosignedById }, select: { credentials: true } }) : null,
    prisma.progressNoteTimeliness.findUnique({ where: { noteId: note.id }, select: { lateEntry: true, label: true, lateReason: true } }).catch(() => null),
  ]);
  // The signed snapshot is the record; the live row is identical for signed notes but the snapshot is authoritative
  const meta = resolveNoteMeta({ ...note, body: wf.body || note.body });
  const printable = buildPrintableNote({
    clientName: note.client.name,
    clientDob: note.client.dateOfBirth ? note.client.dateOfBirth.toISOString().slice(0, 10) : null,
    mrn: note.client.mrn,
    noteType: meta.noteType,
    dateOfService: meta.dateOfService,
    startTime: detail?.startTime ?? null,
    endTime: detail?.endTime ?? null,
    durationMinutes: meta.durationMinutes,
    cptCode: meta.cptCode,
    addOnCptCode: note.addOnCptCode,
    placeOfService: meta.placeOfService,
    telehealth: meta.telehealth || note.audioOnly,
    telehealthModality: detail?.telehealthModality ?? (note.audioOnly ? 'audio_only' : null),
    diagnosisCodes: detail?.diagnosisCodes ?? [],
    part2: meta.part2,
    aiDrafted: meta.aiDrafted,
    body: meta.displayBody,
    status: wf.status === 'LOCKED' ? 'Locked' : 'Signed',
    signedByName: wf.signedByName,
    signerCredentials: signer?.credentials ?? null,
    signedAt: wf.signedAt?.toISOString() ?? null,
    attestedAt: wf.attestedAt?.toISOString() ?? null,
    lockedAt: wf.lockedAt?.toISOString() ?? null,
    cosignRequired: wf.cosignRequired,
    cosignedByName: wf.cosignedByName,
    cosignerCredentials: cosigner?.credentials ?? null,
    cosignedAt: wf.cosignedAt?.toISOString() ?? null,
    lateEntryLabel: stamp?.lateEntry ? stamp.label : null,
    lateEntryReason: stamp?.lateEntry ? stamp.lateReason : null,
    addenda: note.addenda.map((a) => ({ reason: a.reason, text: a.text, authorName: a.authorName, createdAt: a.createdAt.toISOString() })),
  });
  // PRP progress note: the structured contact fields print ahead of the narrative
  if (normalizeNoteType(meta.noteType || '') === 'PRP') {
    const prp = await getPrpNoteDetail(note.id);
    printable.sections = [
      ...prpDetailPrintSections(prp, { telehealth: meta.telehealth || note.audioOnly, modality: detail?.telehealthModality ?? (note.audioOnly ? 'audio_only' : null) }),
      ...printable.sections,
    ];
  }
  return { ok: true, printable, clientId: note.clientId, status: wf.status };
}
