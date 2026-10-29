/**
 * In-session cues (optional, toggleable). Pure, rule-based, no AI and no PHI leaves the browser:
 * computed from the live transcript lines and the pre-session context the page already loaded.
 * Cues are reminders only ("PHQ-9 due", "risk language heard: consider C-SSRS", "goal 2
 * discussed"); they never suggest a diagnosis or what to say in therapy.
 */
import { contentWords } from './grounding';
import { scanTranscriptRisk } from './risk';
import type { TranscriptLine } from './diarization';

export type Cue = { id: string; kind: 'measure' | 'risk' | 'goal' | 'homework'; text: string; lineId?: string };

export type CueContext = {
  measuresDue: { instrument: string; detail: string }[];
  goals: { id: string; text: string }[];
  lastHomework: string | null;
};

/** Goal i is "discussed" when 2+ of its content words (stemmed) appear in the transcript. */
export function goalsDiscussed(lines: Pick<TranscriptLine, 'id' | 'text'>[], goals: CueContext['goals']): { goalId: string; index: number; lineId: string }[] {
  const out: { goalId: string; index: number; lineId: string }[] = [];
  goals.forEach((g, i) => {
    const words = [...new Set(contentWords(g.text).map((w) => w.slice(0, 5)))];
    if (words.length < 2) return;
    for (const l of lines) {
      const have = new Set(contentWords(l.text).map((w) => w.slice(0, 5)));
      if (words.filter((w) => have.has(w)).length >= 2) {
        out.push({ goalId: g.id, index: i, lineId: l.id });
        return;
      }
    }
  });
  return out;
}

export function liveCues(lines: TranscriptLine[], ctx: CueContext): Cue[] {
  const cues: Cue[] = [];
  const risk = scanTranscriptRisk(lines);
  const first = risk.findings[0];
  if (first) {
    const suicidal = risk.findings.some((f) => f.category === 'suicide' || f.category === 'self_harm');
    cues.push({
      id: 'risk',
      kind: 'risk',
      text: suicidal ? `Risk language heard at ${first.at}: consider the C-SSRS screener and safety plan` : `Risk language heard at ${first.at}: assess and document`,
      lineId: first.lineId,
    });
  }
  for (const m of ctx.measuresDue) cues.push({ id: `measure-${m.instrument}`, kind: 'measure', text: `${m.instrument} due (${m.detail})` });
  for (const g of goalsDiscussed(lines, ctx.goals)) cues.push({ id: `goal-${g.goalId}`, kind: 'goal', text: `Goal ${g.index + 1} discussed`, lineId: g.lineId });
  if (ctx.lastHomework && lines.length >= 6 && !lines.some((l) => /\bhomework|practice|assignment|worksheet|journal\b/i.test(l.text))) {
    cues.push({ id: 'homework', kind: 'homework', text: 'Last session\'s homework not reviewed yet' });
  }
  return cues;
}
