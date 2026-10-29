import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { bestMatch, canMoveStage, clinicalTermsIn, matchPerson, nextFurthestStage, speedToLeadStatus } from '../src/lib/marketing/leads';
import { decideSend, quietHoursState, renderTemplate, toUsE164, withSmsFooter, withinBusinessHours, type SendContext } from '../src/lib/marketing/consent';
import { checkReviewResponse, enforceSafeReply, safeReviewResponse } from '../src/lib/marketing/reviewGuard';
import { abVariant, planAudience, validateSegment, type AudienceContact } from '../src/lib/marketing/segments';
import { advanceRun, newRun, noResponseDue, RECIPES, triggerMatches, validateWorkflow, type RunSubject, type Workflow } from '../src/lib/marketing/automation';
import { eventRoi, partnerLeaderboard, rate, sourceReport, speedSummary, stageFunnel, suppress, type AttributionLead } from '../src/lib/marketing/attribution';
import { embedSnippet, FORM_RATE_LIMIT, isSpam, normalizeFormFields, STANDARD_FIELDS, urlHasPhi, validateSubmission } from '../src/lib/marketing/forms';
import { marketingUnsubscribeToken, readMarketingUnsubscribeToken } from '../src/lib/marketing/tokens';
import { redactForAi, ruleSocialDraft, aiFeatureEnabled } from '../src/lib/marketing/aiTemplates';
import { applyMarketingInbound } from '../src/lib/marketing/inboundHook';
import { rateLimit } from '../src/lib/security/rateLimit';
import { canAccessApiPath, canAccessPath, CLINIC_NAV_HREFS } from '../src/lib/auth/roleAccess';
import { buildNavForRole } from '../src/components/layout/navConfig';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Noon Eastern on a weekday (outside quiet hours) and 23:00 Eastern (inside)
const NOON = new Date('2026-10-21T16:00:00Z');
const NIGHT = new Date('2026-10-22T03:00:00Z');
const ctx = (now = NOON, extra: Partial<SendContext> = {}): SendContext => ({ now, timeZone: 'America/New_York', quietHoursStart: '20:00', quietHoursEnd: '09:00', physicalAddress: '123 Main St, Bowie, MD 20715', ...extra });

// ─── Leads: dedupe and stage rules ───────────────────────────────────────────────────────

test('dedupe: two of name / DOB / phone is strong; phone alone is possible; basis never carries data', () => {
  const lead = { firstName: 'Ana', lastName: "O'Neil", dateOfBirth: '1990-04-02', phone: '(301) 555-0101' };
  assert.deepEqual(matchPerson(lead, { name: 'ana oneil', dateOfBirth: new Date('1990-04-02T00:00:00Z'), phone: null }), { level: 'strong', basis: 'name and date of birth' });
  assert.equal(matchPerson(lead, { name: 'Someone Else', dateOfBirth: '1990-04-02', phone: '+1 301-555-0101' })?.level, 'strong');
  assert.deepEqual(matchPerson(lead, { name: 'Other Person', dateOfBirth: '1980-01-01', phone: '3015550101' }), { level: 'possible', basis: 'phone' });
  assert.equal(matchPerson(lead, { name: 'Ana ONeil', dateOfBirth: '1991-01-01', phone: null }), null, 'same name, different DOB is not a match');
  assert.equal(matchPerson({ firstName: 'Ana', lastName: 'Oneil' }, { name: 'Ana Oneil' })?.level, 'possible');
  assert.equal(bestMatch(lead, [{ name: 'X', phone: '3015550101' }, { name: 'Ana Oneil', dateOfBirth: '1990-04-02' }])?.level, 'strong');
  const m = matchPerson(lead, { name: 'ana oneil', dateOfBirth: '1990-04-02' });
  assert.ok(!/ana|1990|0101/i.test(m!.basis));
});

test('stage rules: convert only via Convert, closing needs a reason, converted is final, reopen to New/Contacted', () => {
  assert.equal(canMoveStage('new', 'contacted').ok, true);
  assert.equal(canMoveStage('scheduled', 'screening').ok, true, 'back moves allowed');
  assert.equal(canMoveStage('screening', 'converted').ok, false);
  assert.equal(canMoveStage('screening', 'converted', { viaConvert: true }).ok, true);
  assert.equal(canMoveStage('screening', 'lost').ok, false);
  assert.equal(canMoveStage('screening', 'lost', { reason: 'No response' }).ok, true);
  assert.equal(canMoveStage('converted', 'contacted').ok, false);
  assert.equal(canMoveStage('lost', 'scheduled').ok, false);
  assert.equal(canMoveStage('lost', 'contacted').ok, true);
  assert.equal(canMoveStage('lost', 'converted', { viaConvert: true }).ok, false);
  assert.equal(canMoveStage('new', 'bogus').ok, false);
  assert.equal(nextFurthestStage('screening', 'contacted'), 'screening');
  assert.equal(nextFurthestStage('screening', 'scheduled'), 'scheduled');
  assert.equal(nextFurthestStage('scheduled', 'lost'), 'scheduled');
});

