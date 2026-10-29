/**
 * Clinical Insights — client drawer timeline (pure). Every event is a recorded fact with its date;
 * nothing is inferred. Newest first.
 */
import { INSTRUMENT_LABEL } from './rules';
import type { ClientFacts } from './types';

export type TimelineEvent = {
  date: string;
  kind: 'score' | 'screen' | 'crisis' | 'alert' | 'visit' | 'missed' | 'appointment' | 'plan' | 'social' | 'medication' | 'discharge';
  text: string;
};

export function clientTimeline(f: ClientFacts, max = 60): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const k of ['phq9', 'gad7', 'pcl5'] as const) {
    for (const p of f.scores[k]) out.push({ date: p.date, kind: 'score', text: `${INSTRUMENT_LABEL[k]} ${p.score}${p.source === 'valant' ? ' (Valant import)' : p.source === 'tms' ? ' (TMS course)' : ''}` });
  }
  if (f.cssrs) out.push({ date: f.cssrs.date, kind: 'screen', text: `C-SSRS ${f.cssrs.positive ? 'positive' : 'negative'} (latest screen)` });
  if (f.phq9SafetyFlagDate) out.push({ date: f.phq9SafetyFlagDate, kind: 'screen', text: 'PHQ-9 safety item flagged' });
  for (const c of f.crises) {
    out.push({ date: c.date, kind: 'crisis', text: `Crisis episode${c.followedUp7d === false ? ' — no follow-up within 7 days' : c.followedUp7d ? ' — followed up within 7 days' : ''}` });
  }
  for (const a of f.openAlerts) out.push({ date: a.date, kind: 'alert', text: `Unreviewed ${a.severity.toLowerCase()} risk alert (${a.type.replace(/_/g, ' ')})` });
  for (const r of f.riskLanguage.filter((x) => x.reviewed)) out.push({ date: r.date, kind: 'alert', text: `Risk-language watch hit (${r.severity.toLowerCase()}, reviewed)` });
  if (f.lastVisit) out.push({ date: f.lastVisit, kind: 'visit', text: 'Last attended visit' });
  for (const m of f.missedVisits) out.push({ date: m.date, kind: 'missed', text: m.status === 'NO_SHOW' ? 'No-show' : 'Late cancel' });
  if (f.nextAppointment) out.push({ date: f.nextAppointment, kind: 'appointment', text: 'Next scheduled appointment' });
  if (f.plan) {
    out.push({ date: f.plan.createdOn, kind: 'plan', text: `Treatment plan created (${f.plan.status === 'ACTIVE' ? 'active' : 'needs review'})` });
    if (f.plan.reviewDue) out.push({ date: f.plan.reviewDue, kind: 'plan', text: 'Treatment plan review due' });
  }
  for (const g of f.goalChips) out.push({ date: g.date, kind: 'plan', text: `Goal ${g.goal}: ${g.status}` });
  if (f.sdoh) out.push({ date: f.sdoh.date, kind: 'social', text: f.sdoh.domains.length ? `AHC HRSN positive: ${f.sdoh.domains.map((d) => d.replace(/_/g, ' ')).join(', ')}` : 'AHC HRSN: no positive domains' });
  for (const x of f.fillProblems) out.push({ date: x.date, kind: 'medication', text: 'Prescription not dispensed (DrFirst fill event)' });
  if (f.refillsPending.oldest) out.push({ date: f.refillsPending.oldest, kind: 'medication', text: `Refill request pending (${f.refillsPending.count})` });
  if (f.auth?.endDate) out.push({ date: f.auth.endDate, kind: 'social', text: 'Prior authorization ends' });
  if (f.discharge?.date) out.push({ date: f.discharge.date, kind: 'discharge', text: `Discharged${f.discharge.followUpDocumented ? ' (follow-up documented)' : ' (no follow-up documented)'}` });
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, max);
}
