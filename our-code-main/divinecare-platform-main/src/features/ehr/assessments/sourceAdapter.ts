import { SOURCE_INSTRUMENTS } from './sourceInstruments';
import type { AssessmentInstrument, InstrumentCategory } from './catalog';

const categories: Record<string, InstrumentCategory> = {
  'Depression / Mood': 'Depression & Mood', Anxiety: 'Anxiety',
  'Trauma / PTSD': 'Trauma & Dissociation', 'ADHD / Cognitive': 'ADHD & Cognition',
  'Substance Use': 'Substance Use', 'Suicide / Safety': 'Safety',
  Functioning: 'Functioning & Sleep', Sleep: 'Functioning & Sleep',
};

// Definitions ported from Andy f053dab, including clinician-administered library entries.
export const importedInstruments: AssessmentInstrument[] = SOURCE_INSTRUMENTS.map((source) => ({
  id: source.key === 'C-SSRS' ? 'c-ssrs-brief' : source.key.toLowerCase(),
  name: source.name, fullName: source.fullName,
  category: categories[source.category] ?? 'Functioning & Sleep',
  adminType: source.type === 'clinician_rated' ? 'Clinician-Rated' : 'Self-Report',
  questionCount: source.totalItems, estimatedTime: `${source.timeMin} mins`,
  ageGuidance: source.requiresAge ?? 'See instrument administration guidance',
  description: [source.description, source.administrationNote].filter(Boolean).join(' '),
  hasDigitalQuestionnaire: Boolean(source.questions?.length),
  maxScore: source.maxScore, scoreRanges: source.scoreRanges, alertNote: source.alertNote,
  questions: source.questions?.map((q, index) => ({
    id: `q${index + 1}`, text: q.text, note: q.note,
    options: q.options.map((option) => ({ label: option.label, score: option.value })),
  })),
  calculateResult(answers) {
    let totalScore = Object.values(answers).reduce((sum, score) => sum + score, 0);
    if (source.key === 'DES-II') totalScore /= source.totalItems;
    const range = source.scoreRanges.find((band) => totalScore >= band.min && totalScore <= band.max);
    const safetyItem = source.key === 'EPDS' ? 'q10' : ['PHQ-9', 'PHQ-A'].includes(source.key) ? 'q9' : undefined;
    const safetyFlagged = Boolean(safetyItem && answers[safetyItem] > 0) || (source.key === 'SBQ-R' && totalScore >= 7);
    return {
      totalScore, severity: range?.label ?? 'Review required',
      interpretation: `${source.name}: ${totalScore}. ${range?.label ?? 'Review instrument scoring guidance'}`,
      safetyFlagged,
      safetyNotes: safetyFlagged ? 'Safety screening threshold reached: clinician review required.' : undefined,
    };
  },
}));
