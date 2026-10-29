/**
 * Growth assistant (pure parts): PHI redaction before any model call, feature flags, and the
 * rules-based drafts used when Bedrock is not configured or a model draft fails a check.
 * Every output is a DRAFT that a person approves before it is used.
 */
import { AI_FEATURES, AWARENESS_MONTHS, leadStageLabel, type MarketingAiFeature } from './constants';
import { hasSudTerm } from './segments';

export function aiFeatureEnabled(flags: unknown, key: MarketingAiFeature): boolean {
  if (!flags || typeof flags !== 'object') return true;
  const v = (flags as Record<string, unknown>)[key];
  return v === undefined ? true : Boolean(v);
}

export const AI_FEATURE_KEYS = AI_FEATURES.map((f) => f.key) as MarketingAiFeature[];

/**
 * Strip identifiers before text leaves for the model: emails, phone numbers, dates, long numbers
 * (member ids), street addresses and the given names. Names are replaced with [name].
 */
export function redactForAi(text: string, names: (string | null | undefined)[] = []): string {
  let t = (text ?? '').slice(0, 2000);
  t = t.replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[email]');
  t = t.replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]');
  t = t.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date]');
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date]');
  t = t.replace(/\b\d{1,5}\s+([A-Z][a-z]+\s){1,3}(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)\b\.?/g, '[address]');
  t = t.replace(/\b\d{5,}\b/g, '[number]');
  for (const n of names) {
    for (const part of (n ?? '').split(/\s+/).filter((p) => p.length >= 2)) {
      t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[name]');
    }
  }
  return t;
}