test('speed to lead timer and minimum-necessary note guard', () => {
  const created = new Date('2026-10-21T15:00:00Z');
  assert.deepEqual(speedToLeadStatus({ createdAt: created }, 15, new Date('2026-10-21T15:20:00Z')), { minutes: 20, responded: false, overdue: true });
  assert.deepEqual(speedToLeadStatus({ createdAt: created, firstResponseAt: new Date('2026-10-21T15:05:00Z') }, 15, NOON), { minutes: 5, responded: true, overdue: false });
  assert.ok(clinicalTermsIn('Wants Zoloft refill, history of bipolar').length >= 2);
  assert.deepEqual(clinicalTermsIn('Prefers evening calls, Bowie office'), []);
});

// ─── Consent gating ──────────────────────────────────────────────────────────────────────

test('SMS: explicit consent, STOP, valid number, quiet hours defer (never drop)', () => {
  const r = { phone: '301-555-0101', smsConsent: true };
  assert.deepEqual(decideSend(r, 'sms', 'lead_follow_up', ctx()), { ok: true, to: '+13015550101' });
  assert.equal((decideSend({ ...r, smsConsent: false }, 'sms', 'lead_follow_up', ctx()) as { reason: string }).reason, 'no_sms_consent');
  assert.equal((decideSend({ ...r, smsOptOutAt: new Date() }, 'sms', 'lead_follow_up', ctx()) as { reason: string }).reason, 'sms_opted_out');
  assert.equal((decideSend({ ...r, phone: '555' }, 'sms', 'lead_follow_up', ctx()) as { reason: string }).reason, 'invalid_phone');
  const night = decideSend(r, 'sms', 'lead_follow_up', ctx(NIGHT));
  assert.equal(night.ok, false);
  assert.equal((night as { reason: string }).reason, 'quiet_hours');
  assert.equal((night as { deferUntil: Date }).deferUntil.toISOString(), '2026-10-22T13:00:00.000Z', 'deferred to 9:00 Eastern');
  assert.deepEqual(quietHoursState(ctx(NOON)), { quiet: false, endsAt: null });
  assert.equal(withSmsFooter('Hi there.'), 'Hi there. Reply STOP to opt out.');
  assert.equal(withSmsFooter('Hi. Reply STOP to opt out.'), 'Hi. Reply STOP to opt out.');
  assert.equal(toUsE164('+1 (240) 555-0199'), '+12405550199');
  assert.equal(toUsE164('123-555-0199'), null);
});

test('email: marketing needs opt-in + CAN-SPAM address; inquiry follow-up needs contact consent; unsubscribe wins', () => {
  const r = { email: 'a@example.org', emailConsent: true };
  assert.equal(decideSend(r, 'email', 'marketing', ctx()).ok, true);
  assert.equal((decideSend({ ...r, emailConsent: false }, 'email', 'marketing', ctx()) as { reason: string }).reason, 'no_email_consent');
  assert.equal((decideSend(r, 'email', 'marketing', ctx(NOON, { physicalAddress: '' })) as { reason: string }).reason, 'no_physical_address');
  assert.equal((decideSend({ ...r, emailOptOutAt: new Date() }, 'email', 'marketing', ctx()) as { reason: string }).reason, 'email_opted_out');
  assert.equal(decideSend({ email: 'a@example.org', contactConsent: true }, 'email', 'lead_follow_up', ctx(NOON, { physicalAddress: '' })).ok, true);
  assert.equal((decideSend({ email: 'a@example.org' }, 'email', 'lead_follow_up', ctx()) as { reason: string }).reason, 'no_contact_consent');
  assert.equal(decideSend(r, 'email', 'marketing', ctx(NIGHT)).ok, true, 'quiet hours are for texts');
});

