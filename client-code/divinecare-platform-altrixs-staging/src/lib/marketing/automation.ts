/**
 * Marketing automation engine (pure). A workflow is a trigger plus ordered steps. A run walks the
 * steps for one subject (lead, contact, event registration or review) and returns side-effect
 * ACTIONS for the service layer to apply (src/lib/marketing/service.ts). Nothing here sends.
 *
 * Safety rules built in:
 *  - Every send step goes through the consent gate (decideSend). Blocked = skipped and logged;
 *    quiet hours = the run waits until they end and retries the same step.
 *  - Lead workflows stop when the lead converts (now a client: clinical system only) or closes.
 *  - stop_if_responded ends a follow-up sequence once the lead has replied.
 *  - Bounded: at most MAX_STEPS_PER_TICK steps per tick, and step lists are capped.
 */
import { decideSend, renderTemplate, type BlockReason, type ConsentRecipient, type SendContext, type SendPurpose } from './consent';
import { LEAD_STAGE_KEYS } from './constants';

export const TRIGGER_TYPES = [
  { key: 'lead_created', label: 'New lead' },
  { key: 'stage_changed', label: 'Lead stage changes' },
  { key: 'no_response', label: 'No response from lead in X hours' },
  { key: 'intake_no_show', label: 'Lead missed intake (marked no-show)' },
  { key: 'event_registered', label: 'Event registration' },
  { key: 'event_attended', label: 'Event attendance marked' },
  { key: 'review_received', label: 'Review received' },
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number]['key'];

export type Trigger = {
  type: TriggerType;
  /** stage_changed: target stage */
  toStage?: string;
  /** lead_created: only these sources (empty = all) */
  sources?: string[];
  /** no_response: hours since last outbound without an inbound reply */
  hours?: number;
  /** review_received: only ratings at or below */
  maxRating?: number;
};

export const STEP_TYPES = [
  { key: 'send_sms', label: 'Send text (consent checked)' },
  { key: 'send_email', label: 'Send email (consent checked)' },
  { key: 'create_task', label: 'Create task' },
  { key: 'assign', label: 'Assign to staff' },
  { key: 'wait', label: 'Wait' },
  { key: 'wait_until_event', label: 'Wait until before the event' },
  { key: 'move_stage', label: 'Move lead stage' },
  { key: 'notify_staff', label: 'Notify staff' },
  { key: 'stop_if_responded', label: 'Stop if the lead replied' },
] as const;
export type StepType = (typeof STEP_TYPES)[number]['key'];

export type Step = {
  type: StepType;
  body?: string;
  subject?: string;
  templateId?: string;
  title?: string;
  dueInHours?: number;
  userId?: string;
  hours?: number;
  /** wait_until_event: hours before the event start */
  hoursBefore?: number;
  stage?: string;
  message?: string;
};

export type Workflow = { id: string; name: string; trigger: Trigger; steps: Step[]; active: boolean };

export type RunState = {
  stepIndex: number;
  status: 'active' | 'waiting' | 'completed' | 'stopped';
  waitUntil: Date | null;
  startedAt: Date;
  log: RunLogEntry[];
};

export type RunLogEntry = { at: string; step: number; type: string; result: string };

/** The subject the run acts on. Lead fields drive stop rules; recipient drives the consent gate. */
export type RunSubject = {
  kind: 'lead' | 'contact' | 'registration' | 'review';
  id: string;
  stage?: string | null;
  lastInboundAt?: Date | null;
  eventStartsAt?: Date | null;
  recipient?: ConsentRecipient | null;
  vars?: Record<string, string | null | undefined>;
};

export type Action =
  | { type: 'send'; channel: 'sms' | 'email'; to: string; body: string; subject?: string; purpose: SendPurpose; step: number }
  | { type: 'create_task'; title: string; dueAt: Date; step: number }
  | { type: 'assign'; userId: string | null; step: number }
  | { type: 'move_stage'; stage: string; step: number }
  | { type: 'notify_staff'; message: string; step: number }
  | { type: 'skipped_send'; channel: 'sms' | 'email'; reason: BlockReason; step: number };

export const MAX_STEPS = 20;
export const MAX_STEPS_PER_TICK = 10;
export const MAX_WAIT_HOURS = 24 * 60;

const CLOSED_LEAD = new Set(['converted', 'not_a_fit', 'lost']);

