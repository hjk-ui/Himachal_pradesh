/**
 * Every URL and phone number the starter content uses, with how it was verified (pure).
 *
 * Rule: a seed (seedCatalog.ts) may only use a URL listed here, and a phone / text line only
 * when it appears in `contacts` of the source it came from. tests/resource-library.test.ts
 * enforces this. Verified 2026-10-20 by fetching each page:
 *   http-title   = HTTP 200 and the page <title> names the topic
 *   page-content = the page text was read and the quoted evidence was found on it
 *   state-page   = the publisher blocks automated fetches; verified on an official Maryland
 *                  government page that names and links it (evidence quotes that page)
 * Re-check links at least yearly (linkCheckedAt on each item; staff can re-verify in the UI).
 */

export type VerifiedSource = {
  url: string;
  publisher: string;
  /** Page title as published */
  title: string;
  checkedOn: string;
  method: 'http-title' | 'page-content' | 'state-page';
  evidence: string;
  /** Phone / text contacts confirmed on this page, exactly as published */
  contacts?: string[];
};

const ON = '2026-10-20';
const nimh = (path: string, title: string): VerifiedSource => ({
  url: `https://www.nimh.nih.gov/health/topics/${path}`,
  publisher: 'National Institute of Mental Health (NIMH)',
  title: `${title} - National Institute of Mental Health (NIMH)`,
  checkedOn: ON,
  method: 'http-title',
  evidence: 'HTTP 200; page title matches',
});
const medline = (path: string, title: string): VerifiedSource => ({
  url: `https://medlineplus.gov/${path}`,
  publisher: 'MedlinePlus, National Library of Medicine',
  title,
  checkedOn: ON,
  method: 'http-title',
  evidence: 'HTTP 200; page title matches',
});
const va = (path: string, title: string): VerifiedSource => ({
  url: `https://www.ptsd.va.gov/${path}`,
  publisher: 'VA National Center for PTSD',
  title: `${title} - PTSD: National Center for PTSD`,
  checkedOn: ON,
  method: 'http-title',
  evidence: 'HTTP 200; page title matches',
});
const cdc = (url: string, title: string, evidence: string, contacts?: string[]): VerifiedSource => ({
  url,
  publisher: 'Centers for Disease Control and Prevention (CDC)',
  title,
  checkedOn: ON,
  method: 'page-content',
  evidence,
  contacts,
});