test('HIPAA marketing authorization: clients need a valid one; converted leads leave the marketing system', () => {
  const client = { email: 'c@example.org', emailConsent: true, phone: '3015550101', smsConsent: true, isClient: true };
  assert.equal((decideSend(client, 'email', 'marketing', ctx()) as { reason: string }).reason, 'no_marketing_authorization');
  assert.equal(decideSend({ ...client, marketingAuthorizationAt: '2026-01-01' }, 'email', 'marketing', ctx()).ok, true);
  assert.equal((decideSend({ ...client, marketingAuthorizationAt: '2026-01-01', marketingAuthorizationExpiresAt: '2026-06-01' }, 'sms', 'marketing', ctx()) as { reason: string }).reason, 'marketing_authorization_expired');
  assert.equal((decideSend({ ...client, marketingAuthorizationAt: '2026-01-01', marketingAuthorizationRevokedAt: '2026-02-01' }, 'email', 'marketing', ctx()) as { reason: string }).reason, 'marketing_authorization_revoked');
  assert.equal(decideSend({ ...client, contactConsent: true }, 'sms', 'lead_follow_up', ctx()).ok, false, 'converted lead: no lead follow-ups');
});

test('inquiry auto-reply: only within 24h of an inbound message, STOP still honored', () => {
  const r = { phone: '3015550101', smsConsent: false, lastInboundAt: new Date(NOON.getTime() - 3600000) };
  assert.equal(decideSend(r, 'sms', 'inquiry_reply', ctx()).ok, true);
  assert.equal(decideSend(r, 'sms', 'inquiry_reply', ctx(NIGHT)).ok, true, 'a reply to their own text is not held for quiet hours');
  assert.equal((decideSend({ ...r, lastInboundAt: new Date(NOON.getTime() - 26 * 3600000) }, 'sms', 'inquiry_reply', ctx()) as { reason: string }).reason, 'no_recent_inbound');
  assert.equal((decideSend({ ...r, smsOptOutAt: new Date() }, 'sms', 'inquiry_reply', ctx()) as { reason: string }).reason, 'sms_opted_out');
});

test('segments: no clinical fields, no SUD targeting, clients only with authorization', () => {
  assert.equal(validateSegment({ kinds: ['newsletter'], diagnosis: ['F32'] }).ok, false);
  assert.equal(validateSegment({ kinds: ['newsletter'], appointmentStatus: 'no_show' }).ok, false);
  assert.equal(validateSegment({ tags: ['Opioid recovery'] }).ok, false);
  assert.equal(validateSegment({ tags: ['MAT'] }).ok, false);
  assert.equal(validateSegment({ tags: ['matters'] }).ok, true);
  assert.equal(validateSegment({}).ok, false);
  const base = { tags: [], createdAt: new Date('2026-01-01'), emailConsent: true, email: 'x@example.org' };
  const contacts: AudienceContact[] = [
    { ...base, id: 'n1', name: 'News', kind: 'newsletter' },
    { ...base, id: 'c1', name: 'Client no auth', kind: 'client_authorized', clientId: 'cl1' },
    { ...base, id: 'c2', name: 'Client auth', kind: 'client_authorized', clientId: 'cl2', marketingAuthorizationAt: new Date('2026-01-01') },
    { ...base, id: 'n2', name: 'Unsubscribed', kind: 'newsletter', emailOptOutAt: new Date() },
  ];
  const seg = validateSegment({ kinds: ['newsletter', 'client_authorized'] });
  assert.ok(seg.ok);
  const plan = planAudience(contacts, (seg as unknown as { segment: never }).segment, 'email', ctx());
  assert.equal(plan.matched, 4);
  assert.deepEqual(plan.sendable.map((s) => s.id).sort(), ['c2', 'n1']);
  assert.deepEqual(plan.blocked.map((b) => b.reason).sort(), ['email_opted_out', 'no_marketing_authorization']);
  assert.equal(abVariant(0, true), 'A');
  assert.equal(abVariant(1, true), 'B');
  assert.equal(abVariant(1, false), 'A');
});

// ─── Review responses ────────────────────────────────────────────────────────────────────

test('review guard: never confirms a patient relationship, names, conditions or dates', () => {
  const bad = [
    'Thank you John, we are glad your therapist helped!',
    'We are sorry about the wait during your appointment.',
    'As our patient you deserve better.',
    'We hope your anxiety is improving.',
    'Sorry about your visit on Monday.',
    'Our records show you were seen on 3/4.',
  ];
  for (const t of bad) assert.ok(checkReviewResponse(t, { reviewerName: 'John Smith' }).length > 0, t);
  assert.ok(checkReviewResponse('Thanks Smith', { reviewerName: 'John Smith' }).some((i) => i.code === 'reviewer_name'));
  const good = 'Thank you for your feedback. We take every comment seriously. Please call our office at (301) 555-0100 so we can listen.';
  assert.deepEqual(checkReviewResponse(good, { allowedContacts: ['301-555-0100'] }), []);
  assert.ok(checkReviewResponse(good).some((i) => i.code === 'contact_detail'), 'a phone number that is not the practice is flagged');
  for (const rating of [1, 3, 5]) {
    const t = safeReviewResponse(rating, { practiceName: 'Divine Counseling', officePhone: '301-555-0100' });
    assert.deepEqual(checkReviewResponse(t, { reviewerName: 'Pat Lee', allowedContacts: ['301-555-0100'] }), [], `template ${rating}`);
  }
  const replaced = enforceSafeReply('So glad your sessions with Dr. Lee helped your depression!', { rating: 5, authorName: 'Pat' }, { practiceName: 'Divine Counseling' });
  assert.equal(replaced.replaced, true);
  assert.ok(!/session|depression|Lee/i.test(replaced.text));
  assert.equal(enforceSafeReply('Thank you for sharing your feedback about our community events.', { rating: 5 }, { practiceName: 'X' }).replaced, false);
});

