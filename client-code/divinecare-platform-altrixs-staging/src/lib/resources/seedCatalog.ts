/**
 * Verified starter content (pure). Links only: nothing here copies a publisher's material.
 * Every URL / contact must be in verifiedSources.ts (tests/resource-library.test.ts enforces it).
 * Summaries are the practice's own one-line descriptions of what the linked page covers.
 * No copyrighted worksheets (Therapist Aid, publishers' workbooks) are included; practices add
 * their own handouts by upload.
 */
import type { Audience, ResourceKind, Topic } from './types';

export type SeedItem = {
  seedKey: string;
  kind: ResourceKind;
  title: string;
  summary: string;
  url: string;
  contactPhone?: string;
  contactText?: string;
  topics: Topic[];
  audiences: Audience[];
  language: 'en' | 'es';
  publisher: string;
  licenseNote: string;
};

const GOV = (agency: string) => `${agency}: U.S. government work, generally public domain (some images or linked content may carry their own terms). Linked, not copied.`;
const L = {
  nimh: GOV('NIMH'),
  medline: 'MedlinePlus (National Library of Medicine). Health topic pages are U.S. government works; some linked third-party content is copyrighted. Linked, not copied.',
  va: GOV('U.S. Department of Veterans Affairs'),
  cdc: GOV('CDC'),
  samhsa: GOV('SAMHSA'),
  mdh: 'Maryland Department of Health public web page. Linked, not copied.',
  lifeline: '988 Suicide & Crisis Lifeline public website. Linked, not copied.',
  ctl: 'Crisis Text Line public website (nonprofit). Linked, not copied.',
  md211: '211 Maryland public website. Linked, not copied.',
};
const P = {
  nimh: 'National Institute of Mental Health (NIMH)',
  medline: 'MedlinePlus, National Library of Medicine',
  va: 'VA National Center for PTSD',
  cdc: 'Centers for Disease Control and Prevention (CDC)',
  samhsa: 'Substance Abuse and Mental Health Services Administration (SAMHSA)',
  mdh: 'Maryland Department of Health, Behavioral Health Administration',
};
const ALL_AGES: Audience[] = ['adult', 'teen', 'caregiver'];

