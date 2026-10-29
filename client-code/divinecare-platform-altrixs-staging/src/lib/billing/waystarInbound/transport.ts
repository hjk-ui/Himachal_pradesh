import { awsClientConfig } from '@/lib/aws/clientConfig';
import 'server-only';

/**
 * Sends non-837 X12 files (270 eligibility, 276 claim status) to Waystar /Upload with the same
 * pattern as waystarSftpService.submitClaimBatch(): stage in S3 (KMS) -> Transfer Family SFTP
 * connector StartFileTransfer(SendFilePaths). Same env vars; this file does not change the 837 path.
 * DEMO MODE (AWS not live, or connector / bucket unset): nothing leaves the server.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TransferClient, StartFileTransferCommand } from '@aws-sdk/client-transfer';
import { AWS_LIVE } from '@/lib/services/awsMode';
import { waitForTransfer, waystarSftpConfig } from '@/lib/services/waystarSftpService';
import type { EnvelopeConfig } from './x12';
import type { InquiryConfig } from './generate';

const REGION = process.env.AWS_REGION || 'us-east-1';

function env() {
  return {
    connectorId: process.env.WAYSTAR_SFTP_CONNECTOR_ID || '',
    bucket: process.env.WAYSTAR_S3_BUCKET || '',
    kmsKeyId: process.env.WAYSTAR_KMS_KEY_ID || undefined,
    remoteUploadDir: process.env.WAYSTAR_REMOTE_INBOUND_DIR || '/Upload',
    outboundPrefix: process.env.WAYSTAR_S3_INQUIRY_PREFIX || 'outbound',
  };
}

export function transportLive() {
  const e = env();
  return AWS_LIVE && Boolean(e.connectorId && e.bucket);
}

/** Envelope + provider identifiers for 270/276, from the same env the 837 uses. */
export function inquiryConfig(): InquiryConfig {
  const cfg = waystarSftpConfig();
  const tin = (process.env.PRACTICE_TIN || '').replace(/\D/g, '');
  const envelope: EnvelopeConfig = {
    submitterId: cfg.submitterId,
    submitterName: process.env.WAYSTAR_SUBMITTER_NAME || 'MD BEHAVIORAL HEALTH',
    receiverId: cfg.receiverId,
    usageIndicator: cfg.usageIndicator,
  };
  return {
    ...envelope,
    providerName: process.env.WAYSTAR_SUBMITTER_NAME || 'MD BEHAVIORAL HEALTH',
    providerNpi: cfg.groupNpi,
    originatorId: /^\d{9}$/.test(tin) ? `1${tin}` : '',
  };
}

let s3: S3Client | null = null;
let transfer: TransferClient | null = null;

export type SendResult = {
  fileName: string;
  s3Key: string;
  transferId: string;
  demo: boolean;
  delivery: 'completed' | 'unconfirmed' | 'failed' | 'demo';
  deliveryNote?: string;
};

/** Stages and transfers one file. Throws when staging or StartFileTransfer fails (nothing was sent). */
export async function sendX12File(kind: '270' | '276', fileName: string, content: string): Promise<SendResult> {
  const e = env();
  const s3Key = `${e.outboundPrefix}/${kind}/${fileName}`;
  if (!transportLive()) {
    return { fileName, s3Key, transferId: `demo-${kind}-${Date.now().toString(36)}`, demo: true, delivery: 'demo' };
  }
  s3 ??= new S3Client({ region: REGION, ...awsClientConfig() });
  transfer ??= new TransferClient({ region: REGION, ...awsClientConfig() });
  await s3.send(new PutObjectCommand({
    Bucket: e.bucket,
    Key: s3Key,
    Body: content,
    ContentType: 'text/plain',
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: e.kmsKeyId,
  }));
  const started = await transfer.send(new StartFileTransferCommand({
    ConnectorId: e.connectorId,
    SendFilePaths: [`/${e.bucket}/${s3Key}`],
    RemoteDirectoryPath: e.remoteUploadDir,
  }));
  const transferId = started.TransferId || 'unknown';
  const state = await waitForTransfer(transferId, 15_000);
  const failed = state.files.find((f) => f.status === 'FAILED');
  if (failed) return { fileName, s3Key, transferId, demo: false, delivery: 'failed', deliveryNote: failed.failure || 'transfer failed' };
  const done = state.files.length > 0 && state.files.every((f) => f.status === 'COMPLETED');
  return {
    fileName, s3Key, transferId, demo: false,
    delivery: done ? 'completed' : 'unconfirmed',
    ...(done ? {} : { deliveryNote: state.error ? `Delivery status unreadable (${state.error.slice(0, 120)})` : 'Delivery still in progress when checked' }),
  };
}