// ─── Automation engine ───────────────────────────────────────────────────────────────────

const wf = (steps: Workflow['steps'], trigger: Workflow['trigger'] = { type: 'lead_created' }): Workflow => ({ id: 'w', name: 'w', trigger, steps, active: true });
const lead = (extra: Partial<RunSubject> = {}): RunSubject => ({ kind: 'lead', id: 'l1', stage: 'new', lastInboundAt: null, recipient: { phone: '3015550101', smsConsent: true, email: 'l@example.org', contactConsent: true }, vars: { firstName: 'Ana', practiceName: 'Divine Counseling' }, ...extra });

test('engine: sends through the consent gate, waits, resumes, and finishes', () => {
  const w = wf([{ type: 'send_sms', body: 'Hi {{firstName}} from {{practiceName}}' }, { type: 'wait', hours: 24 }, { type: 'create_task', title: 'Call', dueInHours: 1 }]);
  const a = advanceRun(w, newRun(NOON), lead(), ctx());
  assert.equal(a.actions[0].type, 'send');
  assert.equal((a.actions[0] as { body: string }).body, 'Hi Ana from Divine Counseling');
  assert.equal((a.actions[0] as { to: string }).to, '+13015550101');
  assert.equal(a.state.status, 'waiting');
  assert.equal(a.state.stepIndex, 1);
  const early = advanceRun(w, a.state, lead(), ctx(new Date(NOON.getTime() + 3600000)));
  assert.equal(early.actions.length, 0);
  assert.equal(early.state.status, 'waiting');
  const later = advanceRun(w, a.state, lead(), ctx(new Date(NOON.getTime() + 25 * 3600000)));
  assert.equal(later.actions[0].type, 'create_task');
  assert.equal(later.state.status, 'completed');
});

test('engine: blocked sends are skipped and logged; quiet hours defer the same step', () => {
  const w = wf([{ type: 'send_sms', body: 'Hi' }, { type: 'notify_staff', message: 'n' }]);
  const noConsent = advanceRun(w, newRun(NOON), lead({ recipient: { phone: '3015550101', smsConsent: false } }), ctx());
  assert.deepEqual(noConsent.actions.map((x) => x.type), ['skipped_send', 'notify_staff']);
  assert.equal((noConsent.actions[0] as { reason: string }).reason, 'no_sms_consent');
  const night = advanceRun(w, newRun(NIGHT), lead(), ctx(NIGHT));
  assert.equal(night.actions.length, 0);
  assert.equal(night.state.status, 'waiting');
  assert.equal(night.state.stepIndex, 0, 'same step retried after quiet hours');
  const morning = advanceRun(w, night.state, lead(), ctx(new Date('2026-10-22T13:05:00Z')));
  assert.deepEqual(morning.actions.map((x) => x.type), ['send', 'notify_staff']);
});

test('engine: stops when the lead converts / closes, and stop_if_responded ends follow-ups', () => {
  const w = wf([{ type: 'wait', hours: 1 }, { type: 'stop_if_responded' }, { type: 'send_sms', body: 'x' }]);
  const s1 = advanceRun(w, newRun(NOON), lead(), ctx()).state;
  const conv = advanceRun(w, s1, lead({ stage: 'converted' }), ctx(new Date(NOON.getTime() + 2 * 3600000)));
  assert.equal(conv.state.status, 'stopped');
  assert.equal(conv.actions.length, 0);
  const replied = advanceRun(w, s1, lead({ lastInboundAt: new Date(NOON.getTime() + 600000) }), ctx(new Date(NOON.getTime() + 2 * 3600000)));
  assert.equal(replied.state.status, 'stopped');
  assert.equal(replied.actions.length, 0);
  const quiet = advanceRun(w, s1, lead(), ctx(new Date(NOON.getTime() + 2 * 3600000)));
  assert.equal(quiet.actions[0].type, 'send');
});