export const SEED_ITEMS: readonly SeedItem[] = [
  // ─── Crisis ───
  {
    seedKey: 'crisis-988', kind: 'crisis', title: '988 Suicide & Crisis Lifeline',
    summary: 'Call or text 988, or chat online, to reach a crisis counselor any time, day or night.',
    url: 'https://988lifeline.org/', contactPhone: '988', contactText: 'Call or text 988',
    topics: ['crisis', 'suicide_prevention'], audiences: ['adult', 'teen', 'caregiver'], language: 'en',
    publisher: '988 Suicide & Crisis Lifeline', licenseNote: L.lifeline,
  },
  {
    seedKey: 'crisis-text-line', kind: 'crisis', title: 'Crisis Text Line',
    summary: 'Text HOME to 741741 to reach a trained crisis counselor by text, free and 24/7.',
    url: 'https://www.crisistextline.org/', contactText: 'Text HOME to 741741',
    topics: ['crisis'], audiences: ['adult', 'teen'], language: 'en',
    publisher: 'Crisis Text Line', licenseNote: L.ctl,
  },
  {
    seedKey: 'samhsa-national-helpline', kind: 'crisis', title: 'SAMHSA National Helpline',
    summary: 'Free, confidential, 24/7 treatment referral and information line for mental health and substance use (English and Spanish). TTY 1-800-487-4889.',
    url: 'https://www.samhsa.gov/find-help/helplines/national-helpline', contactPhone: '1-800-662-4357',
    topics: ['crisis', 'sud_recovery'], audiences: ['adult', 'teen', 'caregiver'], language: 'en',
    publisher: P.samhsa, licenseNote: L.samhsa,
  },
  {
    seedKey: 'mdh-988', kind: 'crisis', title: '988 in Maryland (Maryland Department of Health)',
    summary: "Maryland's page on the 988 Suicide & Crisis Lifeline: call, text or chat 988 to talk and connect with services.",
    url: 'https://health.maryland.gov/bha/Pages/988md.aspx', contactPhone: '988',
    topics: ['crisis', 'suicide_prevention'], audiences: ALL_AGES, language: 'en',
    publisher: P.mdh, licenseNote: L.mdh,
  },
  // ─── Community / navigation ───
  {
    seedKey: 'md-211', kind: 'community', title: '211 Maryland',
    summary: 'Call 211 for free, confidential help finding food, housing, utility, health and other community services in Maryland, 24/7.',
    url: 'https://211md.org/', contactPhone: '211',
    topics: ['community_services'], audiences: ['adult', 'caregiver'], language: 'en',
    publisher: '211 Maryland', licenseNote: L.md211,
  },
  {
    seedKey: 'findtreatment-gov', kind: 'link', title: 'FindTreatment.gov',
    summary: "SAMHSA's locator for mental health and substance use treatment facilities.",
    url: 'https://findtreatment.gov/',
    topics: ['sud_recovery', 'community_services'], audiences: ['adult', 'caregiver'], language: 'en',
    publisher: P.samhsa, licenseNote: L.samhsa,
  },
  {
    seedKey: 'mdh-bha-home', kind: 'link', title: 'Maryland Behavioral Health Administration',
    summary: "Maryland's public behavioral health system: how to get help and find services.",
    url: 'https://health.maryland.gov/bha/Pages/Index.aspx',
    topics: ['community_services'], audiences: ['adult', 'caregiver'], language: 'en',
    publisher: P.mdh, licenseNote: L.mdh,
  },
  // ─── NIMH ───
  { seedKey: 'nimh-anxiety', kind: 'link', title: 'Anxiety Disorders (NIMH)', summary: 'Signs, symptoms, risk factors and treatment options for anxiety disorders.', url: 'https://www.nimh.nih.gov/health/topics/anxiety-disorders', topics: ['anxiety'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-depression', kind: 'link', title: 'Depression (NIMH)', summary: 'What depression is, common symptoms, and how it is treated.', url: 'https://www.nimh.nih.gov/health/topics/depression', topics: ['depression'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-ptsd', kind: 'link', title: 'Traumatic Events and PTSD (NIMH)', summary: 'Reactions to traumatic events, PTSD symptoms and treatment.', url: 'https://www.nimh.nih.gov/health/topics/post-traumatic-stress-disorder-ptsd', topics: ['trauma'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-bipolar', kind: 'link', title: 'Bipolar Disorder (NIMH)', summary: 'Mood episodes, diagnosis and treatment of bipolar disorder.', url: 'https://www.nimh.nih.gov/health/topics/bipolar-disorder', topics: ['serious_mental_illness'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-schizophrenia', kind: 'link', title: 'Schizophrenia (NIMH)', summary: 'Symptoms, treatment and support for people with schizophrenia and their families.', url: 'https://www.nimh.nih.gov/health/topics/schizophrenia', topics: ['serious_mental_illness'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-adhd', kind: 'link', title: 'ADHD (NIMH)', summary: 'ADHD in children and adults: signs, diagnosis and treatment.', url: 'https://www.nimh.nih.gov/health/topics/attention-deficit-hyperactivity-disorder-adhd', topics: ['adhd', 'child_teen'], audiences: ['adult', 'teen', 'caregiver'], language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-ocd', kind: 'link', title: 'Obsessive-Compulsive Disorder (NIMH)', summary: 'Obsessions, compulsions and evidence-based treatment for OCD.', url: 'https://www.nimh.nih.gov/health/topics/obsessive-compulsive-disorder-ocd', topics: ['ocd', 'anxiety'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-eating', kind: 'link', title: 'Eating Disorders (NIMH)', summary: 'Types of eating disorders, warning signs and treatment.', url: 'https://www.nimh.nih.gov/health/topics/eating-disorders', topics: ['eating_disorders'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-suicide-prevention', kind: 'link', title: 'Suicide Prevention (NIMH)', summary: 'Warning signs of suicide and how to help someone at risk.', url: 'https://www.nimh.nih.gov/health/topics/suicide-prevention', topics: ['suicide_prevention'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-child-teen', kind: 'link', title: 'Child and Adolescent Mental Health (NIMH)', summary: "Information for parents and caregivers about children's and teens' mental health.", url: 'https://www.nimh.nih.gov/health/topics/child-and-adolescent-mental-health', topics: ['child_teen', 'parenting'], audiences: ['caregiver', 'teen'], language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-medications', kind: 'link', title: 'Mental Health Medications (NIMH)', summary: 'Overview of common medication types used in mental health treatment.', url: 'https://www.nimh.nih.gov/health/topics/mental-health-medications', topics: ['medication_info'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-caring', kind: 'link', title: 'Caring for Your Mental Health (NIMH)', summary: 'Everyday self-care steps and when to seek help.', url: 'https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health', topics: ['coping_skills', 'general_wellness'], audiences: ALL_AGES, language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  { seedKey: 'nimh-bpd', kind: 'link', title: 'Borderline Personality Disorder (NIMH)', summary: 'Symptoms and treatment of borderline personality disorder.', url: 'https://www.nimh.nih.gov/health/topics/borderline-personality-disorder', topics: ['coping_skills'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.nimh, licenseNote: L.nimh },
  // ─── VA National Center for PTSD ───
  { seedKey: 'va-what-is-ptsd', kind: 'link', title: 'What Is PTSD? (VA National Center for PTSD)', summary: 'Plain-language introduction to PTSD.', url: 'https://www.ptsd.va.gov/understand/what/index.asp', topics: ['trauma'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.va, licenseNote: L.va },
  { seedKey: 'va-ptsd-treatment', kind: 'link', title: 'Understanding PTSD Treatment (VA)', summary: 'Effective treatments for PTSD and what to expect.', url: 'https://www.ptsd.va.gov/understand_tx/index.asp', topics: ['trauma'], audiences: ['adult'], language: 'en', publisher: P.va, licenseNote: L.va },
  { seedKey: 'va-ptsd-sleep', kind: 'link', title: 'Sleep Problems and PTSD (VA)', summary: 'How trauma affects sleep and what helps.', url: 'https://www.ptsd.va.gov/understand/related/sleep_problems.asp', topics: ['trauma', 'sleep'], audiences: ['adult'], language: 'en', publisher: P.va, licenseNote: L.va },
  { seedKey: 'va-ptsd-family', kind: 'link', title: 'PTSD: For Family and Friends (VA)', summary: 'Support for family members and friends of someone with PTSD.', url: 'https://www.ptsd.va.gov/family/index.asp', topics: ['trauma', 'family_caregivers'], audiences: ['caregiver'], language: 'en', publisher: P.va, licenseNote: L.va },
  { seedKey: 'va-ptsd-coach', kind: 'link', title: 'PTSD Coach app (VA)', summary: 'Free VA app with tools to manage PTSD symptoms and stress.', url: 'https://www.ptsd.va.gov/appvid/mobile/ptsdcoach_app.asp', topics: ['trauma', 'coping_skills'], audiences: ['adult', 'teen'], language: 'en', publisher: P.va, licenseNote: L.va },
  { seedKey: 'va-ptsd-get-help', kind: 'link', title: 'Get Help for PTSD (VA)', summary: 'Where to find PTSD help for Veterans and non-Veterans.', url: 'https://www.ptsd.va.gov/gethelp/index.asp', topics: ['trauma', 'community_services'], audiences: ['adult'], language: 'en', publisher: P.va, licenseNote: L.va },
  // ─── CDC ───
  { seedKey: 'cdc-diabetes', kind: 'link', title: 'Diabetes Basics (CDC)', summary: 'Types of diabetes, risk and prevention.', url: 'https://www.cdc.gov/diabetes/about/index.html', topics: ['diabetes'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.cdc, licenseNote: L.cdc },
  { seedKey: 'cdc-high-blood-pressure', kind: 'link', title: 'About High Blood Pressure (CDC)', summary: 'What high blood pressure is, its complications and prevention.', url: 'https://www.cdc.gov/high-blood-pressure/about/index.html', topics: ['hypertension'], audiences: ['adult'], language: 'en', publisher: P.cdc, licenseNote: L.cdc },
  { seedKey: 'cdc-naloxone', kind: 'link', title: 'Lifesaving Naloxone (CDC)', summary: 'What naloxone is and how it reverses an opioid overdose.', url: 'https://www.cdc.gov/stop-overdose/caring/naloxone.html', topics: ['sud_recovery'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.cdc, licenseNote: L.cdc },
  { seedKey: 'cdc-parenting', kind: 'link', title: 'Positive Parenting Tips (CDC)', summary: 'Age-by-age parenting tips for supporting healthy child development.', url: 'https://www.cdc.gov/child-development/positive-parenting-tips/index.html', topics: ['parenting', 'child_teen'], audiences: ['caregiver'], language: 'en', publisher: P.cdc, licenseNote: L.cdc },
  { seedKey: 'cdc-sleep', kind: 'link', title: 'About Sleep (CDC)', summary: 'How much sleep people need at each age and why it matters.', url: 'https://www.cdc.gov/sleep/about/index.html', topics: ['sleep', 'general_wellness'], audiences: ALL_AGES, language: 'en', publisher: P.cdc, licenseNote: L.cdc },
  { seedKey: 'cdc-quit-smoking', kind: 'link', title: 'How to Quit Smoking (CDC)', summary: 'Steps to quit and free quitline support: 1-800-QUIT-NOW (1-800-784-8669); Spanish 1-855-335-3569.', url: 'https://www.cdc.gov/tobacco/campaign/tips/quit-smoking/index.html', contactPhone: '1-800-784-8669', topics: ['tobacco'], audiences: ['adult'], language: 'en', publisher: P.cdc, licenseNote: L.cdc },
  // ─── SAMHSA ───
  { seedKey: 'samhsa-988', kind: 'link', title: '988 Suicide & Crisis Lifeline (SAMHSA)', summary: "SAMHSA's information page about 988.", url: 'https://www.samhsa.gov/mental-health/988', topics: ['crisis', 'suicide_prevention'], audiences: ALL_AGES, language: 'en', publisher: P.samhsa, licenseNote: L.samhsa },
  { seedKey: 'samhsa-overdose-prevention', kind: 'link', title: 'Opioid Overdose Prevention and Reversal (SAMHSA)', summary: 'Preventing opioid overdose and using reversal medications.', url: 'https://www.samhsa.gov/substance-use/treatment/overdose-prevention', topics: ['sud_recovery'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.samhsa, licenseNote: L.samhsa },
  // ─── MedlinePlus ───
  { seedKey: 'medline-anxiety', kind: 'link', title: 'Anxiety (MedlinePlus)', summary: 'Overview and links on anxiety from the National Library of Medicine.', url: 'https://medlineplus.gov/anxiety.html', topics: ['anxiety'], audiences: ALL_AGES, language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-depression', kind: 'link', title: 'Depression (MedlinePlus)', summary: 'Overview and links on depression.', url: 'https://medlineplus.gov/depression.html', topics: ['depression'], audiences: ALL_AGES, language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-ptsd', kind: 'link', title: 'Post-Traumatic Stress Disorder (MedlinePlus)', summary: 'Overview and links on PTSD.', url: 'https://medlineplus.gov/posttraumaticstressdisorder.html', topics: ['trauma'], audiences: ALL_AGES, language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-diabetes', kind: 'link', title: 'Diabetes (MedlinePlus)', summary: 'Type 1, type 2 and gestational diabetes: overview and links.', url: 'https://medlineplus.gov/diabetes.html', topics: ['diabetes'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-high-blood-pressure', kind: 'link', title: 'High Blood Pressure (MedlinePlus)', summary: 'Hypertension: overview, treatment and links.', url: 'https://medlineplus.gov/highbloodpressure.html', topics: ['hypertension'], audiences: ['adult'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-sleep-disorders', kind: 'link', title: 'Sleep Disorders (MedlinePlus)', summary: 'Common sleep disorders and their treatment.', url: 'https://medlineplus.gov/sleepdisorders.html', topics: ['sleep'], audiences: ['adult'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-healthy-sleep', kind: 'link', title: 'Healthy Sleep (MedlinePlus)', summary: 'Habits that support good sleep.', url: 'https://medlineplus.gov/healthysleep.html', topics: ['sleep', 'general_wellness'], audiences: ALL_AGES, language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-bereavement', kind: 'link', title: 'Bereavement (MedlinePlus)', summary: 'Grief after a loss and coping resources.', url: 'https://medlineplus.gov/bereavement.html', topics: ['grief'], audiences: ALL_AGES, language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-oud', kind: 'link', title: 'Opioids and Opioid Use Disorder (MedlinePlus)', summary: 'Opioid use disorder and its treatment.', url: 'https://medlineplus.gov/opioidsandopioidusedisorderoud.html', topics: ['sud_recovery'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-aud', kind: 'link', title: 'Alcohol Use Disorder (MedlinePlus)', summary: 'Alcohol use disorder and its treatment.', url: 'https://medlineplus.gov/alcoholusedisorderaud.html', topics: ['sud_recovery'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-drug-info', kind: 'link', title: 'Drugs, Herbs and Supplements (MedlinePlus)', summary: 'Look up plain-language information about a prescription or over-the-counter medicine.', url: 'https://medlineplus.gov/druginformation.html', topics: ['medication_info'], audiences: ['adult', 'caregiver'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-parenting', kind: 'link', title: 'Parenting (MedlinePlus)', summary: 'Parenting overview and links.', url: 'https://medlineplus.gov/parenting.html', topics: ['parenting'], audiences: ['caregiver'], language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-stress', kind: 'link', title: 'Stress (MedlinePlus)', summary: 'How stress affects health and ways to cope.', url: 'https://medlineplus.gov/stress.html', topics: ['coping_skills', 'anxiety'], audiences: ALL_AGES, language: 'en', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-es-depression', kind: 'link', title: 'Depresión (MedlinePlus en español)', summary: 'Información y enlaces sobre la depresión.', url: 'https://medlineplus.gov/spanish/depression.html', topics: ['depression'], audiences: ALL_AGES, language: 'es', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-es-anxiety', kind: 'link', title: 'Ansiedad (MedlinePlus en español)', summary: 'Información y enlaces sobre la ansiedad.', url: 'https://medlineplus.gov/spanish/anxiety.html', topics: ['anxiety'], audiences: ALL_AGES, language: 'es', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-es-diabetes', kind: 'link', title: 'Diabetes (MedlinePlus en español)', summary: 'Información y enlaces sobre la diabetes.', url: 'https://medlineplus.gov/spanish/diabetes.html', topics: ['diabetes'], audiences: ['adult', 'caregiver'], language: 'es', publisher: P.medline, licenseNote: L.medline },
  { seedKey: 'medline-es-hypertension', kind: 'link', title: 'Presión arterial alta (MedlinePlus en español)', summary: 'Información y enlaces sobre la hipertensión.', url: 'https://medlineplus.gov/spanish/highbloodpressure.html', topics: ['hypertension'], audiences: ['adult'], language: 'es', publisher: P.medline, licenseNote: L.medline },
];

/**
 * Crisis lines shown in the library header and the patient portal (always one tap away).
 * Same verified sources as the seeds. 911 is the universal emergency number.
 */
export type CrisisLine = { key: string; name: string; action: string; href: string; detail: string; url: string | null };
export const CRISIS_LINES: readonly CrisisLine[] = [
  { key: '911', name: 'Emergency', action: 'Call 911', href: 'tel:911', detail: 'Immediate danger or a medical emergency.', url: null },
  { key: '988', name: '988 Suicide & Crisis Lifeline', action: 'Call or text 988', href: 'tel:988', detail: 'Free, 24/7 crisis counseling by call, text or chat.', url: 'https://988lifeline.org/' },
  { key: 'ctl', name: 'Crisis Text Line', action: 'Text HOME to 741741', href: 'sms:741741?body=HOME', detail: 'Free, 24/7 support by text.', url: 'https://www.crisistextline.org/' },
  { key: 'samhsa', name: 'SAMHSA National Helpline', action: 'Call 1-800-662-4357', href: 'tel:18006624357', detail: 'Free, confidential, 24/7 treatment referral (English and Spanish). TTY 1-800-487-4889.', url: 'https://www.samhsa.gov/find-help/helplines/national-helpline' },
  { key: '211', name: '211 Maryland', action: 'Call 211', href: 'tel:211', detail: 'Food, housing, utilities and other community help, 24/7.', url: 'https://211md.org/' },
];

/** Verified statewide community directory entries (sdoh_resources, source = seed). Local agencies are added by staff. */
export type CommunitySeed = {
  seedKey: string;
  name: string;
  domains: string[];
  counties: string[];
  phone: string;
  website: string;
  hours: string;
  languages: string[];
  cost: string;
  eligibilityNotes: string;
  verificationSource: string;
};
export const COMMUNITY_SEEDS: readonly CommunitySeed[] = [
  {
    seedKey: 'md-211',
    name: '211 Maryland',
    domains: ['general', 'housing', 'food', 'utilities', 'transportation', 'financial', 'employment', 'family_support'],
    counties: ['statewide'],
    phone: '211',
    website: 'https://211md.org/',
    hours: '24/7, every day of the year',
    languages: ['50 languages (per Maryland DHS)'],
    cost: 'Free',
    eligibilityNotes: 'Free and confidential information and referral for anyone in Maryland.',
    verificationSource: 'https://dhs.maryland.gov/family-resources/',
  },
];

/**
 * AOT resources listed on the MDH AOT Resource Center page (owner-provided copy, quoted in
 * docs/source-forms/mdh-aot-resource-center-2026-10-20.md). No links are known for these, so they are
 * seeded as DRAFTS with no URL: staff add and verify the link (or phone) before activating
 * (activationProblem blocks activation until then). The 988 Lifeline is already seeded as `crisis-988`
 * with its verified link, so it is not duplicated here.
 */
export type AotResourceSeed = {
  seedKey: string;
  kind: ResourceKind;
  title: string;
  summary: string;
  /** Contact details exactly as quoted from the MDH page (not verified against the publisher's own page) */
  contactText?: string;
  topics: Topic[];
  audiences: Audience[];
  publisher: string;
};

export const AOT_LINK_NEEDED_NOTE =
  'Listed on the MDH AOT Resource Center page (2026-10-20). Link to be added by staff: add and verify the publisher link before activating. Linked, not copied.';

export const AOT_RESOURCE_SEEDS: readonly AotResourceSeed[] = [
  {
    seedKey: 'aot-nami-family-helpline', kind: 'community', title: 'NAMI Family Caregiver HelpLine',
    summary: 'Support for family caregivers. Monday–Friday 10:00 AM–10:00 PM ET. Link to be added by staff.',
    contactText: "Call 1-800-950-NAMI (6264) and press 4; text 'Family' to 62640; email helpline@nami.org",
    topics: ['family_caregivers', 'serious_mental_illness'], audiences: ['caregiver'], publisher: 'NAMI',
  },
  {
    seedKey: 'aot-mdh-elearning', kind: 'link', title: 'Maryland AOT E-Learning Portal (MDH)',
    summary: 'Free training for anyone with a role in AOT. Link to be added by staff.',
    topics: ['serious_mental_illness', 'family_caregivers'], audiences: ['adult', 'caregiver'], publisher: 'Maryland Department of Health',
  },
  {
    seedKey: 'aot-mdh-toolkits', kind: 'link', title: 'Maryland AOT Toolkits (MDH BHA)',
    summary: 'Roadmaps, petitioning guidance, eligibility, provider guides and FAQs, in multiple languages. Link to be added by staff.',
    topics: ['serious_mental_illness', 'family_caregivers'], audiences: ['adult', 'caregiver'], publisher: 'Maryland Department of Health, Behavioral Health Administration',
  },
  {
    seedKey: 'aot-tac', kind: 'link', title: 'Treatment Advocacy Center',
    summary: 'AOT information, anosognosia resources and one-pagers on serious mental illness. Link to be added by staff.',
    topics: ['serious_mental_illness', 'family_caregivers'], audiences: ['adult', 'caregiver'], publisher: 'Treatment Advocacy Center',
  },
  {
    seedKey: 'aot-nami-maryland', kind: 'community', title: 'NAMI Maryland',
    summary: 'Local affiliates, peer-led support groups and classes. Link to be added by staff.',
    topics: ['serious_mental_illness', 'family_caregivers', 'community_services'], audiences: ['adult', 'caregiver'], publisher: 'NAMI Maryland',
  },
];