export const VERIFIED_SOURCES: readonly VerifiedSource[] = [
  // ─── Crisis and helplines ───
  {
    url: 'https://988lifeline.org/',
    publisher: '988 Suicide & Crisis Lifeline',
    title: '988 Lifeline',
    checkedOn: ON,
    method: 'page-content',
    evidence: '"Call, text, or chat with a 988 Lifeline counselor for help during difficult moments anytime, day or night."',
    contacts: ['988'],
  },
  {
    url: 'https://www.crisistextline.org/',
    publisher: 'Crisis Text Line',
    title: 'Crisis Text Line | Text HOME to 741741 Free, 24/7 Mental Health Support',
    checkedOn: ON,
    method: 'page-content',
    evidence: '"Text HOME to 741741" to reach a live, trained Crisis Counselor; free, 24/7, confidential.',
    contacts: ['Text HOME to 741741'],
  },
  {
    url: 'https://www.samhsa.gov/find-help/helplines/national-helpline',
    publisher: 'Substance Abuse and Mental Health Services Administration (SAMHSA)',
    title: 'National Helpline for Mental Health, Drug, Alcohol Issues | SAMHSA',
    checkedOn: ON,
    method: 'page-content',
    evidence: '"SAMHSA\'s National Helpline (1-800-662-HELP (4357); TTY: 1-800-487-4889) is a confidential, free, 24/7 information service (English and Spanish)"',
    contacts: ['1-800-662-4357', '1-800-487-4889'],
  },
  {
    url: 'https://www.samhsa.gov/mental-health/988',
    publisher: 'Substance Abuse and Mental Health Services Administration (SAMHSA)',
    title: '988 Suicide & Crisis Lifeline | SAMHSA',
    checkedOn: ON,
    method: 'page-content',
    evidence: 'Page title matches; "In Crisis? Call or Text 988."',
    contacts: ['988'],
  },
  {
    url: 'https://findtreatment.gov/',
    publisher: 'Substance Abuse and Mental Health Services Administration (SAMHSA)',
    title: 'FindTreatment.gov',
    checkedOn: ON,
    method: 'page-content',
    evidence: 'HTTP 200, title "FindTreatment.gov"; linked from SAMHSA\'s National Helpline page (samhsa.gov).',
  },
  {
    url: 'https://www.samhsa.gov/substance-use/treatment/overdose-prevention',
    publisher: 'Substance Abuse and Mental Health Services Administration (SAMHSA)',
    title: 'Opioid Overdose Prevention and Reversal | SAMHSA',
    checkedOn: ON,
    method: 'page-content',
    evidence: 'HTTP 200; page title matches.',
  },
  // ─── Maryland ───
  {
    url: 'https://health.maryland.gov/bha/Pages/988md.aspx',
    publisher: 'Maryland Department of Health, Behavioral Health Administration',
    title: '988 Suicide & Crisis Lifeline',
    checkedOn: ON,
    method: 'page-content',
    evidence: '"People can call (or text or chat) 9-8-8 to talk and to connect with services." Specialists available 24/7.',
    contacts: ['988'],
  },
  {
    url: 'https://health.maryland.gov/bha/Pages/Index.aspx',
    publisher: 'Maryland Department of Health, Behavioral Health Administration',
    title: 'Behavioral Health Administration Home',
    checkedOn: ON,
    method: 'page-content',
    evidence: 'Heading "Behavioral Health Administration (BHA)"; links to "Get help" and "Maryland Behavioral Health Connect".',
  },
  {
    url: 'https://211md.org/',
    publisher: '211 Maryland',
    title: '211 Maryland',
    checkedOn: ON,
    method: 'state-page',
    evidence:
      '211md.org answers automated checks with a bot challenge (HTTP 403). Verified on the Maryland Department of Human Services page https://dhs.maryland.gov/family-resources/: "Call 211"; "free and confidential service providing information, community resources, and referrals ... 24/7, every day of the year, in 50 languages"; its 2-1-1 Maryland link is https://211md.org/.',
    contacts: ['211'],
  },
  // ─── NIMH health topics ───
  nimh('anxiety-disorders', 'Anxiety Disorders'),
  nimh('depression', 'Depression'),
  nimh('post-traumatic-stress-disorder-ptsd', 'Traumatic Events and Post-Traumatic Stress Disorder (PTSD)'),
  nimh('bipolar-disorder', 'Bipolar Disorder'),
  nimh('schizophrenia', 'Schizophrenia'),
  nimh('attention-deficit-hyperactivity-disorder-adhd', 'Attention-Deficit/Hyperactivity Disorder (ADHD)'),
  nimh('obsessive-compulsive-disorder-ocd', 'Obsessive-Compulsive Disorder (OCD)'),
  nimh('eating-disorders', 'Eating Disorders'),
  nimh('suicide-prevention', 'Suicide Prevention'),
  nimh('child-and-adolescent-mental-health', 'Child and Adolescent Mental Health'),
  nimh('mental-health-medications', 'Mental Health Medications'),
  nimh('caring-for-your-mental-health', 'Caring for Your Mental Health'),
  nimh('borderline-personality-disorder', 'Borderline Personality Disorder'),
  // ─── VA National Center for PTSD ───
  va('understand/what/index.asp', 'What is PTSD?'),
  va('understand_tx/index.asp', 'Understanding PTSD Treatment'),
  va('understand/related/sleep_problems.asp', 'Sleep Problems and PTSD'),
  va('family/index.asp', 'For Family and Friends'),
  va('appvid/mobile/ptsdcoach_app.asp', 'PTSD Coach'),
  va('gethelp/index.asp', 'Get Help'),
  // ─── CDC ───
  cdc('https://www.cdc.gov/diabetes/about/index.html', 'Diabetes Basics | Diabetes | CDC', 'Page read: overview of type 1, type 2 and gestational diabetes, prevention.'),
  cdc('https://www.cdc.gov/high-blood-pressure/about/index.html', 'About High Blood Pressure | High Blood Pressure | CDC', 'Page read: definition, diagnosis, complications, prevention.'),
  cdc('https://www.cdc.gov/stop-overdose/caring/naloxone.html', 'Lifesaving Naloxone | Stop Overdose | CDC', 'Page read: "What is naloxone?" section.'),
  cdc('https://www.cdc.gov/child-development/positive-parenting-tips/index.html', 'Positive Parenting Tips | Child Development | CDC', 'Page read: tips by child age.'),
  cdc('https://www.cdc.gov/sleep/about/index.html', 'About Sleep | Sleep | CDC', 'Page read: sleep recommendations by age, benefits, sleep disorders.'),
  cdc(
    'https://www.cdc.gov/tobacco/campaign/tips/quit-smoking/index.html',
    'How to Quit Smoking | Quit Smoking | Tips From Former Smokers | CDC',
    'Page read: lists "1-800-QUIT-NOW (1-800-784-8669)" and "1-855-DÉJELO-YA (1-855-335-3569) (Español)".',
    ['1-800-784-8669', '1-855-335-3569'],
  ),
  // ─── MedlinePlus (NLM) ───
  medline('anxiety.html', 'Anxiety: MedlinePlus'),
  medline('depression.html', 'Depression: MedlinePlus'),
  medline('posttraumaticstressdisorder.html', 'Post-Traumatic Stress Disorder: MedlinePlus'),
  medline('diabetes.html', 'Diabetes | Type 1 Diabetes | Type 2 Diabetes | MedlinePlus'),
  medline('highbloodpressure.html', 'High Blood Pressure | Hypertension | MedlinePlus'),
  medline('sleepdisorders.html', 'Sleep Disorders | MedlinePlus'),
  medline('healthysleep.html', 'Healthy Sleep | MedlinePlus'),
  medline('bereavement.html', 'Bereavement: MedlinePlus'),
  medline('opioidsandopioidusedisorderoud.html', 'Opioids and Opioid Use Disorder (OUD): MedlinePlus'),
  medline('alcoholusedisorderaud.html', 'Alcohol Use Disorder (AUD): MedlinePlus'),
  medline('druginformation.html', 'MedlinePlus: Drugs, Herbs and Supplements'),
  medline('parenting.html', 'Parenting: MedlinePlus'),
  medline('stress.html', 'Stress: MedlinePlus'),
  medline('spanish/depression.html', 'Depresión: MedlinePlus en español'),
  medline('spanish/anxiety.html', 'Ansiedad: MedlinePlus en español'),
  medline('spanish/diabetes.html', 'Diabetes: MedlinePlus en español'),
  medline('spanish/highbloodpressure.html', 'Presión arterial alta | Hipertensión | MedlinePlus en español'),
];

const BY_URL = new Map(VERIFIED_SOURCES.map((s) => [s.url, s]));

export function verifiedSource(url: string): VerifiedSource | undefined {
  return BY_URL.get(url);
}

/** Candidates checked on 2026-10-20 and NOT seeded (kept so nobody re-adds them unverified). */
export const REJECTED_CANDIDATES: readonly { url: string; reason: string }[] = [
  { url: 'https://www.ptsd.va.gov/appvid/videos/index.asp', reason: 'Returned the site 404 page ("Page Not Found")' },
  { url: 'https://www.cdc.gov/children-mental-health/about/index.html', reason: 'Not confirmed (CDC blocks automated fetches; page content not read)' },
  { url: 'https://www.cdc.gov/mental-health/living-with/index.html', reason: 'Not confirmed (page content not read)' },
  { url: 'https://www.cdc.gov/diabetes/prevention-type-2/index.html', reason: 'Not confirmed (page content not read)' },
  { url: 'https://www.samhsa.gov/find-support', reason: 'HTTP 200 but page title could not be confirmed' },
  { url: 'https://www.samhsa.gov/mental-health', reason: 'HTTP 200 but page title could not be confirmed' },
];
