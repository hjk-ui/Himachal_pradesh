# Staging builds on AWS CodeBuild

The staging server (t3.large) took ~50 minutes to run `next build`. Builds now run on CodeBuild
project `altrixs-staging-build` (BUILD_GENERAL1_LARGE, standard:7.0, Node 22, role
`altrixs-codebuild-staging`: read `source/*`, write `builds/*` and `build-cache/*` in
`altrixs-staging-artifacts-792233689095`, own logs). The build gets no secrets and no database:
only ALTRIXS_ENV=staging, NEXT_PUBLIC_PRICING_APPROVED=true, ALTRIXS_COMMIT and a dummy DATABASE_URL.

1. `git bundle create altrixs-staging-<sha>.bundle staging/hardening` and upload to `source/`.
2. `aws codebuild start-build --project-name altrixs-staging-build --environment-variables-override name=BUNDLE_KEY,value=source/altrixs-staging-<sha>.bundle,type=PLAINTEXT name=COMMIT,value=<sha>,type=PLAINTEXT`
   (~5 minutes; writes `builds/<sha>.tar.gz` with `.next/ALTRIXS_BUILD_COMMIT`).
3. Run `deploy-prebuilt.staging.sh` (replace COMMIT in the bundle name) on the server via SSM:
   checkout, `npm ci`, migrations, `prisma generate`, download + verify the build commit, swap `.next`
   (previous kept at `.next.prev` for rollback), restart pm2, health checks (~1.5 minutes).

Rollback: `mv .next .next.bad && mv .next.prev .next && pm2 restart altrixs-staging` (code checkout
must match; redeploy the previous commit's bundle + build otherwise).
The project's inline buildspec is `buildspec.staging.yml`; update both together.