/** Claims health marketing must avoid (FTC / state board rules): guarantees, cures, superlatives. */
const CLAIM_RES = [/\bguarantee[sd]?\b/i, /\bcure[sd]?\b/i, /\b100%/i, /\b(best|#1|number one) (therapist|psychiatrist|practice|clinic)\b/i, /\bno side effects\b/i, /\binstant(ly)? (relief|results)\b/i];

export function contentClaimIssues(text: string): string[] {
  const out: string[] = [];
  for (const re of CLAIM_RES) {
    const m = re.exec(text);
    if (m) out.push(m[0]);
  }
  return out;
}

/** Suicide / self-harm content must follow safe messaging guidelines and include 988. */
export function needsCrisisLine(text: string): boolean {
  return /\b(suicid\w*|self[- ]harm|kill (myself|themselves)|crisis)\b/i.test(text);
}

export function withCrisisLine(text: string): string {
  return /\b988\b/.test(text) ? text : `${text.trim()}\n\nIf you or someone you know is struggling, call or text 988 (Suicide & Crisis Lifeline).`;
}

// ─── Rules-based drafts ─────────────────────────────────────────────────────────────────

export function ruleSuggestedReplies(stage: string, practiceName: string, practicePhone?: string | null): string[] {
  const phone = practicePhone ? ` at ${practicePhone}` : '';
  const p = practiceName || 'our office';
  switch (stage) {
    case 'new':
      return [
        `Thank you for reaching out to ${p}. A member of our intake team will call you today. Is there a time that works best?`,
        `Thanks for contacting ${p}. We would be glad to help you get started. You can also call us${phone}.`,
      ];
    case 'contacted':
    case 'screening':
      return [
        `Thanks for getting back to us. Could you share a good time for a short intake call?`,
        `Thank you. To get you scheduled, please call our intake team${phone} or reply with a few times that work for you.`,
      ];
    case 'insurance_verified':
      return [
        `Good news: we were able to check your insurance. Let us know a day and time that work for your first appointment.`,
        `Thanks for your patience. We are ready to schedule your first visit. What days work best for you?`,
      ];
    case 'scheduled':
      return [`We look forward to meeting you. If you need to change your time, please call us${phone}.`];
    default:
      return [`Thank you for your message. Our team will follow up shortly. You can also call us${phone}.`];
  }
}

export function ruleSocialDraft(topic: string, channels: string[], practiceName: string): { caption: string; hashtags: string[]; imagePrompts: string[] } {
  const t = topic.trim() || 'mental health and wellbeing';
  let caption = `${t}: small steps count. At ${practiceName || 'our practice'}, we are here to help you and your family feel heard and supported. Reach out to learn more about our services.`;
  if (needsCrisisLine(t)) caption = withCrisisLine(caption);
  const base = ['#MentalHealth', '#Wellbeing', '#MarylandMentalHealth', '#YouAreNotAlone', '#CommunityCare'];
  const topical = t
    .split(/\s+/)
    .filter((w) => w.length > 3 && /^[a-z]+$/i.test(w))
    .slice(0, 2)
    .map((w) => `#${w[0].toUpperCase()}${w.slice(1).toLowerCase()}`);
  const hashtags = Array.from(new Set([...topical, ...base])).filter((h) => !hasSudTerm(h.slice(1))).slice(0, channels.includes('LinkedIn') ? 4 : 8);
  return {
    caption,
    hashtags,
    imagePrompts: [
      `Warm, natural-light photo of a diverse group of community members talking in a park, calm colors, no logos, no identifiable patients`,
      `Simple flat illustration about "${t}" using purple (#5C2D91) and gold (#D4A017) accents, plenty of white space for text`,
    ],
  };
}

export function rulePressRelease(input: { headline: string; facts: string; quote?: string; spokesperson?: string; city?: string; practiceName: string; date?: string; contact?: string }): string {
  const date = input.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const city = input.city || 'Bowie, Md.';
  const quote = input.quote?.trim()
    ? `\n\n"${input.quote.trim()}" said ${input.spokesperson?.trim() || 'a spokesperson for ' + input.practiceName}.`
    : '';
  return `FOR IMMEDIATE RELEASE\n\n${input.headline.trim()}\n\n${city.toUpperCase()} (${date}) - ${input.facts.trim()}${quote}\n\nAbout ${input.practiceName}\n${input.practiceName} provides outpatient behavioral health and primary care services in Bowie, Silver Spring and Baltimore, Maryland.\n\nMedia contact\n${input.contact?.trim() || '[name, phone, email]'}\n\n###`;
}

export function ruleLandingCopy(input: { service: string; location?: string; audience?: string; practiceName: string }): { headline: string; subheadline: string; bullets: string[]; cta: string; adVariants: string[]; complianceNotes: string[] } {
  const where = input.location ? ` in ${input.location}` : ' in Maryland';
  const svc = input.service.trim() || 'mental health care';
  return {
    headline: `${svc}${where}`,
    subheadline: `Compassionate, licensed care from ${input.practiceName}. Most major insurance plans accepted; ask our intake team.`,
    bullets: ['Licensed clinicians', 'In-person and telehealth visits', 'Evening appointments may be available', 'Help checking your insurance'],
    cta: 'Request an appointment',
    adVariants: [`${svc}${where} | ${input.practiceName}`, `Talk to someone who listens. ${svc}${where}.`, `New clients welcome. Request an appointment today.`],
    complianceNotes: [
      'No outcome guarantees or "cure" claims.',
      'Use testimonials only with a signed authorization on file.',
      'Do not place tracking pixels (Meta, Google Analytics) on pages with the intake form.',
      'Ads must not target people based on health conditions; addiction-treatment ads need platform certification (e.g. LegitScript) before running.',
    ],
  };
}

export type GrowthAggregates = {
  periodDays: number;
  leadsBySource: { source: string; leads: number; converted: number }[];
  stalledLeads: number;
  waitingFirstResponse: number;
  medianSpeedMinutes: number | null;
  speedTargetMinutes: number;
  quietPartners: string[];
  averageRating: number | null;
  newReviews: number;
  upcomingEvents: number;
};

export function ruleGrowthInsights(a: GrowthAggregates): string[] {
  const out: string[] = [];
  const top = [...a.leadsBySource].sort((x, y) => y.leads - x.leads)[0];
  if (top && top.leads) out.push(`${top.source} brought the most leads in the last ${a.periodDays} days (${top.leads}).`);
  const best = [...a.leadsBySource].filter((s) => s.leads >= 5).sort((x, y) => y.converted / y.leads - x.converted / x.leads)[0];
  if (best && best.converted) out.push(`${best.source} converts best. Consider putting more effort there.`);
  if (a.waitingFirstResponse) out.push(`${a.waitingFirstResponse} open lead(s) have not had a first response yet.`);
  if (a.medianSpeedMinutes != null && a.medianSpeedMinutes > a.speedTargetMinutes) out.push(`Median speed to lead is ${a.medianSpeedMinutes} minutes, above the ${a.speedTargetMinutes}-minute target. Turn on the speed-to-lead recipe.`);
  if (a.stalledLeads) out.push(`${a.stalledLeads} lead(s) have not moved stage in 7+ days. Review them or close as Lost.`);
  if (a.quietPartners.length) out.push(`Partners going quiet (no referral or touch in 60 days): ${a.quietPartners.slice(0, 5).join(', ')}.`);
  if (a.averageRating != null && a.averageRating < 4.2) out.push(`Average review rating is ${a.averageRating}. Ask event attendees and authorized contacts for feedback.`);
  if (a.newReviews) out.push(`${a.newReviews} new review(s) need a HIPAA-safe reply.`);
  if (!a.upcomingEvents) out.push('No community events on the calendar. Plan one for next month.');
  if (!out.length) out.push('Steady week. Keep responding quickly and logging partner touches.');
  return out;
}

export function contentCalendarSuggestions(month: number): { title: string; note: string; ideas: string[] }[] {
  const m = AWARENESS_MONTHS.filter((a) => a.month === month);
  return m.map((a) => ({
    title: a.title,
    note: a.note,
    ideas: [
      `Educational post: 3 facts about ${a.title.split('/')[0].trim()}`,
      'Staff spotlight (with the staff member’s written OK)',
      'Community event or partner shout-out',
      'Resource list: how to get started with care, plus 988 for crisis',
    ],
  }));
}

export function leadStageForPrompt(stage: string): string {
  return leadStageLabel(stage);
}