test('engine: event reminder waits until 24h before; marketing purpose for event / review workflows', () => {
  const r = RECIPES.find((x) => x.key === 'event_reminder')!;
  const starts = new Date(NOON.getTime() + 5 * 24 * 3600000);
  const subject: RunSubject = { kind: 'contact', id: 'c', eventStartsAt: starts, recipient: { email: 'a@example.org', emailConsent: true }, vars: { firstName: 'Ana', eventName: 'Wellness Fair' } };
  const a = advanceRun(wf(r.steps, r.trigger), newRun(NOON), subject, ctx());
  assert.equal(a.state.status, 'waiting');
  assert.equal(a.state.waitUntil?.toISOString(), new Date(starts.getTime() - 24 * 3600000).toISOString());
  const b = advanceRun(wf(r.steps, r.trigger), a.state, subject, ctx(new Date(starts.getTime() - 23 * 3600000)));
  assert.equal(b.actions[0].type, 'send');
  assert.equal((b.actions[0] as { purpose: string }).purpose, 'marketing');
  const noOptIn = advanceRun(wf(r.steps, r.trigger), a.state, { ...subject, recipient: { email: 'a@example.org', emailConsent: false } }, ctx(new Date(starts.getTime() - 23 * 3600000)));
  assert.equal(noOptIn.actions[0].type, 'skipped_send');
});

test('workflow validation + every recipe is valid; triggers and no-response rule', () => {
  for (const r of RECIPES) assert.equal(validateWorkflow(r.trigger, r.steps).ok, true, r.key);
  assert.equal(validateWorkflow({ type: 'stage_changed', toStage: 'converted' }, [{ type: 'notify_staff', message: 'x' }]).ok, false);
  assert.equal(validateWorkflow({ type: 'lead_created' }, [{ type: 'move_stage', stage: 'converted' }]).ok, false);
  assert.equal(validateWorkflow({ type: 'event_registered' }, [{ type: 'move_stage', stage: 'lost' }]).ok, false);
  assert.equal(validateWorkflow({ type: 'lead_created' }, [{ type: 'send_email', body: 'x' }]).ok, false, 'email needs subject');
  assert.equal(validateWorkflow({ type: 'lead_created' }, []).ok, false);
  assert.equal(triggerMatches({ type: 'lead_created', sources: ['website_form'] }, { type: 'lead_created', source: 'phone' }), false);
  assert.equal(triggerMatches({ type: 'review_received', maxRating: 3 }, { type: 'review_received', rating: 2 }), true);
  assert.equal(triggerMatches({ type: 'review_received', maxRating: 3 }, { type: 'review_received', rating: 5 }), false);
  const t = new Date('2026-10-20T12:00:00Z');
  assert.equal(noResponseDue({ stage: 'contacted', lastContactAt: t, lastInboundAt: null }, 24, NOON), true);
  assert.equal(noResponseDue({ stage: 'contacted', lastContactAt: t, lastInboundAt: new Date('2026-10-20T13:00:00Z') }, 24, NOON), false);
  assert.equal(noResponseDue({ stage: 'converted', lastContactAt: t, lastInboundAt: null }, 24, NOON), false);
});

// ─── Attribution ─────────────────────────────────────────────────────────────────────────

