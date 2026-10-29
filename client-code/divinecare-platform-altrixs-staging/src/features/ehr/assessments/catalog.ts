import { importedInstruments } from './sourceAdapter';
import { AIMS_ID, calculateAimsResult } from './aims';
import { STANDARD_SCORING, withWho5Percent } from './standardScoring';

export type InstrumentCategory = 
  | 'Depression & Mood'
  | 'Anxiety'
  | 'Trauma & Dissociation'
  | 'ADHD & Cognition'
  | 'Substance Use'
  | 'Safety'
  | 'Functioning & Sleep'
  | 'Medication Monitoring';

export type AdministrationType = 'Self-Report' | 'Clinician-Rated';

export type AssessmentQuestion = {
  id: string;
  text: string;
  note?: string;
  options: { label: string; score: number; flagged?: boolean }[];
  flagged?: boolean;
};

export type AssessmentInstrument = {
  id: string;
  name: string;
  fullName: string;
  category: InstrumentCategory;
  adminType: AdministrationType;
  questionCount: number;
  maxScore?: number;
  scoreRanges?: { min: number; max: number; label: string; color?: string }[];
  alertNote?: string;
  estimatedTime: string;
  ageGuidance: string;
  description: string;
  hasDigitalQuestionnaire: boolean;
  /** Item wording / scoring not in the system yet ("item content pending licensed copy") */
  itemContentPending?: boolean;
  questions?: AssessmentQuestion[];
  calculateResult: (answers: Record<string, number>) => {
    totalScore: number;
    severity: string;
    interpretation: string;
    safetyFlagged: boolean;
    safetyNotes?: string;
    subscales?: Record<string, number>;
  };
};