/** Validate a workflow definition from the builder. */
export function validateWorkflow(trigger: unknown, steps: unknown): { ok: true; trigger: Trigger; steps: Step[] } | { ok: false; error: string } {
  const t = trigger as Trigger;
  if (!t || !TRIGGER_TYPES.some((x) => x.key === t.type)) return { ok: false, error: 'Choose a trigger.' };
  if (t.type === 'stage_changed' && t.toStage && !(LEAD_STAGE_KEYS as string[]).includes(t.toStage)) return { ok: false, error: 'Unknown stage in trigger.' };
  if (t.type === 'stage_changed' && t.toStage === 'converted') return { ok: false, error: 'Converted leads are clients; client communication stays in the clinical system.' };
  if (t.type === 'no_response' && !(Number(t.hours) >= 1 && Number(t.hours) <= MAX_WAIT_HOURS)) return { ok: false, error: 'No-response trigger needs 1 to 1440 hours.' };
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, error: 'Add at least one step.' };
  if (steps.length > MAX_STEPS) return { ok: false, error: `At most ${MAX_STEPS} steps.` };
  const out: Step[] = [];
  for (const [i, raw] of (steps as Step[]).entries()) {
    if (!raw || !STEP_TYPES.some((x) => x.key === raw.type)) return { ok: false, error: `Step ${i + 1}: choose an action.` };
    if ((raw.type === 'send_sms' || raw.type === 'send_email') && !raw.body?.trim()) return { ok: false, error: `Step ${i + 1}: write the message.` };
    if (raw.type === 'send_email' && !raw.subject?.trim()) return { ok: false, error: `Step ${i + 1}: add a subject.` };
    if (raw.type === 'wait' && !(Number(raw.hours) > 0 && Number(raw.hours) <= MAX_WAIT_HOURS)) return { ok: false, error: `Step ${i + 1}: wait 1 to 1440 hours.` };
    if (raw.type === 'wait_until_event' && !(Number(raw.hoursBefore) >= 0 && Number(raw.hoursBefore) <= 24 * 14)) return { ok: false, error: `Step ${i + 1}: hours before the event (0 to 336).` };
    if (raw.type === 'move_stage' && !(raw.stage && (LEAD_STAGE_KEYS as string[]).includes(raw.stage) && raw.stage !== 'converted')) return { ok: false, error: `Step ${i + 1}: choose a stage (Convert stays manual).` };
    if (raw.type === 'create_task' && !raw.title?.trim()) return { ok: false, error: `Step ${i + 1}: name the task.` };
    if (raw.type === 'notify_staff' && !raw.message?.trim()) return { ok: false, error: `Step ${i + 1}: write the notification.` };
    if ((raw.type === 'move_stage' || raw.type === 'stop_if_responded' || raw.type === 'assign') && !['lead_created', 'stage_changed', 'no_response', 'intake_no_show'].includes(t.type)) {
      return { ok: false, error: `Step ${i + 1}: this action works only on lead workflows.` };
    }
    if (raw.type === 'wait_until_event' && !['event_registered'].includes(t.type)) return { ok: false, error: `Step ${i + 1}: wait-until-event works only on event registration workflows.` };
    out.push({ ...raw, body: raw.body?.trim(), subject: raw.subject?.trim(), title: raw.title?.trim(), message: raw.message?.trim() });
  }
  return { ok: true, trigger: t, steps: out };
}

/** Does this workflow start for the event? */
export function triggerMatches(
  t: Trigger,
  e: { type: TriggerType; source?: string | null; toStage?: string | null; rating?: number | null },
): boolean {
  if (t.type !== e.type) return false;
  if (t.type === 'lead_created' && t.sources?.length) return Boolean(e.source && t.sources.includes(e.source));
  if (t.type === 'stage_changed' && t.toStage) return e.toStage === t.toStage;
  if (t.type === 'review_received' && t.maxRating != null) return (e.rating ?? 5) <= t.maxRating;
  return true;
}

/** Purpose of sends in this workflow: lead workflows follow up on an inquiry; the rest is marketing. */
export function purposeFor(trigger: Trigger): SendPurpose {
  return ['lead_created', 'stage_changed', 'no_response', 'intake_no_show'].includes(trigger.type) ? 'lead_follow_up' : 'marketing';
}

export function newRun(now: Date): RunState {
  return { stepIndex: 0, status: 'active', waitUntil: null, startedAt: now, log: [] };
}

/**
 * Advance a run as far as it can go now. Returns the new state and the actions to apply.
 * Pure: same input, same output.
 */
