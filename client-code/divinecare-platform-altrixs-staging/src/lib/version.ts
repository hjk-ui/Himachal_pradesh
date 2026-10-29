/**
 * Altrixs release versioning (calendar versioning).
 *
 * A release is a git tag `vYYYY.MM.DD.N` (N = release number that day). A build of an untagged commit
 * shows the build date plus a marker: `-rc` on staging, `-dev` elsewhere. The short commit always
 * travels with the version so a screenshot or support ticket points at exact code.
 *
 * next.config.js stamps the raw facts at build time (NEXT_PUBLIC_ALTRIXS_TAGS / _COMMIT / _BUILT_AT / _ENV).
 */

export const RELEASE_TAG_RE = /^v(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/;

export type AltrixsEnv = 'production' | 'staging' | 'development';

export type VersionInput = {
  /** Tags pointing at HEAD (any order) */
  tags: string[];
  commit: string | null;
  builtAt: Date;
  env: AltrixsEnv;
};

export type VersionInfo = {
  version: string;
  /** True when the build is a tagged release */
  release: boolean;
  commit: string | null;
  builtAt: string;
  env: AltrixsEnv;
};

export function normalizeEnv(value: string | undefined | null): AltrixsEnv {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'production' || v === 'prod') return 'production';
  if (v === 'staging' || v === 'stage') return 'staging';
  return 'development';
}

/** Calendar date of the build in the practice's time zone (Maryland), as YYYY.MM.DD */
export function buildDateStamp(builtAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(builtAt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')}`;
}

/** Highest release tag at HEAD (a commit tagged twice keeps the later release number) */
export function pickReleaseTag(tags: string[]): string | null {
  const releases = tags
    .map((t) => t.trim())
    .filter((t) => RELEASE_TAG_RE.test(t))
    .sort((a, b) => {
      const pa = a.match(RELEASE_TAG_RE)!.slice(1).map(Number);
      const pb = b.match(RELEASE_TAG_RE)!.slice(1).map(Number);
      for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  return releases[0] ?? null;
}

export function resolveVersion(input: VersionInput): VersionInfo {
  const tag = pickReleaseTag(input.tags);
  const version = tag
    ? tag.slice(1)
    : `${buildDateStamp(input.builtAt)}-${input.env === 'staging' ? 'rc' : input.env === 'production' ? 'untagged' : 'dev'}`;
  return {
    version,
    release: Boolean(tag),
    commit: input.commit,
    builtAt: input.builtAt.toISOString(),
    env: input.env,
  };
}

/** e.g. "2026.10.17.1 (977f464)" */
export function formatVersionLabel(info: Pick<VersionInfo, 'version' | 'commit'>): string {
  return info.commit ? `${info.version} (${info.commit})` : info.version;
}

/** Version of this build, from the facts next.config.js stamped at build time */
export function currentVersion(): VersionInfo {
  const builtAt = new Date(process.env.NEXT_PUBLIC_ALTRIXS_BUILT_AT || 0);
  return resolveVersion({
    tags: (process.env.NEXT_PUBLIC_ALTRIXS_TAGS || '').split(',').filter(Boolean),
    commit: process.env.NEXT_PUBLIC_ALTRIXS_COMMIT || null,
    builtAt: Number.isNaN(builtAt.getTime()) ? new Date(0) : builtAt,
    env: normalizeEnv(process.env.NEXT_PUBLIC_ALTRIXS_ENV),
  });
}
