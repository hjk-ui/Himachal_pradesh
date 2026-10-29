import { AIMS_EXAM_PROCEDURE, AIMS_NAME, AIMS_QUESTIONS } from './aims';

interface Option { label: string; value: number; }
interface Question { text: string; options: Option[]; note?: string; conditional?: boolean; }
interface ScoreRange { min: number; max: number; label: string; color: string; }

interface Instrument {
  key: string; name: string; fullName: string; category: string;
  type: 'self_report' | 'clinician_rated'; timeMin: number;
  description: string; totalItems: number; maxScore: number;
  questions?: Question[]; scoreRanges: ScoreRange[];
  alertNote?: string; administrationNote?: string; requiresAge?: string;
  /** Item wording and scoring not reproduced here: administer the official form until a licensed copy is added */
  itemContentPending?: boolean;
}

// ─── Shared Option Sets ───────────────────────────────────────────────────────

const FREQ4: Option[] = [
  { label: 'Not at all', value: 0 }, { label: 'Several days', value: 1 },
  { label: 'More than half the days', value: 2 }, { label: 'Nearly every day', value: 3 },
];
const FREQ5: Option[] = [
  { label: 'Never', value: 0 }, { label: 'Rarely', value: 1 },
  { label: 'Sometimes', value: 2 }, { label: 'Often', value: 3 }, { label: 'Very Often', value: 4 },
];
const SEV5: Option[] = [
  { label: 'Not at all', value: 0 }, { label: 'A little bit', value: 1 },
  { label: 'Moderately', value: 2 }, { label: 'Quite a bit', value: 3 }, { label: 'Extremely', value: 4 },
];
const AGREE5: Option[] = [
  { label: 'Not at all', value: 0 }, { label: 'A little', value: 1 },
  { label: 'Somewhat', value: 2 }, { label: 'Much', value: 3 }, { label: 'Very much', value: 4 },
];
const YESNO: Option[] = [{ label: 'No', value: 0 }, { label: 'Yes', value: 1 }];
const SPIN5: Option[] = [
  { label: 'Not at all', value: 0 }, { label: 'A little bit', value: 1 },
  { label: 'Somewhat', value: 2 }, { label: 'Very much', value: 3 }, { label: 'Extremely', value: 4 },
];
const SCARD3: Option[] = [
  { label: 'Not True or Hardly Ever True', value: 0 },
  { label: 'Somewhat True or Sometimes True', value: 1 },
  { label: 'Very True or Often True', value: 2 },
];
const DASS4: Option[] = [
  { label: 'Did not apply to me at all', value: 0 },
  { label: 'Applied to me to some degree, or some of the time', value: 1 },
  { label: 'Applied to me to a considerable degree, or a good part of time', value: 2 },
  { label: 'Applied to me very much, or most of the time', value: 3 },
];
const PCT11: Option[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => ({ label: `${v}%`, value: v }));

// ─── Instrument Definitions ───────────────────────────────────────────────────