export function advanceRun(
  workflow: Workflow,
  state: RunState,
  subject: RunSubject,
  ctx: SendContext,
): { state: RunState; actions: Action[] } {
  const s: RunState = { ...state, log: [...state.log] };
  const actions: Action[] = [];
  const now = ctx.now;
  const log = (step: number, type: string, result: string) => s.log.push({ at: now.toISOString(), step, type, result });

  if (s.status === 'completed' || s.status === 'stopped') return { state: s, actions };
  const purpose = purposeFor(workflow.trigger);

  for (let n = 0; n < MAX_STEPS_PER_TICK; n++) {
    if (subject.kind === 'lead' && subject.stage && CLOSED_LEAD.has(subject.stage)) {
      s.status = 'stopped';
      s.waitUntil = null;
      log(s.stepIndex, 'stop', subject.stage === 'converted' ? 'lead converted to client' : `lead closed (${subject.stage})`);
      return { state: s, actions };
    }
    if (s.stepIndex >= workflow.steps.length) {
      s.status = 'completed';
      s.waitUntil = null;
      return { state: s, actions };
    }
    const i = s.stepIndex;
    const step = workflow.steps[i];

    // Waiting (wait / wait_until_event / quiet hours deferral)
    if (s.waitUntil && s.waitUntil.getTime() > now.getTime()) {
      s.status = 'waiting';
      return { state: s, actions };
    }
    const resumedFromWait = Boolean(s.waitUntil);
    s.waitUntil = null;
    s.status = 'active';

    switch (step.type) {
      case 'wait': {
        if (!resumedFromWait) {
          s.waitUntil = new Date(now.getTime() + Number(step.hours) * 3600000);
          s.status = 'waiting';
          log(i, step.type, `waiting ${step.hours}h`);
          return { state: s, actions };
        }
        log(i, step.type, 'wait finished');
        break;
      }
      case 'wait_until_event': {
        const starts = subject.eventStartsAt;
        if (!starts) {
          log(i, step.type, 'no event date; skipped');
          break;
        }
        const at = new Date(starts.getTime() - Number(step.hoursBefore ?? 24) * 3600000);
        if (!resumedFromWait && at.getTime() > now.getTime()) {
          s.waitUntil = at;
          s.status = 'waiting';
          log(i, step.type, `waiting until ${at.toISOString()}`);
          return { state: s, actions };
        }
        if (starts.getTime() < now.getTime()) {
          s.status = 'stopped';
          log(i, step.type, 'event already started; stopped');
          return { state: s, actions };
        }
        log(i, step.type, 'reached');
        break;
      }
      case 'stop_if_responded': {
        if (subject.lastInboundAt && subject.lastInboundAt.getTime() >= s.startedAt.getTime()) {
          s.status = 'stopped';
          log(i, step.type, 'lead replied; sequence stopped');
          return { state: s, actions };
        }
        log(i, step.type, 'no reply yet');
        break;
      }
      case 'send_sms':
      case 'send_email': {
        const channel = step.type === 'send_sms' ? 'sms' : 'email';
        const recipient = subject.recipient;
        if (!recipient) {
          log(i, step.type, 'no recipient; skipped');
          actions.push({ type: 'skipped_send', channel, reason: channel === 'sms' ? 'no_phone' : 'no_email', step: i });
          break;
        }
        const d = decideSend(recipient, channel, purpose, ctx);
        if (d.ok === false) {
          if (d.reason === 'quiet_hours' && d.deferUntil) {
            s.waitUntil = d.deferUntil;
            s.status = 'waiting';
            log(i, step.type, 'quiet hours; deferred');
            return { state: s, actions };
          }
          log(i, step.type, `not sent: ${d.reason}`);
          actions.push({ type: 'skipped_send', channel, reason: d.reason, step: i });
          break;
        }
        const body = renderTemplate(step.body ?? '', subject.vars ?? {});
        const subj = step.subject ? renderTemplate(step.subject, subject.vars ?? {}) : undefined;
        actions.push({ type: 'send', channel, to: d.to, body, subject: subj, purpose, step: i });
        log(i, step.type, 'send queued');
        break;
      }
      case 'create_task':
        actions.push({ type: 'create_task', title: step.title ?? 'Follow up', dueAt: new Date(now.getTime() + Number(step.dueInHours ?? 0) * 3600000), step: i });
        log(i, step.type, 'task created');
        break;
      case 'assign':
        actions.push({ type: 'assign', userId: step.userId ?? null, step: i });
        log(i, step.type, 'assigned');
        break;
      case 'move_stage':
        if (subject.kind === 'lead' && step.stage && step.stage !== 'converted') {
          actions.push({ type: 'move_stage', stage: step.stage, step: i });
          log(i, step.type, `moved to ${step.stage}`);
        } else log(i, step.type, 'skipped');
        break;
      case 'notify_staff':
        actions.push({ type: 'notify_staff', message: step.message ?? 'Marketing automation', step: i });
        log(i, step.type, 'staff notified');
        break;
      default:
        log(i, String((step as Step).type), 'unknown step; skipped');
    }
    s.stepIndex = i + 1;
  }
  return { state: s, actions };
}

