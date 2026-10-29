# Security scanning and patch SLAs

## What runs where

| Check | Where | When | Blocks? |
|---|---|---|---|
| `npm audit --omit=dev --audit-level=high` | `.github/workflows/ci.yml` | every push / PR | No (report only) |
| `npm audit --omit=dev --audit-level=critical` | `.github/workflows/ci.yml` | every push / PR | **Yes**: any critical advisory in a production dependency fails CI |
| Dependabot (npm + GitHub Actions) | `.github/dependabot.yml` | weekly (Mon) | No; opens PRs. Minor/patch updates are grouped into one PR; majors arrive one per PR |
| CodeQL (`javascript-typescript`, `security-extended`) | `.github/workflows/codeql.yml` | every push / PR + weekly (Mon) | Findings show in the PR and under Security → Code scanning |
| OWASP ZAP baseline (passive, unauthenticated) | `.github/workflows/zap-baseline.yml` | weekly (Tue) + manual "Run workflow" | No (`fail_action: false`) |

`npm audit` uses `--omit=dev` because dev dependencies (tailwind, eslint, playwright, tsx, prisma CLI in dev) are not shipped
to the server's request path. The CodeBuild staging build (`deploy/codebuild/buildspec.staging.yml`) runs `npm ci --no-audit`.
The audit gate is in GitHub CI, so that is expected.

## Reading the results

- **npm audit**: open the "Dependency audit" steps in the CI run. Each entry lists the package, the advisory (GHSA link),
  and whether a fix is available. Locally: `npm audit --omit=dev` (or `--json` for counts by severity under `metadata.vulnerabilities`).
  Fix it by upgrading the direct dependency. For a transitive package, add a scoped entry under `overrides` in `package.json`
  (examples are already there for nodemailer, uuid, effect and deepmerge-ts). Then run `npm install`, `npx tsc --noEmit -p .` and `npm test`.
- **Dependabot**: review the grouped minor/patch PR weekly and merge it once CI is green. Review each major PR on its own.
  Prisma 7 and Tailwind 4 majors are ignored on purpose (planned upgrades, see below).
- **CodeQL**: GitHub → Security → Code scanning. Triage every alert: fix it, or dismiss it with a reason ("false positive" or
  "used in tests") so the dismissal stays on record.
- **ZAP baseline**: download the `zap-baseline-report` artifact from the workflow run (HTML, Markdown and JSON). It covers
  only what an anonymous visitor can reach: login page, public pages, headers, cookies. Alerts marked WARN are findings to
  triage. Rules in `.zap/rules.tsv` marked IGNORE are confirmed false positives, each with its reason. Add a rule there only
  with a reason. The scan is passive: it spiders and inspects responses, it does not attack or log in.

## Patch SLAs

Measured from the advisory publication date, or the date we learn of it if that is later.

| Severity | Remediate within |
|---|---|
| Critical | 7 days. **72 hours** if it is known to be exploited (CISA KEV or a vendor "exploited in the wild" note) |
| High | 30 days |
| Medium | 90 days |
| Low | 180 days |

If a fix cannot ship within the SLA (no upstream fix, or the fix is a breaking major), record the exception below with the
exploitability for our usage, the mitigation, and a target date.

## Current exceptions and planned upgrades (as of 2026-10-24)

`npm audit --omit=dev`: **0** vulnerabilities (was 1 critical, 15 high, 4 moderate).

- **Prisma 7 (planned).** The Prisma 6 advisories came from `@prisma/config` dependencies `effect` (<3.20, AsyncLocalStorage
  context loss under concurrent RPC fibers) and `deepmerge-ts` (<8, stack exhaustion on recursive object graphs). `@prisma/config`
  only loads `prisma.config.*` / schema settings when the Prisma CLI runs (`prisma generate`, `migrate`). That is trusted, repo-controlled
  input, outside the HTTP request path. The query engine and `@prisma/client` runtime do not use either package. Mitigation in place:
  `overrides` pin `effect@^3.22.4` and `deepmerge-ts@^8.0.2` under `@prisma/config` (prisma uses only the plain `deepmerge()` function,
  which is unchanged in v8), so the advisories no longer apply. The Prisma 7 upgrade (driver adapters, new generator output path)
  is planned post go-live and is tracked as a separate change.
- **next-auth 5.0.0-beta.32** is the newest v5 beta. Its only advisory came through its `nodemailer` peer (`^7 || ^8`). We don't
  use the Email/Nodemailer provider (Credentials only). The override `"nodemailer": "$nodemailer"` makes next-auth and `@auth/core` share
  the app's patched `nodemailer@10.2.1`.
- **xlsx (SheetJS)**: the npm registry copy (0.18.5) is unmaintained and has prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS
  (GHSA-5pgg-2g8v-p4x9) with no npm fix. We now install the vendor's maintained build from
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, which fixes both (pinned with an integrity hash in `package-lock.json`).
  It runs in the browser on the admin migration pages (staff parse their own Valant exports) and in `scripts/import-client-excel.ts`.
  Dependabot cannot update a tarball URL, so check https://cdn.sheetjs.com/ by hand each quarter.
- **Dev-only (not in `--omit=dev`)**: `postcss-selector-parser` <7.1.6 (moderate, quadratic selector parsing) via `tailwindcss@3`.
  It runs only at build time on our own CSS. The fix is Tailwind 4 (a breaking rewrite), planned separately.
