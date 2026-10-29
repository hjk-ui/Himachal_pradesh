/**
 * Deterministic (rule-based) pre-visit brief: bullets straight from the facts. Pure.
 * Used when AI is not allowed (consent declined, protected record), not configured, fails, or
 * its output does not survive grounding. Every phrase is a template filled from a fact.
 * Audience-first order: prescribers read medications and labs early, therapists notes and scores,
 * primary care medications, labs and the problem list.
 */
import type { PreVisitFacts, ScoreFact } from '@/lib/ai/previsit/facts';
import { NO_THERAPY_TEXT, VISIT_KIND_LABEL, type VisitRef } from '@/lib/ai/previsit/enrich';

export const RULE_MAX_BULLETS = 9;
/** Same cap as an AI bullet (validate.ts MAX_BULLET_CHARS) */
const MAX_RULE_BULLET_CHARS = 300;

function list(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; +${more} more` : '');
}

function scorePhrase(s: ScoreFact): string {
  const base = `${s.instrument} ${s.latest.score ?? 'n/a'}${s.latest.severity ? ` (${s.latest.severity})` : ''} on ${s.latest.date}`;
  if (!s.previous) return `${base}, first on file`;
  if (s.change == null || s.change === 0) return `${base}, unchanged from ${s.previous.date}`;
  const earlier = s.history.length > 2 ? ` (earlier ${s.history[0].score ?? 'n/a'} on ${s.history[0].date})` : '';
  return `${base}, ${s.change > 0 ? 'up' : 'down'} ${Math.abs(s.change)} from ${s.previous.score} on ${s.previous.date}${earlier}`;
}

const visitRef = (r: VisitRef | null) => (r ? `${r.date} (${r.type}${r.imported ? ', Valant' : ''})` : 'none on record');

type Section = 'safety' | 'visits' | 'diagnoses' | 'meds' | 'labs' | 'changes' | 'scores' | 'notes' | 'open';

const ORDER: Record<PreVisitFacts['audience'], Section[]> = {
  therapist: ['safety', 'visits', 'changes', 'scores', 'notes', 'open', 'diagnoses', 'meds'],
  prescriber: ['safety', 'visits', 'meds', 'labs', 'diagnoses', 'changes', 'scores', 'notes', 'open'],
  primary_care: ['safety', 'visits', 'meds', 'labs', 'diagnoses', 'changes', 'scores', 'notes', 'open'],
};

export function ruleBasedBullets(f: PreVisitFacts): string[] {
  const c = f.changes;
  const out: Partial<Record<Section, string>> = {};

  // Safety
  const safety: string[] = [`Risk level ${f.risk.level}`];
  if (f.risk.openAlerts) safety.push(`${f.risk.openAlerts} unreviewed risk alert(s)`);
  const cssrs = f.scores.find((s) => s.instrument === 'C-SSRS');
  if (f.risk.cssrsSafetyFlagged && cssrs) safety.push(`latest C-SSRS safety-flagged on ${cssrs.latest.date}`);
  if (c.newRiskAlerts.length) safety.push(`new alerts: ${list(c.newRiskAlerts.map((a) => `${a.type} (${a.severity}) ${a.date}`), 2)}`);
  if (c.crisisEpisodes.length) safety.push(`crisis episode(s): ${list(c.crisisEpisodes.map((e) => `${e.date} (${e.status})`), 2)}`);
  if (safety.length === 1) safety.push('no unreviewed risk alerts');
  out.safety = `${safety.join('; ')}.`;

  // Visits by type + next appointment + therapy frequency (says what it counts)
  const v = f.visits;
  const vis = [`Last therapy session: ${visitRef(v.last.therapy)} / Last med management: ${visitRef(v.last.medManagement)}`];
  if (v.last.primaryCare) vis[0] += ` / Last primary care: ${visitRef(v.last.primaryCare)}`;
  vis.push(v.next ? `next: ${v.next.date} ${v.next.type} (${VISIT_KIND_LABEL[v.next.kind]})` : 'nothing scheduled');
  if (f.sessionFrequency) vis.push(`${f.sessionFrequency.recommendation.toLowerCase()} therapy recommended: ${f.sessionFrequency.detail}`);
  else if (!v.last.therapy && (v.last.medManagement || v.last.primaryCare)) vis.push(NO_THERAPY_TEXT);
  out.visits = `${vis.join('; ')}.`;

  // Diagnoses
  if (f.diagnoses.length) out.diagnoses = `Diagnoses: ${list(f.diagnoses.map((d) => `${d.code ? `${d.code} ` : ''}${d.name}${d.primary ? ' (primary)' : ''}`), 4)}.`;

  // Medications
  if (f.currentMedications.length || f.recentMedChanges.length) {
    const meds = f.currentMedications.length
      ? `Current medications: ${list(f.currentMedications.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.sig ? ` ${m.sig}` : ''}`), 5)}`
      : 'No active medications on file';
    const ch = f.recentMedChanges.length ? `; recent changes: ${list(f.recentMedChanges.map((m) => `${m.change} ${m.name}${m.dose ? ` ${m.dose}` : ''} ${m.date}${m.fromDrFirst ? ' (DrFirst)' : ''}`), 3)}` : '';
    out.meds = `${meds}${ch}.`;
  } else if (f.audience !== 'therapist') out.meds = 'No active medications on file.';

  // Labs (prescriber / primary care)
  if (f.labs) {
    const lab: string[] = [];
    const results = f.labs.results ?? [];
    if (results.length) {
      lab.push(
        `Labs: ${list(
          results.map((r) => `${r.test} ${r.latest.value}${r.latest.unit ? ` ${r.latest.unit}` : ''}${r.latest.flag ? ` [${r.latest.flag}]` : ''} on ${r.latest.date}${r.history[1] ? ` (previous ${r.history[1].value} on ${r.history[1].date})` : ''}`),
          3
        )}`
      );
    } else if ((f.labs.fromDocuments ?? []).length) {
      lab.push(`Labs from chart documents: ${list((f.labs.fromDocuments ?? []).map((d) => `${d.text}${d.date ? ` (${d.date})` : ''}`), 2)}`);
    } else lab.push('No structured lab results on file');
    if ((f.labs.pending ?? []).length) lab.push(`pending: ${list((f.labs.pending ?? []).map((p) => `${p.tests} since ${p.orderedDate}`), 2)}`);
    const mon = f.labs.monitoring ?? [];
    if (mon.length) lab.push(`monitoring: ${list(mon.map((m) => `${m.test} for ${m.medication} ${m.state === 'overdue' ? `overdue (last ${m.lastDate})` : 'no result on file'}`), 3)}`);
    if (f.labs.due.length) lab.push(`standing labs ${list(f.labs.due.map((l) => `${l.tests.join(', ') || 'standing order'} ${l.state === 'overdue' ? 'overdue' : 'due'} ${l.dueDate}`), 2)}`);
    if (f.labs.resultsAwaitingReview) lab.push(`${f.labs.resultsAwaitingReview} lab result(s) awaiting review`);
    out.labs = `${lab.join('; ')}.`;
  }

  // Changes since last visit
  const since = f.lastVisit ? `Since the last visit on ${f.lastVisit.date}` : `Since ${f.since} (no completed visit on file)`;
  const ch: string[] = [];
  if (c.medsStarted.length) ch.push(`started ${list(c.medsStarted.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.fromDrFirst ? ' (DrFirst)' : ''} ${m.date}`))}`);
  if (c.medsStopped.length) ch.push(`stopped ${list(c.medsStopped.map((m) => `${m.name} ${m.date}`))}`);
  if (c.newProblems.length) ch.push(`new problem(s) ${list(c.newProblems.map((p) => `${p.name}${p.code ? ` (${p.code})` : ''}`))}`);
  if (c.newDiagnoses.length) ch.push(`new diagnosis ${list(c.newDiagnoses.map((d) => `${d.code ? `${d.code} ` : ''}${d.name} ${d.date}`), 2)}`);
  if (c.newScores.length) ch.push(`new scores: ${[...new Set(c.newScores.map((s) => s.instrument))].join(', ')}`);
  if (c.newDocuments.length) ch.push(`new documents ${list(c.newDocuments.map((d) => `${d.label} ${d.date}`), 2)}`);
  if (c.missedVisits.length) ch.push(`${c.missedVisits.length} missed or cancelled visit(s), latest ${c.missedVisits[0].date} (${c.missedVisits[0].status})`);
  out.changes = ch.length ? `${since}: ${ch.join('; ')}.` : `${since}: no medication, diagnosis, score, document or attendance changes recorded.`;

  // Scores
  const scored = f.scores.filter((s) => s.instrument !== 'C-SSRS' || !f.risk.cssrsSafetyFlagged);
  if (scored.length) out.scores = `${scored.map(scorePhrase).join('; ')}.`;
  else if (!f.scores.length) out.scores = 'No PHQ-9, GAD-7 or C-SSRS scores on file.';

  // Recent signed notes (audience-first kind), or imported notes not summarized yet
  const kindList = { therapy: f.notes.therapy, med_management: f.notes.medManagement, primary_care: f.notes.primaryCare } as const;
  const kindName = { therapy: 'therapy note', med_management: 'med management note', primary_care: 'primary care note' } as const;
  const firstKind = f.notes.order.find((k) => kindList[k].length);
  if (firstKind) {
    const n = kindList[firstKind][0];
    const sec = n.sections.find((s) => s.label === 'Plan / follow-up') ?? n.sections[0];
    const others = f.notes.order.filter((k) => k !== firstKind && kindList[k].length).map((k) => `last ${kindName[k]} ${kindList[k][0].date}`);
    out.notes = `Last ${kindName[firstKind]} ${n.date} (${n.type}${n.authorRole ? `, ${n.authorRole}` : ''})${sec ? `: ${sec.label}: ${sec.text}` : ''}${others.length ? `; ${others.join('; ')}` : ''}`;
  } else if (f.lastNotePlan) {
    const t = f.lastNotePlan.text.length > 200 ? `${f.lastNotePlan.text.slice(0, 199).trimEnd()}…` : f.lastNotePlan.text;
    out.notes = `Last note plan (${f.lastNotePlan.date}): ${t}`;
  } else if (f.notes.documents.length) {
    out.notes = `Imported notes not summarized yet: ${list(f.notes.documents.map((d) => `${d.label} ${d.date}`), 3)}.`;
  }

  // Plan review + open items
  const open: string[] = [];
  if (f.treatmentPlan) {
    const tp = f.treatmentPlan;
    if (tp.reviewState === 'overdue') open.push(`Treatment plan review overdue (due ${tp.reviewDueAt})`);
    else if (tp.reviewState === 'due_soon') open.push(`Treatment plan review due ${tp.reviewDueAt}`);
    else if (tp.reviewState === 'not_set') open.push(`Treatment plan ${tp.status.toLowerCase()} with no review date`);
    else open.push(`Treatment plan ${tp.status.toLowerCase()}, review due ${tp.reviewDueAt}`);
    if (tp.goals.length) open.push(`goal: ${tp.goals[0]}`);
  } else open.push('No active treatment plan on file');
  if (f.openItems.draftNotes) open.push(`${f.openItems.draftNotes} unsigned draft note(s)`);
  if (f.openItems.overdueNotes) open.push(`${f.openItems.overdueNotes} note(s) past the documentation deadline`);
  if (f.openItems.pendingConsents) open.push(`${f.openItems.pendingConsents} pending consent(s)`);
  if (f.openItems.overdueMeasures.length) open.push(`measures overdue: ${list(f.openItems.overdueMeasures.map((m) => m.instrument))}`);
  if (f.openItems.referrals.length) open.push(`open referral(s): ${list(f.openItems.referrals.map((r) => `${r.kind} (${r.status})`))}`);
  if (f.openItems.drFirstPending) open.push(`${f.openItems.drFirstPending} pending DrFirst request(s)`);
  if (f.openItems.sdohReferrals.length) open.push(`SDOH referral(s): ${list(f.openItems.sdohReferrals.map((r) => `${r.need} (${r.status})`))}`);
  out.open = `${open.join('; ')}.`;

  return ORDER[f.audience]
    .map((k) => out[k])
    .filter((b): b is string => Boolean(b))
    .map((b) => (b.length > MAX_RULE_BULLET_CHARS ? `${b.slice(0, MAX_RULE_BULLET_CHARS - 1).trimEnd()}…` : b))
    .slice(0, RULE_MAX_BULLETS);
}