test('attribution: funnel, cost per lead, small-cell suppression, speed, partners, events', () => {
  const at = (source: string, stage: string, furthest: string, extra: Partial<AttributionLead> = {}): AttributionLead => ({ source, stage, furthestStage: furthest, createdAt: new Date('2026-10-01T12:00:00Z'), ...extra });
  const leads: AttributionLead[] = [
    ...Array.from({ length: 12 }, (_, i) => at('website_form', 'converted', 'converted', { convertedAt: new Date(), firstAppointmentAt: new Date(), firstResponseAt: new Date(`2026-10-01T12:${String(i * 2).padStart(2, '0')}:00Z`) })),
    ...Array.from({ length: 8 }, () => at('website_form', 'lost', 'contacted')),
    at('phone', 'converted', 'converted', { convertedAt: new Date(), partnerId: 'p1' }),
    at('phone', 'new', 'new', { partnerId: 'p1' }),
  ];
  const rows = sourceReport(leads, [{ channel: 'Website form', month: '2026-10', amountCents: 40000 }], 11);
  const web = rows.find((r) => r.source === 'website_form')!;
  assert.equal(web.leads, 20);
  assert.equal(web.converted.display, '12');
  assert.equal(web.conversionRate, 60);
  assert.equal(web.costPerLeadCents, 2000);
  assert.equal(web.costPerConversionCents, 3333);
  const phone = rows.find((r) => r.source === 'phone')!;
  assert.equal(phone.converted.display, '<11');
  assert.equal(phone.conversionRate, null, 'suppressed cell hides its rate');
  assert.deepEqual(suppress(0, 11), { value: 0, display: '0', suppressed: false });
  assert.equal(rate(1, 3), 33.3);
  assert.equal(rate(1, 0), null);
  const f = stageFunnel(leads);
  assert.equal(f[0].count, 22);
  assert.equal(f.find((x) => x.stage === 'contacted')!.count, 21);
  assert.equal(f.find((x) => x.stage === 'converted')!.count, 13);
  const sp = speedSummary(leads, 15);
  assert.equal(sp.responded, 12);
  assert.equal(sp.medianMinutes, 11);
  assert.equal(sp.waiting, 1);
  const lb = partnerLeaderboard(leads, [{ id: 'p1', name: 'Bowie High', lastTouchAt: null }, { id: 'p2', name: 'Quiet Church', lastTouchAt: null }], 11, NOON);
  assert.equal(lb[0].name, 'Bowie High');
  assert.equal(lb[0].leads, 2);
  assert.equal(lb[0].converted.display, '<11');
  assert.equal(lb[1].quiet, true);
  const roi = eventRoi([{ id: 'e1', title: 'Fair', costCents: 5000, registrations: 30, attended: 20 }], [at('community_event', 'new', 'new', { eventId: 'e1' }), at('community_event', 'new', 'new', { eventId: 'e1' })], 11);
  assert.equal(roi[0].costPerLeadCents, 2500);
});

// ─── Public forms ────────────────────────────────────────────────────────────────────────

