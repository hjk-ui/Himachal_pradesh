/**
 * AI Scribe for group sessions (group therapy, skills, psychoeducation, SUD counseling, IOP / PHP
 * groups). Pure, browser-safe: member roster, consent, speaker mapping, per-member source isolation,
 * prompts, grounding and placement into the group session note fields (src/lib/groups/types.ts).
 *
 * One capture records the session once. The clinician maps each Transcribe speaker label to the
 * clinician or one attending member (quick mapping step). Then:
 *  - SHARED section (topic, objectives, interventions, dynamics, plan): drafted from the clinician's
 *    lines and the lines of INCLUDED members only. It describes the group as a whole and never names
 *    or describes one member (aliases and names in a sentence withhold it).
 *  - INDIVIDUAL response, per member: drafted ONLY from that member's own mapped lines, numbered
 *    separately for each member, so a sentence cannot cite (and the model never sees) another
 *    member's words. A sentence that names another member or uses a member alias is withheld.
 *  - Unattributed speech (labels not mapped) is never used, in any section.
 *  - Members without AI consent (declined, or missing when the practice requires it) are excluded:
 *    their mapped speech is dropped everywhere and they get no AI text.
 *  - 42 CFR Part 2: in a non-SUD group, a member whose record is Part 2 gets nothing SUD-related:
 *    their SUD lines are not sent and SUD sentences are withheld from their section; and because
 *    the shared section is copied into that member's note, SUD lines and sentences are also kept
 *    out of the shared section.
 * Recording consent is all-party (Maryland): every person present must have agreed to the recording,
 * one checkbox per member, before capture starts. AI consent decides only whose words are used.
 * Risk, attendance, minutes, participation level, UDS, ASAM and goals stay clinician-entered.
 */
import { AI_DRAFT_MARKER } from '@/lib/ai/noteDraftFormats';
import { findNameMentions } from '@/lib/groups/rules';
import type { GroupKind, NoteValues } from '@/lib/groups/types';
import { SUD_TERMS } from './clientSummary';
import { checkDraftSentence, sourceMap, type CheckedSentence, type DraftSentence, type Source } from './grounding';
import { formatTimestamp, type RawSegment, type StoredSegment } from './diarization';
import type { AiConsentStatus } from './consent';
import { draftLanguageInstruction, type ScribeLanguage } from './language';

export type GroupMember = {
  clientId: string;
  /** Pseudonym the model sees ("Member A"); never the name */
  alias: string;
  aiConsent: AiConsentStatus;
  /** The member's own record is Part 2 */
  part2: boolean;
  /** AI may use this member's words (AI consent on file, or not required by the practice) */
  included: boolean;
};

export function memberAlias(i: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return `Member ${i < 26 ? letters[i] : `${letters[Math.floor(i / 26) - 1]}${letters[i % 26]}`}`;
}

export function groupMembers(attendees: { clientId: string; aiConsent: AiConsentStatus; part2: boolean }[], practiceRequiresAiConsent: boolean): GroupMember[] {
  return attendees.map((a, i) => ({
    clientId: a.clientId,
    alias: memberAlias(i),
    aiConsent: a.aiConsent,
    part2: a.part2,
    included: a.aiConsent === 'signed' || (a.aiConsent === 'missing' && !practiceRequiresAiConsent),
  }));
}

/** Recording attestation for a group: one box per person present (members and any other person). */
export type GroupConsentRow = { clientId: string | null; label?: string; agreed: boolean };

export function groupRecordingConsentCheck(rows: GroupConsentRow[]): { ok: true } | { ok: false; code: string; message: string } {
  if (!rows.length || !rows.some((r) => r.clientId)) return { ok: false, code: 'group_no_members', message: 'List the members present before recording.' };
  const refused = rows.filter((r) => r.agreed !== true).length;
  if (refused) {
    return {
      ok: false,
      code: 'participant_declined',
      message: `Everyone present must agree before a group is recorded (Md. Code, Cts. & Jud. Proc. §10-402). ${refused} ${refused === 1 ? 'person has' : 'people have'} not agreed: do not record this group.`,
    };
  }
  return { ok: true };
}

export const GROUP_CLINICIAN = 'CLINICIAN';
export const GROUP_UNATTRIBUTED = 'UNATTRIBUTED';
/** speakerMap values: CLINICIAN | member:<clientId> | UNATTRIBUTED */
export type GroupSpeakerValue = string;

export function memberSpeakerValue(clientId: string): string {
  return `member:${clientId}`;
}

/** Who a raw label belongs to: 'clinician', a member's clientId, or null (unattributed). */
export function speakerOwner(map: Record<string, string> | null | undefined, label: string): { kind: 'clinician' } | { kind: 'member'; clientId: string } | null {
  const v = map?.[label];
  if (v === GROUP_CLINICIAN) return { kind: 'clinician' };
  if (typeof v === 'string' && v.startsWith('member:') && v.length > 7) return { kind: 'member', clientId: v.slice(7) };
  return null;
}

