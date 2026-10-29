/**
 * Risk language watch: phrase lists. Pure data, browser-safe.
 *
 * Concepts follow the Columbia Suicide Severity Rating Scale (C-SSRS): wish to be dead (passive
 * ideation), non-specific active thoughts, method, intent, plan, preparatory behavior and actual /
 * interrupted / aborted attempts, plus non-suicidal self-injury. Homicidal language and
 * abuse / danger language (Danger Assessment lethality markers: threats to kill, weapons,
 * strangulation) are separate categories. Sources: docs/ai-risk-watch.md.
 *
 * Phrases are matched per sentence. Severity here is the base severity; context (a plan, means
 * or timing in the same or a neighbouring sentence, recency, the channel) can raise it in engine.ts.
 */

export type RiskCategory = 'suicide' | 'self_harm' | 'homicide' | 'abuse_danger' | 'hopelessness';

export type RiskConcept =
  | 'passive_ideation'
  | 'active_ideation'
  | 'method'
  | 'intent_plan'
  | 'preparatory'
  | 'attempt'
  | 'nssi'
  | 'homicidal_ideation'
  | 'homicidal_plan'
  | 'abuse'
  | 'abuse_lethal'
  | 'hopelessness';

export type RiskSeverity = 'high' | 'medium' | 'low';

export type PhraseDef = {
  id: string;
  category: RiskCategory;
  concept: RiskConcept;
  re: RegExp;
  severity: RiskSeverity;
  /**
   * Wording with common non-risk readings ("end it" with a partner, "hurt myself" at the gym,
   * "I want to kill my boss"). Only ambiguous low/medium hits are ever sent to the AI, and the
   * AI may only downgrade those.
   */
  ambiguous?: boolean;
  /** Behavior wording: recency decides HIGH vs history (see engine.ts) */
  behavior?: boolean;
};

export const CONCEPT_LABEL: Record<RiskConcept, string> = {
  passive_ideation: 'Passive suicidal ideation (wish to be dead)',
  active_ideation: 'Active suicidal ideation',
  method: 'Suicide method / means',
  intent_plan: 'Suicidal intent or plan',
  preparatory: 'Preparatory behavior',
  attempt: 'Suicide attempt',
  nssi: 'Self-harm',
  homicidal_ideation: 'Homicidal ideation',
  homicidal_plan: 'Homicidal plan / means',
  abuse: 'Abuse or danger at home',
  abuse_lethal: 'Abuse with lethality markers',
  hopelessness: 'Hopelessness',
};

export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  suicide: 'Suicide',
  self_harm: 'Self-harm',
  homicide: 'Harm to others',
  abuse_danger: 'Abuse / danger',
  hopelessness: 'Hopelessness',
};

const NOT_WANT = String.raw`(?:don['’]?t|do\s+not|doesn['’]?t|does\s+not|no\s+longer|never)\s+(?:really\s+)?want\s+to`;

