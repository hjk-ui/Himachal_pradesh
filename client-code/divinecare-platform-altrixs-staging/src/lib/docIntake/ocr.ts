/**
 * OCR for intake documents with Amazon Textract (text detection only; fields come from Bedrock).
 *
 * - Images (JPEG/PNG): synchronous DetectDocumentText on the bytes.
 * - PDFs (any page count, scanned or not): async StartDocumentTextDetection, which needs the
 *   file in S3. It is written to DOC_INTAKE_S3_BUCKET under doc-intake/ and deleted as soon as
 *   the job finishes.
 *
 * Credentials: static keys, or AWS_LIVE=true with an instance role that grants
 * textract:DetectDocumentText / StartDocumentTextDetection / GetDocumentTextDetection and
 * s3:PutObject / GetObject / DeleteObject on the bucket.
 */
import { awsClientConfig } from '@/lib/aws/clientConfig';
import { instrumentAwsClient } from '@/lib/integrations/callLog/awsInstrument';
import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION?.trim() || 'us-east-1';
const BUCKET = process.env.DOC_INTAKE_S3_BUCKET?.trim() || '';
const PREFIX = 'doc-intake/';

let textract: TextractClient | null = null;
let s3: S3Client | null = null;

export function isOcrConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim()) || process.env.AWS_LIVE === 'true';
}

/** Multi-page PDFs need the S3 staging bucket as well */
export function isPdfOcrConfigured(): boolean {
  return isOcrConfigured() && Boolean(BUCKET);
}

function textractClient() {
  textract ??= instrumentAwsClient(new TextractClient({ region: REGION, ...awsClientConfig() }), 'textract');
  return textract;
}

function s3Client() {
  s3 ??= new S3Client({ region: REGION, ...awsClientConfig() });
  return s3;
}

/** pages[i] is the text of page i + 1 ("" for a page with no text) */
export type OcrText = { text: string; pageCount: number; pages: string[] };

/** LINE blocks in reading order, pages separated by a blank line */
function linesToText(blocks: Block[], metadataPages = 0): OcrText {
  const pages = new Map<number, string[]>();
  for (const b of blocks) {
    if (b.BlockType !== 'LINE' || !b.Text) continue;
    const page = b.Page ?? 1;
    const list = pages.get(page) ?? [];
    list.push(b.Text);
    pages.set(page, list);
  }
  const ordered = [...pages.keys()].sort((a, b) => a - b);
  const pageCount = Math.max(1, metadataPages, ordered.length ? ordered[ordered.length - 1] : 0);
  return {
    text: ordered.map((p) => pages.get(p)!.join('\n')).join('\n\n'),
    pageCount,
    // Indexed by the real page number, so a blank page does not shift the pages after it
    pages: Array.from({ length: pageCount }, (_, i) => pages.get(i + 1)?.join('\n') ?? ''),
  };
}

export async function ocrImage(bytes: Uint8Array): Promise<OcrText> {
  const res = await textractClient().send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }));
  return linesToText(res.Blocks ?? [], res.DocumentMetadata?.Pages ?? 0);
}

/**
 * Upload the PDF to the staging bucket and start the async job. Returns the Textract job id.
 * Textract returns the earlier job for a repeated request token, so re-processing passes a new one.
 */
export async function startPdfOcr(documentId: string, bytes: Uint8Array, requestToken = documentId): Promise<string> {
  const key = `${PREFIX}${documentId}.pdf`;
  await s3Client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    })
  );
  try {
    const res = await textractClient().send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: BUCKET, Name: key } },
        ClientRequestToken: requestToken.replace(/[^A-Za-z0-9-_]/g, '').slice(0, 64),
      })
    );
    if (!res.JobId) throw new Error('Textract returned no job id');
    return res.JobId;
  } catch (err) {
    await deletePdf(documentId);
    throw err;
  }
}

async function deletePdf(documentId: string) {
  try {
    await s3Client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${documentId}.pdf` }));
  } catch (err) {
    console.error('[doc-intake] could not delete OCR staging object', documentId, err instanceof Error ? err.message : '');
  }
}

export type PdfOcrPoll =
  | { state: 'running' }
  | { state: 'done'; result: OcrText }
  | { state: 'failed'; error: string };

/** Poll an async job; when it finishes, collect every page and delete the staged PDF. */
export async function pollPdfOcr(documentId: string, jobId: string): Promise<PdfOcrPoll> {
  const blocks: Block[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const res = await textractClient().send(
      new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken, MaxResults: 1000 })
    );
    if (res.JobStatus === 'IN_PROGRESS') return { state: 'running' };
    if (res.JobStatus === 'FAILED') {
      await deletePdf(documentId);
      return { state: 'failed', error: res.StatusMessage || 'Textract could not read this document' };
    }
    pages = res.DocumentMetadata?.Pages ?? pages;
    blocks.push(...(res.Blocks ?? []));
    nextToken = res.NextToken;
  } while (nextToken);
  await deletePdf(documentId);
  return { state: 'done', result: linesToText(blocks, pages) };
}