export type GroupLine = { id: string; seq: number; speaker: string; startMs: number; text: string };

export type GroupSources = {
  shared: GroupLine[];
  perMember: Map<string, GroupLine[]>;
  /** Lines never used: unattributed, excluded members, Part 2 SUD lines */
  dropped: { unattributed: number; excluded: number; part2: number };
};

const isSud = (text: string) => SUD_TERMS.test(text);

/**
 * Split the transcript into what each draft may see. Shared: clinician + included members (aliases).
 * Per member: only that member's lines, numbered t1… for that member alone.
 */
export function groupDraftSources(input: {
  segments: (RawSegment & { seq: number })[] | StoredSegment[];
  speakerMap: Record<string, string> | null | undefined;
  members: GroupMember[];
  kind: GroupKind;
}): GroupSources {
  const byId = new Map(input.members.map((m) => [m.clientId, m]));
  const sudGroup = input.kind === 'sud';
  const sharedNoSud = !sudGroup && input.members.some((m) => m.included && m.part2);
  const ordered = [...input.segments].sort((a, b) => a.seq - b.seq);
  const shared: GroupLine[] = [];
  const perMember = new Map<string, GroupLine[]>();
  const dropped = { unattributed: 0, excluded: 0, part2: 0 };
  for (const s of ordered) {
    const owner = speakerOwner(input.speakerMap, s.speakerLabel);
    if (!owner) {
      dropped.unattributed++;
      continue;
    }
    let speaker = 'Clinician';
    if (owner.kind === 'member') {
      const m = byId.get(owner.clientId);
      if (!m || !m.included) {
        dropped.excluded++;
        continue;
      }
      speaker = m.alias;
      const memberSud = !sudGroup && m.part2 && isSud(s.text);
      if (!memberSud) {
        const list = perMember.get(m.clientId) ?? [];
        list.push({ id: `t${list.length + 1}`, seq: s.seq, speaker: 'Member', startMs: s.startMs, text: s.text });
        perMember.set(m.clientId, list);
      } else dropped.part2++;
    }
    if (sharedNoSud && isSud(s.text)) {
      if (owner.kind === 'clinician') dropped.part2++;
      continue;
    }
    shared.push({ id: `t${shared.length + 1}`, seq: s.seq, speaker, startMs: s.startMs, text: s.text });
  }
  return { shared, perMember, dropped };
}

export function groupLinesText(lines: GroupLine[]): string {
  return lines.map((l) => `${l.id} [${formatTimestamp(l.startMs)}] ${l.speaker}: ${l.text}`).join('\n');
}

/** Fields the AI drafts (narrative only). Everything else stays clinician-entered. */
export const GROUP_SHARED_AI_FIELDS: Record<GroupKind, readonly string[]> = {
  psychotherapy: ['topic', 'objectives', 'interventions', 'dynamics', 'plan'],
  sud: ['topic', 'interventions', 'dynamics', 'plan'],
};
export const GROUP_INDIVIDUAL_AI_FIELDS: Record<GroupKind, readonly string[]> = {
  psychotherapy: ['response', 'progress'],
  sud: ['triggers', 'progress'],
};
/** Fields the AI never fills in a group note. */
export const GROUP_NEVER_AI_FIELDS = new Set(['risk', 'riskDetail', 'participation', 'useSinceLast', 'useDetail', 'cravings', 'udsSource', 'udsResult', 'udsDate', 'asamDimensions', 'asamDetail', 'stageOfChange', 'goalIds', 'curriculum', 'moodAffect']);

const SENTENCE = '{"text":"...","cites":["t3"]}';

export function groupSharedSystemPrompt(kind: GroupKind, language: ScribeLanguage): string {
  const fields = GROUP_SHARED_AI_FIELDS[kind];
  return `You draft the SHARED section of a ${kind === 'sud' ? 'substance use group counseling' : 'group psychotherapy'} note. The same text is copied into every attending member's chart.
Fields: ${fields.join(', ')} ("topic" is one short phrase).
Rules:
- Use ONLY the numbered transcript lines; every sentence cites at least one line id that supports it.
- Describe the group as a whole. NEVER name, number, quote or describe an individual member; never write "Member A" or any alias; never attribute a statement to one member.
- No risk statements, diagnoses, substance use by any one person, attendance or billing.
- Clinical, third person, past tense. If a field was not covered, omit it.
${draftLanguageInstruction(language)}
Return one JSON object: {"shared":{"<field>":[${SENTENCE}]}}`.trim();
}

export function groupMemberSystemPrompt(kind: GroupKind, language: ScribeLanguage): string {
  const fields = GROUP_INDIVIDUAL_AI_FIELDS[kind];
  const meaning =
    kind === 'sud'
      ? '"triggers": triggers the member themself identified; "progress": progress toward recovery goals the member themself described.'
      : '"response": how the member responded to the group\'s interventions, from their own words; "progress": progress toward their goals the member themself described.';
  return `You draft ONE group member's individual section of a group note. The lines below are ONLY what this one member said in the group.
Fields: ${fields.join(', ')}. ${meaning}
Rules:
- Use ONLY these numbered lines; every sentence cites at least one of them.
- Write about "the client" only. Never mention, name or describe any other group member, and never repeat what others said.
- No risk level, diagnoses, attendance, participation rating, drug screen results or billing.
- Clinical, third person, past tense. If a field is not supported, omit it.
${draftLanguageInstruction(language)}
Return one JSON object: {"fields":{"<field>":[${SENTENCE}]}}`.trim();
}

