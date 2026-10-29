/**
 * AI Scribe capture language. Pure, browser-safe.
 *
 * The clinician picks the language spoken in the session: English (en-US, default) or Spanish
 * (es-US). The language is stored on the capture (scribe_captures.language). Transcription:
 *  - Amazon Transcribe streaming (standard) and batch support es-US; Chime live transcription
 *    (standard engine) supports es-US too.
 *  - Transcribe Medical (streaming and batch) is en-US only, so a Spanish capture always uses the
 *    standard engine, whatever the practice engine setting is.
 *  - The practice custom vocabulary is an en-US resource: it is not used for Spanish.
 * Drafting: the NOTE is always written in English (the chart language); quotes are translated and
 * marked as translated. The plain-language CLIENT SUMMARY is written in the client's preferred
 * language when that is Spanish (Client.preferredLanguage 'es'), otherwise English.
 */
import type { StreamEngine } from './transcribeUrl';

export const SCRIBE_LANGUAGES = ['en-US', 'es-US'] as const;
export type ScribeLanguage = (typeof SCRIBE_LANGUAGES)[number];
export const DEFAULT_SCRIBE_LANGUAGE: ScribeLanguage = 'en-US';

export const SCRIBE_LANGUAGE_LABELS: Record<ScribeLanguage, string> = {
  'en-US': 'English',
  'es-US': 'Spanish (Español)',
};

export function isScribeLanguage(v: unknown): v is ScribeLanguage {
  return typeof v === 'string' && (SCRIBE_LANGUAGES as readonly string[]).includes(v);
}

export function normalizeScribeLanguage(v: unknown): ScribeLanguage {
  return isScribeLanguage(v) ? v : DEFAULT_SCRIBE_LANGUAGE;
}

/** Transcribe Medical is English only: Spanish always streams on the standard engine. */
export function streamEngineForLanguage(engine: StreamEngine, language: ScribeLanguage): StreamEngine {
  return language === 'en-US' ? engine : 'standard';
}

/** The practice vocabulary (en-US) applies to English standard streams only. */
export function vocabularyForLanguage(vocabularyName: string | undefined, language: ScribeLanguage): string | undefined {
  return language === 'en-US' ? vocabularyName : undefined;
}

/** Language the capture picker preselects: Spanish when the client's preferred language is Spanish. */
export function defaultCaptureLanguage(preferredLanguage: string | null | undefined): ScribeLanguage {
  return isSpanishPreference(preferredLanguage) ? 'es-US' : 'en-US';
}

/** Client.preferredLanguage is ISO 639-1 ('es'); imported values may be 'spa', 'Spanish' or 'es-US'. */
export function isSpanishPreference(preferredLanguage: string | null | undefined): boolean {
  const v = String(preferredLanguage ?? '').trim().toLowerCase();
  return v === 'es' || v === 'spa' || v.startsWith('es-') || v === 'spanish' || v === 'español' || v === 'espanol';
}

/** Client summary language: Spanish only when the client prefers Spanish. */
export function summaryLanguageFor(preferredLanguage: string | null | undefined): 'en' | 'es' {
  return isSpanishPreference(preferredLanguage) ? 'es' : 'en';
}

/** Drafting prompt line for the capture language (the note is always in English). */
export function draftLanguageInstruction(language: ScribeLanguage): string {
  if (language === 'en-US') return '';
  return 'The transcript is in Spanish. Write every note sentence in English (clinical English for the chart). When you quote the client, translate the quote into English and add "(translated from Spanish)". Cite the Spanish transcript lines that support each sentence. Write numbers as digits only when the cited line has that number. The "summary" sentences stay in English too (they are translated for the client separately).';
}

/** Crisis line appended to every client summary, per language. */
export const SUMMARY_CRISIS_LINE = {
  en: 'If you are in crisis, call or text 988 any time, or call 911 in an emergency.',
  es: 'Si está en crisis, llame o envíe un mensaje de texto al 988 en cualquier momento (oprima 2 para español), o llame al 911 en una emergencia.',
} as const;

/** System prompt for translating an approved-to-draft English client summary into Spanish. */
export function summaryTranslationPrompt(): string {
  return [
    'Translate the client session summary below from English into Spanish for the client (US Spanish).',
    'Rules: translate only; do not add, remove or change any information, advice, date, number or medication.',
    'Plain language, short sentences, 6th-8th grade reading level, use "usted".',
    'Keep the line breaks and the "- " list items. Do not translate the number 988 or 911.',
    'Return only the Spanish text, nothing else.',
  ].join('\n');
}

/** Spanish substance-use terms (Part 2 check on a Spanish client summary; English terms are in clientSummary.ts). */
export const SUD_TERMS_ES =
  /\b(alcohol|beber|bebid[ao]s?|borrach[oa]|cervezas?|vino|licor|sobriedad|sobri[oa]|reca[ií]das?|antojos?|ansias de consumir|sustancias?|drogas?|opioides?|hero[ií]na|fentanilo|coca[ií]na|metanfetamina|marihuana|cannabis|pastillas|consum(o|ir|iendo|e)|sobredosis|desintoxicaci[oó]n|rehabilitaci[oó]n|metadona|buprenorfina|suboxone|naltrexona|naloxona|narcan)\b/i;