test('public form: honeypot / fill-time spam checks, validation, no PHI in URLs, iframe embed only', () => {
  const now = Date.now();
  assert.equal(isSpam({ honeypot: 'http://spam', renderedAt: now - 10000, now }), true);
  assert.equal(isSpam({ honeypot: '', renderedAt: now - 1000, now }), true, 'too fast');
  assert.equal(isSpam({ renderedAt: null, now }), true);
  assert.equal(isSpam({ honeypot: '', renderedAt: now - 10000, now }), false);
  const fields = normalizeFormFields([{ key: 'phone' }, { key: 'email' }, { key: 'smsConsent', required: true }, { key: 'evil', label: 'Reason for visit' }, { key: 'serviceInterest' }]);
  assert.deepEqual(fields.map((f) => f.key), ['firstName', 'lastName', 'phone', 'email', 'serviceInterest', 'contactConsent', 'smsConsent']);
  assert.equal(fields.find((f) => f.key === 'smsConsent')!.required, false, 'SMS consent is never required');
  assert.equal(STANDARD_FIELDS.some((f) => /reason|symptom|diagnos/i.test(f.key)), false);
  const bad = validateSubmission(fields, { firstName: 'A', lastName: '', phone: '12', contactConsent: false }, { serviceOptions: ['Therapy'] });
  assert.equal(bad.ok, false);
  assert.ok(['lastName', 'phone', 'contactConsent'].every((k) => k in (bad as { errors: Record<string, string> }).errors));
  const smsNoPhone = validateSubmission(fields, { firstName: 'A', lastName: 'B', email: 'a@b.co', contactConsent: true, smsConsent: true });
  assert.equal(smsNoPhone.ok, false);
  const good = validateSubmission(fields, { firstName: ' Ana ', lastName: 'Lee', phone: '301-555-0101', contactConsent: true, smsConsent: true, serviceInterest: 'Therapy', dateOfBirth: '1990-01-01' }, { serviceOptions: ['Therapy'] });
  assert.ok(good.ok);
  const v = (good as { value: { firstName: string; phone: string; smsConsent: boolean; dateOfBirth: string | null; source: string } }).value;
  assert.equal(v.firstName, 'Ana');
  assert.equal(v.phone, '+13015550101');
  assert.equal(v.smsConsent, true);
  assert.equal(v.dateOfBirth, null, 'DOB dropped when the form does not show it');
  assert.equal(v.source, 'website_form');
  assert.equal(validateSubmission(fields, { firstName: 'A', lastName: 'B', phone: '3015550101', contactConsent: true, serviceInterest: 'Hack' }, { serviceOptions: ['Therapy'] }).ok, false);
  assert.equal(urlHasPhi('/p/divine/intake/request?embed=1'), false);
  assert.equal(urlHasPhi('/p/divine/intake/request?email=a@b.co'), true);
  assert.equal(urlHasPhi('/p/divine/intake/request?dob=1990-01-01'), true);
  assert.equal(urlHasPhi('/p/divine/intake/3015550101'), true);
  const snip = embedSnippet('https://altrixs.com/', 'divine', 'request');
  assert.ok(snip.startsWith('<iframe src="https://altrixs.com/p/divine/intake/request?embed=1"'));
  assert.ok(!/<script/i.test(snip));
  assert.equal(urlHasPhi(snip.match(/src="([^"]+)"/)![1]), false);
});

test('public form rate limits: per form per IP, then per IP', () => {
  const key = `test-mkt-form:${Math.random()}`;
  const { limit, windowMs } = FORM_RATE_LIMIT.perForm;
  for (let i = 0; i < limit; i++) assert.equal(rateLimit(key, limit, windowMs).ok, true);
  assert.equal(rateLimit(key, limit, windowMs).ok, false);
  assert.ok(FORM_RATE_LIMIT.perIp.limit > FORM_RATE_LIMIT.perForm.limit);
  const route = read('src/app/api/marketing/public/forms/[org]/[form]/route.ts');
  assert.match(route, /FORM_RATE_LIMIT\.perIp/);
  assert.match(route, /FORM_RATE_LIMIT\.perForm/);
});

test('public pages: no tracking scripts, posts in the body, SMS box unchecked, 988 shown', () => {
  for (const p of ['src/app/p/[org]/intake/[form]/page.tsx', 'src/app/p/[org]/events/[slug]/page.tsx']) {
    const src = read(p);
    assert.ok(!/gtag|googletagmanager|fbq\(|connect\.facebook|analytics\.js|<Script/i.test(src), `${p} has a tracker`);
    assert.match(src, /method: 'POST'/);
    assert.match(src, /CrisisFooter/);
  }
  assert.match(read('src/app/p/[org]/intake/[form]/page.tsx'), /smsConsent: false/);
  assert.match(read('src/proxy.ts'), /\/api\/marketing\/public\//);
});

// ─── Tokens, AI redaction, inbound STOP ──────────────────────────────────────────────────

test('unsubscribe token round-trips and rejects tampering', () => {
  const t = marketingUnsubscribeToken('contact', 'ck123', 'secret');
  assert.deepEqual(readMarketingUnsubscribeToken(t, 'secret'), { kind: 'contact', id: 'ck123' });
  assert.equal(readMarketingUnsubscribeToken(t, 'other'), null);
  assert.equal(readMarketingUnsubscribeToken(`${t}x`, 'secret'), null);
  assert.equal(readMarketingUnsubscribeToken('garbage', 'secret'), null);
});

test('AI: identifiers redacted before any model call; drafts add 988 for crisis topics; flags default on', () => {
  const r = redactForAi('Hi I am Ana Lee, DOB 04/02/1990, call 301-555-0101 or ana@x.com, member 123456789, 12 Oak Street', ['Ana Lee']);
  assert.ok(!/Ana|Lee|04\/02|555-0101|ana@x|123456789|Oak Street/.test(r), r);
  assert.match(ruleSocialDraft('Suicide prevention month', ['Facebook'], 'Divine').caption, /988/);
  assert.ok(!ruleSocialDraft('Alcohol awareness', ['Facebook'], 'Divine').hashtags.some((h) => /alcohol/i.test(h)), 'no SUD hashtags');
  assert.equal(aiFeatureEnabled(null, 'reviewReply'), true);
  assert.equal(aiFeatureEnabled({ reviewReply: false }, 'reviewReply'), false);
  const ai = read('src/lib/marketing/ai.ts');
  assert.match(ai, /redactForAi/);
  assert.match(ai, /enforceSafeReply/);
  assert.match(ai, /marketingAiUsage/);
});

test('inbound STOP opts out marketing leads and contacts with that number; other replies join the lead thread', async () => {
  const leads = [{ id: 'l1', organizationId: 'o', phone: '+13015550101', stage: 'contacted', lastInboundAt: null, smsOptOutAt: null as Date | null }];
  const contacts = [{ id: 'c1', phone: '301-555-0101', smsOptOutAt: null as Date | null }];
  const messages: unknown[] = [];
  const db = {
    marketingLead: {
      findMany: async () => leads,
      updateMany: async ({ data }: { data: { smsOptOutAt: Date } }) => { leads.forEach((l) => (l.smsOptOutAt = data.smsOptOutAt)); return { count: 1 }; },
      update: async () => ({}),
    },
    marketingContact: {
      findMany: async () => contacts,
      updateMany: async ({ data }: { data: { smsOptOutAt: Date } }) => { contacts.forEach((c) => (c.smsOptOutAt = data.smsOptOutAt)); return { count: 1 }; },
    },
    marketingLeadActivity: { create: async () => ({}) },
    marketingMessage: { create: async (x: unknown) => { messages.push(x); return x; } },
  };
  const now = new Date();
  const stop = await applyMarketingInbound(db, { from: '+13015550101', keyword: 'stop', body: 'STOP', now });
  assert.equal(stop.leads, 1);
  assert.equal(leads[0].smsOptOutAt, now);
  assert.equal(contacts[0].smsOptOutAt, now);
  const other = await applyMarketingInbound(db, { from: '+13015550101', keyword: 'other', body: 'Can I come Tuesday?', now });
  assert.equal(other.recorded, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(await applyMarketingInbound({}, { from: '+13015550101', keyword: 'stop', body: 'STOP', now }), { leads: 0, contacts: 0, recorded: false, autoReplyLeadId: null }, 'tolerates databases without marketing tables');
  assert.match(read('src/lib/sms/inbound.ts'), /applyMarketingInbound/);
});

test('business hours and template rendering', () => {
  const hours = { wed: { open: '09:00', close: '17:00' } };
  assert.equal(withinBusinessHours(hours, 'America/New_York', NOON), true, 'Wed 12:00 ET');
  assert.equal(withinBusinessHours(hours, 'America/New_York', NIGHT), false, 'Wed 23:00 ET');
  assert.equal(renderTemplate('Hi {{firstName}}, {{unknown}}call {{practicePhone}}', { firstName: 'Ana', practicePhone: '301' }), 'Hi Ana, call 301');
});

// ─── Role access ─────────────────────────────────────────────────────────────────────────

test('role access: hub for leadership + Office Manager; lead inbox adds Front Desk; clinicians none', () => {
  const hub = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'];
  const leadsOnly = ['FRONT_DESK'];
  const none = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'BILLING', 'HR', 'CASE_MANAGER', 'PEER_SUPPORT', 'PRP_SPECIALIST', 'PHYSICIAN', 'MEDICAL_ASSISTANT', 'CRISIS_RESPONDER'];
  for (const r of hub) {
    assert.equal(canAccessPath(r, '/dashboard/marketing'), true, r);
    assert.equal(canAccessPath(r, '/dashboard/marketing/leads'), true, r);
    assert.equal(canAccessApiPath(r, '/api/marketing/campaigns', 'POST'), true, r);
    assert.equal(canAccessApiPath(r, '/api/marketing/leads', 'GET'), true, r);
  }
  for (const r of leadsOnly) {
    assert.equal(canAccessPath(r, '/dashboard/marketing'), false, r);
    assert.equal(canAccessPath(r, '/dashboard/marketing/leads'), true, r);
    assert.equal(canAccessApiPath(r, '/api/marketing/leads/abc/convert', 'POST'), true, r);
    assert.equal(canAccessApiPath(r, '/api/marketing/settings', 'GET'), false, r);
    assert.equal(canAccessApiPath(r, '/api/marketing/analytics', 'GET'), false, r);
  }
  for (const r of none) {
    assert.equal(canAccessPath(r, '/dashboard/marketing'), false, r);
    assert.equal(canAccessPath(r, '/dashboard/marketing/leads'), false, r);
    assert.equal(canAccessApiPath(r, '/api/marketing/leads', 'GET'), false, r);
    assert.equal(canAccessApiPath(r, '/api/marketing', 'GET'), false, r);
  }
  assert.ok(CLINIC_NAV_HREFS.includes('/dashboard/marketing' as never));
  const fd = buildNavForRole('FRONT_DESK').flatMap((s) => s.items.map((i) => i.href));
  assert.ok(fd.includes('/dashboard/marketing/leads'));
  assert.ok(!fd.includes('/dashboard/marketing'));
  const om = buildNavForRole('OFFICE_MANAGER').flatMap((s) => s.items);
  assert.ok(om.some((i) => i.href === '/dashboard/marketing' && i.group === 'Growth & Marketing'));
  assert.ok(!buildNavForRole('THERAPIST').flatMap((s) => s.items.map((i) => i.href)).some((h) => h.startsWith('/dashboard/marketing')));
});

test('marketing sender is the only new direct SMS caller and is allowlisted in the patient gate test', () => {
  assert.match(read('tests/sms-patient-gate.test.ts'), /src\/lib\/marketing\/send\.ts/);
  const send = read('src/lib/marketing/send.ts');
  assert.match(send, /decideSend/);
  assert.match(send, /sms_not_connected/);
  assert.match(send, /email_not_connected/);
});