function asSentences(v: unknown): DraftSentence[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { text: unknown; cites: unknown } => Boolean(x) && typeof x === 'object')
    .filter((x) => typeof x.text === 'string')
    .map((x) => ({ text: String(x.text), cites: Array.isArray(x.cites) ? x.cites.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()) : [] }));
}

/** Parse {"shared":{…}} or {"fields":{…}} into field → sentences, keeping only the allowed fields. */
export function parseGroupReply(reply: string, key: 'shared' | 'fields', allowed: readonly string[]): Record<string, DraftSentence[]> | null {
  let root: unknown;
  try {
    root = JSON.parse(reply);
  } catch {
    return null;
  }
  const obj = root && typeof root === 'object' ? (root as Record<string, unknown>)[key] : null;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out: Record<string, DraftSentence[]> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) if (allowed.includes(k) && !GROUP_NEVER_AI_FIELDS.has(k)) out[k] = asSentences(v);
  return out;
}

const ALIAS = /\bmember\s+[a-z]{1,2}\b/i;

/**
 * Ground one section. Besides the citation checks: a sentence that uses a member alias or names
 * another attendee is withheld (privacy), and for a Part 2 context any SUD sentence is withheld.
 */
export function groundGroupSection(
  raw: Record<string, DraftSentence[]>,
  lines: GroupLine[],
  opts: { otherNames: string[]; noSud: boolean }
): { fields: Record<string, CheckedSentence[]>; withheld: number; weak: number } {
  const map = sourceMap(lines.map((l): Source => ({ id: l.id, kind: 'transcript', text: l.text })));
  const fields: Record<string, CheckedSentence[]> = {};
  let withheld = 0;
  let weak = 0;
  for (const [k, list] of Object.entries(raw)) {
    fields[k] = list.map((s) => {
      let c = checkDraftSentence(s, map);
      if (c.status !== 'withheld') {
        const named = ALIAS.test(c.text) || findNameMentions(c.text, opts.otherNames.map((name) => ({ name }))).length > 0;
        if (named || (opts.noSud && SUD_TERMS.test(c.text))) c = { ...c, status: 'withheld', support: 0 };
      }
      if (c.status === 'withheld') withheld++;
      else if (c.status === 'weak') weak++;
      return c;
    });
  }
  return { fields, withheld, weak };
}

const joinUsable = (list: CheckedSentence[] | undefined) =>
  (list ?? [])
    .filter((s) => s.status !== 'withheld')
    .map((s) => s.text.trim().replace(/([^.!?])$/, '$1.'))
    .join(' ');

/** Grounded sentences → note field values. Narrative fields start with the AI DRAFT marker; topic is a plain phrase. */
export function groupFieldValues(fields: Record<string, CheckedSentence[]>): NoteValues {
  const out: NoteValues = {};
  for (const [k, list] of Object.entries(fields)) {
    const text = joinUsable(list);
    if (!text) continue;
    out[k] = k === 'topic' ? text.replace(/[.!?]$/, '').slice(0, 200) : `${AI_DRAFT_MARKER}\n${text}`;
  }
  return out;
}

/** Fill AI values only into fields the clinician left empty. */
export function mergeAiValues(current: NoteValues | null | undefined, ai: NoteValues | null | undefined): NoteValues {
  const out: NoteValues = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(ai ?? {})) {
    if (GROUP_NEVER_AI_FIELDS.has(k)) continue;
    const cur = out[k];
    const empty = cur == null || (Array.isArray(cur) ? cur.length === 0 : String(cur).trim() === '');
    if (empty && v != null && v !== '') out[k] = v;
  }
  return out;
}

/** "Accept" for group note fields: strip the marker from every value. */
export function acceptGroupValues(values: NoteValues | null | undefined): NoteValues {
  const out: NoteValues = { ...(values ?? {}) };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && v.includes(AI_DRAFT_MARKER)) out[k] = v.split(AI_DRAFT_MARKER).join('').replace(/^\s*\n/, '').trim();
  }
  return out;
}

export function groupValuesHaveMarker(values: NoteValues | null | undefined): boolean {
  return Object.values(values ?? {}).some((v) => typeof v === 'string' && v.includes(AI_DRAFT_MARKER));
}

/** Stored draft on scribe_group_captures.draft (purged with the transcript). */
export type GroupDraft = {
  shared: NoteValues;
  individuals: Record<string, NoteValues>;
  counts: { withheld: number; weak: number; members: number; dropped: GroupSources['dropped'] };
};