const INSTRUMENTS: Instrument[] = [
  // ── Depression / Mood ────────────────────────────────────────────────────────
  {
    key: 'PHQ-9', name: 'PHQ-9', fullName: 'Patient Health Questionnaire-9',
    category: 'Depression / Mood', type: 'self_report', timeMin: 2, totalItems: 9, maxScore: 27,
    description: 'Gold-standard depression screen. Item 9 (SI) triggers mandatory safety protocol.',
    alertNote: 'ALERT: Item 9 ≥ 1 requires immediate C-SSRS and safety plan.',
    scoreRanges: [
      { min: 0, max: 4, label: 'Minimal', color: '#22c55e' }, { min: 5, max: 9, label: 'Mild', color: '#84cc16' },
      { min: 10, max: 14, label: 'Moderate', color: '#f59e0b' }, { min: 15, max: 19, label: 'Mod. Severe', color: '#f97316' },
      { min: 20, max: 27, label: 'Severe', color: '#ef4444' },
    ],
    questions: [
      { text: 'Little interest or pleasure in doing things', options: FREQ4 },
      { text: 'Feeling down, depressed, or hopeless', options: FREQ4 },
      { text: 'Trouble falling or staying asleep, or sleeping too much', options: FREQ4 },
      { text: 'Feeling tired or having little energy', options: FREQ4 },
      { text: 'Poor appetite or overeating', options: FREQ4 },
      { text: 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down', options: FREQ4 },
      { text: 'Trouble concentrating on things, such as reading the newspaper or watching television', options: FREQ4 },
      { text: 'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual', options: FREQ4 },
      { text: 'Thoughts that you would be better off dead, or of hurting yourself in some way', options: FREQ4, note: 'Positive response requires immediate safety assessment' },
    ],
    administrationNote: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
  },
  {
    key: 'PHQ-2', name: 'PHQ-2', fullName: 'Patient Health Questionnaire-2',
    category: 'Depression / Mood', type: 'self_report', timeMin: 1, totalItems: 2, maxScore: 6,
    description: 'Ultra-brief depression screener. Score ≥ 3 warrants full PHQ-9.',
    scoreRanges: [
      { min: 0, max: 2, label: 'Screen Negative', color: '#22c55e' }, { min: 3, max: 6, label: 'Screen Positive', color: '#ef4444' },
    ],
    questions: [
      { text: 'Little interest or pleasure in doing things', options: FREQ4 },
      { text: 'Feeling down, depressed, or hopeless', options: FREQ4 },
    ],
    administrationNote: 'Over the last 2 weeks, how often have you been bothered by:',
  },
  {
    key: 'MDQ', name: 'MDQ', fullName: 'Mood Disorder Questionnaire',
    category: 'Depression / Mood', type: 'self_report', timeMin: 5, totalItems: 15, maxScore: 15,
    description: 'Bipolar disorder screening tool. Positive: 7+ yes + same period + moderate/serious impairment.',
    // Read by parts (standardScoring.ts), not by a total band
    scoreRanges: [],
    questions: [
      { text: 'You felt so good or so hyper that other people thought you were not your normal self, or you were so hyper that you got into trouble?', options: YESNO },
      { text: 'You were so irritable that you shouted at people or started fights or arguments?', options: YESNO },
      { text: 'You felt much more self-confident than usual?', options: YESNO },
      { text: 'You got much less sleep than usual and found you didn\'t really miss it?', options: YESNO },
      { text: 'You were much more talkative or spoke faster than usual?', options: YESNO },
      { text: 'Thoughts raced through your head or you couldn\'t slow your mind down?', options: YESNO },
      { text: 'You were so easily distracted that you had trouble concentrating or staying on track?', options: YESNO },
      { text: 'You had much more energy than usual?', options: YESNO },
      { text: 'You were much more active or did many more things than usual?', options: YESNO },
      { text: 'You were much more social or outgoing than usual — for example, you telephoned friends in the middle of the night?', options: YESNO },
      { text: 'You were much more interested in sex than usual?', options: YESNO },
      { text: 'You did things that were unusual for you or that other people might have thought were excessive, foolish, or risky?', options: YESNO },
      { text: 'Spending money got you or your family in trouble?', options: YESNO },
      { text: 'If you checked YES to more than one of the above, did several of these happen during the same period of time?', options: YESNO },
      { text: 'How much of a problem did any of these cause you (at their most severe)?', options: [{ label: 'No problem', value: 0 }, { label: 'Minor problem', value: 0 }, { label: 'Moderate problem', value: 1 }, { label: 'Serious problem', value: 1 }] },
    ],
    administrationNote: 'Has there ever been a period of time when you were not your usual self and…',
  },
  {
    key: 'RMS', name: 'RMS', fullName: 'Rapid Mood Screener',
    category: 'Depression / Mood', type: 'self_report', timeMin: 3, totalItems: 10, maxScore: 10,
    description: 'Brief bipolar I screening tool (McIntyre et al. 2021). Score ≥ 5 suggests screen-positive for Bipolar I and warrants MDQ / psychiatric referral.',
    alertNote: 'Score ≥ 5: Screen Positive — Bipolar I. Consider MDQ and psychiatric referral.',
    scoreRanges: [
      { min: 0, max: 4, label: 'Screen Negative', color: '#22c55e' },
      { min: 5, max: 10, label: 'Screen Positive — Bipolar I', color: '#ef4444' },
    ],
    questions: [
      { text: 'Have you had a period of 4 consecutive days or more when you felt so good or hyper that other people thought you were not your normal self, or you were so hyper that you got into trouble?', options: YESNO },
      { text: 'Have you had a period of 4 consecutive days or more when you were so irritable that you shouted at people or started fights or arguments?', options: YESNO },
      { text: 'Have you had a period of 4 consecutive days or more when you needed much less sleep than usual and found you didn\'t really miss it?', options: YESNO },
      { text: 'Have you had a period of 4 consecutive days or more when thoughts raced through your head or you couldn\'t slow your mind down?', options: YESNO },
      { text: 'Have you had a period of 4 consecutive days or more when you were much more talkative or spoke much faster than usual?', options: YESNO },
      { text: 'Have you had a period of 4 consecutive days or more when you were much more active or did many more things than usual?', options: YESNO },
      { text: 'Have you had a period of 4 consecutive days or more when you did things that were unusual for you or that other people might have thought were excessive, foolish, or risky — and that you later regretted?', options: YESNO },
      { text: 'Have you ever been prescribed a mood stabilizer or antipsychotic medication (medications commonly used to treat bipolar disorder)?', options: YESNO },
      { text: 'Have you ever been told by a healthcare provider that you have bipolar disorder?', options: YESNO },
      { text: 'Has a blood relative (parent, sibling, child, aunt/uncle, niece/nephew, or grandparent) ever been diagnosed with bipolar disorder?', options: YESNO },
    ],
    administrationNote: 'McIntyre et al. 2021. Please answer Yes or No for each item based on your lifetime experience.',
  },
  {
    key: 'EPDS', name: 'EPDS', fullName: 'Edinburgh Postnatal Depression Scale',
    category: 'Depression / Mood', type: 'self_report', timeMin: 3, totalItems: 10, maxScore: 30,
    description: 'Perinatal depression screen. Score ≥ 10 suggests possible depression. Item 10 (self-harm) requires safety assessment.',
    alertNote: 'Item 10 > 0 requires immediate safety assessment.',
    requiresAge: 'Perinatal (pregnant or within 1 year postpartum)',
    scoreRanges: [
      { min: 0, max: 9, label: 'Screen Negative', color: '#22c55e' }, { min: 10, max: 12, label: 'Possible Depression', color: '#f59e0b' },
      { min: 13, max: 30, label: 'Likely Depression', color: '#ef4444' },
    ],
    questions: [
      { text: 'I have been able to laugh and see the funny side of things', options: [{ label: 'As much as I always could', value: 0 }, { label: 'Not quite so much now', value: 1 }, { label: 'Definitely not so much now', value: 2 }, { label: 'Not at all', value: 3 }] },
      { text: 'I have looked forward with enjoyment to things', options: [{ label: 'As much as I ever did', value: 0 }, { label: 'Rather less than I used to', value: 1 }, { label: 'Definitely less than I used to', value: 2 }, { label: 'Hardly at all', value: 3 }] },
      { text: 'I have blamed myself unnecessarily when things went wrong', options: [{ label: 'Yes, most of the time', value: 3 }, { label: 'Yes, some of the time', value: 2 }, { label: 'Not very often', value: 1 }, { label: 'No, never', value: 0 }] },
      { text: 'I have been anxious or worried for no good reason', options: [{ label: 'No, not at all', value: 0 }, { label: 'Hardly ever', value: 1 }, { label: 'Yes, sometimes', value: 2 }, { label: 'Yes, very often', value: 3 }] },
      { text: 'I have felt scared or panicky for no very good reason', options: [{ label: 'Yes, quite a lot', value: 3 }, { label: 'Yes, sometimes', value: 2 }, { label: 'No, not much', value: 1 }, { label: 'No, not at all', value: 0 }] },
      { text: 'Things have been getting on top of me', options: [{ label: 'Yes, most of the time I haven\'t been able to cope at all', value: 3 }, { label: 'Yes, sometimes I haven\'t been coping as well as usual', value: 2 }, { label: 'No, most of the time I have coped quite well', value: 1 }, { label: 'No, I have been coping as well as ever', value: 0 }] },
      { text: 'I have been so unhappy that I have had difficulty sleeping', options: [{ label: 'Yes, most of the time', value: 3 }, { label: 'Yes, sometimes', value: 2 }, { label: 'Not very often', value: 1 }, { label: 'No, not at all', value: 0 }] },
      { text: 'I have felt sad or miserable', options: [{ label: 'Yes, most of the time', value: 3 }, { label: 'Yes, quite often', value: 2 }, { label: 'Not very often', value: 1 }, { label: 'No, not at all', value: 0 }] },
      { text: 'I have been so unhappy that I have been crying', options: [{ label: 'Yes, most of the time', value: 3 }, { label: 'Yes, quite often', value: 2 }, { label: 'Only occasionally', value: 1 }, { label: 'No, never', value: 0 }] },
      { text: 'The thought of harming myself has occurred to me', options: [{ label: 'Yes, quite often', value: 3 }, { label: 'Sometimes', value: 2 }, { label: 'Hardly ever', value: 1 }, { label: 'Never', value: 0 }], note: 'Any positive response requires safety assessment' },
    ],
    administrationNote: 'As you are pregnant or have recently had a baby, we would like to know how you are feeling. Please check the answer that comes closest to how you have felt IN THE PAST 7 DAYS, not just how you feel today.',
  },
  {
    key: 'GDS-15', name: 'GDS-15', fullName: 'Geriatric Depression Scale — Short Form',
    category: 'Depression / Mood', type: 'self_report', timeMin: 5, totalItems: 15, maxScore: 15,
    description: 'Depression screening validated for older adults (65+). Yes/No format reduces cognitive burden.',
    requiresAge: 'Adults 65+',
    scoreRanges: [
      { min: 0, max: 4, label: 'Normal', color: '#22c55e' }, { min: 5, max: 8, label: 'Mild Depression', color: '#f59e0b' },
      { min: 9, max: 11, label: 'Moderate Depression', color: '#f97316' }, { min: 12, max: 15, label: 'Severe Depression', color: '#ef4444' },
    ],
    questions: [
      { text: 'Are you basically satisfied with your life?', options: [{ label: 'Yes', value: 0 }, { label: 'No', value: 1 }] },
      { text: 'Have you dropped many of your activities and interests?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you feel that your life is empty?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you often get bored?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Are you in good spirits most of the time?', options: [{ label: 'Yes', value: 0 }, { label: 'No', value: 1 }] },
      { text: 'Are you afraid that something bad is going to happen to you?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you feel happy most of the time?', options: [{ label: 'Yes', value: 0 }, { label: 'No', value: 1 }] },
      { text: 'Do you often feel helpless?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you prefer to stay at home, rather than going out and doing new things?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you feel you have more problems with memory than most?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you think it is wonderful to be alive now?', options: [{ label: 'Yes', value: 0 }, { label: 'No', value: 1 }] },
      { text: 'Do you feel pretty worthless the way you are now?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you feel full of energy?', options: [{ label: 'Yes', value: 0 }, { label: 'No', value: 1 }] },
      { text: 'Do you feel that your situation is hopeless?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
      { text: 'Do you think that most people are better off than you are?', options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }] },
    ],
    administrationNote: 'Choose the best answer for how you have felt over the past week.',
  },

  // ── Anxiety ──────────────────────────────────────────────────────────────────
  {
    key: 'GAD-7', name: 'GAD-7', fullName: 'Generalized Anxiety Disorder-7',
    category: 'Anxiety', type: 'self_report', timeMin: 2, totalItems: 7, maxScore: 21,
    description: 'Primary anxiety screener for GAD, panic, social anxiety, PTSD, and OCD.',
    scoreRanges: [
      { min: 0, max: 4, label: 'Minimal', color: '#22c55e' }, { min: 5, max: 9, label: 'Mild', color: '#84cc16' },
      { min: 10, max: 14, label: 'Moderate', color: '#f59e0b' }, { min: 15, max: 21, label: 'Severe', color: '#ef4444' },
    ],
    questions: [
      { text: 'Feeling nervous, anxious, or on edge', options: FREQ4 },
      { text: 'Not being able to stop or control worrying', options: FREQ4 },
      { text: 'Worrying too much about different things', options: FREQ4 },
      { text: 'Trouble relaxing', options: FREQ4 },
      { text: 'Being so restless that it is hard to sit still', options: FREQ4 },
      { text: 'Becoming easily annoyed or irritable', options: FREQ4 },
      { text: 'Feeling afraid, as if something awful might happen', options: FREQ4 },
    ],
    administrationNote: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
  },
  {
    key: 'GAD-2', name: 'GAD-2', fullName: 'Generalized Anxiety Disorder-2',
    category: 'Anxiety', type: 'self_report', timeMin: 1, totalItems: 2, maxScore: 6,
    description: 'Ultra-brief anxiety screener. Score ≥ 3 warrants full GAD-7.',
    scoreRanges: [
      { min: 0, max: 2, label: 'Screen Negative', color: '#22c55e' }, { min: 3, max: 6, label: 'Screen Positive', color: '#ef4444' },
    ],
    questions: [
      { text: 'Feeling nervous, anxious, or on edge', options: FREQ4 },
      { text: 'Not being able to stop or control worrying', options: FREQ4 },
    ],
    administrationNote: 'Over the last 2 weeks, how often have you been bothered by:',
  },
  {
    key: 'OCI-R', name: 'OCI-R', fullName: 'OCD Inventory — Revised',
    category: 'Anxiety', type: 'self_report', timeMin: 5, totalItems: 18, maxScore: 72,
    description: 'OCD symptom severity across 6 subscales. Score ≥ 21 suggests OCD.',
    scoreRanges: [
      { min: 0, max: 20, label: 'Below OCD Threshold', color: '#22c55e' }, { min: 21, max: 40, label: 'Moderate OCD', color: '#f59e0b' },
      { min: 41, max: 72, label: 'Severe OCD', color: '#ef4444' },
    ],
    questions: [
      { text: 'I have saved up so many things that they get in the way', options: AGREE5 },
      { text: 'I check things more often than necessary', options: AGREE5 },
      { text: 'I get upset if objects are not arranged properly', options: AGREE5 },
      { text: 'I feel compelled to count while I am doing things', options: AGREE5 },
      { text: 'I find it difficult to touch an object when I know it has been touched by strangers or certain people', options: AGREE5 },
      { text: 'I find it difficult to control my own thoughts', options: AGREE5 },
      { text: 'I collect things I don\'t need', options: AGREE5 },
      { text: 'I repeatedly check doors, windows, drawers, etc.', options: AGREE5 },
      { text: 'I get upset if others change the way I have arranged things', options: AGREE5 },
      { text: 'I feel I have to repeat certain numbers', options: AGREE5 },
      { text: 'I sometimes have to wash or clean myself simply because I feel contaminated', options: AGREE5 },
      { text: 'I am upset by unpleasant thoughts that come into my mind against my will', options: AGREE5 },
      { text: 'I avoid throwing things away because I am afraid I might need them later', options: AGREE5 },
      { text: 'I repeatedly check gas and water taps and light switches after turning them off', options: AGREE5 },
      { text: 'I need things to be arranged in a particular order', options: AGREE5 },
      { text: 'I feel that there are good and bad numbers', options: AGREE5 },
      { text: 'I wash my hands more often and longer than necessary', options: AGREE5 },
      { text: 'I frequently get nasty thoughts and have difficulty getting rid of them', options: AGREE5 },
    ],
    administrationNote: 'The following statements refer to experiences that many people have in their everyday lives. Rate how much that experience has distressed or bothered you during the past month.',
  },

  // ── Trauma / PTSD ────────────────────────────────────────────────────────────
  {
    key: 'PCL-5', name: 'PCL-5', fullName: 'PTSD Checklist for DSM-5',
    category: 'Trauma / PTSD', type: 'self_report', timeMin: 5, totalItems: 20, maxScore: 80,
    description: 'PTSD symptom severity screen. Score ≥ 33 suggests probable PTSD. Maps to DSM-5 criteria.',
    scoreRanges: [
      { min: 0, max: 32, label: 'Below Threshold', color: '#22c55e' },
      { min: 33, max: 80, label: 'Probable PTSD', color: '#ef4444' },
    ],
    questions: [
      { text: 'Repeated, disturbing, and unwanted memories of the stressful experience?' },
      { text: 'Repeated, disturbing dreams of the stressful experience?' },
      { text: 'Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?' },
      { text: 'Feeling very upset when something reminded you of the stressful experience?' },
      { text: 'Having strong physical reactions when something reminded you of the stressful experience (for example, heart pounding, trouble breathing, sweating)?' },
      { text: 'Avoiding memories, thoughts, or feelings related to the stressful experience?' },
      { text: 'Avoiding external reminders of the stressful experience (for example, people, places, conversations, activities, objects, or situations)?' },
      { text: 'Trouble remembering important parts of the stressful experience?' },
      { text: 'Having strong negative beliefs about yourself, other people, or the world (for example, having thoughts such as: I am bad, there is something seriously wrong with me, no one can be trusted, the world is completely dangerous)?' },
      { text: 'Blaming yourself or someone else for the stressful experience or what happened after it?' },
      { text: 'Having strong negative feelings such as fear, horror, anger, guilt, or shame?' },
      { text: 'Loss of interest in activities that you used to enjoy?' },
      { text: 'Feeling distant or cut off from other people?' },
      { text: 'Trouble experiencing positive feelings (for example, being unable to feel happiness or have loving feelings for people close to you)?' },
      { text: 'Irritable behavior, angry outbursts, or acting aggressively?' },
      { text: 'Taking too many risks or doing things that could cause you harm?' },
      { text: 'Being "superalert" or watchful or on guard?' },
      { text: 'Feeling jumpy or easily startled?' },
      { text: 'Having difficulty concentrating?' },
      { text: 'Trouble falling or staying asleep?' },
    ].map(q => ({ ...q, options: SEV5 })),
    administrationNote: 'Below is a list of problems that people sometimes have in response to a very stressful experience. Please read each problem carefully and then circle one of the numbers to the right to indicate how much you have been bothered by that problem in the past month.',
  },
  {
    key: 'ACEs', name: 'ACEs', fullName: 'Adverse Childhood Experiences Survey',
    category: 'Trauma / PTSD', type: 'self_report', timeMin: 5, totalItems: 10, maxScore: 10,
    description: 'Childhood trauma exposure. Score ≥ 4 associated with significantly elevated health risks.',
    scoreRanges: [
      { min: 0, max: 1, label: 'Low', color: '#22c55e' }, { min: 2, max: 3, label: 'Moderate', color: '#f59e0b' },
      { min: 4, max: 6, label: 'High', color: '#f97316' }, { min: 7, max: 10, label: 'Very High', color: '#ef4444' },
    ],
    questions: [
      { text: 'Did a parent or other adult in the household often swear at you, insult you, put you down, or humiliate you? Or act in a way that made you afraid that you might be physically hurt?', options: YESNO },
      { text: 'Did a parent or other adult in the household often push, grab, slap, or throw something at you? Or ever hit you so hard that you had marks or were injured?', options: YESNO },
      { text: 'Did an adult or person at least 5 years older than you ever touch or fondle you or have you touch their body in a sexual way? Or try to or actually have oral, anal, or vaginal sex with you?', options: YESNO },
      { text: 'Did you often feel that no one in your family loved you or thought you were important or special? Or that your family didn\'t look out for each other, feel close to each other, or support each other?', options: YESNO },
      { text: 'Did you often feel that you didn\'t have enough to eat, had to wear dirty clothes, and had no one to protect you? Or that your parents were too drunk or high to take care of you or take you to the doctor if you needed it?', options: YESNO },
      { text: 'Were your parents ever separated or divorced?', options: YESNO },
      { text: 'Was your mother or stepmother often pushed, grabbed, slapped, or had something thrown at her? Or sometimes or often kicked, bitten, hit with a fist, or hit with something hard? Or ever repeatedly hit for at least a few minutes or threatened with a gun or knife?', options: YESNO },
      { text: 'Did you live with anyone who was a problem drinker or alcoholic or who used street drugs?', options: YESNO },
      { text: 'Was a household member depressed or mentally ill or did a household member attempt suicide?', options: YESNO },
      { text: 'Did a household member go to prison?', options: YESNO },
    ],
    administrationNote: 'While you were growing up, during your first 18 years of life…',
  },

  // ── ADHD ─────────────────────────────────────────────────────────────────────
  {
    key: 'ASRS', name: 'ASRS-v1.1', fullName: 'Adult ADHD Self-Report Scale v1.1 Screener',
    category: 'ADHD / Cognitive', type: 'self_report', timeMin: 3, totalItems: 6, maxScore: 24,
    description: 'WHO ADHD screener for adults. 4+ darkened boxes = positive screen. Part A items 1–3 threshold: Sometimes; items 4–6 threshold: Often.',
    // Read by the shaded count (standardScoring.ts), not by a total band
    scoreRanges: [],
    questions: [
      { text: 'How often do you have trouble wrapping up the final details of a project, once the challenging parts have been done?', options: FREQ5 },
      { text: 'How often do you have difficulty getting things in order when you have to do a task that requires organization?', options: FREQ5 },
      { text: 'How often do you have problems remembering appointments or obligations?', options: FREQ5 },
      { text: 'When you have a task that requires a lot of thought, how often do you avoid or delay getting started?', options: FREQ5 },
      { text: 'How often do you fidget or squirm with your hands or feet when you have to sit down for a long time?', options: FREQ5 },
      { text: 'How often do you feel overly active and compelled to do things, like you were driven by a motor?', options: FREQ5 },
    ],
    administrationNote: 'Please answer the questions below, rating yourself on each of the criteria shown using the scale on the right side of the page. As you answer each question, place an X in the box that best describes how you have felt and conducted yourself over the past 6 months.',
  },

  // ── Substance Use ─────────────────────────────────────────────────────────────
  {
    key: 'AUDIT', name: 'AUDIT', fullName: 'Alcohol Use Disorders Identification Test',
    category: 'Substance Use', type: 'self_report', timeMin: 3, totalItems: 10, maxScore: 40,
    description: 'WHO 10-item alcohol screen. Gold standard across settings.',
    scoreRanges: [
      { min: 0, max: 7, label: 'Low Risk', color: '#22c55e' }, { min: 8, max: 15, label: 'Hazardous', color: '#f59e0b' },
      { min: 16, max: 19, label: 'Harmful', color: '#f97316' }, { min: 20, max: 40, label: 'Possible Dependence', color: '#ef4444' },
    ],
    questions: [
      { text: 'How often do you have a drink containing alcohol?', options: [{ label: 'Never', value: 0 }, { label: 'Monthly or less', value: 1 }, { label: '2–4 times a month', value: 2 }, { label: '2–3 times a week', value: 3 }, { label: '4+ times a week', value: 4 }] },
      { text: 'How many standard drinks containing alcohol do you have on a typical day when you are drinking?', options: [{ label: '1 or 2', value: 0 }, { label: '3 or 4', value: 1 }, { label: '5 or 6', value: 2 }, { label: '7 to 9', value: 3 }, { label: '10 or more', value: 4 }] },
      { text: 'How often do you have 6 or more drinks on one occasion?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
      { text: 'How often during the last year have you found that you were not able to stop drinking once you had started?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
      { text: 'How often during the last year have you failed to do what was normally expected from you because of your drinking?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
      { text: 'How often during the last year have you needed an alcoholic drink in the morning to get yourself going after a heavy drinking session?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
      { text: 'How often during the last year have you had a feeling of guilt or remorse after drinking?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
      { text: 'How often during the last year have you been unable to remember what happened the night before because you had been drinking?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
      { text: 'Have you or someone else been injured as a result of your drinking?', options: [{ label: 'No', value: 0 }, { label: 'Yes, but not in the last year', value: 2 }, { label: 'Yes, during the last year', value: 4 }] },
      { text: 'Has a relative, friend, doctor, or another health professional expressed concern about your drinking or suggested you cut down?', options: [{ label: 'No', value: 0 }, { label: 'Yes, but not in the last year', value: 2 }, { label: 'Yes, during the last year', value: 4 }] },
    ],
    administrationNote: 'Now I am going to ask you some questions about your use of alcoholic beverages during this past year.',
  },
  {
    key: 'AUDIT-C', name: 'AUDIT-C', fullName: 'Alcohol Use Disorders Identification Test — Consumption',
    category: 'Substance Use', type: 'self_report', timeMin: 1, totalItems: 3, maxScore: 12,
    description: '3-item alcohol screener. Men: ≥ 4 positive. Women: ≥ 3 positive.',
    scoreRanges: [
      { min: 0, max: 3, label: 'Low Risk (Women: ≤2)', color: '#22c55e' }, { min: 4, max: 12, label: 'Hazardous / Harmful', color: '#ef4444' },
    ],
    questions: [
      { text: 'How often do you have a drink containing alcohol?', options: [{ label: 'Never', value: 0 }, { label: 'Monthly or less', value: 1 }, { label: '2–4 times a month', value: 2 }, { label: '2–3 times a week', value: 3 }, { label: '4+ times a week', value: 4 }] },
      { text: 'How many standard drinks containing alcohol do you have on a typical day when you are drinking?', options: [{ label: '1 or 2', value: 0 }, { label: '3 or 4', value: 1 }, { label: '5 or 6', value: 2 }, { label: '7 to 9', value: 3 }, { label: '10 or more', value: 4 }] },
      { text: 'How often do you have 6 or more drinks on one occasion?', options: [{ label: 'Never', value: 0 }, { label: 'Less than monthly', value: 1 }, { label: 'Monthly', value: 2 }, { label: 'Weekly', value: 3 }, { label: 'Daily or almost daily', value: 4 }] },
    ],
    administrationNote: 'Please answer these questions about your alcohol use.',
  },
  {
    key: 'DAST-10', name: 'DAST-10', fullName: 'Drug Abuse Screening Test — 10',
    category: 'Substance Use', type: 'self_report', timeMin: 3, totalItems: 10, maxScore: 10,
    description: '10-item drug use screen (excluding alcohol and tobacco). Score ≥ 3 indicates moderate problem.',
    scoreRanges: [
      { min: 0, max: 2, label: 'Low (No/Low)', color: '#22c55e' }, { min: 3, max: 5, label: 'Moderate', color: '#f59e0b' },
      { min: 6, max: 8, label: 'Substantial', color: '#f97316' }, { min: 9, max: 10, label: 'Severe', color: '#ef4444' },
    ],
    questions: [
      { text: 'Have you used drugs other than those required for medical reasons?', options: YESNO },
      { text: 'Do you abuse more than one drug at a time?', options: YESNO },
      { text: 'Are you unable to stop using drugs when you want to?', options: YESNO },
      { text: 'Have you ever had blackouts or flashbacks as a result of drug use?', options: YESNO },
      { text: 'Do you ever feel bad or guilty about your drug use?', options: YESNO },
      { text: 'Does your spouse (or parents) ever complain about your involvement with drugs?', options: YESNO },
      { text: 'Have you neglected your family because of your use of drugs?', options: YESNO },
      { text: 'Have you engaged in illegal activities in order to obtain drugs?', options: YESNO },
      { text: 'Have you ever experienced withdrawal symptoms (felt sick) when you stopped taking drugs?', options: YESNO },
      { text: 'Have you had medical problems as a result of your drug use (e.g., memory loss, hepatitis, convulsions, bleeding, etc.)?', options: YESNO },
    ],
    administrationNote: 'The following questions concern information about your potential involvement with drugs not including alcoholic beverages during the past 12 months.',
  },
  {
    key: 'CAGE-AID', name: 'CAGE-AID', fullName: 'CAGE Adapted to Include Drugs',
    category: 'Substance Use', type: 'self_report', timeMin: 2, totalItems: 4, maxScore: 4,
    description: '4-question combined alcohol and drug screen. Score ≥ 2 suggests dependence.',
    scoreRanges: [
      { min: 0, max: 1, label: 'Screen Negative', color: '#22c55e' }, { min: 2, max: 4, label: 'Screen Positive', color: '#ef4444' },
    ],
    questions: [
      { text: 'Have you ever felt you ought to Cut down on your drinking or drug use?', options: YESNO },
      { text: 'Have people Annoyed you by criticizing your drinking or drug use?', options: YESNO },
      { text: 'Have you ever felt bad or Guilty about your drinking or drug use?', options: YESNO },
      { text: 'Have you ever had a drink or used drugs first thing in the morning to steady your nerves or to get rid of a hangover (Eye-opener)?', options: YESNO },
    ],
    administrationNote: 'Please answer Yes or No to the following questions.',
  },
  {
    key: 'CRAFFT', name: 'CRAFFT', fullName: 'Car, Relax, Alone, Forget, Friends, Trouble',
    category: 'Substance Use', type: 'self_report', timeMin: 3, totalItems: 6, maxScore: 6,
    description: 'Validated substance use screen for adolescents aged 12–21. Score ≥ 2 warrants full assessment.',
    requiresAge: 'Adolescents 12–21',
    scoreRanges: [
      { min: 0, max: 1, label: 'Screen Negative', color: '#22c55e' }, { min: 2, max: 6, label: 'Screen Positive', color: '#ef4444' },
    ],
    questions: [
      { text: 'Have you ever ridden in a CAR driven by someone (including yourself) who was "high" or had been using alcohol or drugs?', options: YESNO },
      { text: 'Do you ever use alcohol or drugs to RELAX, feel better about yourself, or fit in?', options: YESNO },
      { text: 'Do you ever use alcohol or drugs while you are by yourself, ALONE?', options: YESNO },
      { text: 'Do you ever FORGET things you did while using alcohol or drugs?', options: YESNO },
      { text: 'Do your family or FRIENDS ever tell you that you should cut down on your drinking or drug use?', options: YESNO },
      { text: 'Have you ever gotten into TROUBLE while you were using alcohol or drugs?', options: YESNO },
    ],
    administrationNote: 'During the past 12 months, on how many days did you drink more than a few sips of beer, wine, or any drink containing alcohol? [If 0 days, answer Car question only] On how many days did you use marijuana? On how many days did you use anything else to get high?',
  },

  // ── Suicide / Safety ─────────────────────────────────────────────────────────
  {
    key: 'C-SSRS', name: 'C-SSRS Brief', fullName: 'Columbia Suicide Severity Rating Scale — Lifetime/Recent',
    category: 'Suicide / Safety', type: 'clinician_rated', timeMin: 5, totalItems: 6, maxScore: 6,
    description: 'FDA-referenced SI severity scale. Structured interview mapping suicidal ideation to behavior. Separate lifetime and recent (past month) ratings.',
    alertNote: 'Any active ideation with intent or plan requires immediate intervention.',
    scoreRanges: [
      { min: 0, max: 0, label: 'No Ideation', color: '#22c55e' }, { min: 1, max: 2, label: 'Passive/Active Ideation', color: '#f59e0b' },
      { min: 3, max: 4, label: 'Ideation w/ Plan', color: '#f97316' }, { min: 5, max: 6, label: 'Intent/Plan/Attempt', color: '#ef4444' },
    ],
    questions: [
      { text: 'Wish to be Dead: Person endorses thoughts about a wish to be dead or not alive anymore, or wish to fall asleep and not wake up.', options: YESNO },
      { text: 'Non-Specific Active Suicidal Thoughts: General, non-specific thoughts of wanting to end one\'s life/commit suicide (e.g., "I\'ve thought about killing myself") without thoughts of ways to kill oneself/associated methods, intent, or plan during the assessment period.', options: YESNO },
      { text: 'Active Suicidal Ideation with Any Methods (Not Plan) without Intent to Act: Person endorses thoughts of suicide and has thought of at least one method during the assessment period.', options: YESNO },
      { text: 'Active Suicidal Ideation with Some Intent to Act, without Specific Plan: Active suicidal thoughts with some intent to act on such thoughts, as opposed to "I have the thoughts but I definitely will not do anything about them."', options: YESNO },
      { text: 'Active Suicidal Ideation with Specific Plan and Intent: Thoughts of killing oneself with details of plan fully or partially worked out and some intent to carry it out.', options: YESNO },
      { text: 'Suicidal Behavior: Any actual, interrupted, or aborted suicidal act or preparatory behavior.', options: YESNO },
    ],
    administrationNote: 'Ask client about each of the following. Score 1 if present in the past month.',
  },
  {
    key: 'SBQ-R', name: 'SBQ-R', fullName: 'Suicidal Behaviors Questionnaire — Revised',
    category: 'Suicide / Safety', type: 'self_report', timeMin: 2, totalItems: 4, maxScore: 18,
    description: '4-item self-report suicide risk screen. Score ≥ 7 (non-clinical) or ≥ 8 (clinical) suggests elevated risk.',
    alertNote: 'Score ≥ 7 in non-clinical populations warrants immediate safety assessment.',
    scoreRanges: [
      { min: 3, max: 6, label: 'Low Risk', color: '#22c55e' }, { min: 7, max: 10, label: 'Elevated Risk', color: '#f97316' },
      { min: 11, max: 18, label: 'High Risk', color: '#ef4444' },
    ],
    questions: [
      { text: 'Have you ever thought about or attempted to kill yourself?', options: [{ label: 'Never', value: 1 }, { label: 'It was just a brief passing thought', value: 2 }, { label: 'I have had a plan at least once and really wanted to die', value: 3 }, { label: 'I have attempted to kill myself, but did not want to die', value: 4 }, { label: 'I have attempted to kill myself, and really hoped to die', value: 5 }] },
      { text: 'How often have you thought about killing yourself in the past year?', options: [{ label: 'Never', value: 1 }, { label: 'Rarely (1 time)', value: 2 }, { label: 'Sometimes (2 times)', value: 3 }, { label: 'Often (3–4 times)', value: 4 }, { label: 'Very often (5 or more)', value: 5 }] },
      { text: 'Have you ever told someone that you were going to commit suicide, or that you might do it?', options: [{ label: 'No', value: 1 }, { label: 'Yes, at one time, but did not really want to die', value: 2 }, { label: 'Yes, at one time, and really wanted to die', value: 3 }, { label: 'Yes, more than once, but did not want to die', value: 3 }, { label: 'Yes, more than once, and really wanted to die', value: 4 }] },
      { text: 'How likely is it that you will attempt suicide someday?', options: [{ label: 'Never', value: 0 }, { label: 'No chance at all', value: 0 }, { label: 'Rather unlikely', value: 1 }, { label: 'Unlikely', value: 1 }, { label: 'Likely', value: 2 }, { label: 'Rather likely', value: 2 }, { label: 'Very likely', value: 3 }] },
    ],
    administrationNote: 'Please read each statement carefully and circle the answer that best applies to you.',
  },

  // ── Functioning / QoL ─────────────────────────────────────────────────────────
  {
    key: 'SDS', name: 'SDS', fullName: 'Sheehan Disability Scale',
    category: 'Functioning', type: 'self_report', timeMin: 2, totalItems: 3, maxScore: 30,
    description: '3-item functioning scale across work/school, social, and family domains. Score ≥ 5 on any subscale suggests significant impairment.',
    scoreRanges: [
      { min: 0, max: 4, label: 'Unimpaired', color: '#22c55e' }, { min: 5, max: 12, label: 'Mild Impairment', color: '#f59e0b' },
      { min: 13, max: 20, label: 'Moderate Impairment', color: '#f97316' }, { min: 21, max: 30, label: 'Severe Impairment', color: '#ef4444' },
    ],
    questions: [
      { text: 'Work/School: Has your illness interfered with your work or studies?', options: [{ label: '0 — Not at all', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }, { label: '5 — Extremely', value: 5 }, { label: '6', value: 6 }, { label: '7', value: 7 }, { label: '8', value: 8 }, { label: '9', value: 9 }, { label: '10', value: 10 }] },
      { text: 'Social Life: Has your illness interfered with your social life and leisure activities?', options: [{ label: '0 — Not at all', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }, { label: '5 — Extremely', value: 5 }, { label: '6', value: 6 }, { label: '7', value: 7 }, { label: '8', value: 8 }, { label: '9', value: 9 }, { label: '10', value: 10 }] },
      { text: 'Family Life/Home Responsibilities: Has your illness interfered with your family life or home responsibilities?', options: [{ label: '0 — Not at all', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }, { label: '5 — Extremely', value: 5 }, { label: '6', value: 6 }, { label: '7', value: 7 }, { label: '8', value: 8 }, { label: '9', value: 9 }, { label: '10', value: 10 }] },
    ],
    administrationNote: 'The following questions ask about how symptoms have disrupted your life. Use the scale below, where 0 = Not at all and 10 = Extremely.',
  },

  // ── Sleep ─────────────────────────────────────────────────────────────────────
  {
    key: 'ISI', name: 'ISI', fullName: 'Insomnia Severity Index',
    category: 'Sleep', type: 'self_report', timeMin: 3, totalItems: 7, maxScore: 28,
    description: '7-item insomnia severity and impact measure. Score ≥ 15 indicates clinical insomnia.',
    scoreRanges: [
      { min: 0, max: 7, label: 'No Insomnia', color: '#22c55e' }, { min: 8, max: 14, label: 'Subthreshold', color: '#84cc16' },
      { min: 15, max: 21, label: 'Moderate Insomnia', color: '#f97316' }, { min: 22, max: 28, label: 'Severe Insomnia', color: '#ef4444' },
    ],
    questions: [
      { text: 'Difficulty FALLING ASLEEP', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Very Severe', value: 4 }] },
      { text: 'Difficulty STAYING ASLEEP', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Very Severe', value: 4 }] },
      { text: 'Problems WAKING UP TOO EARLY', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Very Severe', value: 4 }] },
      { text: 'How SATISFIED/DISSATISFIED are you with your current sleep pattern?', options: [{ label: 'Very Satisfied', value: 0 }, { label: 'Satisfied', value: 1 }, { label: 'Moderately Satisfied', value: 2 }, { label: 'Dissatisfied', value: 3 }, { label: 'Very Dissatisfied', value: 4 }] },
      { text: 'How NOTICEABLE to others do you think your sleep problem is in terms of impairing your quality of life?', options: [{ label: 'Not at all Noticeable', value: 0 }, { label: 'A little', value: 1 }, { label: 'Somewhat', value: 2 }, { label: 'Much', value: 3 }, { label: 'Very much Noticeable', value: 4 }] },
      { text: 'How WORRIED/DISTRESSED are you about your current sleep problem?', options: [{ label: 'Not at all', value: 0 }, { label: 'A little', value: 1 }, { label: 'Somewhat', value: 2 }, { label: 'Much', value: 3 }, { label: 'Very much', value: 4 }] },
      { text: 'To what extent do you consider your sleep problem to INTERFERE with your daily functioning (e.g., daytime fatigue, mood, ability to function at work/daily chores, concentration, memory, mood, etc.) currently?', options: [{ label: 'Not at all', value: 0 }, { label: 'A little', value: 1 }, { label: 'Somewhat', value: 2 }, { label: 'Much', value: 3 }, { label: 'Very much', value: 4 }] },
    ],
    administrationNote: 'Please rate the CURRENT (i.e., last 2 weeks) SEVERITY of your insomnia problem(s).',
  },

  // ── Social Anxiety ────────────────────────────────────────────────────────
  {
    key: 'SPIN', name: 'SPIN', fullName: 'Social Phobia Inventory',
    category: 'Anxiety', type: 'self_report', timeMin: 5, totalItems: 17, maxScore: 68,
    description: 'Social anxiety disorder screen covering fear, avoidance, and physiological distress. Score ≥ 19 suggests social phobia.',
    scoreRanges: [
      { min: 0, max: 20, label: 'None or Very Mild', color: '#22c55e' }, { min: 21, max: 30, label: 'Mild', color: '#84cc16' },
      { min: 31, max: 40, label: 'Moderate', color: '#f59e0b' }, { min: 41, max: 50, label: 'Severe', color: '#f97316' },
      { min: 51, max: 68, label: 'Very Severe', color: '#ef4444' },
    ],
    questions: [
      'I am afraid of people in authority.',
      'I am bothered by blushing in front of people.',
      'Parties and social events scare me.',
      "I avoid talking to people I don't know.",
      'Being criticized scares me a lot.',
      'I avoid doing things or speaking to people for fear of embarrassment.',
      'Sweating in front of people causes me distress.',
      'I avoid going to parties.',
      'I avoid activities in which I am the center of attention.',
      'Talking to strangers scares me.',
      'I avoid having to give speeches.',
      'I would do anything to avoid being criticized.',
      'Heart palpitations bother me when I am around people.',
      'I am afraid of doing things when people might be watching.',
      'Being embarrassed or looking stupid are among my worst fears.',
      'I avoid speaking to anyone in authority.',
      'Trembling or shaking in front of others is distressing to me.',
    ].map(text => ({ text, options: SPIN5 })),
    administrationNote: 'For each item, indicate how much the following bothered you during the past week.',
  },

  // ── Dissociation ─────────────────────────────────────────────────────────
  {
    key: 'DES-II', name: 'DES-II', fullName: 'Dissociative Experiences Scale — II',
    category: 'Trauma / PTSD', type: 'self_report', timeMin: 10, totalItems: 28, maxScore: 100,
    description: 'Measures frequency of dissociative experiences. Mean score ≥ 30 suggests clinically significant dissociation. Screens for depersonalization, derealization, and identity alteration.',
    scoreRanges: [
      { min: 0, max: 9, label: 'Normal Range', color: '#22c55e' }, { min: 10, max: 19, label: 'Mild', color: '#84cc16' },
      { min: 20, max: 29, label: 'Moderate', color: '#f59e0b' }, { min: 30, max: 100, label: 'Significant Dissociation', color: '#ef4444' },
    ],
    questions: [
      'Finding yourself in a place with no idea how you got there.',
      'Listening to someone talk and suddenly realizing you did not hear part or all of what was said.',
      'Not remembering important events in your life (such as a wedding or graduation).',
      'Being accused of lying when you do not think you have lied.',
      'Not recognizing friends or family members.',
      'Standing next to yourself or watching yourself do something as if you were looking at another person.',
      'Looking in a mirror and not recognizing yourself.',
      'Feeling that other people, objects, and the world around you is not real.',
      'Feeling that your body does not seem to belong to you.',
      'Remembering a past event so vividly that you feel as if you were reliving that event.',
      'Feeling in a familiar place but finding it strange and unfamiliar.',
      'Becoming so absorbed in a television show or movie that you are unaware of other events around you.',
      'Becoming so absorbed in a fantasy or daydream that it feels as though it were really happening.',
      'Being able to ignore pain.',
      'Sitting staring off into space, thinking of nothing, unaware of the passage of time.',
      'Talking out loud to yourself when alone.',
      'Acting so differently in one situation compared with another that you feel almost like two different people.',
      'Being in a situation you realize you have been in before, but feeling it for the first time.',
      'Finding yourself dressed in clothes you do not remember putting on.',
      'Finding new things among your belongings that you do not remember buying.',
      'Being approached by people who call you by another name or insist they have met you before.',
      "Not being sure whether things you remember actually happened or whether you just dreamed them.",
      'Not knowing if you have actually done something or only thought about doing it.',
      'Finding notes, drawings, or other writings that you must have done but cannot remember.',
      'Having thoughts, feelings, or impulses that seem to belong to someone else.',
      'Feeling as if you are looking at the world through a fog so that people and objects appear far away.',
      'Getting a feeling of being a witness to your own thoughts, feelings, or actions.',
      'Feeling that your head is filled with voices that are not your own.',
    ].map(text => ({ text, options: PCT11 })),
    administrationNote: 'For each question, please mark the number that shows what percentage of the time you have that experience. 0% = never, 100% = always.',
  },

  // ── Pediatric Depression ─────────────────────────────────────────────────
  {
    key: 'PHQ-A', name: 'PHQ-A', fullName: 'Patient Health Questionnaire — Adolescent Version',
    category: 'Depression / Mood', type: 'self_report', timeMin: 2, totalItems: 9, maxScore: 27,
    description: 'PHQ-9 adapted for adolescents ages 12–17. Same scoring thresholds. Item 9 (SI) triggers mandatory safety protocol.',
    alertNote: 'ALERT: Item 9 ≥ 1 requires immediate C-SSRS and safety plan.',
    requiresAge: 'Adolescents 12–17',
    scoreRanges: [
      { min: 0, max: 4, label: 'Minimal', color: '#22c55e' }, { min: 5, max: 9, label: 'Mild', color: '#84cc16' },
      { min: 10, max: 14, label: 'Moderate', color: '#f59e0b' }, { min: 15, max: 19, label: 'Mod. Severe', color: '#f97316' },
      { min: 20, max: 27, label: 'Severe', color: '#ef4444' },
    ],
    questions: [
      { text: 'Little interest or pleasure in doing things you used to enjoy', options: FREQ4 },
      { text: 'Feeling down, depressed, irritable, or hopeless', options: FREQ4 },
      { text: 'Trouble falling asleep, staying asleep, or sleeping too much', options: FREQ4 },
      { text: 'Feeling tired or having little energy', options: FREQ4 },
      { text: 'Poor appetite, weight loss, or overeating', options: FREQ4 },
      { text: 'Feeling bad about yourself — or feeling like a failure, or that you have let your family down', options: FREQ4 },
      { text: 'Trouble concentrating on things like school work, reading, or watching TV', options: FREQ4 },
      { text: 'Moving or speaking so slowly that other people could have noticed? Or being so fidgety or restless that you were moving around a lot more than usual', options: FREQ4 },
      { text: 'Thoughts of being better off dead, or of hurting yourself in some way, or thoughts of suicide', options: FREQ4, note: 'Positive response requires immediate safety assessment' },
    ],
    administrationNote: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
  },

  // ── Pediatric Anxiety ─────────────────────────────────────────────────────
  {
    key: 'SCARED-C', name: 'SCARED-Child', fullName: 'Screen for Child Anxiety Related Disorders — Child Self-Report (41 items)',
    category: 'Anxiety', type: 'self_report', timeMin: 10, totalItems: 41, maxScore: 82,
    description: 'Pediatric anxiety screen for children/adolescents ages 8–18. Total ≥ 25 suggests possible anxiety disorder. 5 subscales: Panic, Generalized Anxiety, Separation Anxiety, Social Anxiety, School Avoidance.',
    requiresAge: 'Children/Adolescents 8–18',
    scoreRanges: [
      { min: 0, max: 24, label: 'Below Threshold', color: '#22c55e' },
      { min: 25, max: 40, label: 'Possible Anxiety Disorder', color: '#f59e0b' },
      { min: 41, max: 82, label: 'Likely Anxiety Disorder', color: '#ef4444' },
    ],
    questions: [
      'When I feel frightened, it is hard to breathe.',
      'I get headaches when I am at school.',
      "I don't like to be with people I don't know well.",
      'I get scared if I sleep away from home.',
      'I worry about other people liking me.',
      'When I get frightened, I feel like passing out.',
      'I am nervous.',
      'I follow my mother or father wherever they go.',
      'People tell me that I look nervous.',
      "I feel nervous with people I don't know well.",
      'I get stomachaches at school.',
      'When I get frightened, I feel like I am going crazy.',
      'I worry about sleeping alone.',
      'I worry about being as good as other kids.',
      'When I get frightened, I feel like things are not real.',
      'I have nightmares about something bad happening to my parents.',
      'I worry about going to school.',
      'When I get frightened, my heart beats fast.',
      'I get shaky.',
      'I have nightmares about something bad happening to me.',
      'I worry about things working out for me.',
      'When I get frightened, I sweat a lot.',
      'I am a worrier.',
      'I get really frightened for no reason at all.',
      'I am afraid to be alone at home.',
      "It is hard for me to talk with people I don't know well.",
      'When I get frightened, I feel like I am choking.',
      'People tell me that I worry too much.',
      "I don't like to be away from my family.",
      'I am afraid of having anxiety (or panic) attacks.',
      'I worry that something bad might happen to my parents.',
      "I feel shy with people I don't know well.",
      'I worry about what is going to happen in the future.',
      'When I get frightened, I feel like throwing up.',
      'I worry about how well I do things.',
      'I am scared to go to school.',
      'I worry about things that have already happened.',
      'When I get frightened, I feel dizzy.',
      'I feel nervous when I am with other children or adults and I have to do something while they watch me (e.g., read aloud, speak, play a game, play a sport).',
      "I feel nervous when I am going to parties, dances, or any place where there will be people that I don't know well.",
      'I am shy.',
    ].map(text => ({ text, options: SCARD3 })),
    administrationNote: 'Below is a list of sentences that describe how people feel. Read each phrase and decide if it is "Not True or Hardly Ever True" or "Somewhat True or Sometimes True" or "Very True or Often True" for you. Think about how you have been feeling for the past 3 months.',
  },

  // ── Mania Self-Report ─────────────────────────────────────────────────────
  {
    key: 'ASRM', name: 'ASRM', fullName: 'Altman Self-Rating Mania Scale',
    category: 'Depression / Mood', type: 'self_report', timeMin: 2, totalItems: 5, maxScore: 20,
    description: '5-item self-report mania screen. Score ≥ 6 = positive screen for manic/hypomanic episode. Complementary to MDQ.',
    scoreRanges: [
      { min: 0, max: 5,  label: 'Screen Negative', color: '#22c55e' },
      { min: 6, max: 20, label: 'Screen Positive — Mania/Hypomania', color: '#ef4444' },
    ],
    questions: [
      { text: 'I feel happier or more cheerful than usual.', options: [{ label: '0 — No change', value: 0 }, { label: '1 — Slightly more than usual', value: 1 }, { label: '2 — Definitely more than usual', value: 2 }, { label: '3 — Much more than usual', value: 3 }, { label: '4 — Extremely happy, best ever', value: 4 }] },
      { text: 'I feel more self-confident than usual.', options: [{ label: '0 — No change', value: 0 }, { label: '1 — Slightly more than usual', value: 1 }, { label: '2 — Definitely more than usual', value: 2 }, { label: '3 — Much more than usual', value: 3 }, { label: '4 — Extremely self-confident', value: 4 }] },
      { text: 'I need less sleep than usual.', options: [{ label: '0 — No change', value: 0 }, { label: '1 — Sleep slightly less (up to 1 hour)', value: 1 }, { label: '2 — Sleep somewhat less (1–2 hours)', value: 2 }, { label: '3 — Sleep much less (2–3 hours)', value: 3 }, { label: '4 — Sleep hardly at all (>3 hours less)', value: 4 }] },
      { text: 'I talk more than usual.', options: [{ label: '0 — No change', value: 0 }, { label: '1 — Slightly more than usual', value: 1 }, { label: '2 — Definitely more than usual', value: 2 }, { label: '3 — Much more — difficult to interrupt', value: 3 }, { label: '4 — Constantly talking, impossible to stop', value: 4 }] },
      { text: 'I have been more active than usual (socially, sexually, at work, home, or school).', options: [{ label: '0 — No change', value: 0 }, { label: '1 — Slightly more than usual', value: 1 }, { label: '2 — Definitely more than usual', value: 2 }, { label: '3 — Much more than usual', value: 3 }, { label: '4 — Markedly more — clearly out of character', value: 4 }] },
    ],
    administrationNote: 'Over the past week, rate how you have been feeling compared to your normal state.',
  },

  // ── PTSD / Trauma — IES-R ─────────────────────────────────────────────────
  {
    key: 'IES-R', name: 'IES-R', fullName: 'Impact of Event Scale — Revised',
    category: 'Trauma / PTSD', type: 'self_report', timeMin: 5, totalItems: 22, maxScore: 88,
    description: '22-item PTSD impact scale. Score ≥ 24 suggests clinical PTSD. Three subscales: Intrusion, Avoidance, Hyperarousal. Supplement to PCL-5.',
    scoreRanges: [
      { min: 0,  max: 23, label: 'Below Threshold', color: '#22c55e' },
      { min: 24, max: 32, label: 'PTSD Suggested', color: '#f59e0b' },
      { min: 33, max: 88, label: 'Severe — Probable PTSD', color: '#ef4444' },
    ],
    questions: [
      'Any reminder brought back feelings about it.',
      'I had trouble staying asleep.',
      'Other things kept making me think about it.',
      'I felt irritable and angry.',
      'I tried not to be upset when I thought about it or was reminded of it.',
      'I thought about it when I didn\'t mean to.',
      'I felt as if it hadn\'t happened or wasn\'t real.',
      'I stayed away from reminders of it.',
      'Pictures about it popped into my mind.',
      'I was jumpy and easily startled.',
      'I tried not to think about it.',
      'I was aware that I still had a lot of feelings about it, but I didn\'t deal with them.',
      'My feelings about it were kind of numb.',
      'I found myself acting or feeling like I was back at that time.',
      'I had trouble falling asleep.',
      'I had waves of strong feelings about it.',
      'I tried to remove it from my memory.',
      'I had trouble concentrating.',
      'Reminders of it caused me to have physical reactions, such as sweating, trouble breathing, nausea, or a pounding heart.',
      'I had dreams about it.',
      'I felt watchful and on guard.',
      'I tried not to talk about it.',
    ].map(text => ({ text, options: [{ label: 'Not at all', value: 0 }, { label: 'A little bit', value: 1 }, { label: 'Moderately', value: 2 }, { label: 'Quite a bit', value: 3 }, { label: 'Extremely', value: 4 }] })),
    administrationNote: 'Below is a list of comments made by people after stressful life events. Please read each item and indicate how distressing each difficulty has been for you during the past 7 days with respect to your stressful experience.',
  },

  // ── Sleep — ESS ────────────────────────────────────────────────────────────
  {
    key: 'ESS', name: 'ESS', fullName: 'Epworth Sleepiness Scale',
    category: 'Sleep', type: 'self_report', timeMin: 2, totalItems: 8, maxScore: 24,
    description: '8-item daytime sleepiness screen. Score above 10 = excessive daytime sleepiness. Use alongside ISI.',
    scoreRanges: [
      { min: 0,  max: 10, label: 'Normal', color: '#22c55e' },
      { min: 11, max: 12, label: 'Mild Excessive Daytime Sleepiness', color: '#84cc16' },
      { min: 13, max: 15, label: 'Moderate Excessive Daytime Sleepiness', color: '#f59e0b' },
      { min: 16, max: 24, label: 'Severe Excessive Daytime Sleepiness', color: '#ef4444' },
    ],
    questions: [
      'Sitting and reading',
      'Watching TV',
      'Sitting, inactive in a public place (e.g., a theatre or a meeting)',
      'As a passenger in a car for an hour without a break',
      'Lying down to rest in the afternoon when circumstances permit',
      'Sitting and talking to someone',
      'Sitting quietly after a lunch without alcohol',
      'In a car, while stopped for a few minutes in traffic',
    ].map(text => ({ text, options: [{ label: '0 — Would never doze', value: 0 }, { label: '1 — Slight chance of dozing', value: 1 }, { label: '2 — Moderate chance of dozing', value: 2 }, { label: '3 — High chance of dozing', value: 3 }] })),
    administrationNote: 'How likely are you to doze off or fall asleep in the following situations, in contrast to just feeling tired? This refers to your usual way of life in recent times. Even if you have not done some of these things recently, try to work out how they would have affected you.',
  },

  // ── Wellbeing ─────────────────────────────────────────────────────────────
  {
    key: 'WHO-5', name: 'WHO-5', fullName: 'WHO-5 Well-Being Index',
    category: 'Functioning', type: 'self_report', timeMin: 1, totalItems: 5, maxScore: 25,
    description: '5-item wellbeing and quality of life screen. Raw score under 13 (50% or under) indicates poor wellbeing — screen for depression; 7 or under (28% or under) suggests likely depression. Multiply raw score × 4 for percentage score (0–100%).',
    scoreRanges: [
      { min: 0,  max: 7,  label: 'Likely Depression', color: '#ef4444' },
      { min: 8,  max: 12, label: 'Poor Wellbeing — Screen for Depression', color: '#f59e0b' },
      { min: 13, max: 25, label: 'Adequate Wellbeing', color: '#22c55e' },
    ],
    questions: [
      'I have felt cheerful and in good spirits.',
      'I have felt calm and relaxed.',
      'I have felt active and vigorous.',
      'I woke up feeling fresh and rested.',
      'My daily life has been filled with things that interest me.',
    ].map(text => ({ text, options: [{ label: '5 — All of the time', value: 5 }, { label: '4 — Most of the time', value: 4 }, { label: '3 — More than half of the time', value: 3 }, { label: '2 — Less than half of the time', value: 2 }, { label: '1 — Some of the time', value: 1 }, { label: '0 — At no time', value: 0 }] })),
    administrationNote: 'Over the last 2 weeks…',
  },

  // ── DASS-21 ───────────────────────────────────────────────────────────────
  {
    key: 'DASS-21', name: 'DASS-21', fullName: 'Depression Anxiety Stress Scales — 21 Item',
    category: 'Depression / Mood', type: 'self_report', timeMin: 5, totalItems: 21, maxScore: 63,
    description: '21-item version of DASS. Depression, Anxiety, and Stress subscales (7 items each). Each subscale = sum of its 7 items × 2 (DASS-42 norms). Depression ≥ 10, Anxiety ≥ 8, Stress ≥ 15 = above the normal range.',
    // Scored per subscale (standardScoring.ts); there is no published total band
    scoreRanges: [],
    questions: [
      { text: 'I found it hard to wind down.', options: DASS4 },
      { text: 'I was aware of dryness of my mouth.', options: DASS4 },
      { text: 'I couldn\'t seem to experience any positive feeling at all.', options: DASS4 },
      { text: 'I experienced breathing difficulty (e.g. excessively rapid breathing, breathlessness in the absence of physical exertion).', options: DASS4 },
      { text: 'I found it difficult to work up the initiative to do things.', options: DASS4 },
      { text: 'I tended to over-react to situations.', options: DASS4 },
      { text: 'I experienced trembling (e.g. in the hands).', options: DASS4 },
      { text: 'I felt that I was using a lot of nervous energy.', options: DASS4 },
      { text: 'I was worried about situations in which I might panic and make a fool of myself.', options: DASS4 },
      { text: 'I felt that I had nothing to look forward to.', options: DASS4 },
      { text: 'I found myself getting agitated.', options: DASS4 },
      { text: 'I found it difficult to relax.', options: DASS4 },
      { text: 'I felt down-hearted and blue.', options: DASS4 },
      { text: 'I was intolerant of anything that kept me from getting on with what I was doing.', options: DASS4 },
      { text: 'I felt I was close to panic.', options: DASS4 },
      { text: 'I was unable to become enthusiastic about anything.', options: DASS4 },
      { text: 'I felt I wasn\'t worth much as a person.', options: DASS4 },
      { text: 'I felt that I was rather touchy.', options: DASS4 },
      { text: 'I was aware of the action of my heart in the absence of physical exertion (e.g. sense of heart rate increase, irregular heartbeat).', options: DASS4 },
      { text: 'I felt scared without any good reason.', options: DASS4 },
      { text: 'I felt that life was meaningless.', options: DASS4 },
    ],
    administrationNote: 'Please read each statement and circle a number 0, 1, 2, or 3 that indicates how much the statement applied to you over the past week. There are no right or wrong answers. Do not spend too much time on any statement. 0 = Did not apply to me at all, 1 = Applied to me to some degree, 2 = Applied to me to a considerable degree, 3 = Applied to me very much.',
  },

  // ── Somatic Symptoms ──────────────────────────────────────────────────────
  {
    key: 'PHQ-15', name: 'PHQ-15', fullName: 'Patient Health Questionnaire — Somatic Symptom Scale',
    category: 'Functioning', type: 'self_report', timeMin: 3, totalItems: 15, maxScore: 30,
    description: '15-item somatic symptom severity. Score 0–4 minimal, 5–9 low, 10–14 medium, ≥ 15 high somatic symptom burden. Frequently co-occurs with depression and anxiety.',
    scoreRanges: [
      { min: 0,  max: 4,  label: 'Minimal', color: '#22c55e' },
      { min: 5,  max: 9,  label: 'Low', color: '#84cc16' },
      { min: 10, max: 14, label: 'Medium', color: '#f59e0b' },
      { min: 15, max: 30, label: 'High', color: '#ef4444' },
    ],
    questions: [
      'Stomach pain',
      'Back pain',
      'Pain in your arms, legs, or joints (knees, hips, etc.)',
      'Menstrual cramps or other problems with your periods (women only)',
      'Headaches',
      'Chest pain',
      'Dizziness',
      'Fainting spells',
      'Feeling your heart pound or race',
      'Shortness of breath',
      'Pain or problems during sexual intercourse',
      'Constipation, loose bowels, or diarrhea',
      'Nausea, gas, or indigestion',
      'Feeling tired or having low energy',
      'Trouble sleeping',
    ].map(text => ({ text, options: [{ label: '0 — Not bothered at all', value: 0 }, { label: '1 — Bothered a little', value: 1 }, { label: '2 — Bothered a lot', value: 2 }] })),
    administrationNote: 'During the past 4 weeks, how much have you been bothered by any of the following problems?',
  },

  // ── Satisfaction with Life ────────────────────────────────────────────────
  {
    key: 'SWLS', name: 'SWLS', fullName: 'Satisfaction with Life Scale',
    category: 'Functioning', type: 'self_report', timeMin: 2, totalItems: 5, maxScore: 35,
    description: '5-item global life satisfaction measure (Diener et al., 1985). 20 = neutral; 21 or more = satisfied. Tracks positive wellbeing alongside symptom-focused measures.',
    scoreRanges: [
      { min: 5,  max: 9,  label: 'Extremely Dissatisfied', color: '#ef4444' },
      { min: 10, max: 14, label: 'Dissatisfied', color: '#f97316' },
      { min: 15, max: 19, label: 'Slightly Dissatisfied', color: '#f59e0b' },
      { min: 20, max: 20, label: 'Neutral', color: '#a3a3a3' },
      { min: 21, max: 25, label: 'Slightly Satisfied', color: '#84cc16' },
      { min: 26, max: 30, label: 'Satisfied', color: '#22c55e' },
      { min: 31, max: 35, label: 'Extremely Satisfied', color: '#16a34a' },
    ],
    questions: [
      'In most ways my life is close to my ideal.',
      'The conditions of my life are excellent.',
      'I am satisfied with my life.',
      'So far I have gotten the important things I want in life.',
      'If I could live my life over, I would change almost nothing.',
    ].map(text => ({ text, options: [{ label: '1 — Strongly Disagree', value: 1 }, { label: '2 — Disagree', value: 2 }, { label: '3 — Slightly Disagree', value: 3 }, { label: '4 — Neither Agree nor Disagree', value: 4 }, { label: '5 — Slightly Agree', value: 5 }, { label: '6 — Agree', value: 6 }, { label: '7 — Strongly Agree', value: 7 }] })),
    administrationNote: 'Below are five statements with which you may agree or disagree. Using the 1–7 scale, indicate your agreement with each item.',
  },

  // ── Medication Monitoring ────────────────────────────────────────────────────
  {
    key: AIMS_NAME, name: AIMS_NAME, fullName: 'Abnormal Involuntary Movement Scale',
    category: 'Medication Monitoring', type: 'clinician_rated', timeMin: 10, totalItems: 12, maxScore: 28,
    description: 'NIMH clinician-rated exam for tardive dyskinesia and other involuntary movements (public domain). Recommended at baseline and every 6 months on an antipsychotic. Score = sum of items 1–7 (0–28). Positive screen (Schooler-Kane, screening guidance only): ≥2 in two or more areas, or ≥3 in any one area.',
    alertNote: 'Positive screen is screening guidance only — confirm with clinical judgement.',
    scoreRanges: [
      { min: 0, max: 0, label: 'No abnormal movements rated', color: '#22c55e' },
      { min: 1, max: 28, label: 'Movements rated — see screen result', color: '#f59e0b' },
    ],
    questions: AIMS_QUESTIONS,
    administrationNote: `Examination procedure: ${AIMS_EXAM_PROCEDURE.join(' ')}`,
  },
];

// Library-only (clinician-rated, no digital question bank)
const LIBRARY_ONLY: Omit<Instrument, 'questions'>[] = [
  { key: 'YMRS', name: 'YMRS', fullName: 'Young Mania Rating Scale', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 15, totalItems: 11, maxScore: 60, description: 'Clinician-rated mania severity. Score ≥ 20 suggests manic episode.', scoreRanges: [{ min: 0, max: 12, label: 'Normal', color: '#22c55e' }, { min: 13, max: 19, label: 'Mild', color: '#84cc16' }, { min: 20, max: 35, label: 'Moderate Mania', color: '#f97316' }, { min: 36, max: 60, label: 'Severe Mania', color: '#ef4444' }] },
  { key: 'HAM-D', name: 'HAM-D-17', fullName: 'Hamilton Depression Rating Scale', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 20, totalItems: 17, maxScore: 52, description: 'Classic clinician-rated depression severity used in clinical trials. Score only: administer from the clinic’s form and enter the total; items are not reproduced.', scoreRanges: [{ min: 0, max: 7, label: 'No Depression', color: '#22c55e' }, { min: 8, max: 16, label: 'Mild', color: '#84cc16' }, { min: 17, max: 23, label: 'Moderate', color: '#f59e0b' }, { min: 24, max: 52, label: 'Severe', color: '#ef4444' }] },
  { key: 'MADRS', name: 'MADRS', fullName: 'Montgomery-Åsberg Depression Rating Scale', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 20, totalItems: 10, maxScore: 60, description: 'Clinician-rated depression severity. Score only: administer from the clinic’s form and enter the total (0–60); items are not reproduced.', scoreRanges: [{ min: 0, max: 6, label: 'Normal', color: '#22c55e' }, { min: 7, max: 19, label: 'Mild', color: '#84cc16' }, { min: 20, max: 34, label: 'Moderate', color: '#f59e0b' }, { min: 35, max: 60, label: 'Severe', color: '#ef4444' }] },
  { key: 'HAM-A', name: 'HAM-A', fullName: 'Hamilton Anxiety Rating Scale', category: 'Anxiety', type: 'clinician_rated', timeMin: 15, totalItems: 14, maxScore: 56, description: 'Clinician-rated anxiety severity.', scoreRanges: [{ min: 0, max: 13, label: 'Minimal', color: '#22c55e' }, { min: 14, max: 17, label: 'Mild', color: '#84cc16' }, { min: 18, max: 24, label: 'Moderate', color: '#f59e0b' }, { min: 25, max: 56, label: 'Severe', color: '#ef4444' }] },
  { key: 'BPRS', name: 'BPRS', fullName: 'Brief Psychiatric Rating Scale', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 25, totalItems: 18, maxScore: 126, description: 'Broad psychiatric symptoms for psychosis, depression, anxiety. Used in inpatient settings.', scoreRanges: [{ min: 18, max: 30, label: 'Minimal', color: '#22c55e' }, { min: 31, max: 41, label: 'Mild', color: '#84cc16' }, { min: 42, max: 52, label: 'Moderate', color: '#f59e0b' }, { min: 53, max: 126, label: 'Severe', color: '#ef4444' }] },
  { key: 'PANSS', name: 'PANSS', fullName: 'Positive and Negative Syndrome Scale', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 30, totalItems: 30, maxScore: 210, description: 'Schizophrenia symptom severity. Positive, negative, and general subscales.', scoreRanges: [{ min: 30, max: 58, label: 'Minimal', color: '#22c55e' }, { min: 59, max: 75, label: 'Mild', color: '#84cc16' }, { min: 76, max: 95, label: 'Moderate', color: '#f59e0b' }, { min: 96, max: 210, label: 'Severe', color: '#ef4444' }] },
  { key: 'CIWA-Ar', name: 'CIWA-Ar', fullName: 'Clinical Institute Withdrawal Assessment for Alcohol', category: 'Substance Use', type: 'clinician_rated', timeMin: 5, totalItems: 10, maxScore: 67, description: 'Alcohol withdrawal severity. Score ≥ 10 indicates pharmacological intervention needed.', alertNote: 'Score ≥ 15 — consider medically managed withdrawal', scoreRanges: [{ min: 0, max: 9, label: 'Minimal', color: '#22c55e' }, { min: 10, max: 14, label: 'Mild', color: '#f59e0b' }, { min: 15, max: 19, label: 'Moderate', color: '#f97316' }, { min: 20, max: 67, label: 'Severe', color: '#ef4444' }] },
  { key: 'COWS', name: 'COWS', fullName: 'Clinical Opiate Withdrawal Scale', category: 'Substance Use', type: 'clinician_rated', timeMin: 5, totalItems: 11, maxScore: 48, description: 'Opioid withdrawal severity. Score ≥ 13 indicates moderate withdrawal. Used for buprenorphine induction timing.', alertNote: 'Score ≥ 8–12 before initiating buprenorphine induction', scoreRanges: [{ min: 0, max: 4, label: 'None/Minimal', color: '#22c55e' }, { min: 5, max: 12, label: 'Mild', color: '#84cc16' }, { min: 13, max: 24, label: 'Moderate', color: '#f97316' }, { min: 25, max: 48, label: 'Severe', color: '#ef4444' }] },
  { key: 'YBOCS', name: 'Y-BOCS', fullName: 'Yale-Brown Obsessive Compulsive Scale', category: 'Anxiety', type: 'clinician_rated', timeMin: 30, totalItems: 10, maxScore: 40, description: 'Gold-standard OCD severity scale (copyrighted). Score only: administer from the clinic’s licensed form and enter the clinician-rated total (0–40); items are not reproduced. Usable weekly for OCD (e.g. TMS). A rise of 5 or more points is flagged.', scoreRanges: [{ min: 0, max: 7, label: 'Subclinical', color: '#22c55e' }, { min: 8, max: 15, label: 'Mild', color: '#84cc16' }, { min: 16, max: 23, label: 'Moderate', color: '#f59e0b' }, { min: 24, max: 31, label: 'Severe', color: '#f97316' }, { min: 32, max: 40, label: 'Extreme', color: '#ef4444' }] },
  { key: 'Vanderbilt', name: 'Vanderbilt', fullName: 'Vanderbilt ADHD Diagnostic Rating Scale', category: 'ADHD / Cognitive', type: 'clinician_rated', timeMin: 10, totalItems: 35, maxScore: 105, description: 'Parent/teacher ADHD rating scale for children ages 6–12. Requires teacher and parent forms.', requiresAge: 'Children 6–12', scoreRanges: [{ min: 0, max: 15, label: 'Below Threshold', color: '#22c55e' }, { min: 16, max: 105, label: 'Screen Positive', color: '#ef4444' }] },
  { key: 'SLUMS', name: 'SLUMS', fullName: 'Saint Louis University Mental Status Exam', category: 'ADHD / Cognitive', type: 'clinician_rated', timeMin: 7, totalItems: 11, maxScore: 30, description: 'Public domain cognitive screen for dementia/MCI. More sensitive than MMSE for MCI detection.', requiresAge: 'Adults 60+', scoreRanges: [{ min: 27, max: 30, label: 'Normal (HS)', color: '#22c55e' }, { min: 21, max: 26, label: 'MCI (HS)', color: '#f59e0b' }, { min: 0, max: 20, label: 'Dementia (HS)', color: '#ef4444' }] },
  { key: 'SCARED-5', name: 'SCARED-5', fullName: 'Screen for Child Anxiety Related Disorders — 5 item', category: 'Anxiety', type: 'self_report', timeMin: 2, totalItems: 5, maxScore: 10, description: 'Ultra-brief pediatric anxiety screener. Score ≥ 3 suggests possible anxiety disorder.', requiresAge: 'Children/Adolescents 8–18', scoreRanges: [{ min: 0, max: 2, label: 'Screen Negative', color: '#22c55e' }, { min: 3, max: 10, label: 'Screen Positive', color: '#ef4444' }] },
  { key: 'BASIS-24', name: 'BASIS-24', fullName: 'Behavioral and Symptom Identification Scale', category: 'Functioning', type: 'self_report', timeMin: 10, totalItems: 24, maxScore: 96, description: 'Broad symptom and functioning outcome measure. 6 subscales including depression, relationships, self-harm, emotional lability, psychosis, role functioning.', scoreRanges: [{ min: 0, max: 24, label: 'Low Severity', color: '#22c55e' }, { min: 25, max: 48, label: 'Moderate', color: '#f59e0b' }, { min: 49, max: 96, label: 'High Severity', color: '#ef4444' }] },
  { key: 'WHODAS', name: 'WHODAS 2.0', fullName: 'WHO Disability Assessment Schedule 2.0', category: 'Functioning', type: 'self_report', timeMin: 5, totalItems: 12, maxScore: 48, description: 'WHO functioning across 6 domains. Useful for treatment outcomes tracking.', scoreRanges: [{ min: 0, max: 16, label: 'Minimal Disability', color: '#22c55e' }, { min: 17, max: 32, label: 'Moderate', color: '#f59e0b' }, { min: 33, max: 48, label: 'Severe', color: '#ef4444' }] },
  // ── Newly Added (Clinician Request Sep 2026) ──────────────────────────────
  { key: 'DASS-42', name: 'DASS-42', fullName: 'Depression Anxiety Stress Scales — 42 Item', category: 'Depression / Mood', type: 'self_report', timeMin: 10, totalItems: 42, maxScore: 126, description: 'Measures depression, anxiety, and stress on three 14-item subscales. Scores multiplied ×1 (unlike DASS-21 ×2). Depression ≥ 14, Anxiety ≥ 10, Stress ≥ 19 = moderate severity.', scoreRanges: [], administrationNote: 'Use the 0–3 scale: 0 = Did not apply at all, 3 = Applied very much/most of the time. Administer via paper or licensed digital version.' },
  { key: 'NIDA-ASSIST', name: 'NIDA-ASSIST', fullName: 'NIDA-Modified ASSIST (Alcohol, Smoking & Substance Involvement Screening Test)', category: 'Substance Use', type: 'clinician_rated', timeMin: 15, totalItems: 27, maxScore: 99, itemContentPending: true, description: 'Item content pending licensed copy. NIDA prescreen plus per-substance questions (tobacco, alcohol, cannabis, cocaine, prescription stimulants, methamphetamine, inhalants, sedatives, hallucinogens, street opioids, prescription opioids, other) with a risk level per substance. The item wording and per-substance scoring are not in the system yet: administer the official NIDA form and record the per-substance risk levels in the notes.', alertNote: 'Risk level is per substance (lower / moderate / high), not a total score.', scoreRanges: [] },
  { key: 'BAM', name: 'BAM', fullName: 'Brief Addiction Monitor', category: 'Substance Use', type: 'clinician_rated', timeMin: 10, totalItems: 17, maxScore: 68, itemContentPending: true, description: 'Item content pending licensed copy. 17-item recovery monitor over the past 30 days, scored as Use, Risk-factor and Protective-factor subscales (no single total). The item wording and subscale scoring are not in the system yet: administer the official form and record the three subscale scores in the notes. Repeats every 30 days on the MBC schedule.', scoreRanges: [] },
  { key: 'IPDS', name: 'IPDS', fullName: 'Iowa Personality Disorder Screen', category: 'Functioning', type: 'self_report', timeMin: 5, totalItems: 11, maxScore: 11, description: 'Brief yes/no screen for Axis II personality disorders. Score ≥ 5 suggests possible personality disorder requiring full evaluation. Validated against structured clinical interview.', scoreRanges: [{ min: 0, max: 4, label: 'Below Threshold', color: '#22c55e' }, { min: 5, max: 7, label: 'Possible PD', color: '#f59e0b' }, { min: 8, max: 11, label: 'Likely PD', color: '#ef4444' }] },
  { key: 'SCARED-P', name: 'SCARED-Parent', fullName: 'Screen for Child Anxiety — Parent Report (41 items)', category: 'Anxiety', type: 'self_report', timeMin: 10, totalItems: 41, maxScore: 82, description: 'Parent-report version of SCARED (same 41 items rephrased for parent). Total ≥ 25 suggests possible anxiety disorder in child. Administer alongside SCARED-Child for full assessment.', requiresAge: 'Parent/guardian reporting on child ages 8–18', scoreRanges: [{ min: 0, max: 24, label: 'Below Threshold', color: '#22c55e' }, { min: 25, max: 40, label: 'Possible Anxiety', color: '#f59e0b' }, { min: 41, max: 82, label: 'Likely Anxiety Disorder', color: '#ef4444' }] },
  { key: 'Vanderbilt-T', name: 'Vanderbilt-Teacher', fullName: 'Vanderbilt ADHD Diagnostic Teacher Rating Scale', category: 'ADHD / Cognitive', type: 'clinician_rated', timeMin: 10, totalItems: 35, maxScore: 105, description: 'Teacher-completed ADHD rating scale for children ages 6–12. Must be paired with Vanderbilt Parent form for full diagnostic picture. Covers inattention, hyperactivity, oppositional, academic, and behavioral performance.', requiresAge: 'Children 6–12 (completed by teacher)', scoreRanges: [{ min: 0, max: 15, label: 'Below Threshold', color: '#22c55e' }, { min: 16, max: 105, label: 'Screen Positive', color: '#ef4444' }] },
  { key: 'HDCL-C', name: 'HDCL-C', fullName: 'Johns Hopkins Depression Checklist for Children', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 10, totalItems: 24, maxScore: 96, description: 'Clinician-administered depression severity tool for pediatric patients. Covers sadness, anhedonia, appetite, sleep, psychomotor, energy, guilt, concentration, and suicidality domains.', requiresAge: 'Children/Adolescents 6–18', scoreRanges: [{ min: 0, max: 15, label: 'Minimal', color: '#22c55e' }, { min: 16, max: 30, label: 'Mild', color: '#84cc16' }, { min: 31, max: 60, label: 'Moderate', color: '#f59e0b' }, { min: 61, max: 96, label: 'Severe', color: '#ef4444' }] },
  { key: 'DSM5-CC', name: 'DSM-5 Level 1', fullName: 'DSM-5 Self-Rated Level 1 Cross-Cutting Symptom Measure — Adult', category: 'Depression / Mood', type: 'self_report', timeMin: 10, totalItems: 23, maxScore: 92, description: 'DSM-5 broad symptom screen across 13 domains: depression, anger, mania, anxiety, somatic, sleep, memory, repetitive thoughts, dissociation, personality, substance use, suicidality, and psychosis. Any domain score ≥ 2 warrants further evaluation.', scoreRanges: [{ min: 0, max: 22, label: 'Minimal Cross-Domain', color: '#22c55e' }, { min: 23, max: 46, label: 'Moderate', color: '#f59e0b' }, { min: 47, max: 92, label: 'High — Multi-Domain', color: '#ef4444' }] },
  // ── Additional Valant Instruments (Score Entry only) ─────────────────────
  // Licensed / paper instruments: administer the official form, then record the total via Manual Score Entry.
  { key: 'BAI', name: 'BAI', fullName: 'Beck Anxiety Inventory', category: 'Anxiety', type: 'self_report', timeMin: 5, totalItems: 21, maxScore: 63, description: '21-item anxiety severity scale. Score 0–7 minimal, 8–15 mild, 16–25 moderate, 26–63 severe.', scoreRanges: [{ min: 0, max: 7, label: 'Minimal', color: '#22c55e' }, { min: 8, max: 15, label: 'Mild', color: '#84cc16' }, { min: 16, max: 25, label: 'Moderate', color: '#f59e0b' }, { min: 26, max: 63, label: 'Severe', color: '#ef4444' }], administrationNote: 'Administer via licensed paper form (Pearson). Score from paper; record total here.' },
  { key: 'BDI-II', name: 'BDI-II', fullName: 'Beck Depression Inventory — II', category: 'Depression / Mood', type: 'self_report', timeMin: 5, totalItems: 21, maxScore: 63, description: '21-item depression severity. Score 0–13 minimal, 14–19 mild, 20–28 moderate, 29–63 severe. Item 9 (suicidality) requires safety review.', alertNote: 'Item 9 endorsements require safety assessment.', scoreRanges: [{ min: 0, max: 13, label: 'Minimal', color: '#22c55e' }, { min: 14, max: 19, label: 'Mild', color: '#84cc16' }, { min: 20, max: 28, label: 'Moderate', color: '#f59e0b' }, { min: 29, max: 63, label: 'Severe', color: '#ef4444' }], administrationNote: 'Administer via licensed paper form (Pearson). Score from paper; record total here.' },
  { key: 'QIDS-SR', name: 'QIDS-SR', fullName: 'Quick Inventory of Depressive Symptomatology — Self-Report', category: 'Depression / Mood', type: 'self_report', timeMin: 5, totalItems: 16, maxScore: 27, description: '16-item self-report depression severity aligned with DSM symptom domains. Score ≥ 11 suggests moderate depression.', scoreRanges: [{ min: 0, max: 5, label: 'None', color: '#22c55e' }, { min: 6, max: 10, label: 'Mild', color: '#84cc16' }, { min: 11, max: 15, label: 'Moderate', color: '#f59e0b' }, { min: 16, max: 20, label: 'Severe', color: '#f97316' }, { min: 21, max: 27, label: 'Very Severe', color: '#ef4444' }], administrationNote: 'Available free at IDS-QIDS.org. Administer via paper; record total here.' },
  { key: 'PSWQ', name: 'PSWQ', fullName: 'Penn State Worry Questionnaire', category: 'Anxiety', type: 'self_report', timeMin: 5, totalItems: 16, maxScore: 80, description: 'Trait pathological worry measure. Score ≥ 62 suggests clinical worry typical of GAD.', scoreRanges: [{ min: 16, max: 39, label: 'Low Worry', color: '#22c55e' }, { min: 40, max: 61, label: 'Moderate Worry', color: '#f59e0b' }, { min: 62, max: 80, label: 'High Worry', color: '#ef4444' }], administrationNote: 'Administer via paper (public domain). Rate each item 1–5; record total here.' },
  { key: 'LSAS', name: 'LSAS', fullName: 'Liebowitz Social Anxiety Scale', category: 'Anxiety', type: 'self_report', timeMin: 10, totalItems: 24, maxScore: 144, description: 'Social anxiety fear and avoidance across 24 situations. Total ≥ 30 suggests social anxiety disorder; ≥ 60 marked/severe.', scoreRanges: [{ min: 0, max: 29, label: 'None/Mild', color: '#22c55e' }, { min: 30, max: 59, label: 'Moderate', color: '#f59e0b' }, { min: 60, max: 89, label: 'Marked', color: '#f97316' }, { min: 90, max: 144, label: 'Severe', color: '#ef4444' }], administrationNote: 'Clinician interviews client on 24 social/performance situations. Two subscales: performance and social interaction.' },
  { key: 'PDSS', name: 'PDSS', fullName: 'Panic Disorder Severity Scale', category: 'Anxiety', type: 'clinician_rated', timeMin: 5, totalItems: 7, maxScore: 28, description: 'Clinician-rated panic severity across frequency, distress, avoidance, and interference. Score ≥ 8 suggests clinically significant panic.', scoreRanges: [{ min: 0, max: 3, label: 'Normal', color: '#22c55e' }, { min: 4, max: 7, label: 'Borderline', color: '#84cc16' }, { min: 8, max: 13, label: 'Mild–Moderate', color: '#f59e0b' }, { min: 14, max: 28, label: 'Severe', color: '#ef4444' }], administrationNote: 'Clinician rates each of 7 items 0–4. Requires review of panic diary if available.' },
  { key: 'MSI-BPD', name: 'MSI-BPD', fullName: 'McLean Screening Instrument for BPD', category: 'Functioning', type: 'self_report', timeMin: 5, totalItems: 10, maxScore: 10, description: '10-item yes/no BPD screener. Score ≥ 7 suggests further diagnostic evaluation for borderline personality disorder.', scoreRanges: [{ min: 0, max: 6, label: 'Below Threshold', color: '#22c55e' }, { min: 7, max: 10, label: 'Screen Positive', color: '#ef4444' }], administrationNote: 'Client answers Yes/No to 10 statements. Administer via paper; record total here.' },
  { key: 'OQ-45', name: 'OQ-45', fullName: 'Outcome Questionnaire — 45', category: 'Functioning', type: 'self_report', timeMin: 10, totalItems: 45, maxScore: 180, description: 'Broad outcome measure (symptom distress, interpersonal, social role). Clinical cutoff typically 63; reliable change index ≈ 14.', scoreRanges: [{ min: 0, max: 62, label: 'Non-Clinical', color: '#22c55e' }, { min: 63, max: 180, label: 'Clinical Range', color: '#ef4444' }], administrationNote: 'Administer via licensed paper form or OQ Measures digital platform. Record total here.' },
  { key: 'SF-12', name: 'SF-12', fullName: 'Short Form Health Survey — 12', category: 'Functioning', type: 'self_report', timeMin: 5, totalItems: 12, maxScore: 100, description: 'Health-related quality of life yielding Physical (PCS) and Mental (MCS) component scores. Population mean ≈ 50.', scoreRanges: [{ min: 0, max: 39, label: 'Below Average', color: '#ef4444' }, { min: 40, max: 49, label: 'Below Average / Borderline', color: '#f59e0b' }, { min: 50, max: 100, label: 'Average or Above', color: '#22c55e' }], administrationNote: 'Requires licensed form and RAND scoring software. Record PCS and MCS component scores separately.' },
  { key: 'MoCA', name: 'MoCA', fullName: 'Montreal Cognitive Assessment', category: 'ADHD / Cognitive', type: 'clinician_rated', timeMin: 10, totalItems: 30, maxScore: 30, description: 'Cognitive screen for MCI/dementia. Score ≥ 26 generally normal; ≤ 25 suggests impairment (education-adjusted).', requiresAge: 'Adults (esp. 55+)', scoreRanges: [{ min: 26, max: 30, label: 'Normal', color: '#22c55e' }, { min: 18, max: 25, label: 'Mild Cognitive Impairment', color: '#f59e0b' }, { min: 0, max: 17, label: 'Significant Impairment', color: '#ef4444' }], administrationNote: 'Clinician-administered. Requires MoCA certification (free at mocatest.org). Administer standard paper form.' },
  { key: 'AQ-10', name: 'AQ-10', fullName: 'Autism Spectrum Quotient — 10 Item', category: 'ADHD / Cognitive', type: 'self_report', timeMin: 3, totalItems: 10, maxScore: 10, description: 'Brief autism spectrum screener. Score ≥ 6 warrants full diagnostic assessment.', scoreRanges: [{ min: 0, max: 5, label: 'Screen Negative', color: '#22c55e' }, { min: 6, max: 10, label: 'Screen Positive', color: '#ef4444' }], administrationNote: 'Client responds Definitely agree / Slightly agree / Slightly disagree / Definitely disagree to 10 items. Administer via paper; record total here.' },
  { key: 'RAADS-14', name: 'RAADS-14', fullName: 'Ritvo Autism Asperger Diagnostic Scale — 14 Item Screener', category: 'ADHD / Cognitive', type: 'self_report', timeMin: 5, totalItems: 14, maxScore: 42, description: 'Brief adult autism screener. Score ≥ 14 suggests possible ASD; full RAADS-R recommended.', scoreRanges: [{ min: 0, max: 13, label: 'Below Threshold', color: '#22c55e' }, { min: 14, max: 42, label: 'Screen Positive', color: '#ef4444' }], administrationNote: 'Each item rated 0 (Never true) to 3 (True now and when I was young). Administer via paper; record total here.' },
  { key: 'CAPS-5', name: 'CAPS-5', fullName: 'Clinician-Administered PTSD Scale for DSM-5', category: 'Trauma / PTSD', type: 'clinician_rated', timeMin: 45, totalItems: 30, maxScore: 80, description: 'Gold-standard clinician-rated PTSD severity. Symptom severity score ≥ 25–30 often used for clinical PTSD threshold (site-specific).', scoreRanges: [{ min: 0, max: 20, label: 'Minimal', color: '#22c55e' }, { min: 21, max: 39, label: 'Mild–Moderate', color: '#f59e0b' }, { min: 40, max: 80, label: 'Severe', color: '#ef4444' }], administrationNote: 'Clinician-administered semi-structured interview. Training required. Available free from National Center for PTSD (ptsd.va.gov).' },
  { key: 'CDRS-R', name: 'CDRS-R', fullName: 'Children\'s Depression Rating Scale — Revised', category: 'Depression / Mood', type: 'clinician_rated', timeMin: 20, totalItems: 17, maxScore: 113, description: 'Clinician-rated pediatric depression severity. Score ≥ 40 suggests depressive disorder.', requiresAge: 'Children/Adolescents 6–18', scoreRanges: [{ min: 17, max: 28, label: 'None/Minimal', color: '#22c55e' }, { min: 29, max: 39, label: 'Borderline', color: '#84cc16' }, { min: 40, max: 60, label: 'Moderate', color: '#f59e0b' }, { min: 61, max: 113, label: 'Severe', color: '#ef4444' }], administrationNote: 'Requires WPS license. Clinician rates 14 verbal items and 3 observational items. Record total here.' },
  { key: 'MFQ', name: 'MFQ', fullName: 'Mood and Feelings Questionnaire', category: 'Depression / Mood', type: 'self_report', timeMin: 5, totalItems: 33, maxScore: 66, description: 'Pediatric depression screen (long form). Child and parent versions available. Score ≥ 27 (long) suggests possible depression.', requiresAge: 'Children/Adolescents 8–18', scoreRanges: [{ min: 0, max: 26, label: 'Below Threshold', color: '#22c55e' }, { min: 27, max: 66, label: 'Screen Positive', color: '#ef4444' }], administrationNote: 'Free download from Duke DBSMA. Parent and child forms administered separately. Record total here.' },
  { key: 'CBCL', name: 'CBCL', fullName: 'Child Behavior Checklist', category: 'Functioning', type: 'clinician_rated', timeMin: 15, totalItems: 113, maxScore: 226, description: 'Parent-report broadband behavioral/emotional problems. T-scores ≥ 65 borderline; ≥ 70 clinical range (ASEBA norms).', requiresAge: 'Children/Adolescents 6–18', scoreRanges: [{ min: 0, max: 64, label: 'Normal Range (T)', color: '#22c55e' }, { min: 65, max: 69, label: 'Borderline', color: '#f59e0b' }, { min: 70, max: 100, label: 'Clinical', color: '#ef4444' }], administrationNote: 'Requires ASEBA license. Parent completes 120-item form; record T-scores for Total, Internalizing, and Externalizing here.' },
  { key: 'CAARS', name: 'CAARS', fullName: 'Conners\' Adult ADHD Rating Scales', category: 'ADHD / Cognitive', type: 'self_report', timeMin: 15, totalItems: 66, maxScore: 198, description: 'Adult ADHD symptom severity (self or observer). T-scores ≥ 65 suggest clinically elevated ADHD symptoms.', requiresAge: 'Adults 18+', scoreRanges: [{ min: 0, max: 64, label: 'Within Normal Limits (T)', color: '#22c55e' }, { min: 65, max: 69, label: 'Elevated', color: '#f59e0b' }, { min: 70, max: 100, label: 'Very Elevated', color: '#ef4444' }], administrationNote: 'Requires MHS license. Administer via paper or MHS online portal. Record ADHD Index T-score here.' },
];

export const SOURCE_INSTRUMENTS: Instrument[] = [
  ...INSTRUMENTS,
  ...LIBRARY_ONLY.map(i => ({ ...i, questions: undefined })),
];


