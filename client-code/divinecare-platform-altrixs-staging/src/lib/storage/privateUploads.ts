import path from 'path';

/**
 * Uploaded files (staff photos, client photos, credential documents, intake documents) live OUTSIDE
 * `public/`, so Next.js and nginx never serve them directly. They are streamed by
 * /api/files/[kind]/[name], which checks the signed-in user first.
 *
 * Set UPLOADS_DIR on servers (e.g. /var/lib/altrixs/uploads); defaults to ./private-uploads.
 */
export const UPLOAD_KINDS = ['avatars', 'client-avatars', 'credentials', 'intake-docs'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

const ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), 'private-uploads');
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export function isUploadKind(kind: string): kind is UploadKind {
  return (UPLOAD_KINDS as readonly string[]).includes(kind);
}

export function uploadDir(kind: UploadKind) {
  return path.join(ROOT, kind);
}

/** Absolute path for a stored file, or null if the name could escape the folder. */
export function uploadPath(kind: UploadKind, filename: string) {
  if (!SAFE_NAME.test(filename)) return null;
  return path.join(uploadDir(kind), filename);
}

/**
 * Signed structured forms (e.g. the Carelon non-overlap attestation PDF). Deliberately NOT an
 * UploadKind: /api/files never serves them; only the form's own audited download route reads them.
 */
export function signedFormPath(filename: string) {
  if (!SAFE_NAME.test(filename)) return null;
  return path.join(ROOT, 'signed-forms', filename);
}

/**
 * Practice-uploaded resource library files (handouts / worksheets). Not an UploadKind: /api/files
 * never serves them; only the audited library download routes (staff and patient) read them.
 */
export function resourceFilePath(filename: string) {
  if (!SAFE_NAME.test(filename)) return null;
  return path.join(ROOT, 'resource-library', filename);
}

export function uploadUrl(kind: UploadKind, filename: string) {
  return `/api/files/${kind}/${filename}`;
}

/**
 * Filename of a stored upload from its URL. Accepts current `/api/files/<kind>/…`
 * URLs and legacy `/uploads/<kind>/…` URLs still saved in older rows.
 */
export function storedUploadName(url: string | null | undefined, kind: UploadKind) {
  if (!url) return null;
  const clean = url.split('?')[0];
  for (const prefix of [`/api/files/${kind}/`, `/uploads/${kind}/`]) {
    if (clean.startsWith(prefix)) {
      const name = path.basename(clean.slice(prefix.length));
      return SAFE_NAME.test(name) ? name : null;
    }
  }
  return null;
}