// ─── Pre-built recipes ─────────────────────────────────────────────────────────────────

export type Recipe = { key: string; name: string; description: string; trigger: Trigger; steps: Step[] };

export const RECIPES: Recipe[] = [
  {
    key: 'speed_to_lead',
    name: 'New lead: speed to lead',
    description: 'Instant text (if the lead opted in), a 15-minute call task for intake, and a staff alert.',
    trigger: { type: 'lead_created' },
    steps: [
      { type: 'send_sms', body: 'Hi {{firstName}}, thanks for contacting {{practiceName}}. Our intake team will call you shortly. If you need help right now, call or text 988.' },
      { type: 'create_task', title: 'Call new lead (speed to lead)', dueInHours: 0.25 },
      { type: 'notify_staff', message: 'New lead in the pipeline. Call within 15 minutes.' },
    ],
  },
  {
    key: 'three_touch',
    name: '3-touch follow-up',
    description: 'Day 1 text, day 3 email, day 6 final call task. Stops as soon as the lead replies or converts.',
    trigger: { type: 'lead_created' },
    steps: [
      { type: 'wait', hours: 24 },
      { type: 'stop_if_responded' },
      { type: 'send_sms', body: 'Hi {{firstName}}, this is {{practiceName}} following up on your request. Reply here or call {{practicePhone}} to talk with intake.' },
      { type: 'wait', hours: 48 },
      { type: 'stop_if_responded' },
      { type: 'send_email', subject: 'Following up on your request', body: 'Hi {{firstName}},\n\nWe wanted to follow up on your request to {{practiceName}}. When you are ready, call {{practicePhone}} or reply to this email and our intake team will help you get started.\n\nThank you,\n{{practiceName}}' },
      { type: 'wait', hours: 72 },
      { type: 'stop_if_responded' },
      { type: 'create_task', title: 'Final follow-up call, then close as Lost if no answer', dueInHours: 4 },
    ],
  },
  {
    key: 'intake_no_show',
    name: 'Missed intake re-engagement (leads only)',
    description: 'For leads who missed a scheduled intake before becoming clients: a gentle text and a call task.',
    trigger: { type: 'intake_no_show' },
    steps: [
      { type: 'move_stage', stage: 'contacted' },
      { type: 'send_sms', body: 'Hi {{firstName}}, we missed you today at {{practiceName}}. We would be glad to find another time. Call {{practicePhone}} or reply here.' },
      { type: 'create_task', title: 'Call to reschedule missed intake', dueInHours: 24 },
    ],
  },
  {
    key: 'event_reminder',
    name: 'Event reminder',
    description: 'Email reminder 24 hours before a community event to registrants who opted in.',
    trigger: { type: 'event_registered' },
    steps: [
      { type: 'wait_until_event', hoursBefore: 24 },
      { type: 'send_email', subject: 'Reminder: {{eventName}}', body: 'Hi {{firstName}},\n\nThis is a reminder that {{eventName}} is on {{eventDate}}. We look forward to seeing you.\n\n{{practiceName}}' },
    ],
  },
  {
    key: 'review_request_after_event',
    name: 'Review request after an event',
    description: 'Thank-you email with a review link to event attendees who opted in (community members, never patients unless authorized).',
    trigger: { type: 'event_attended' },
    steps: [
      { type: 'wait', hours: 24 },
      { type: 'send_email', subject: 'Thank you for joining {{eventName}}', body: 'Hi {{firstName}},\n\nThank you for joining us at {{eventName}}. If you have a minute, we would appreciate your feedback about the event: {{reviewLink}}\n\n{{practiceName}}' },
    ],
  },
  {
    key: 'negative_review_alert',
    name: 'Low-rating review alert',
    description: 'Alerts leadership and creates a task when a 1-3 star review arrives.',
    trigger: { type: 'review_received', maxRating: 3 },
    steps: [
      { type: 'notify_staff', message: 'A 1-3 star review arrived. Draft a HIPAA-safe reply in Reputation.' },
      { type: 'create_task', title: 'Respond to low-rating review (HIPAA-safe template)', dueInHours: 24 },
    ],
  },
];

/** Leads with no reply X hours after our last outbound (no_response trigger candidates). */
export function noResponseDue(
  lead: { stage: string; lastContactAt: Date | null; lastInboundAt: Date | null },
  hours: number,
  now: Date,
): boolean {
  if (CLOSED_LEAD.has(lead.stage)) return false;
  if (!lead.lastContactAt) return false;
  if (lead.lastInboundAt && lead.lastInboundAt.getTime() >= lead.lastContactAt.getTime()) return false;
  return now.getTime() - lead.lastContactAt.getTime() >= hours * 3600000;
}
