/**
 * AWS side of "Upload audio" (server only): presigned S3 PUT, Transcribe batch job, transcript read,
 * and deletion of the audio object, the output JSON and the job. See upload.ts for the flow.
 *
 * IAM on the server role (docs/ai-scribe.md §7): s3:PutObject, s3:GetObject, s3:DeleteObject on
 * arn:aws:s3:::<SCRIBE_UPLOAD_BUCKET>/scribe-uploads/* and /scribe-transcripts/*;
 * transcribe:StartTranscriptionJob, transcribe:GetTranscriptionJob, transcribe:DeleteTranscriptionJob,
 * transcribe:StartMedicalTranscriptionJob, transcribe:GetMedicalTranscriptionJob,
 * transcribe:DeleteMedicalTranscriptionJob; kms:GenerateDataKey / kms:Decrypt on the bucket key.
 * Transcribe reads the media and writes the output with the CALLER's permissions, so no separate
 * data-access role is needed.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { instrumentAwsClient } from '@/lib/integrations/callLog/awsInstrument';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DeleteMedicalTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
  GetMedicalTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartMedicalTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { awsClientConfig } from '@/lib/aws/clientConfig';
import { awsRegion, hasAwsRoleOrKeys } from '@/lib/aws/credentials';
import { batchJobInput, batchTranscriptToSegments, scribeUploadBucket, scribeUploadKmsKey, uploadContentType, UPLOAD_URL_EXPIRES_S, type BatchEngine, type BatchTranscriptJson, type UploadExt } from './upload';
import type { RawSegment } from './diarization';

let s3: S3Client | null = null;
let transcribe: TranscribeClient | null = null;
const s3c = () => (s3 ??= new S3Client({ region: awsRegion(), ...awsClientConfig() }));
const tc = () => (transcribe ??= instrumentAwsClient(new TranscribeClient({ region: awsRegion(), ...awsClientConfig() }), 'transcribe'));

/** Upload needs AWS credentials (keys or AWS_LIVE role) and the upload bucket. */
export function isUploadConfigured(): boolean {
  return hasAwsRoleOrKeys() && Boolean(scribeUploadBucket());
}

export async function presignAudioPut(objectKey: string, ext: UploadExt): Promise<{ url: string; contentType: string; headers: Record<string, string> }> {
  const bucket = scribeUploadBucket();
  if (!bucket) throw new Error('upload_not_configured');
  const kms = scribeUploadKmsKey();
  const contentType = uploadContentType(ext);
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
    ServerSideEncryption: kms ? 'aws:kms' : 'AES256',
    ...(kms ? { SSEKMSKeyId: kms } : {}),
  });
  const url = await getSignedUrl(s3c(), cmd, { expiresIn: UPLOAD_URL_EXPIRES_S });
  // Headers that are part of the signature: the browser must send exactly these
  const headers: Record<string, string> = { 'Content-Type': contentType, 'x-amz-server-side-encryption': kms ? 'aws:kms' : 'AES256' };
  if (kms) headers['x-amz-server-side-encryption-aws-kms-key-id'] = kms;
  return { url, contentType, headers };
}

export async function startBatchJob(input: { engine: BatchEngine; language: 'en-US' | 'es-US'; jobName: string; objectKey: string; outputKey: string; ext: UploadExt; vocabularyName?: string }) {
  const bucket = scribeUploadBucket();
  if (!bucket) throw new Error('upload_not_configured');
  const job = batchJobInput({ ...input, bucket, kmsKeyId: scribeUploadKmsKey() });
  if (job.kind === 'medical') await tc().send(new StartMedicalTranscriptionJobCommand(job.params));
  else await tc().send(new StartTranscriptionJobCommand(job.params));
  return job.kind;
}

export type BatchStatus = { status: 'IN_PROGRESS' | 'QUEUED' } | { status: 'COMPLETED'; segments: RawSegment[] } | { status: 'FAILED'; reason: string };

export async function readBatchJob(input: { jobName: string; medical: boolean; outputKey: string }): Promise<BatchStatus> {
  const status = input.medical
    ? (await tc().send(new GetMedicalTranscriptionJobCommand({ MedicalTranscriptionJobName: input.jobName }))).MedicalTranscriptionJob?.TranscriptionJobStatus
    : (await tc().send(new GetTranscriptionJobCommand({ TranscriptionJobName: input.jobName }))).TranscriptionJob?.TranscriptionJobStatus;
  if (status === 'FAILED') return { status: 'FAILED', reason: 'transcription_failed' };
  if (status !== 'COMPLETED') return { status: status === 'QUEUED' ? 'QUEUED' : 'IN_PROGRESS' };
  const bucket = scribeUploadBucket();
  if (!bucket) throw new Error('upload_not_configured');
  const res = await s3c().send(new GetObjectCommand({ Bucket: bucket, Key: input.outputKey }));
  const text = (await res.Body?.transformToString('utf-8')) || '{}';
  return { status: 'COMPLETED', segments: batchTranscriptToSegments(JSON.parse(text) as BatchTranscriptJson) };
}

/** Delete the audio object, the output JSON and the job. Each step is attempted; failures are reported, not thrown. */
export async function deleteUploadArtifacts(input: { objectKey: string | null; outputKey: string; jobName: string | null; medical: boolean }): Promise<{ audioDeleted: boolean; transcriptDeleted: boolean; jobDeleted: boolean }> {
  const bucket = scribeUploadBucket();
  const out = { audioDeleted: !input.objectKey, transcriptDeleted: false, jobDeleted: !input.jobName };
  if (bucket && input.objectKey) {
    out.audioDeleted = await s3c()
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: input.objectKey }))
      .then(() => true)
      .catch(() => false);
  }
  if (bucket) {
    out.transcriptDeleted = await s3c()
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: input.outputKey }))
      .then(() => true)
      .catch(() => false);
  }
  if (input.jobName) {
    out.jobDeleted = await (input.medical
      ? tc().send(new DeleteMedicalTranscriptionJobCommand({ MedicalTranscriptionJobName: input.jobName }))
      : tc().send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: input.jobName })))
      .then(() => true)
      .catch(() => false);
  }
  return out;
}