const EXISTING_INSTRUMENTS: AssessmentInstrument[] = [
  // --- DEPRESSION & MOOD ---
  {
    id: 'phq-9',
    name: 'PHQ-9',
    fullName: 'Patient Health Questionnaire-9',
    category: 'Depression & Mood',
    adminType: 'Self-Report',
    questionCount: 9,
    estimatedTime: '3–5 mins',
    ageGuidance: '18+ (Adults)',
    description: 'Standardized 9-question instrument to screen and measure depression severity.',
    hasDigitalQuestionnaire: true,
    questions: [
      {
        id: 'q1',
        text: 'Little interest or pleasure in doing things',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q2',
        text: 'Feeling down, depressed, or hopeless',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q3',
        text: 'Trouble falling or staying asleep, or sleeping too much',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q4',
        text: 'Feeling tired or having little energy',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q5',
        text: 'Poor appetite or overeating',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q6',
        text: 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q7',
        text: 'Trouble concentrating on things, such as reading the newspaper or watching television',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q8',
        text: 'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q9',
        text: 'Thoughts that you would be better off dead or of hurting yourself in some way',
        flagged: true,
        options: [
          { label: 'Not at all', score: 0 },
          { label: 'Several days', score: 1, flagged: true },
          { label: 'More than half the days', score: 2, flagged: true },
          { label: 'Nearly every day', score: 3, flagged: true }
        ]
      }
    ],
    calculateResult: (answers) => {
      const scores = Object.values(answers);
      const total = scores.reduce((sum, val) => sum + (val || 0), 0);
      const q9Score = answers['q9'] || 0;
      const safetyFlagged = q9Score > 0;
      let severity = 'Minimal';
      if (total >= 20) severity = 'Severe';
      else if (total >= 15) severity = 'Moderately Severe';
      else if (total >= 10) severity = 'Moderate';
      else if (total >= 5) severity = 'Mild';

      return {
        totalScore: total,
        severity,
        interpretation: `PHQ-9 Score: ${total}/27 (${severity} Depression). ${safetyFlagged ? 'CRITICAL: Suicidal Ideation Item 9 is Positive.' : ''}`,
        safetyFlagged,
        safetyNotes: safetyFlagged ? `Suicidal ideation item endorsed (Score = ${q9Score}). Immediate clinical safety review required.` : undefined
      };
    }
  },
  {
    id: 'phq-2',
    name: 'PHQ-2',
    fullName: 'Patient Health Questionnaire-2',
    category: 'Depression & Mood',
    adminType: 'Self-Report',
    questionCount: 2,
    estimatedTime: '1–2 mins',
    ageGuidance: '18+ (Adults)',
    description: 'Ultra-brief 2-question screening tool for depression.',
    hasDigitalQuestionnaire: true,
    questions: [
      {
        id: 'q1',
        text: 'Little interest or pleasure in doing things',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      },
      {
        id: 'q2',
        text: 'Feeling down, depressed, or hopeless',
        options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }]
      }
    ],
    calculateResult: (answers) => {
      const total = (answers['q1'] || 0) + (answers['q2'] || 0);
      const positive = total >= 3;
      return {
        totalScore: total,
        severity: positive ? 'Positive Screen' : 'Negative Screen',
        interpretation: `PHQ-2 Score: ${total}/6. ${positive ? 'Positive screen for depression. Administer full PHQ-9.' : 'Negative screen.'}`,
        safetyFlagged: false
      };
    }
  },
  {
    id: 'mdq',
    name: 'MDQ',
    fullName: 'Mood Disorder Questionnaire',
    category: 'Depression & Mood',
    adminType: 'Self-Report',
    questionCount: 13,
    estimatedTime: '5 mins',
    ageGuidance: '18+ (Adults)',
    description: 'Screening instrument for bipolar spectrum disorders.',
    hasDigitalQuestionnaire: true,
    questions: Array.from({ length: 13 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `Has there ever been a period of time when you were not your usual self and… (Item ${i + 1})`,
      options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 1 }]
    })),
    calculateResult: (answers) => {
      const total = Object.values(answers).reduce((sum, v) => sum + (v || 0), 0);
      const positive = total >= 7;
      return {
        totalScore: total,
        severity: positive ? 'Positive Bipolar Screen' : 'Negative Screen',
        interpretation: `MDQ Score: ${total}/13. ${positive ? 'Screening positive for Bipolar Spectrum.' : 'Negative screen.'}`,
        safetyFlagged: false
      };
    }
  },

  // --- ANXIETY ---
  {
    id: 'gad-7',
    name: 'GAD-7',
    fullName: 'Generalized Anxiety Disorder-7',
    category: 'Anxiety',
    adminType: 'Self-Report',
    questionCount: 7,
    estimatedTime: '3 mins',
    ageGuidance: '18+ (Adults)',
    description: 'Standardized 7-item scale for screening and scoring generalized anxiety severity.',
    hasDigitalQuestionnaire: true,
    questions: [
      { id: 'q1', text: 'Feeling nervous, anxious, or on edge', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q2', text: 'Not being able to stop or control worrying', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q3', text: 'Worrying too much about different things', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q4', text: 'Trouble relaxing', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q5', text: 'Being so restless that it is hard to sit still', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q6', text: 'Becoming easily annoyed or irritable', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q7', text: 'Feeling afraid, as if something awful might happen', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] }
    ],
    calculateResult: (answers) => {
      const total = Object.values(answers).reduce((s, v) => s + (v || 0), 0);
      let severity = 'Minimal Anxiety';
      if (total >= 15) severity = 'Severe Anxiety';
      else if (total >= 10) severity = 'Moderate Anxiety';
      else if (total >= 5) severity = 'Mild Anxiety';

      return {
        totalScore: total,
        severity,
        interpretation: `GAD-7 Score: ${total}/21 (${severity}).`,
        safetyFlagged: false
      };
    }
  },
  {
    id: 'gad-2',
    name: 'GAD-2',
    fullName: 'Generalized Anxiety Disorder-2',
    category: 'Anxiety',
    adminType: 'Self-Report',
    questionCount: 2,
    estimatedTime: '1 min',
    ageGuidance: '18+ (Adults)',
    description: 'Brief 2-item anxiety screener.',
    hasDigitalQuestionnaire: true,
    questions: [
      { id: 'q1', text: 'Feeling nervous, anxious, or on edge', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] },
      { id: 'q2', text: 'Not being able to stop or control worrying', options: [{ label: 'Not at all', score: 0 }, { label: 'Several days', score: 1 }, { label: 'More than half the days', score: 2 }, { label: 'Nearly every day', score: 3 }] }
    ],
    calculateResult: (answers) => {
      const total = (answers['q1'] || 0) + (answers['q2'] || 0);
      const positive = total >= 3;
      return {
        totalScore: total,
        severity: positive ? 'Positive Screen' : 'Negative Screen',
        interpretation: `GAD-2 Score: ${total}/6. ${positive ? 'Positive screen. Administer GAD-7.' : 'Negative screen.'}`,
        safetyFlagged: false
      };
    }
  },

  // --- TRAUMA & DISSOCIATION ---
  {
    id: 'pcl-5',
    name: 'PCL-5',
    fullName: 'PTSD Checklist for DSM-5',
    category: 'Trauma & Dissociation',
    adminType: 'Self-Report',
    questionCount: 20,
    estimatedTime: '5–10 mins',
    ageGuidance: '18+ (Adults)',
    description: '20-item self-report measure to assess PTSD symptoms.',
    hasDigitalQuestionnaire: true,
    questions: Array.from({ length: 20 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `In the past month, how much were you bothered by DSM-5 PTSD symptom ${i + 1}?`,
      options: [
        { label: 'Not at all', score: 0 },
        { label: 'A little bit', score: 1 },
        { label: 'Moderately', score: 2 },
        { label: 'Quite a bit', score: 3 },
        { label: 'Extremely', score: 4 }
      ]
    })),
    calculateResult: (answers) => {
      const total = Object.values(answers).reduce((s, v) => s + (v || 0), 0);
      const provisionalPtsd = total >= 33;
      return {
        totalScore: total,
        severity: provisionalPtsd ? 'Provisional PTSD' : 'Below Cutoff',
        interpretation: `PCL-5 Total Score: ${total}/80. ${provisionalPtsd ? 'Meets provisional cutoff (>=33) for PTSD.' : 'Below clinical threshold.'}`,
        safetyFlagged: false
      };
    }
  },
  {
    id: 'aces',
    name: 'ACEs',
    fullName: 'Adverse Childhood Experiences Questionnaire',
    category: 'Trauma & Dissociation',
    adminType: 'Self-Report',
    questionCount: 10,
    estimatedTime: '3–5 mins',
    ageGuidance: '18+ (Adults)',
    description: '10-item measure of childhood trauma, abuse, and household dysfunction.',
    hasDigitalQuestionnaire: true,
    questions: Array.from({ length: 10 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `Childhood trauma/adversity item ${i + 1}`,
      options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 1 }]
    })),
    calculateResult: (answers) => {
      const total = Object.values(answers).reduce((s, v) => s + (s || 0) + (v || 0), 0);
      let risk = 'Low Risk';
      if (total >= 4) risk = 'High Risk for Health Issues';
      else if (total >= 1) risk = 'Intermediate Risk';

      return {
        totalScore: total,
        severity: risk,
        interpretation: `ACE Score: ${total}/10 (${risk}).`,
        safetyFlagged: false
      };
    }
  },

  // --- SUBSTANCE USE ---
  {
    id: 'audit',
    name: 'AUDIT',
    fullName: 'Alcohol Use Disorders Identification Test',
    category: 'Substance Use',
    adminType: 'Self-Report',
    questionCount: 10,
    estimatedTime: '3–5 mins',
    ageGuidance: '18+ (Adults)',
    description: '10-item WHO screening tool to assess alcohol consumption and hazardous drinking.',
    hasDigitalQuestionnaire: true,
    questions: Array.from({ length: 10 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `Alcohol consumption & consequences item ${i + 1}`,
      options: [
        { label: 'Never / 0', score: 0 },
        { label: 'Monthly or less / 1', score: 1 },
        { label: '2-4 times a month / 2', score: 2 },
        { label: '2-3 times a week / 3', score: 3 },
        { label: '4+ times a week / 4', score: 4 }
      ]
    })),
    calculateResult: (answers) => {
      const total = Object.values(answers).reduce((s, v) => s + (v || 0), 0);
      let zone = 'Zone I: Low Risk';
      if (total >= 20) zone = 'Zone IV: High Risk / Possible Dependence';
      else if (total >= 16) zone = 'Zone III: Harmful Drinking';
      else if (total >= 8) zone = 'Zone II: Hazardous Use';

      return {
        totalScore: total,
        severity: zone,
        interpretation: `AUDIT Total Score: ${total}/40 (${zone}).`,
        safetyFlagged: total >= 20
      };
    }
  },

  // --- SAFETY ---
  {
    id: 'c-ssrs-brief',
    name: 'C-SSRS Brief',
    fullName: 'Columbia-Suicide Severity Rating Scale (Brief)',
    category: 'Safety',
    adminType: 'Clinician-Rated',
    questionCount: 6,
    estimatedTime: '2 mins',
    ageGuidance: 'All Ages',
    description: 'Gold-standard suicide risk screening instrument for clinical settings.',
    hasDigitalQuestionnaire: true,
    questions: [
      { id: 'q1', text: 'Have you wished you were dead or wished you could go to sleep and not wake up?', options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 1 }] },
      { id: 'q2', text: 'Have you actually had any thoughts of killing yourself?', options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 1 }] },
      { id: 'q3', text: 'Have you been thinking about how you might do this?', options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 2, flagged: true }] },
      { id: 'q4', text: 'Have you had these thoughts and had some intention of acting on them?', options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 3, flagged: true }] },
      { id: 'q5', text: 'Have you started to work out or worked out the details of how to kill yourself?', options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 4, flagged: true }] },
      { id: 'q6', text: 'Have you done anything, started to do anything, or prepared to do anything to end your life?', options: [{ label: 'No', score: 0 }, { label: 'Yes', score: 5, flagged: true }] }
    ],
    calculateResult: (answers) => {
      const q3 = answers['q3'] || 0;
      const q4 = answers['q4'] || 0;
      const q5 = answers['q5'] || 0;
      const q6 = answers['q6'] || 0;
      const isHigh = q4 > 0 || q5 > 0 || q6 > 0;
      const isModerate = q3 > 0;

      let risk = 'Low Suicide Risk';
      if (isHigh) risk = 'HIGH Suicide Risk';
      else if (isModerate) risk = 'MODERATE Suicide Risk';

      return {
        totalScore: isHigh ? 3 : isModerate ? 2 : 1,
        severity: risk,
        interpretation: `C-SSRS Risk Level: ${risk}. ${isHigh ? 'HIGH RISK: Active ideation with intent/plan or recent behavior.' : ''}`,
        safetyFlagged: isHigh || isModerate,
        safetyNotes: isHigh ? 'High suicide risk endorsed. Initiate immediate Safety Protocol.' : undefined
      };
    }
  }
];

