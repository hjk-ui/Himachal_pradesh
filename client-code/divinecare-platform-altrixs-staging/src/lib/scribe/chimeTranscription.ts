/**
 * Telehealth capture: Amazon Chime SDK live transcription (server only). The engine follows the
 * practice's scribe setting: standard Amazon Transcribe (EngineTranscribeSettings, default, with the
 * practice vocabulary from SCRIBE_TRANSCRIBE_VOCABULARY) or Transcribe Medical
 * (EngineTranscribeMedicalSettings). Chime sends the meeting audio to Transcribe inside AWS (BAA-covered) and
 * delivers transcript events to the attendees' browsers over the meeting data channel, attributed
 * to the attendee who spoke, so speaker roles are exact. No audio is stored by this path.
 *
 * IAM: chime:StartMeetingTranscription / chime:StopMeetingTranscription on the server role, and
 * the Chime transcription service-linked role (AWSServiceRoleForAmazonChimeTranscription) in the
 * account. Chime meetings run in us-east-1 (CHIME_REGION).
 */
import {
  ChimeSDKMeetingsClient,
  StartMeetingTranscriptionCommand,
  StopMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import { awsClientConfig } from '@/lib/aws/clientConfig';
import { instrumentAwsClient } from '@/lib/integrations/callLog/awsInstrument';
import { CHIME_REGION } from '@/lib/services/chimeService';
import { scribeVocabularyName, type StreamEngine } from './transcribeUrl';

let client: ChimeSDKMeetingsClient | null = null;
function meetings(): ChimeSDKMeetingsClient {
  client ??= instrumentAwsClient(new ChimeSDKMeetingsClient({
    ...awsClientConfig(),
    region: CHIME_REGION,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(), secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim() }
        : undefined,
  }), 'chime');
  return client;
}

/** Settings sent to Chime (exported for the source check in tests). */
export const CHIME_MEDICAL_SETTINGS = {
  LanguageCode: 'en-US',
  Specialty: 'PRIMARYCARE',
  Type: 'CONVERSATION',
  Region: 'us-east-1',
} as const;

/** Standard engine settings (the vocabulary must exist in this Region, us-east-1). */
export const CHIME_STANDARD_SETTINGS = {
  LanguageCode: 'en-US',
  Region: 'us-east-1',
} as const;

type ChimeTranscriptionConfiguration = NonNullable<
  ConstructorParameters<typeof StartMeetingTranscriptionCommand>[0]['TranscriptionConfiguration']
>;

/** TranscriptionConfiguration for StartMeetingTranscription (pure; exported for tests). */
export function chimeTranscriptionConfiguration(
  engine: StreamEngine,
  vocabularyName: string | undefined = scribeVocabularyName(),
  languageCode: 'en-US' | 'es-US' = 'en-US'
): ChimeTranscriptionConfiguration {
  // Spanish: standard engine only (Transcribe Medical is en-US), no en-US practice vocabulary
  if (languageCode !== 'en-US') return { EngineTranscribeSettings: { ...CHIME_STANDARD_SETTINGS, LanguageCode: languageCode } };
  if (engine === 'medical') return { EngineTranscribeMedicalSettings: { ...CHIME_MEDICAL_SETTINGS } };
  return { EngineTranscribeSettings: { ...CHIME_STANDARD_SETTINGS, ...(vocabularyName ? { VocabularyName: vocabularyName } : {}) } };
}

export type ChimeTranscriptionResult = { ok: true } | { ok: false; error: string };

export async function startChimeTranscription(meetingId: string, engine: StreamEngine, languageCode: 'en-US' | 'es-US' = 'en-US'): Promise<ChimeTranscriptionResult> {
  try {
    await meetings().send(
      new StartMeetingTranscriptionCommand({
        MeetingId: meetingId,
        TranscriptionConfiguration: chimeTranscriptionConfiguration(engine, scribeVocabularyName(), languageCode),
      })
    );
    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    console.error('[scribe:chime] start transcription failed:', name);
    return {
      ok: false,
      error:
        name === 'AccessDeniedException' || name === 'ForbiddenException'
          ? 'AWS denied live transcription for this meeting (the server role needs chime:StartMeetingTranscription). Nothing was captured.'
          : 'Live transcription could not start for this meeting. Nothing was captured.',
    };
  }
}

export async function stopChimeTranscription(meetingId: string): Promise<ChimeTranscriptionResult> {
  try {
    await meetings().send(new StopMeetingTranscriptionCommand({ MeetingId: meetingId }));
    return { ok: true };
  } catch (err) {
    console.error('[scribe:chime] stop transcription failed:', err instanceof Error ? err.name : 'unknown');
    return { ok: false, error: 'Could not stop live transcription; it ends when the meeting ends.' };
  }
}