export const PHRASES: PhraseDef[] = [
  // ── Suicide: intent / plan (C-SSRS q4–q5) ─────────────────────────────────────
  {
    id: 'intent-going-to',
    category: 'suicide',
    concept: 'intent_plan',
    severity: 'high',
    re: /\b(?:i['’]?m|i\s+am|im|i\s+will|i['’]?ll|i\s+(?:am\s+)?(?:going|gonna)\s+to|i['’]?m\s+(?:going|gonna)(?:\s+to)?|gonna|going\s+to|ready\s+to|decided\s+to|about\s+to)\s+(?:just\s+)?(?:kill\s+myself|end\s+(?:my\s+life|it\s+all|it\s+tonight)|take\s+my\s+(?:own\s+)?life|commit\s+suicide|unalive\s+myself)\b/i,
  },
  { id: 'plan-explicit', category: 'suicide', concept: 'intent_plan', severity: 'high', re: /\b(?:plan(?:s|ned|ning)?\s+(?:to|on)\s+(?:kill(?:ing)?\s+(?:my|him|her|them)sel(?:f|ves)|end(?:ing)?\s+(?:my|his|her|their)\s+life|commit(?:ting)?\s+suicide|overdos\w*|hang(?:ing)?\s+(?:my|him|her)self)|(?:si|suicidal\s+ideation|suicidal\s+thoughts?)\s+with\s+(?:a\s+)?(?:specific\s+)?(?:plan|intent))\b/i },
  { id: 'have-plan', category: 'suicide', concept: 'intent_plan', severity: 'high', re: /\b(?:i\s+(?:have|got|made)|(?:has|have|had)\s+(?:made\s+)?)\s+a\s+(?:suicide\s+)?plan\s+(?:to|for)\s+(?:kill|end|die|how)\b/i },
  { id: 'goodbye-note', category: 'suicide', concept: 'preparatory', severity: 'high', re: /\b(?:wr(?:ote|ite|iting)\s+(?:a|my)\s+(?:suicide|goodbye)\s+(?:note|letter)|suicide\s+note|said\s+(?:my\s+)?goodbyes?\s+to|this\s+is\s+(?:my\s+)?goodbye|giv(?:e|ing|en)\s+away\s+(?:all\s+)?(?:my|his|her)\s+(?:stuff|things|belongings|possessions))\b/i },
  { id: 'stockpile', category: 'suicide', concept: 'preparatory', severity: 'high', re: /\b(?:stockpil\w*|hoard(?:ing|ed)?|sav(?:ed|ing)\s+up)\s+(?:my\s+|his\s+|her\s+)?(?:pills|meds|medications?|tablets)\b/i },
  // ── Suicide: method (C-SSRS q3) ───────────────────────────────────────────────
  { id: 'method', category: 'suicide', concept: 'method', severity: 'high', re: /\b(?:hang\s+myself|shoot\s+myself|slit\s+my\s+(?:wrists?|throat)|jump\s+(?:off|from)\s+(?:a|the)\s+(?:bridge|building|roof|overpass)|overdose\s+on|take\s+(?:all|the\s+whole\s+bottle)\s+of\s+my\s+(?:pills|meds)|drive\s+(?:my\s+car\s+)?(?:off|into)\s+(?:a|the)\s+(?:bridge|wall|tree|traffic)|step\s+in\s+front\s+of\s+(?:a|the)\s+(?:train|bus|truck)|gun\s+to\s+my\s+head)\b/i },
  // ── Suicide: behavior (C-SSRS q6–q9) ──────────────────────────────────────────
  { id: 'attempt', category: 'suicide', concept: 'attempt', severity: 'medium', behavior: true, re: /\b(?:(?:attempted|tried\s+to)\s+(?:suicide|to\s+kill\s+(?:my|him|her|them)sel(?:f|ves)|kill\s+(?:my|him|her|them)sel(?:f|ves)|end\s+(?:my|his|her|their)\s+life|overdose)|suicide\s+attempts?|(?:sa|s\/a)\s+(?:x\s*\d|in|on|last)|took\s+(?:a\s+bunch|a\s+handful|all|the\s+whole\s+bottle)\s+of\s+(?:my\s+|his\s+|her\s+)?(?:pills|meds|tablets)|intentional\s+overdose|interrupted\s+attempt|aborted\s+attempt)\b/i },
  // ── Suicide: active ideation (C-SSRS q2) ──────────────────────────────────────
  { id: 'kill-myself', category: 'suicide', concept: 'active_ideation', severity: 'medium', re: /\b(?:kill(?:ing)?\s+myself|end(?:ing)?\s+my\s+(?:own\s+)?life|take\s+my\s+(?:own\s+)?life|unalive\s+myself|commit\s+suicide)\b/i },
  { id: 'kms', category: 'suicide', concept: 'active_ideation', severity: 'medium', ambiguous: true, re: /(?<![\w/])kms(?![\w/])/ },
  { id: 'end-it-all', category: 'suicide', concept: 'active_ideation', severity: 'medium', re: /\bend\s+it\s+all\b/i },
  { id: 'end-it', category: 'suicide', concept: 'active_ideation', severity: 'medium', ambiguous: true, re: /\b(?:just\s+)?end\s+it\b(?!\s+(?:all|with|between|off))/i },
  { id: 'suicidal', category: 'suicide', concept: 'active_ideation', severity: 'medium', re: /\b(?:(?:feel(?:ing|s)?|i['’]?m|i\s+am|im|been|being|was|is|actively|currently)\s+suicidal|suicidal\s+(?:ideation|thoughts?|feelings?|urges?)|thoughts?\s+(?:of|about)\s+(?:suicide|killing\s+(?:my|him|her|them)sel(?:f|ves)|ending\s+(?:my|his|her|their)\s+life)|(?:endorses?|endorsed|reports?|reported|admits?|positive\s+for|\+)\s+(?:active\s+)?(?:si|suicidal\s+ideation)|active\s+si)\b/i },
  { id: 'si-acronym', category: 'suicide', concept: 'active_ideation', severity: 'medium', ambiguous: true, re: /(?<![\w/-])SI(?![\w-])/ },
  { id: 'suicide-word', category: 'suicide', concept: 'active_ideation', severity: 'medium', ambiguous: true, re: /\bsuicide\b(?!\s+(?:hotline|prevention|lifeline|awareness|note|attempts?|risk\s+assessment|screen\w*|safety\s+plan))/i },
  // ── Suicide: passive ideation (C-SSRS q1) ─────────────────────────────────────
  {
    id: 'wish-dead',
    category: 'suicide',
    concept: 'passive_ideation',
    severity: 'medium',
    re: new RegExp(
      String.raw`\b(?:wish(?:es|ed|ing)?\s+(?:i|she|he|they)\s+(?:was|were|could\s+be)\s+dead|wish(?:es|ed|ing)?\s+(?:i|she|he|they)\s+(?:had\s+never\s+been\s+born|could\s+(?:just\s+)?(?:die|not\s+wake\s+up))|(?:i\s+)?(?:want|wanna|wanted|wants)\s+to\s+(?:just\s+)?(?:die|be\s+dead)|better\s+off\s+dead|better\s+off\s+without\s+me|${NOT_WANT}\s+(?:live|be\s+alive|be\s+here(?:\s+anymore)?|wake\s+up|exist)|(?:go\s+to\s+sleep|fall\s+asleep)\s+and\s+(?:never|not)\s+wake\s+up|no\s+reason\s+(?:to|for)\s+(?:live|living)|(?:life|living)\s+(?:is|isn['’]?t|is\s+not)\s+(?:not\s+)?worth\s+(?:it|living)|tired\s+of\s+(?:living|being\s+alive|life)|passive\s+(?:si|suicidal\s+ideation|death\s+wish)|death\s+wish)\b`,
      'i'
    ),
  },
  // ── Self-harm (C-SSRS q10, NSSI) ──────────────────────────────────────────────
  { id: 'nssi', category: 'self_harm', concept: 'nssi', severity: 'medium', re: /\b(?:cut(?:ting)?\s+(?:myself|my\s+(?:arms?|wrists?|legs?|thighs?))|burn(?:ed|ing|t)?\s+myself|self[-\s]?harm(?:ing|ed)?|self[-\s]?injur\w*|nssi|(?:urges?\s+to|started|back\s+to|been)\s+cutting|carv(?:ed|ing)\s+(?:into\s+)?my)\b/i },
  { id: 'hurt-myself', category: 'self_harm', concept: 'nssi', severity: 'medium', ambiguous: true, re: /\b(?:hurt(?:ing)?|harm(?:ing)?)\s+myself\b/i },
  // ── Homicide ─────────────────────────────────────────────────────────────────
  { id: 'hi-plan', category: 'homicide', concept: 'homicidal_plan', severity: 'high', re: /\b(?:(?:going|gonna|plan(?:ning)?)\s+to\s+(?:kill|shoot|stab|murder)\s+(?:him|her|them|my\s+\w+|the\s+\w+|everyone|somebody|someone)|(?:bought|got|have)\s+a\s+(?:gun|knife|weapon)\s+(?:to|for)\s+(?:kill|shoot|use\s+on|hurt)|(?:hi|homicidal\s+ideation)\s+with\s+(?:a\s+)?(?:plan|intent)|shoot\s+up\s+(?:the|my)\s+\w+)\b/i },
  { id: 'hi', category: 'homicide', concept: 'homicidal_ideation', severity: 'medium', re: /\b(?:homicidal(?:\s+(?:ideation|thoughts?|urges?))?|thoughts?\s+of\s+(?:killing|hurting|harming)\s+(?:others|someone|him|her|them|my\s+\w+)|(?:endorses?|endorsed|reports?|positive\s+for|\+)\s+hi)\b/i },
  { id: 'kill-them', category: 'homicide', concept: 'homicidal_ideation', severity: 'medium', ambiguous: true, re: /\b(?:want|wanna|wanted|going|gonna|could|will)\s+(?:to\s+)?(?:kill|murder|stab|shoot)\s+(?:him|her|them|my\s+(?:boss|ex|husband|wife|partner|mom|mother|dad|father|brother|sister|neighbou?r|coworker|roommate|teacher)|someone|somebody|everyone)\b/i },
  // ── Abuse / danger ───────────────────────────────────────────────────────────
  {
    id: 'abuse-lethal',
    category: 'abuse_danger',
    concept: 'abuse_lethal',
    severity: 'high',
    re: /\b(?:threaten(?:s|ed|ing)?\s+(?:to\s+)?(?:kill|shoot|stab)\s+(?:me|us|her|the\s+kids|my\s+(?:kids|children|son|daughter))|(?:said|says|told\s+me)\s+(?:he|she|they)\s*(?:['’]?ll|['’]?d|\s+will|\s+would|\s+(?:is|was)\s+going\s+to)\s+kill\s+(?:me|us)|(?:choked|strangled|choking|strangling|chokes|strangles)\s+(?:me|her|him)|(?:pointed|held|pulled)\s+a\s+(?:gun|knife)\s+(?:at|on|to)\s+(?:me|my|her)|afraid\s+(?:he|she|they)\s*(?:['’]?ll|\s+will|\s+(?:is|are)\s+going\s+to)\s+kill\s+(?:me|us)|fear(?:s|ed)?\s+for\s+(?:my|her|his|their)\s+life)\b/i,
  },
  {
    id: 'abuse',
    category: 'abuse_danger',
    concept: 'abuse',
    severity: 'medium',
    re: /\b(?:(?:he|she|they|my\s+(?:husband|wife|partner|boyfriend|girlfriend|ex|dad|father|mom|mother|stepdad|stepfather|stepmom|uncle|brother))\s+(?:hits?|hit\s+me|beats?|beat\s+me|punch(?:es|ed)\s+me|slap(?:s|ped)\s+me|kick(?:s|ed)\s+me|hurts?\s+me|abuses?\s+me|abused\s+me|raped\s+me|molest(?:s|ed)\s+me|touch(?:es|ed)\s+me\s+(?:inappropriately|there))|(?:being|been|getting)\s+(?:abused|hit|beaten|molested|raped)|afraid\s+to\s+go\s+home|not\s+safe\s+at\s+home|(?:domestic|intimate\s+partner)\s+violence|\bipv\b|\bdv\b\s+(?:at\s+home|ongoing|current))\b/i,
  },
  // ── Hopelessness (low; screen prompt, not ideation) ──────────────────────────
  { id: 'hopeless', category: 'hopelessness', concept: 'hopelessness', severity: 'low', ambiguous: true, re: /\b(?:can['’]?t\s+go\s+on|cant\s+go\s+on|(?:what['’]?s|whats)\s+the\s+point(?:\s+(?:of|in)\s+(?:living|anything|life))?|no\s+point\s+(?:in\s+)?(?:living|anymore|going\s+on|trying)|(?:want|wanna)\s+to\s+(?:disappear|give\s+up)|giving\s+up\s+on\s+(?:life|everything)|hopeless(?:ness)?|nothing\s+to\s+live\s+for)\b/i },
];

// ── Context cues (matched in the hit sentence and its neighbours) ───────────────

/** Access to / acquisition of lethal means */
export const MEANS_CUE =
  /\b(?:(?:has|have|got|bought|keeps?|own(?:s|ed)?|access\s+to|loaded|with\s+(?:a|my|the))\s+(?:a\s+)?(?:gun|guns|firearms?|pistol|rifle|handgun|rope|noose|razor\s*blades?|razors?)|stockpil\w*|sav(?:ed|ing)\s+(?:up\s+)?(?:my\s+)?(?:pills|meds|medications?)|(?:pills|meds|medications?)\s+(?:saved|stashed|stockpiled|ready)|enough\s+(?:pills|meds)\s+to|(?:all|bottle|bunch|handful)\s+of\s+(?:my\s+)?(?:pills|meds)|gun\s+in\s+the\s+(?:home|house))\b/i;

/** Intent, plan or timing wording */
export const PLAN_CUE =
  /\b(?:plan(?:s|ned|ning)?\s+(?:to|on|for)|(?:a|specific|with)\s+plan|intent(?:ion)?\s+to|with\s+intent|tonight|right\s+now|this\s+weekend|tomorrow|(?:going|gonna)\s+to\s+do\s+it|ready\s+to\s+(?:die|go|do\s+it)|decided\s+to|goodbye|suicide\s+note|said\s+(?:my\s+)?goodbyes?)\b/i;

/** Behavior happened recently (C-SSRS: behavior within the past 3 months is high risk) */
export const RECENT_CUE =
  /\b(?:today|tonight|yesterday|last\s+(?:night|week|weekend|month)|this\s+(?:morning|week|weekend|month)|(?:a\s+)?(?:few|couple(?:\s+of)?|\d+)\s+(?:days|weeks)\s+ago|(?:past|last)\s+(?:\d+\s+)?(?:days?|weeks?|month)|recently|again|just\s+now|earlier)\b/i;

export const HISTORICAL_CUE =
  /\b(?:history\s+of|hx\s+of|h\/o|past\s+(?:history|hx)|lifetime|previous(?:ly)?|prior|remote|years?\s+ago|(?:in|back\s+in)\s+(?:19|20)\d\d|as\s+a\s+(?:child|kid|teen(?:ager)?)|in\s+(?:high\s+school|college|the\s+past)|when\s+(?:i|she|he|they)\s+(?:was|were)\s+(?:young|\d+|a\s+(?:child|kid|teen)))\b/i;

/** Figures of speech that contain risk words but are not risk (checked against the sentence) */
export const IDIOM =
  /\b(?:dying\s+(?:to|for)|to\s+die\s+for|kill(?:ing)?\s+(?:time|it\b)|killed\s+it|(?:is|are|was)\s+killing\s+me|kill\s+for\s+a|bored\s+to\s+death|scared\s+to\s+death|laugh(?:ed|ing)?\s+(?:myself\s+)?to\s+death|dead\s+(?:tired|battery|line|end)|over\s+my\s+dead\s+body|(?:could|would)\s+(?:just\s+)?die\s+of\s+embarrassment)\b/i;