export const ASSESSMENT_CATALOG: AssessmentInstrument[] = importedInstruments.map((instrument) => {
  // AIMS: total is items 1–7 only (11–12 are dental yes/no), with the Schooler-Kane screen.
  if (instrument.id === AIMS_ID) return { ...instrument, calculateResult: calculateAimsResult };
  // ASRS (shaded count), DASS (subscales), MDQ (Parts 1–3): published rules, not a total band
  const standard = STANDARD_SCORING[instrument.id];
  if (standard) return { ...instrument, calculateResult: standard };
  if (instrument.id === 'who-5') return { ...instrument, calculateResult: (answers: Record<string, number>) => withWho5Percent(instrument.calculateResult(answers)) };
  const existing = EXISTING_INSTRUMENTS.find((entry) => entry.id === instrument.id);
  // Preserve the detailed safety evaluation for C-SSRS and PHQ-9.
  if (existing?.id === 'c-ssrs-brief') return {
    ...instrument,
    calculateResult: (answers: Record<string, number>) => ({
      ...existing.calculateResult(answers),
      totalScore: Object.values(answers).filter(value => value > 0).length,
    }),
  };
  return existing && existing.id === 'phq-9'
    ? { ...instrument, calculateResult: existing.calculateResult, questions: existing.questions }
    : instrument;
});

/** No sample patient responses — assessment history comes from real administrations. */
export const ASSESSMENTS_SEED: {
  clientId: string;
  clientName: string;
  items: { type: string; date: string; score: number; severity: string; flags: string[] }[];
}[] = [];

