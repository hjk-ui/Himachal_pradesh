# Staging CodeBuild + prebuilt deploy

Operator path for `altrixs-staging` / divinecare staging:

1. Publish a `git bundle` of the staging branch to S3 `source/`.
2. CodeBuild (Node 22, large): `npm ci` → optional Next cache restore → `npm run build` → upload `builds/<sha>.tar.gz`.
3. Server: `deploy-prebuilt.staging.sh` fetches the tarball, hard-resets the app tree, `npm ci`, migrate, `prisma generate`, swap `.next`, **delete `.next/cache`**, pm2 restart, health-check `/login` + selected APIs.
4. Rollback: restore `.next.prev`.

See repo root:

- `buildspec.staging.yml`
- `deploy-prebuilt.staging.sh`
