# Altrixs production cutover plan (Valant exit, Nov 8 2026)

Prepared 2026-10-20 from the `staging/hardening` codebase, `DEPLOY.md`, `docs/`, `scripts/`, `prisma/migrations/`,
`.env.example`, the project memory notes, and **read-only** AWS describe/list calls (profile `altrixs`, us-east-1).
No AWS resource, DNS record, server or database was changed to write this plan.

**Calendar.** Nov 8 2026 is a **Sunday**. The cutover runs Friday evening Nov 6 to Sunday Nov 8. The first clinic
day on Altrixs is **Monday Nov 9**. Hypercare runs Nov 9 to Nov 20. (The Oct 9 one-pager said Nov 2. Valant's exit
date of Nov 8 replaces it. Every date below works back from Nov 8.)

**Owners.** Names come from the go-live one-pager. Change them as needed.

| Short name | Who | Owns |
|---|---|---|
| **PL** | Andy Kum, project lead | AWS account, decisions, vendors, cutover command |
| **SP** | Sam, sponsor | Go/no-go, contracts (Valant, DrFirst, Waystar, Mindaptix) |
| **DEV** | Dev lead (Kartik) plus whoever deploys `staging/hardening` | Code, deploys, imports, scripts |
| **BIL** | Billing lead | Waystar, payers, A/R reconciliation, patient balances |
| **CLN** | Clinical lead / Medical Director | Prescribers, EPCS, clinical validation, downtime clinical forms |
| **PO** | Privacy/Security officer (name one; PL until then) | Risk assessment, BAAs, access reviews |
| **SU-x** | Super-user per site (B = Bowie, SS = Silver Spring, BA = Baltimore, LP = Lexington Park) | Training, smoke tests, floor support |
| **MX** | Mindaptix (Gaurav) | Read-only counts on the old production DB, freezing their deploys, handing over access |

---

## 0. What exists today (verified 2026-10-20)

| Item | Current production (Mindaptix codebase) | Staging (this codebase) |
|---|---|---|
| EC2 | `i-0d5432ef9c5805121` "Altrixs-next.js", **t3.small**, us-east-1c, default VPC, public IP 107.21.192.210, **no IAM role / no SSM**, SGs `launch-wizard-1` (**22, 80, 443 open to 0.0.0.0/0**) + `ec2-rds-1`, IMDSv2 required | `i-0b31cc388db14d752` "Altrixs-staging", t3.large, us-east-1c, role `altrixs-staging-ec2`, SG 80/443 only, SSM only |
| EBS | `vol-06ae9f39d6d27d349` 20 GB gp3, **unencrypted** (holds DB dumps, `live-clients.txt`, client avatars per the Oct 15 inspection) | `vol-0d927fa6a5e91b7ce` 30 GB gp3, encrypted |
| RDS | `altrixs-postgres`: PG 16.13, db.t4g.small, **single-AZ** (us-east-1c), 20 GB gp3 (autoscale to 100), encrypted, private, deletion protection, PI on, **7-day** backups, created 2026-08-11 | `altrixs-staging-postgres`: PG 16.13, db.t4g.small, single-AZ (1b), 20 GB, encrypted, private, deletion protection, PI on, 7-day backups |
| DB footprint | About 1.7 GB used (FreeStorageSpace about 18.3 GB). Avg 4 to 8 connections, peaks of 15. Steady low writes (avg 2.4 to 2.9 write IOPS, peaks about 19). It is in use, and about the same size as staging's Valant import. | About 1.8 GB used after the Valant import |
| AWS Backup | Plan `altrixs-daily-monthly`, selection `altrixs-web-and-db` = old prod EC2 + `altrixs-postgres`. **EC2 jobs complete, but they are unencrypted recovery points. Every RDS job FAILS:** "inside or too close to the automated backup window". | **Not in AWS Backup.** Only RDS automated 7-day backups, plus manual snapshot `altrixs-staging-pre-0ecfc20`. |
| Network | Default VPC `vpc-0166783ea22d29d8f` (172.31.0.0/16). Public /20s in 6 AZs and private /25s in 1a/1b/1c/1d/1f. **No NAT, no ALB, no ACM certificate, no WAF.** | Same VPC and subnet as prod |
| DNS | Squarespace nameservers. `altrixs.com` A = 107.21.192.210. MX = Google Workspace. TXT = google-site-verification only. **No SPF, no DMARC.** **No Route 53 hosted zone.** Route 53 health checks exist for `altrixs.com/login` and `staging.altrixs.com/api/ready`. | |
| SES | Production access, 50,000/day. `altrixs.com` verified, DKIM SUCCESS. **No custom MAIL FROM.** | Same identity (`no-reply@altrixs.com`) |
| SMS | Toll-free +18885985978: registration `registration-1e51b16a…` **CREATED** (started Jul 31, never submitted). Toll-free +18333637044: registration `registration-ce2d3a4d…` **REVIEWING** (submitted Oct 17). Both numbers PENDING. | Staging role allowed to send on +18885985978 |
| Waystar | Transfer connector `c-e0002d623f084fc8a` → `sftp://sshftp.waystar.com:22` (**test** mailbox 331609), bucket `altrixs-waystar-edi-792233689095`, KMS `alias/altrixs-waystar-edi`, secret `altrixs/waystar/sftp-test` | Staging uses prefixes `staging/outbound/837` and `staging/inbound` |
| Secrets | `altrixs/staging/{admin-login,integrations,phi-field-encryption-key}`, `altrixs/waystar/sftp-test`, RDS-managed `rds!db-a67f7d7c…`. **No `altrixs/prod/*`.** | |
| Alarms | 14 alarms, all OK: `altrixs-production-*` (7, watching the OLD instance/DB/site) and `altrixs-staging-*` (7) | |
| Logs | CloudTrail and VPC flow logs (365 days), RDS postgresql logs. **No application, nginx or cron logs in CloudWatch**: pm2 logs are on the box only. | |
| IAM | **Root access keys present.** `gaurav@mindaptix.com`: AdministratorAccess, **no MFA**. `bridgecare-api`: 10 FullAccess policies + key from Jun 29, no MFA. `altrixs-connect`: Connect/Bedrock/Chime full + key from Sep 30. `ses-smtp-user.20260901-121353`: key. | Staging uses an instance role with no static keys |

### What the old production holds, and what must be preserved

- The production database is live: it has had steady connections and writes for 30 days, and it uses about the
  same storage as staging after its full Valant import. The Oct 15 disk inspection found a
  `live-rds-before-local-import.dump`, `live-clients.txt`, 21 client avatars and one staff credential file. So
  **treat `altrixs-postgres` and `vol-06ae9f39d6d27d349` as containing PHI.** That means at least Valant-derived
  client demographics, and possibly records that staff entered in the Mindaptix app.
- These read-only calls cannot tell whether clinicians entered clinical data there (notes, appointments,
  messages). Reading table contents would mean reading PHI, so this plan does not. **Task T-02**: Mindaptix runs a
  counts-only query against the old DB and sends PL the output. The query returns no PHI:
  `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 2 DESC;` plus, for each clinical table
  (notes, appointments, messages, documents, users), `count(*)` and `max("createdAt")` where `"createdAt" > '2026-08-11'`.
  - If there are clinical rows that Valant does **not** have (for example notes written only in the Mindaptix
    app), CLN decides by Oct 30 whether to (a) export them as PDFs into the Altrixs chart with Smart Document
    Intake, or (b) keep them in the retained snapshot and record their location in the legal record policy.
  - Patient portal / Flutter app accounts: the Flutter patient app calls `https://altrixs.com/api/patient/*`
    (`docs/Flutter-Patient-App-*.md`). If patients have accounts on the old DB, they must re-register or be
    re-invited after cutover (Q-09).
- **Retention after cutover (all owned by PL):**
  1. Take a final manual snapshot `altrixs-postgres-final-20261107`. Copy it into `altrixs-backup-vault` with a
     7-year retention (HIPAA documentation is 6 years; Maryland record retention runs from the last visit, and for
     minors it runs past age 21, so ask counsel).
  2. Snapshot `vol-06ae9f39d6d27d349` and **copy it encrypted** with the prod CMK. Delete the unencrypted snapshot
     and the unencrypted AWS Backup EC2 recovery points once the encrypted copy is verified.
  3. Stop the old instance (do not terminate it) on Nov 8. Terminate it, and delete `altrixs-postgres` after a
     final snapshot, only after the Nov 30 sign-off (T-90).

---

## 1. Decision: target architecture

### Recommendation: **Option A, a new production environment built from this codebase, in its own VPC. Staging stays staging.**

| | **A. New prod stack (recommended)** | B. Reuse old prod EC2/RDS |
|---|---|---|
| Codebase fit | Schema built from `prisma/migrations` + `scripts/migrate.sh` (166+ tables) | The old RDS has Mindaptix's Prisma schema (about 90 models). It would have to be wiped or merged, and DEPLOY.md forbids `prisma db push` on a live DB. |
| PHI hygiene | Clean disk and DB. Every volume, snapshot and bucket is encrypted from day 1. | Unencrypted root volume with PHI dumps. Encrypting it means replacing the volume anyway. |
| Access | Instance role + SSM only. No SSH. No Mindaptix credentials. | SSH open to the world, Mindaptix deploys over SSH, no role, 8 stale pm2 releases |
| Rollback / evidence | The old system stays intact (stopped) as evidence and a fallback until sign-off | It is overwritten on cutover day, so there is nothing to fall back to |
| Resilience | Multi-AZ RDS, 2 app instances behind an ALB in 2 AZs, WAF, PITR 35 days | Single AZ everywhere, unless rebuilt (which is option A with more risk) |
| Effort | About 3 days of infrastructure work, rehearsed twice before Nov 8 | Looks smaller, but cleaning up and converting the old stack costs about the same, with more risk |

Industry practice for a HIPAA workload: a separate production environment and network from staging, a
Multi-AZ database with PITR and deletion protection, more than one app instance (or at least EC2
auto-recovery), TLS terminated at an ALB with an ACM certificate, a WAF, secrets in Secrets Manager per
environment, a least-privilege instance role, and a tested backup restore. Option A meets all of these.

### Target design (Option A)

```
Route 53 (altrixs.com zone) ──► WAF (AWS managed rules + rate limit) ──► ALB (ACM cert, TLS 1.2+/1.3, 2 public subnets)
                                                                         │ HTTPS to targets
                                     ┌───────────────────────────────────┴───────────────────────────────┐
                              app-a (t3.large, private subnet AZ-a)                   app-b (t3.large, private subnet AZ-b)
                              nginx :443 → pm2 next start :3000                       same; cron jobs run ONLY on app-a
                                     │   EFS (encrypted) mounted at /var/lib/altrixs/uploads (shared uploads)
                                     ▼
                              RDS PostgreSQL 16 Multi-AZ (db.m7g.large, gp3 100 GB, PITR 35 d, PI, deletion protection)
NAT gateway (1) for outbound: DrFirst, Bedrock, SES/SMS, Transfer API, SSM. Waystar SFTP goes via the Transfer connector (static IPs).
```

- **Why 2 instances need EFS:** private uploads are written to local disk (`src/lib/storage/privateUploads.ts`,
  `UPLOADS_DIR`). Mounting EFS at `/var/lib/altrixs/uploads` makes them shared, with no code change.
- **Sessions:** next-auth sessions are signed with `AUTH_SECRET`, so both instances share one secret and no
  sticky sessions are needed. In-memory rate limits (register, booking, Availity routes) become per-instance;
  the WAF rate rule sits on top of them.
- **Cron must run once only.** Install the jobs only on app-a: the DrFirst sweep, Waystar retrieval, SUD radar
  (`deploy/crontab.staging` → a new `deploy/crontab.production`) and the notifications caller (`docs/ops-cron.md` §1).
  `drfirst-sync` and `sud-radar-scan` hold advisory locks, `waystar-retrieve` has per-file locks, and
  notifications are de-duplicated, so a double run is safe. A single runner is still cleaner.
- **Deploys:** use the same bundle → S3 → SSM pattern as DEPLOY.md, rolling one instance at a time:
  1. Run `scripts/migrate.sh` once.
  2. Take app-a out of the target group, build, `pm2 restart`, check `/api/ready`, and put it back.
  3. Repeat for app-b.

  `next build` takes 15 to 18 minutes on a t3.large. Rolling avoids downtime and keeps the build from starving a
  live server. Later, build once in CI and ship `.next` as an artifact.
- **Lean fallback (Option A-lean)**, if the owner wants a lower bill: one t3.large with EC2 auto-recovery and an
  AMI, behind the same ALB and WAF, with RDS db.t4g.large Multi-AZ and no NAT (the instance stays in a public
  subnet, and its SG admits only the ALB). This is still separate, Multi-AZ, ALB+ACM+WAF and PITR, but has one
  app instance.

### Monthly cost estimate (us-east-1 on-demand list prices, Oct 2026; confirm in the AWS Pricing Calculator)

| Component | A (recommended) | A-lean | B (reuse, hardened) |
|---|---|---|---|
| EC2 app | 2 × t3.large = $122 | 1 × t3.large = $61 | 1 × t3.large = $61 |
| EBS gp3 (40 GB each) | $7 | $4 | $4 |
| ALB (hours + LCU) | $25 | $25 | $25 |
| RDS PostgreSQL Multi-AZ | db.m7g.large = $245 | db.t4g.large = $188 | db.t4g.large = $188 |
| RDS storage gp3 100 GB × 2 AZ | $23 | $23 | $23 |
| RDS backup storage (35-day PITR, beyond the free tier) | $10 | $10 | $10 |
| EFS uploads (about 20 GB) | $6 | $0 | $0 |
| NAT gateway + data | $36 | $0 | $0 |
| WAF (ACL + 4 managed groups + requests) | $10 | $10 | $10 |
| AWS Backup (EC2/EBS + RDS vault copies, 35 daily + 12 monthly) | $25 | $20 | $20 |
| CloudWatch (logs, agent metrics, about 25 alarms) | $20 | $15 | $15 |
| Secrets Manager (about 12) + KMS CMKs (3) | $8 | $8 | $8 |
| S3 (artifacts, EDI, doc intake, recordings) | $5 | $5 | $5 |
| Route 53 zone + health checks | $4 | $4 | $4 |
| Public IPv4 (ALB, NAT) | $11 | $7 | $7 |
| **Fixed infrastructure** | **about $560/mo** | **about $380/mo** | **about $380/mo** |

**Usage-based costs are the same for every option.** These are estimates at about 1,950 visits a month
(Bowie 300 + Silver Spring 120 + Baltimore 50 a week):

| Service | Monthly estimate |
|---|---|
| Toll-free SMS reminders (about 4,000 messages incl. carrier fees) | about $45 |
| SES | about $1 |
| Chime telehealth (assumes 30% virtual, 50 minutes, 2 attendees) | about $100 |
| Bedrock (note drafts / coding) | about $100 to $200 |
| Textract and Comprehend Medical | about $50 to $70 |
| **Usage-based total, without AI Scribe** | **about $300 to $400** |
| AI Scribe transcription, if used on every visit (Transcribe standard, $0.024/min) | about $1,200 more |

Scribe is consent-gated and optional, so it is listed separately.

- Staging keeps running at about $110/mo.
- Retiring the old production saves about $60/mo once its final snapshots are taken (keeping them costs about $3/mo).
- After 30 days of steady state, a 1-year Compute Savings Plan plus an RDS reserved instance cuts about 30 to 40%
  of the EC2 and RDS lines. Performance Insights data may also justify moving RDS down to db.t4g.large.

---

## 2. Production environment build checklist

Names use the `altrixs-prod-*` prefix. **Never reuse `altrixs-postgres` or any `altrixs-production-*` alarm
names**: they belong to the old Mindaptix stack. Every item is done by DEV and PL unless noted.

### 2.1 Network (Oct 21)

- [ ] VPC `altrixs-prod-vpc` 10.20.0.0/16 across 2 AZs (us-east-1a, us-east-1b):
  - public subnets (ALB, NAT)
  - private-app subnets
  - private-db subnets
- [ ] 1 NAT gateway. Private route tables point 0.0.0.0/0 at the NAT.
- [ ] Gateway VPC endpoint for S3. Optional interface endpoints for SSM, Secrets Manager and Logs.
- [ ] VPC flow logs to `/altrixs/prod/vpc-flow-logs`, kept 1 year.
- [ ] Security groups:
  - `altrixs-prod-alb`: 443 (and 80 redirect) from 0.0.0.0/0.
  - `altrixs-prod-app`: 443 from `altrixs-prod-alb` only. **No port 22.**
  - `altrixs-prod-db`: 5432 from `altrixs-prod-app` only.
  - `altrixs-prod-efs`: 2049 from `altrixs-prod-app`.
- [ ] No peering to the default VPC. Staging cannot reach prod.

### 2.2 KMS and Secrets (Oct 21)

- [ ] CMK `alias/altrixs-prod-data` (RDS, EFS, EBS, S3, Secrets, CloudWatch Logs), with key rotation on. Keep using
  CMK `alias/altrixs-waystar-edi` for EDI.
- [ ] Secrets:

  | Secret | Contents |
  |---|---|
  | `altrixs/prod/app` | AUTH_SECRET, CRON_SECRET, UNSUBSCRIBE_SECRET, ERA_WEBHOOK_SECRET, SMART_SIGNING_SECRET |
  | `altrixs/prod/phi-field-encryption-key` | **New key. Never copy the staging key.** Replicate the secret to us-west-2 so the key survives a region or account mistake. Without it, encrypted SSNs and DrFirst log payloads cannot be read. |
  | `altrixs/prod/integrations` | DrFirst prod, Waystar prod, Stripe when approved |
  | `altrixs/waystar/sftp-prod` | Waystar production SFTP credentials |
  | `altrixs/prod/admin-login` | Break-glass admin |
  | RDS-managed master secret | Created by RDS |

- [ ] The `.env` on each instance is rendered from these secrets at deploy time (mode 600), the same way staging
  merges `altrixs/staging/integrations`.

### 2.3 RDS (Oct 22)

- [ ] `altrixs-prod-db`:
  - PostgreSQL 16.13 (same as staging), db.m7g.large, **Multi-AZ**.
  - gp3 100 GB, storage autoscaling to 500.
  - Encrypted with the prod CMK. Private. Deletion protection on.
- [ ] Backup retention **35 days (PITR)**. Backup window **04:00 to 04:30 UTC**. Copy tags to snapshots.
- [ ] Performance Insights (7 days free) and Enhanced Monitoring at 60 s.
- [ ] Log exports `postgresql` and `upgrade`.
- [ ] Parameter group with `rds.force_ssl=1`, `log_min_duration_statement=1000`, and `pgaudit` for DDL/role changes.
- [ ] Master password managed in Secrets Manager. App user `altrixs_app` (not the master), with grants the same as
  staging. A read-only `altrixs_readonly` user for check scripts and reports.
- [ ] **Schema bootstrap** (repeat it in the rehearsal database to prove it):
  1. On the empty database, create the Prisma-modelled tables once at the release commit, the same way staging was
     built. `prisma db push` is safe **only** on an empty database and only this one time; DEPLOY.md forbids it on
     any database that already has data.
  2. Run `bash scripts/migrate.sh`. All ledger files are idempotent (63 as of Oct 20: 62 `.sql` files plus 1 legacy folder) and create the SQL-only tables and seed rows, and
     the ledger records them.
  3. Acceptance: `scripts/migrate.sh --status` shows 0 pending, and
     `pg_dump --schema-only --no-owner` of prod vs staging (same commit) shows no differences except names and
     ownership.
  4. After this, only `migrate.sh` ever touches the prod schema.

### 2.4 Compute (Oct 22–23)

- [ ] AMI: Ubuntu 24.04, Node 22 (NodeSource), pm2 5.4, nginx, 4 GB swap, service user `altrixs`, `/opt/altrixs/app`,
  automatic security updates, CloudWatch agent, SSM agent. Bake the AMI from the staging build steps.
- [ ] `altrixs-prod-app-a` and `altrixs-prod-app-b`:
  - t3.large (unlimited credits), private subnets, IMDSv2 required.
  - 40 GB gp3 root volume encrypted with the prod CMK.
  - Termination protection on. EC2 auto-recovery alarm on each.
- [ ] Mount EFS `altrixs-prod-uploads` (encrypted, TLS mount, backup on) at `/var/lib/altrixs/uploads`.
- [ ] nginx serves 443 with an internal certificate for ALB→target encryption. It returns 404 on `/uploads/`, and
  `server_tokens` is off.
- [ ] ALB `altrixs-prod-alb`:
  - Listeners: HTTPS 443 with policy `ELBSecurityPolicy-TLS13-1-2-2021-06`; HTTP 80 redirects to 443.
  - Target group health check `GET /api/ready` (200).
  - Deregistration delay 30 s. Idle timeout 120 s (long imports and the notifications cron).
  - Access logs to S3.
- [ ] ACM certificate for `altrixs.com`, `www.altrixs.com` and `cutover.altrixs.com`, DNS-validated.
- [ ] WAF `altrixs-prod-waf` on the ALB:
  - AWS managed rule groups: Common, KnownBadInputs, AmazonIpReputation, SQLi.
  - Rate rule of 2,000 requests per 5 minutes per IP.
  - Body-size exceptions for the import endpoints `/api/migration/*` and the doc-intake upload, with Count first,
    then Block after tuning.
  - **Until cutover:** an IP allowlist rule limits `cutover.altrixs.com` to the office and admin IPs.
  - Logs to `aws-waf-logs-altrixs-prod`.
- [ ] Rolling deploy runbook. Copy DEPLOY.md §3 with two changes: `ALTRIXS_ENV=production`, and deregister and
  re-register each target around its build.

### 2.5 S3 (Oct 22)

All buckets are private, with Block Public Access on, SSE-KMS (prod CMK), versioning, TLS-only bucket policies, and
S3 data events in CloudTrail.

| Bucket | Purpose and rules |
|---|---|
| `altrixs-prod-artifacts-792233689095` | Bundles. Expire after 90 days. |
| `altrixs-prod-docintake-792233689095` | `DOC_INTAKE_S3_BUCKET`. Lifecycle deletes `doc-intake/` objects after 1 day, matching the staging behaviour. |
| `altrixs-prod-recordings-792233689095` | `TELEHEALTH_S3_RECORDINGS_BUCKET`. Recording stays OFF until a consent workflow exists, because Maryland requires all-party consent to record. |
| `altrixs-prod-uploads-backup-792233689095` | Optional, if AWS Backup of EFS is not enough |
| `altrixs-prod-alb-logs-792233689095` | ALB access logs |

- [ ] Waystar: keep bucket `altrixs-waystar-edi-792233689095` and add the prefixes `production/outbound/837` and
  `production/inbound`. The bucket policy denies the staging role on `production/*`.

### 2.6 IAM role `altrixs-prod-ec2` (least privilege, Oct 22)

Managed policies `AmazonSSMManagedInstanceCore` and `CloudWatchAgentServerPolicy`, plus one inline policy per
area. Each policy is scoped to prod ARNs:

| Area | Actions (resource scope) |
|---|---|
| Bedrock | `bedrock:InvokeModel`, `InvokeModelWithResponseStream` on the Sonnet 4.6 / Haiku 4.5 inference profiles and foundation models in us-east-1, us-east-2 and us-west-2. `bedrock:ApplyGuardrail` on the prod guardrail. |
| Comprehend Medical | `comprehendmedical:DetectEntitiesV2`, `InferICD10CM`, `InferRxNorm` (*), with a region condition of us-east-1 |
| Transcribe (AI Scribe) | `transcribe:StartStreamTranscription`, `StartStreamTranscriptionWebSocket`, `StartMedicalStreamTranscription`, `StartMedicalStreamTranscriptionWebSocket` |
| Chime SDK | `chime:CreateMeeting`, `CreateMeetingWithAttendees`, `GetMeeting`, `DeleteMeeting`, `CreateAttendee`, `BatchCreateAttendee`, `DeleteAttendee`, `ListAttendees`, `StartMeetingTranscription`, `StopMeetingTranscription` (us-east-1). The service-linked role `AWSServiceRoleForAmazonChimeTranscription` already exists. |
| SES | `ses:SendEmail`, `SendRawEmail` on `identity/altrixs.com`, with condition `ses:FromAddress = no-reply@altrixs.com` |
| SMS / SNS | `sms-voice:SendTextMessage` on the prod toll-free number / pool and its configuration set. `sns:Publish` on the prod alerts topic (`AWS_SNS_TOPIC_ARN`). The inbound topic `altrixs-prod-inbound-sms` is KMS-encrypted (`docs/ops-cron.md` §3). |
| Textract | `textract:AnalyzeDocument`, `DetectDocumentText`, `StartDocumentAnalysis`, `GetDocumentAnalysis`. S3 Get/Put/Delete on the doc-intake bucket. |
| Transfer (Waystar) | `transfer:StartFileTransfer`, `StartDirectoryListing`, `ListFileTransferResults`, `DescribeConnector` on the **prod** connector ARN. S3 on `altrixs-waystar-edi-*/production/*`. KMS on `alias/altrixs-waystar-edi`. |
| Secrets | `secretsmanager:GetSecretValue` on `altrixs/prod/*`, `altrixs/waystar/sftp-prod` and the RDS master secret ARN only |
| S3 / KMS | Prod buckets above. `kms:Decrypt`, `GenerateDataKey` on the prod CMK. |
| Optional | `events:PutEvents` on the prod bus, if EventBridge clinical alerts are used. `connect:*` limited to the needed actions on `altrixs-prod`, if Connect calling is used. |

- [ ] Add an explicit deny on everything tagged `env=staging`, and the reverse on the staging role.
- [ ] Set `AWS_LIVE=true` (commit 2978249). **No `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the prod `.env`.**
- [ ] Before Bedrock is used in prod, request access to the Sonnet/Haiku models and complete the Marketplace
  subscription with an admin identity, as was done for staging.
- [ ] Set the four `BEDROCK_GUARDRAIL_{CLINICAL,GENERAL}_{ID,VERSION}` variables (guardrails created 2026-10-23, see docs/ai-guardrails.md) and grant the prod role `bedrock:ApplyGuardrail` on both.

### 2.7 Logs, monitoring and alarms (Oct 23)

- [ ] The CloudWatch agent ships these log groups, KMS-encrypted and kept 1 year:
  - `/altrixs/prod/app` (pm2 stdout/stderr)
  - `/altrixs/prod/nginx`
  - `/altrixs/prod/cron`, one stream per job: drfirst-sync, waystar-retrieve, sud-radar-scan, notifications
  - `/altrixs/prod/ssm-sessions` (Session Manager session logging)
- [ ] The agent also sends memory and disk metrics.
- [ ] Alarms go to SNS `altrixs-infra-alerts` (andy@altrixs.com + SMS; confirm the email subscription). Create them
  as `altrixs-prod-*`, then retire the 7 `altrixs-production-*` alarms after decommission.

  | Area | Alarms |
  |---|---|
  | ALB | 5xx > 1% for 5 min; UnHealthyHostCount ≥ 1; TargetResponseTime p95 > 3 s |
  | EC2 | Status check per instance (with auto-recover action); CPU > 85% for 15 min; memory > 90%; disk > 80% |
  | RDS | CPU > 80%; FreeableMemory < 500 MB; FreeStorage < 15 GB; connections > 80% of max; read/write latency |
  | Cron | Log metric filters for ERROR in each job, and "no successful run in 1 h" for drfirst-sync and waystar-retrieve |
  | WAF | Blocked requests spike |
  | Site | Route 53 HTTPS health check on `https://altrixs.com/api/ready`, with an alarm |

- [ ] GuardDuty, Security Hub, Config (HIPAA conformance pack) and CloudTrail are account-wide and already on.
  Confirm the new resources show up in Config. Triage critical/high Security Hub findings for prod resources
  before Nov 5.

### 2.8 Backups and restore test (Oct 23 and Oct 28)

- [ ] **Fix the current failure:** AWS Backup's RDS job starts at 07:00 UTC and collides with the RDS automated
  backup window (around 08:20 UTC), so **no RDS recovery point has been created in the vault.**
  - For prod: RDS window 04:00 to 04:30 UTC, AWS Backup rule at 07:00 UTC.
  - Move the old plan's window too, so the old DB gets vault copies before it is retired.
- [ ] New plan `altrixs-prod-daily-monthly`:
  - Daily backups kept 35 days, monthly kept 1 year (7 years for the final pre-decommission copies).
  - Covers `altrixs-prod-db`, both EC2 instances and EFS.
  - Vault `altrixs-prod-backup-vault`, encrypted with the prod CMK.
  - Vault Lock in governance mode.
  - Cross-region copy to us-west-2 of the monthly backups.
- [ ] Add staging RDS to a backup plan (it has no vault copies).
- [ ] **Restore test (T-24, Oct 28)**, recorded in the risk assessment as evidence:
  1. RDS PITR to a temporary instance. Check `migrate.sh --status` and row counts, then delete the instance.
  2. Restore EFS to a new file system.
  3. Launch an AMI restore of app-a in an isolated SG.

  Target RTO 4 h and RPO 5 min (PITR).

### 2.9 DNS and TLS (Oct 22 to Oct 27)

- [ ] **Move the `altrixs.com` zone to Route 53.** Squarespace DNS cannot alias the apex to an ALB, and the apex must
  serve the app: staff bookmark `altrixs.com/dashboard`, and the Flutter app calls `https://altrixs.com/api/patient/*`.
  1. Oct 22: create hosted zone `altrixs.com`. Copy **every** Squarespace record:
     - apex A 107.21.192.210 (unchanged for now)
     - the Google Workspace MX ×5
     - google-site-verification TXT
     - SES DKIM CNAMEs
     - `staging` A 54.204.119.171
     - any Squarespace website/`www` records and any Connect records
  2. Oct 23: compare the old and new answers record by record with `dig @nsa1.squarespacedns.com` vs `dig @ns-xxx.awsdns`.
  3. Oct 26 (Mon): switch the nameservers at the registrar. TTLs are already 300 s.
  4. Watch mail flow and staging for 24 h. Roll back by restoring the Squarespace nameservers.
- [ ] `cutover.altrixs.com` CNAME → ALB (with the WAF allowlist), used for imports and validation before the switch.
- [ ] **Cutover:**
  - `altrixs.com` A/AAAA ALIAS → ALB.
  - `www` → ALB. nginx or an ALB rule redirects `www` to the apex.
  - Remove the allowlist and drop `cutover.altrixs.com` after the cutover.
- [ ] CAA records: `amazon.com` (ACM), plus `letsencrypt.org` while staging still uses certbot.

### 2.10 Email domain (SES) (Oct 22)

- [ ] SPF on `altrixs.com`: `v=spf1 include:_spf.google.com include:amazonses.com ~all`. Today there is no SPF
  record, and Google Workspace mail needs one too.
- [ ] Custom MAIL FROM `mail.altrixs.com` (MX `feedback-smtp.us-east-1.amazonses.com` + SPF `include:amazonses.com`),
  so SPF aligns for DMARC.
- [ ] DMARC `_dmarc.altrixs.com`: `v=DMARC1; p=none; rua=mailto:dmarc@altrixs.com; fo=1`. Move to `p=quarantine`
  after 2 to 4 weeks of clean reports.
- [ ] Configuration set `altrixs-prod` with bounce/complaint events to SNS. Keep the complaint rate under 0.1%.
- [ ] `EMAIL_FROM=no-reply@altrixs.com`. The app sends with SES through the instance role or SMTP (`SMTP_*`).
  Prefer the role; if SMTP is kept, create a **new** prod SMTP IAM user and retire `ses-smtp-user.20260901-121353`.
- [ ] Q-07: should patients get mail from the practice's own domain (`marylandbhealth.com`) instead of `altrixs.com`?

### 2.11 Production environment variables

Rendered into `/opt/altrixs/app/.env` from Secrets Manager. NEXT_PUBLIC_* values are **build-time**, so changing
one means rebuilding.

| Group | Variables | Prod value / note |
|---|---|---|
| Core | `DATABASE_URL` | `postgresql://altrixs_app:…@altrixs-prod-db…:5432/altrixs?sslmode=require` |
| | `AUTH_SECRET` (alias `NEXTAUTH_SECRET`) | New 32+ byte random value. Shared by both instances. |
| | `AUTH_URL` (alias `NEXTAUTH_URL`) | `https://cutover.altrixs.com` until the DNS switch, then `https://altrixs.com` (restart only) |
| | `NEXT_PUBLIC_APP_URL`, `API_BASE_URL` | `https://altrixs.com` (build-time). `API_BASE_URL` sets the FHIR issuer. |
| | `ALTRIXS_ENV` | `production` (feeds `NEXT_PUBLIC_ALTRIXS_ENV`, `/api/version`) |
| | `UPLOADS_DIR` | `/var/lib/altrixs/uploads` (EFS) |
| | `PHI_FIELD_ENCRYPTION_KEY` | From `altrixs/prod/phi-field-encryption-key` |
| | `NODE_ENV` | `production` |
| | `ICD10_DATA_DIR` | Default `data/icd10cm`. Confirm the artifact is in the bundle (`scripts/build-icd10-artifact.ts`). |
| | `PATIENT_CORS_ORIGIN` | Exact origins only, never `*` |
| | `DEFAULT_ORG` | MD Behavioral Health org id, so the DrFirst sweep runs for that org only |
| | `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_FINGERPRINTS`, `APPLE_APP_ID` | Real values if the Flutter app uses app links. Otherwise leave them unset; `APPLE_APP_ID` defaults to a placeholder. |
| AWS | `AWS_REGION`, `AWS_DEFAULT_REGION` | `us-east-1` |
| | `AWS_LIVE` | `true` |
| | `BEDROCK_CLAUDE_SONNET_MODEL_ID`, `BEDROCK_CLAUDE_HAIKU_MODEL_ID`, `BEDROCK_MODEL_ID` | Same as staging: `us.anthropic.claude-sonnet-4-6`, Haiku 4.5 |
| | `BEDROCK_GUARDRAIL_CLINICAL_ID` / `_VERSION`, `BEDROCK_GUARDRAIL_GENERAL_ID` / `_VERSION` | `u9brovqm098p` / 1, `835mmtxabtqk` / 1 |
| | `DOC_INTAKE_S3_BUCKET` | Prod doc-intake bucket |
| | `TELEHEALTH_S3_RECORDINGS_BUCKET` | Leave unset until recording consent exists |
| | `AWS_EVENTBRIDGE_BUS_NAME` | Optional |
| | `AWS_HEALTHLAKE_*`, `AWS_PERSONALIZE_*` | Unset (demo/off) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | SES us-east-1, `no-reply@altrixs.com` |
| SMS | `SMS_ORIGINATION_IDENTITY` / `SNS_SMS_ORIGINATION_NUMBER` | The **registered** toll-free number |
| | `SMS_CONFIGURATION_SET` | Prod configuration set |
| | `SMS_INBOUND_TOPIC_ARN` | `arn:aws:sns:us-east-1:792233689095:altrixs-prod-inbound-sms` |
| | `SMS_SELF_MANAGED_KEYWORDS` | `false` |
| | `SMS_PROGRAM_NAME` | Practice name |
| Crisis paging | `ENABLE_LIVE_CRISIS_PAGING`, `PINPOINT_APPLICATION_ID`, `AWS_SNS_TOPIC_ARN` | Turn on only after CLN approves the paging tree and it has been tested |
| Cron | `CRON_SECRET`, `UNSUBSCRIBE_SECRET` | New random values |
| DrFirst | `DRFIRST_VENDOR_USERNAME`, `DRFIRST_VENDOR_PASSWORD`, `DRFIRST_PRACTICE_USERNAME`, `DRFIRST_PORTAL_SYSTEM_NAME`, `DRFIRST_ENGINE_URL`, `DRFIRST_UPDATE_URL`, `DRFIRST_SSO_URL` | **Production** values from DrFirst |
| | `DRFIRST_REGISTER_ON_LAUNCH` | **`true`** |
| | `DRFIRST_API_VERSION` | `2.54` (fallback) |
| | `DRFIRST_LOG_RETENTION_DAYS` | `90` |
| | `DRFIRST_SYNC_LOOKBACK_DAYS` | `90` |
| | `DRFIRST_ENABLE_SEND_PRESCRIPTION` | `false`: ambulatory prescribing happens inside Rcopia |
| | Path-B vars `DRFIRST_ENABLED`, `DRFIRST_ENV`, `DRFIRST_SECRET`, `DRFIRST_PARTNER_ID`, `DRFIRST_CLIENT_*`, `DRFIRST_USERNAME`, `DRFIRST_PASSWORD`, `DRFIRST_API_BASE_URL` | Leave as in staging (the Path-B panel is a fail-closed placeholder) |
| | `DRFIRST_TEST_*`, `DRFIRST_MOCK_FAILURE`, `DRFIRST_PATIENT_SCAN_START` | **Must not be set** |
| Waystar | `WAYSTAR_SFTP_CONNECTOR_ID` | The prod connector |
| | `WAYSTAR_S3_BUCKET`, `WAYSTAR_S3_OUTBOUND_PREFIX`, `WAYSTAR_S3_INBOUND_PREFIX`, `WAYSTAR_S3_INQUIRY_PREFIX` | `production/...` |
| | `WAYSTAR_REMOTE_OUTBOUND_DIR` / `WAYSTAR_REMOTE_INBOUND_DIR` | `/Upload`, `/Download` |
| | `WAYSTAR_KMS_KEY_ID`, `WAYSTAR_SUBMITTER_ID`, `WAYSTAR_SUBMITTER_NAME`, `WAYSTAR_SUBMITTER_PHONE`, `WAYSTAR_RECEIVER_ID`, `WAYSTAR_SENDER_ID`, `WAYSTAR_NPI`, `WAYSTAR_ORG_NAME`, `WAYSTAR_TAX_ID` | Prod values |
| | `WAYSTAR_USAGE_INDICATOR` | **`P`** (code default is `T`) |
| | `WAYSTAR_RETRIEVE_WAIT_MS` | Default |
| | `WAYSTAR_CLIENT_ID`, `WAYSTAR_CLIENT_SECRET`, `WAYSTAR_TOKEN_URL`, `WAYSTAR_CLAIMS_URL`, `WAYSTAR_CLAIM_STATUS_URL`, `WAYSTAR_ERA_URL`, `WAYSTAR_SCOPE` | Only if the Waystar API is used instead of SFTP |
| Practice billing | `PRACTICE_TIN`, `PRACTICE_GROUP_NPI`, `PRACTICE_BILLING_ADDRESS`, `PRACTICE_BILLING_CITY`, `PRACTICE_BILLING_STATE`, `PRACTICE_BILLING_ZIP`, `PRACTICE_BILLING_PHONE` | Tax ID 923843658. NPIs 1801621297 / 1346021813 / 1740059005 per site. Phone 301-249-8100. |
| | `LAB_FACILITY_CLIA` | Real CLIA, or unset |
| ERA | `ERA_WEBHOOK_SECRET` (alias `WAYSTAR_WEBHOOK_SECRET`) | Set it |
| | `ERA_WEBHOOK_ENABLED` | Leave unset unless a verified push source exists (835s arrive via SFTP retrieval) |
| Eligibility (Availity) | `AVAILITY_*` | Only if Availity 270/271 is contracted. Waystar replaced Availity (Q-06). |
| | `AVAILITY_COVERAGES_MOCK_SCENARIO_ID` | **Never** in prod |
| | `CARELON_ORG_ID` | If Carelon attestation is used |
| Stripe (later) | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_V2_*` / `STRIPE_COUPON_V2_*` (printed by `scripts/stripe-sync-catalog.ts`), `NEXT_PUBLIC_PRICING_APPROVED`, `BILLING_SEAT_SYNC`, `BILLING_COMPED_ORG_IDS`, `NEXT_PUBLIC_BILLING_SERVICE_OFFERED` | **Unset at go-live.** MD Behavioral Health is comped in code. Stripe needs a separate go-ahead. |
| Realtime / push | `PUSHER_*`, `NEXT_PUBLIC_SOCKET_CHAT` | Unset (polling) unless Pusher is contracted with a BAA |
| | `FIREBASE_*` | Only if patient push is live. Firebase/Google needs BAA coverage. |
| CRISP / SMART | `SMART_SIGNING_SECRET`, `SMART_ALLOWED_CLIENTS`, `SMART_REDIRECT_URIS`, `CRISP_EQP_URL` | Blank (demo) until a CRISP participation agreement exists |
| Telephony | `CONNECT_INSTANCE_ID`, `CONNECT_QUEUE_ID`, `CONNECT_CONTACT_FLOW_ID`, `CONNECT_SOURCE_PHONE_NUMBER`, `VOICEMAIL_OWNER_ORG_ID` | Only if the Connect hub is used at go-live (Q-10) |
| | `ZOOM_*`, `GOOGLE_*` | Unset (telehealth defaults to in-app Chime) |
| **Never in prod** | `PRP_ELIGIBILITY_TEST_PASS`, `CLINICAL_CLEARINGHOUSE_MODE=demo`, `ROLE_DEMO_PASSWORD`, `SEED_*`, `TARGET_ORG_*`, `RDS_DATABASE_URL`, `ALTRIXS_SKIP_BUILD_TYPECHECK`, `SHOW_CODES`, `REPLACE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Add a startup check that refuses to boot with `ALTRIXS_ENV=production` if any of these are set (DEV, by Oct 30) |

**Scripts that must never run against prod:**
- `scripts/seed-*.ts`
- `scripts/_*.js`, for example `_preprod-go.js` and `_prelive-depth.js`, which create users with the hard-coded
  password `Altrixs@123`
- `clean-dummy-data.ts`, `purge-fake-seeds.ts`, `batch-replace-dummy-data.cjs`, `fix-mock-data.cjs`
- `prisma/*Seed.ts`, `prisma/seed.ts`

Keep them out of the prod bundle, or guard them on `ALTRIXS_ENV=production` (DEV, T-27).

---

## 3. Data migration

### 3.1 Principles

- Production starts **empty**: schema, then configuration, then the final Valant export. Staging data (rehearsal
  imports, DrFirst test links such as `rcopiaUsername=ssherman`, test claims) is **never** copied to prod.
- Every Valant import in **Admin → Migration** (`src/app/dashboard/admin/migration/page.tsx`, APIs under
  `src/app/api/migration/*`) has a **dry run**. The imports are idempotent upserts keyed by Valant ids, they are
  audited, and they run under the leadership import gate.
- **Two rehearsals before the real run:**
  - R1 on staging, Oct 27.
  - R2 on the prod infrastructure in a separate database `altrixs_rehearsal` on `altrixs-prod-db`, Nov 3. The
    app is pointed at it through `DATABASE_URL`, and the database is dropped on Nov 5.

  Record the timings for every step. The final run reuses them.

### 3.2 Freeze window

| When | What freezes |
|---|---|
| Fri Oct 30, 18:00 | **Code freeze.** Release candidate tagged `v2026.10.30.N`. Only P1 fixes after this, each approved by PL. |
| Thu Nov 5, 18:00 | **Configuration freeze in Valant.** No new payers, facilities, fee schedule rows or users. |
| **Fri Nov 6, 18:00** (after the last clinic closes) | **Valant becomes read-only for scheduling, clinical and patient billing.** No new appointments, notes, patient payments or demographic edits. Front desks book anything urgent on paper (downtime form F-1) for entry into Altrixs on Sunday. Insurance billing for dates of service up to Nov 6 continues in Valant (run-out, §3.6). |
| Sat Nov 7 | Not a clinic day (confirm, Q-04). Any Saturday activity goes on paper. |

### 3.3 Final Valant exports (Sat Nov 7, 07:00 to 09:00, BIL + PL)

| # | Valant report / grid | Notes |
|---|---|---|
| E1 | Setup › Facilities (DataGrid .xlsx) | Includes Lexington Park / St. Mary's |
| E2 | Insurance Companies grid | |
| E3 | Measurement Types | |
| E4 | Lab Request Types | |
| E5 | Fee schedule | |
| E6 | Staff list / login audit (staff template) | Build it from the template at `/api/migration/template/staff` |
| E7 | **Patient export with `Pt. ID`** (the `ValantDataExport…` layout used on staging: about 15,439 patients) | Ask Valant to add ZIP, main phone, payer and member ID if they are still missing (§3.7) |
| E8 | Contact & demographics export | Re-import in "contact" mode, which fills empty fields only |
| E9 | Diagnoses – Patient (CSV) | |
| E10 | Treatment plans | |
| E11 | Authorizations | |
| E12 | Autopay / payment plans | |
| E13 | Copays | |
| E14 | Appointments between **Nov 9 2026 and Dec 31 2027**, plus history (2 years) | Non-patient blocks are skipped by design |
| E15 | Transaction journal (full history) | |
| E16 | **Patient Aging Summary, as of Nov 7** | Print the report totals page too |
| E17 | Insurance Aging and Combined Aging (reference only) | |
| E18 | **Prepayments, FULL history** (start = the first Valant date) | Per `docs/valant-ledger-cutover.md` |
| E19 | Valant A/R and payments reports printed to PDF (control totals) | For the reconciliation |

Store the exports **only** in a KMS-encrypted S3 prefix (`altrixs-prod-artifacts-…/valant-final/`), never on
laptops. Delete local copies after the import (PO checks). Run
`npx tsx scripts/valant-reference-counts.ts <aging> <prepayments> <copays> <insurance-aging> <combined-aging> <transactions> <authorizations>`
on the files first. It gives parser counts with no PHI, which become the expected import counts.

### 3.4 Import order (Sat Nov 7, 09:00 to 18:00, DEV + BIL at `cutover.altrixs.com`)

Each step is **dry run → read the result → import → note the counts in the cutover log**.

| Step | Import (Admin → Migration tab) | Depends on | Acceptance |
|---|---|---|---|
| 1 | **Import Facilities** (E1) → check the Facility → Location map (owner-edited mappings are kept) | Locations created during config | All 4 Valant facilities mapped (Bowie, Silver Spring, Baltimore, Lexington Park) |
| 2 | **Import Insurance Companies** (E2) | | Counts equal the grid rows, grouped by name + EDI payer ID |
| 3 | **Import Measurement Types** (E3), **Lab Request Types** (E4), **Fee Schedule** (E5) | | Dry-run counts equal file rows |
| 4 | **Import Staff** (E6), run before go-live week (Nov 2) and topped up here | | Every active clinician has a user, role, NPI/license and `rcopiaUsername` (prescribers) |
| 5 | **Import Clients** (E7) | 1 | Created + updated = E7 row count. Duplicates = 0. Family-shared emails imported without email (about 203 on staging). |
| 6 | **Clients – contact re-import** (E8) and **facility re-import** | 5 | `scripts/check-client-demographics.ts` gaps no worse than R2 |
| 7 | **Import Diagnoses** (E9) | 5 | Patients matched = R2 ±1% |
| 8 | **Import Treatment Plans** (E10) | 5, staff | `ownersNotLinked` = 0, `patientsNotFound` explained. The plan "pending transition" rule covers clients without plans (`20261018_plan_pending_transition.sql`). |
| 9 | **Import Authorizations** (E11), **Autopay** (E12), **Copays** (E13) | 5 | Reference counts equal `valant-reference-counts.ts` |
| 10 | **Import Appointments** (E14), then **appointment labels** (`/api/scheduling/appointment-labels/load-valant` → apply suggestions) | 5, staff | Monday Nov 9 schedule per clinician and per site equals Valant's printed Nov 9 schedule. `scripts/find-duplicate-appointments.ts` = 0. |
| 11 | **Import Transactions** (E15) → **Valant Provider Codes** map | 5 | Every provider code with rows is mapped. Unmapped = 0. |
| 12 | PCP assignment: `scripts/check-pcp-assignments.ts`, then `scripts/fix-pcp-assignments.ts` only for the reviewed list | 11 | Mismatches reviewed by CLN |
| 13 | **Import Aging Summary** (E16), **Insurance Aging**, **Combined Aging** (E17), **Prepayments** (E18) | 5 | Green reconcile checks against the report totals |
| 14 | **Billing → Valant Balances → Post patient opening balances**, then **Post prepayment credits** (only if Valant confirms the aging does not already net prepayments) | 13 | §3.6 |

Smart Document Intake (historical progress notes and assessments as locked PDFs) is **not** on the cutover
critical path. It continues in hypercare, starting with active clients seen in the first 2 weeks.

### 3.5 Acceptance checks (Sun Nov 8, 07:00 to 11:00, DEV)

Run on app-a via SSM, from `/opt/altrixs/app`, as
`npx tsx --conditions=react-server --env-file=.env scripts/<name>`. Every one is read-only and prints counts and
ids only. Compare each result with the R2 baseline. Any unexplained difference over 1% is a blocker.

| Check | Script | Pass criteria |
|---|---|---|
| Schema | `bash scripts/migrate.sh --status` | 0 pending, no checksum change |
| App | `curl https://cutover.altrixs.com/api/version` / `/api/ready` | Commit = release tag, env = production, db ok |
| Demographics | `check-client-demographics.ts --org=<id>` | DrFirst-ready and claim-ready counts ≥ R2 |
| Census | `check-practice-overview.ts --org=<id> --date=2026-11-09` | Overview = SQL. Nov 9 appointments per location = Valant schedule. |
| Duplicates | `find-duplicate-appointments.ts --org=<id>` | 0 |
| Timezone | `fix-appointment-timezone.ts --org=<id>` (review list only) | Empty list for imported appointments |
| PCP | `check-pcp-assignments.ts --org=<id>` | Same as the reviewed R2 list |
| Primary care | `medical-patient-reconciliation.ts <orgId>` | No unlinked rows |
| Eligibility scanner | `check-service-eligibility.ts --org=<id>` | Data-quality section ≈ R2 |
| Reports | `check-report-library.ts --org=<id> --only=ar-aging,…` | Every report runs, with no timeouts |
| Insights | `check-clinical-insights.ts --org=<id>` | Runs. Attention share ≈ 15% target. |
| Card data | `find-card-data.ts <orgId>` | 0 (no card data in prod) |
| Session frequency | `check-session-frequency.ts <orgId>` | Fast path = row path |
| DrFirst parsers | `check-rcopia-parsers.ts` | Pass |

### 3.6 A/R reconciliation (BIL, Sun Nov 8, 09:00 to 12:00)

Follow `docs/valant-ledger-cutover.md`:
- The as-of date is Nov 7.
- Posted total = matched rows total, and matched + unmatched = snapshot total = **the printed Valant Patient Aging
  total, to the cent**.
- Resolve the unmatched list before posting.
- Spot-check 5 charts per site.
- Generate statements as a draft.
- Audit rows exist for the `patientLedgerEntry` batch.

Also:
- **Insurance A/R stays in Valant** (run-out). Nothing for dates of service ≤ Nov 6 is billed from Altrixs.
- Sign-off sheet:

  | Valant patient A/R | Altrixs posted opening balances | Prepayment credits | Unmatched (count and $) | Excluded (count and $) |
  |---|---|---|---|---|
  | | | | | |

  Signed by BIL and PL.
- Open item before R2: Valant has to confirm whether the Patient Aging total already nets unapplied prepayments.
  If it does, post opening balances only.

### 3.7 What does NOT migrate

| Item | Where it lives after cutover |
|---|---|
| Insurance claims, insurance balances and denials for dates of service ≤ Nov 6 | Worked to zero in Valant (run-out, read and bill access needed for 90 to 120 days, Q-01) |
| Progress notes and other clinical documents as structured data | Locked PDFs through Smart Document Intake, during hypercare. Valant read-only access is the source until then. |
| Assessment / measurement **values** (PHQ-9, GAD-7 scores over time) | Only measurement **types** import. Scores come in as PDF documents, or Valant gives a structured export (Q-08). |
| Card-on-file / autopay card numbers | Never imported. Cards are re-entered with the payment processor (Q-05). Autopay plan terms import as data only. |
| Valant user accounts, passwords, MFA | New Altrixs accounts (§5) |
| Patient portal accounts, portal messages | Re-invite patients to the Altrixs portal / Flutter app |
| Valant e-prescribing history | Comes from DrFirst/Surescripts medication history after the first Rcopia launch. Valant Rx history stays in Valant read-only. |
| Non-patient schedule blocks (about 3,200 on staging), recurring templates | Rebuilt in Altrixs scheduling settings by the super-users (Nov 2 to 6) |
| Payment plans | Rebuilt by hand (the few that exist) |
| Valant audit logs / accounting of disclosures | Keep a Valant export (or access) for 6 years |
| Mindaptix-only records (if T-02 finds any) | See §0 |

---

## 4. Integrations go-live

| Integration | Today | Needed for Nov 9 | Owner / due | Fallback if late |
|---|---|---|---|---|
| **DrFirst Rcopia** | Staging 201 works: SSO, Engine/Update, 11 downloads. Certification evidence is in `docs/drfirst-certification/` (gap AUM2/3: allergies sent free-text). | **Production vendor/practice credentials, prod SSO/Engine/Update URLs, certification sign-off.** `DRFIRST_REGISTER_ON_LAUNCH=true`. `User.rcopiaUsername` mapped for every prescriber. **EPCS identity proofing and 2FA tokens for every prescriber of controlled substances.** Maryland PDMP access through Rcopia. | PL: request prod credentials and book the certification demo **Oct 21**. Certification passed by **Oct 30**. CLN: EPCS done per prescriber by **Nov 4**. | Prescribers log in to Rcopia directly (prod account, no SSO) on Nov 9. Meds are then synced by the 15-minute download sweep once the integration is live. |
| **Waystar** | Test SFTP mailbox 331609 through connector `c-e0002d623f084fc8a`. First test claim Oct 15 (`ALTRIXS-20261015-6193.837`). Payer ID 100198 and receiver `WAYSTAR` unverified. | Production SFTP mailbox (rotate to SSH-key login), a **new prod connector** (or the existing one with the prod secret), `WAYSTAR_USAGE_INDICATOR=P`, production S3 prefixes, payer list verified. The required number of clean test claims is accepted. **Claim, ERA (835) and EFT enrollment per payer** (Medicare, Maryland Medicaid, CareFirst, Aetna, UHC/Optum, Cigna, Carelon/Optum Maryland BH ASO). | BIL: test-claim quota met **Oct 27**. Prod mailbox **Oct 30**. All payer enrollments submitted **Oct 23** (ERA/EFT take 2 to 6 weeks). | Claims are created and held in Altrixs (week-1 rule: held → checked → released per payer). Paper EOBs / payer portals for ERA until enrollments land. Maryland Medicaid BH goes through Optum Maryland (Incedo) whatever the clearinghouse (Q-06). |
| **SMS** (End User Messaging) | +18885985978 registration CREATED (not submitted). +18333637044 REVIEWING. | One approved toll-free number, keyword responses, two-way topic `altrixs-prod-inbound-sms` subscribed to `https://altrixs.com/api/sms/inbound` (`docs/ops-cron.md` §2–3). Consent recorded per client (`smsConsent`; never bulk-set). | PL: submit or finish registration **Oct 21** (opt-in screenshot, privacy clause, legal name). Approval can take 2 to 4+ weeks. | Email reminders only (SES) plus front-desk confirmation calls. Do not send from an unregistered number. |
| **SES email** | Production access, DKIM ok | SPF / MAIL FROM / DMARC (§2.10), bounce handling | PL **Oct 22** | n/a |
| **Chime telehealth** | Works on staging through the role | Prod role permissions (§2.6). Recording OFF. | DEV **Oct 23** | Phone visits |
| **Transcribe (AI Scribe)** | Staging role policy `staging-scribe-transcription` | Prod role. AI consent at point of care (commit 0161a18). CLN decides which clinicians use it in week 1. | CLN **Nov 2** | Clinicians write notes manually |
| **Bedrock** | Sonnet 4.6 / Haiku 4.5 on staging | Model access + guardrail in prod | DEV **Oct 23** | AI features fail closed (503), with no fake output |
| **Textract** (doc intake) | Staging bucket prefix | Prod bucket + lifecycle | DEV **Oct 23** | Manual document filing |
| **Stripe** | No keys. Pricing approved Oct 20. | **Not needed for MD Behavioral Health go-live** (comped org). Live catalog sync (`scripts/stripe-sync-catalog.ts --live`) needs a separate written go-ahead. | PL, after go-live | n/a |
| **Patient card payments** | The AutoPay capture form was retired (410) | A processor for copays at the front desk (Q-05) | SP **Oct 26** | The current Valant-era terminal, with payments posted manually in Altrixs |
| **CRISP / HIE** | SMART/CRISP EQP code in demo mode | Not needed for go-live. Post go-live: participation agreement, ENS panel. PDMP goes through DrFirst. | PO, December | n/a |
| **Amazon Connect** | Instance `altrixs-prod` + Lambda exist | Only if the Communications hub is used Nov 9 (Q-10) | PL | Existing phones |

---

## 5. People

### 5.1 Accounts, roles, MFA

- **Staff import (Nov 2):**
  - Use Admin → Migration → **Import Staff** from the Valant login audit list (32 staff on staging) plus new hires.
  - Assign roles per `docs/role-access-matrix.md`: Front Desk, Therapist, Psychiatrist, NP, Physician, Medical NP,
    MA, PRP, Case Manager, Peer, Billing, Office Manager, Practice Director, HR, Admin.
  - Mark the Medical Director.
  - Map `rcopiaUsername` for each prescriber to the **production** Rcopia login.
- Each person gets an invite with a temporary password and must change it at first login.
- **Admin accounts:** two named practice admins, plus one break-glass admin in `altrixs/prod/admin-login`. No shared
  logins. No developer has a standing PHI admin account in prod.
- **MFA: built Oct 24** (`docs/security-controls.md`, migration `20261024_staff_mfa_lockout.sql`):
  - TOTP two-factor for every staff role, set up at first sign-in, 10 one-time recovery codes,
    optional "Remember this device for 30 days"; admins reset it from Users & Roles (audited).
  - Idle sign-out at 15 minutes (60-second warning), session max 12 h, lockout after 5 failed attempts
    for 15 minutes, 12-character passwords with a common-password check.
  - Before go-live: `PHI_FIELD_ENCRYPTION_KEY` must be set in prod (the TOTP secrets are encrypted with it),
    and staff need an authenticator app on their phone before their first sign-in.
- **AWS console:**
  - MFA on every human identity.
  - **Delete the root access keys.**
  - Remove `gaurav@mindaptix.com` AdministratorAccess, or scope it with MFA plus a BAA (Q-03).
  - Deactivate the `bridgecare-api` / `altrixs-connect` keys once the old prod is stopped (Nov 8) and delete them
    on Nov 30.
  - Prod access through SSO permission sets: `ProdReadOnly` and `ProdOperator`, the latter for SSM on the prod
    instances, time-boxed.

### 5.2 Training by role (CLN + super-users, Oct 26 to Nov 6)

Sessions run 60 to 90 minutes on **staging**, with each user's own login on staging.

| Dates | Role group | Content |
|---|---|---|
| Oct 26–27 | Super-users (2 Bowie, 1–2 Silver Spring incl. 1 primary care, 1 Baltimore, 1 Lexington Park) | Everything below, plus the downtime procedure and smoke-test scripts. Train-the-trainer. |
| Oct 28–29 | Front desk / office managers | Scheduling, labels, check-in, intake, demographics, insurance, copays, reminders/consent for SMS |
| Oct 29–30 | Therapists, PRP, case managers, peer support | Caseload, chart, notes (templates, sign/lock, addenda), treatment plans (pending transition), assessments, telehealth, Scribe (if enabled) |
| Oct 30 – Nov 2 | Psychiatrists / NPs, physicians / medical NPs / MAs | Above, plus E-Prescribe through Rcopia, EPCS, PDMP, med reconciliation, labs, primary care chart (MA minimum-necessary) |
| Nov 2–3 | Billing | Claims hold/release, Waystar responses, ERA review queue, patient ledger/opening balances, statements, run-out boundary (dates of service ≤ Nov 6 in Valant) |
| Nov 3–4 | Leadership | Dashboards, reports, alerts, audit log, access reviews |
| Nov 5–6 | Everyone | 30-minute "first day" walk-through, MFA enrolment, sign-off sheet per person |

Attendance is tracked per person. Nobody gets a prod login without completing their session and signing the
acceptable-use/HIPAA attestation.

### 5.3 Go-live support rota (Nov 9 to 20)

- **On site:**
  - Super-users on the floor 07:30 to 18:00 at each site in week 1.
  - Baltimore staff reinforce Bowie Monday to Tuesday.
  - Silver Spring has a primary care super-user Monday to Wednesday.
- **Command:**
  - PL runs the 08:00 per-site huddle (15 minutes, video) and the 16:00 issue review.
  - All issues go in one shared issue log, with severity P1 to P4.
- **Engineering on call:** DEV primary 07:00 to 19:00 ET on Nov 9 to 13, with a second engineer as backup. After
  hours, page through the infra alerts. Fixes ship as P1 hotfixes using the rolling deploy.
- **Billing:** BIL reviews the held claims daily and releases them per payer after the first clean 999/277CA.
- **Vendors:** DrFirst and Waystar support contacts and account managers are on a single contact sheet at every
  front desk and in the command channel.

### 5.4 Downtime procedure (paper), printed at every front desk by Nov 6

1. **Trigger:** Altrixs is unreachable for more than 15 minutes, or there is a P1 data issue. The site lead
   declares downtime in the command channel.
2. **Before downtime:**
   - Every evening, a super-user prints or exports the **next day's schedule per clinician**, plus the
     emergency/crisis contact sheet.
   - This starts Sunday Nov 8 for Monday.
3. **Forms:**

   | Form | Use |
   |---|---|
   | F-1 | Appointment / check-in log |
   | F-2 | Progress note (paper) |
   | F-3 | Medication / prescription log. Prescribers use Rcopia directly; it does not depend on Altrixs. |
   | F-4 | Superbill / charge capture |
   | F-5 | Payment receipt log |
   | F-6 | Crisis / risk event. Always direct to **988**, and follow the clinic crisis protocol. |
   | F-7 | Consent forms |

4. **Recovery:** forms are keyed into Altrixs within 24 h, marked as late entries with the actual service time.
   Paper is then scanned through Document Intake and stored per the records policy.
5. Hold a downtime drill at each site during training week (Nov 4).

---

## 6. Cutover runbook (Fri Nov 6 to Mon Nov 9, all times ET)

Command channel open throughout. One person keeps the **cutover log**: timestamp, step, who, result, counts.

| Time | Step | Who | Done when |
|---|---|---|---|
| **Fri Nov 6, 12:00** | Go/no-go #1 confirmed (from Nov 5). The prod release is on both instances. `altrixs_rehearsal` dropped. `migrate.sh --status` = 0 pending on `altrixs`. Staff accounts exist with MFA enrolled. Config imports (steps 1–4) done. | PL, DEV | Checklist signed |
| 16:00 | Print the downtime packets and Monday schedules from **Valant** (backup). | SU-* | At every desk |
| **18:00** | **Valant freeze** (§3.2). Last Valant patient payment posted. Front desks note any Saturday bookings on F-1. | BIL, SU-* | Announcement sent |
| 18:30 | Manual snapshot `altrixs-prod-db-pre-import-20261106`. Old prod: notify Mindaptix to stop all deploys. Snapshot `altrixs-postgres-final-20261106` (§0). | DEV, PL | Snapshots available |
| **Sat Nov 7, 07:00** | Final Valant exports E1–E19 to the encrypted S3 prefix. Run `valant-reference-counts.ts`. | BIL, PL | Files and counts logged |
| 09:00 | Imports steps 5–11 (§3.4). R2 timing is the guide. Steps 5 and 10 are the long ones. | DEV, BIL | Each dry run and import result logged |
| 13:00 | Mid-point check: client count, Monday appointment count per site vs the Valant print. | DEV, SU-B | Match |
| 14:00 | Steps 12–13 (PCP review, aging and prepayment imports). | DEV, BIL, CLN | Green reconcile checks |
| 17:00 | Snapshot `altrixs-prod-db-post-import-20261107`. Stop for the day. | DEV | Snapshot available |
| **Sun Nov 8, 07:00** | Acceptance scripts (§3.5). | DEV | All pass, or the deltas are explained |
| 09:00 | **A/R posting** (step 14) and the reconciliation sign-off (§3.6). | BIL, PL | Sheet signed |
| 10:00 | **Smoke tests per role** at `cutover.altrixs.com`, each super-user with their own account. The scripts are below. | SU-*, CLN | Pass/fail table complete |
| 12:00 | Fix window. P1 hotfixes only, through the rolling deploy. | DEV | |
| **14:00** | **Go/no-go #2** (SP decides; criteria in §7). | SP, PL, CLN, BIL | Decision logged |
| 14:30 | **DNS switch:** Route 53 `altrixs.com` + `www` ALIAS → ALB. Set `AUTH_URL=https://altrixs.com` and restart each instance. Remove the WAF allowlist. | DEV, PL | `dig altrixs.com` returns the ALB IPs from 3 resolvers |
| 15:00 | Verify through `https://altrixs.com`: `/api/version` (prod tag, env production), `/api/ready`, login with MFA, the Flutter app endpoint `/api/patient/me` (401 without a token). Re-point the Route 53 health check / alarm. Stop the old EC2 `i-0d5432ef9c5805121` (not terminate). | DEV | All green |
| 15:30 | Enable integrations in prod `.env`: DrFirst prod (`DRFIRST_REGISTER_ON_LAUNCH=true`), Waystar prod (`WAYSTAR_USAGE_INDICATOR=P`), SMS (if registered), cron (`deploy/crontab.production` on app-a, notifications every 10 min). Restart. | DEV | First cron runs logged OK |
| 16:00 | Test transactions with a designated test patient and a test prescriber: DrFirst launch → patient registered → sweep picks up the change. Waystar: **do not** send a production claim yet. Email reminder to a staff test address. SMS `HELP` test. | DEV, CLN | Logged |
| 17:00 | Enter any Saturday paper bookings (F-1). Print/export Monday's schedule from **Altrixs** for the downtime packet. | SU-* | |
| 18:00–22:00 | Monitoring: dashboards, alarms, error logs. Night on-call. | DEV | No alarms |
| **Mon Nov 9, 06:30** | Pre-open check: `/api/ready`, schedules load per site, DrFirst sweep OK overnight, no alarms. | DEV, PL | Go |
| 07:30 | Super-users on the floor. 08:00 huddles. Hypercare begins. | All | |
| Mon Nov 9 – Fri Nov 13 | First claims batch per payer: build → check → release. Confirm the 999/277CA through `waystar-retrieve`. | BIL | First acceptances |

**Smoke tests per role** (each 10 to 15 minutes; pass = no blocker). Base them on `docs/Altrixs-E2E-Clinic-Loop-QA.md`.
Use only the test patient for anything that writes.

| Role | Test |
|---|---|
| Front desk | Find a client, check Monday's schedule for their site, book and cancel a test appointment, check in, edit demographics on the test patient |
| Therapist | Caseload shows their clients only. Open a chart (diagnoses, plan, appointments). Draft, sign and lock a note on the test patient. Start and end a Chime test visit. |
| Psychiatrist / NP | Chart meds and allergies. E-Prescribe launch opens prod Rcopia **on the right patient**. PDMP link. Notification badge. |
| Physician / MA (Silver Spring, Bowie) | Primary care chart. The MA cannot see behavioral health notes. |
| PRP / case manager / peer | Program pages, attendance |
| Billing | Patient balance on 5 charts = the Valant aging row. Draft claim from the locked test note. Do not submit. Statements draft. |
| Practice director / admin | Dashboards, census = §3.5, audit log shows the cutover actions, user list and roles |
| Security | Signed-out access to `/dashboard` and `/api/*` → 401/redirect. A therapist cannot open another clinician's restricted chart (Part 2 / caseload rules). |

---

## 7. Rollback plan and criteria

**Before the DNS switch (go/no-go #2, Sun Nov 8 14:00), roll back, that is postpone go-live and stay on
Valant, if any of these are true:**

1. A/R reconciliation does not tie to the cent, and BIL cannot explain the difference.
2. The client count or Monday schedule count differs from Valant by more than 0.5%, or any wrong-patient match is
   found (an appointment, plan or diagnosis on the wrong client).
3. Any role cannot log in (MFA included), or a smoke test shows cross-client or cross-organization data exposure.
4. `/api/ready` is unstable, or p95 latency is above 3 s under the smoke-test load.
5. Backups are not working on prod (no PITR, or the snapshots failed).

**Not rollback triggers** (go live and use the fallback):
- DrFirst SSO not ready: prescribers use Rcopia directly.
- Waystar production not ready: hold claims.
- SMS not approved: email reminders plus calls.
- Scribe or AI features off.

**How to postpone:**
- Keep the DNS pointing at the old host. Keep Valant as the system of record and lift the Valant freeze on Monday
  at 07:00.
- Altrixs prod stays at the cutover hostname. Re-run the imports at the next weekend window, since the imports
  are idempotent.
- This needs Valant to be **fully active past Nov 8** (Q-01).

**After go-live (Nov 9 onward):** fix forward by default. Roll back to Valant **only** with SP's decision, within
the first 72 h, and only for one of these:
- Altrixs is unavailable for more than 4 clinic hours with no fix in sight.
- A data-integrity incident affects patient safety: wrong-patient medication or allergy data, or lost notes.
- A confirmed security breach of prod.

**Steps to fall back:**
1. Declare downtime (paper, §5.4).
2. Re-open Valant scheduling and documentation, if the contract still allows full use.
3. Export from Altrixs every note, appointment and payment created since Nov 9 (audit log + reports) and re-key it
   into Valant.
4. Put Altrixs into read-only maintenance with a WAF rule that allows admins only.
5. Keep PITR and the snapshots.

If Valant is **read-only only** after Nov 8, it serves history (charts, past notes, A/R run-out), and
operations continue on paper until Altrixs is fixed. That is why the full-access extension is recommended.

**Database rollback within Altrixs:**
- Migrations are additive and forward-only, so code rollback is `git checkout $PREV` + rebuild (DEPLOY.md §5).
- For bad data: PITR to a new instance, compare, then repair forward. Never delete ledger rows.

---

## 8. HIPAA

| Item | Action | Owner / due |
|---|---|---|
| **BAA, AWS** | Active. Confirm in AWS Artifact that the account is covered, and that only HIPAA-eligible services handle PHI: EC2, RDS, S3, EFS, ALB, WAF, KMS, Secrets Manager, CloudWatch, Bedrock, Transcribe, Comprehend Medical, Chime SDK, SES, End User Messaging SMS, SNS, Textract, Transfer Family, Backup, Connect. | PO, Oct 23 |
| **BAA, DrFirst** | Signed BAA as part of the Rcopia production contract | SP, Oct 27 |
| **BAA, Waystar** | Signed BAA for the production account (clearinghouse) | SP, Oct 27 |
| **BAA, Google Workspace** | If staff email ever carries PHI (MX is Google), sign the Google BAA | PO, Oct 30 |
| **BAA, Mindaptix** | Mindaptix has had admin access to PHI systems (AWS admin, prod DB). Sign a BAA retroactively, or revoke access and document it. | SP, Oct 23 |
| **Valant** | BAA continues during read-only / run-out access. Get a written data return/destruction confirmation at the end of the contract. | SP |
| **Stripe** | **Stripe does not sign BAAs.** Only subscription billing of other practices goes there. No patient names, diagnoses, service descriptions or notes in Stripe objects or metadata. If patient copays ever run through a processor, use the HIPAA payment-processing exemption carefully (amount and payer only), or pick a processor that signs a BAA. | PL, before any Stripe go-ahead |
| **Firebase / Pusher / Zoom / Google Meet** | Leave them disabled in prod unless a BAA is in place | DEV |
| **Risk assessment update** | Update the Security Risk Analysis for the new prod stack, data flows (Valant → S3 → Altrixs, Waystar, DrFirst, Bedrock), the decommissioning of the old prod, open gaps (MFA, the AUM2/3 drug coding gap), and the restore test evidence (§2.8) | PO, Nov 4 |
| **Audit logging** | App: `AuditLog` is append-only (trigger `audit_log_no_update_delete`, migration `20261016_doc_intake_upload_audit_log.sql`); PHI access is audited (`auditPhiAccess`); imports are audited with counts. Keep 6 years: AuditLog stays in RDS, and add a monthly export to S3 with Object Lock. Infrastructure: CloudTrail (KMS, validation), Config, VPC flow logs, SSM session logs, WAF and ALB logs, RDS logs. | DEV, Nov 5 |
| **Access reviews** | Before go-live: review every prod user and role against the staff list (`audit-db-roles.ts` style, counts and roles). Then monthly for the first quarter and quarterly after that. Remove accounts the day someone leaves. Review IAM and SSO the same way. | PO, Nov 6 then monthly |
| **42 CFR Part 2** | SUD records: confirm the Part 2 disclosure rules (`20261018_part2_disclosures.sql`) and the consent library are configured before go-live | CLN, Nov 4 |
| **Minimum necessary** | Role matrix (`docs/role-access-matrix.md`), MA restrictions, caseload scoping. Close the open org-filter findings: residential residents, bed-board, `sud-radar` GET, and `$queryRawUnsafe` interpolation in the refills route. | DEV, Oct 30 |
| **Encryption** | At rest: KMS for RDS, EBS, EFS, S3, Logs and Secrets. Field encryption for SSNs (prod key). In transit: TLS 1.2+ at the ALB, ALB→nginx over TLS, `rds.force_ssl`. | DEV |
| **Old prod PHI** | Encrypted retention snapshots, deletion of unencrypted copies, removal of the public `/uploads/` exposure (moot once stopped), documented disposal | PL, Nov 30 |
| **Policies** | Downtime procedure, breach response contact list, workforce training records (§5.2) | PO, Nov 6 |

---

## 9. Open questions for the owner

| # | Question | Recommendation (industry practice) | Needed by |
|---|---|---|---|
| Q-01 | Valant contract: can we keep **full** access through Nov 30 (rollback) and **read/billing** access for 120 days (insurance run-out, history)? | Yes. Without it there is no rollback and no run-out. | Oct 23 |
| Q-02 | Approve Option A (about $560/mo fixed) or A-lean (about $380/mo)? | A | Oct 21 |
| Q-03 | Mindaptix: revoke AWS admin and prod DB access after T-02, or keep scoped access under a BAA? Who owns the `mindaptix/divinecare-platform` repo going forward? | Revoke; transfer the repo to the practice's GitHub org | Oct 23 |
| Q-04 | Does Lexington Park / St. Mary's go live on Nov 9? It is a Valant facility, so it must. Are any clinics open on Saturdays? | Include LP on Nov 9, with its own super-user | Oct 22 |
| Q-05 | Which card processor takes patient copays after Nov 8? Valant's integrated one ends with the contract. | A processor that signs a BAA, or terminal-only with no PHI | Oct 26 |
| Q-06 | Clearinghouse scope: Waystar for everything, and Optum Maryland (Incedo) for Medicaid BH? Is Availity eligibility still contracted? | Waystar claims + eligibility; Medicaid BH per Optum MD rules | Oct 23 |
| Q-07 | Patient-facing email domain: `altrixs.com` or `marylandbhealth.com`? | Practice domain (patients recognise it), with SES DKIM/SPF/DMARC on it | Oct 23 |
| Q-08 | Will Valant provide structured assessment scores and progress notes (PDF) in bulk, and when? | Ask now; PDFs through Document Intake in hypercare | Oct 23 |
| Q-09 | Is the Flutter patient app in patients' hands on the old production? Who rebuilds and publishes it, and do patients need to re-register? | Re-invite after cutover; same API host | Oct 27 |
| Q-10 | Amazon Connect phone hub at go-live, or keep the current phones? | Keep the current phones for go-live | Oct 27 |
| Q-11 | MFA: accept a TOTP build as a go-live blocker, with email OTP as the interim? | Yes | Oct 21 |
| Q-12 | AI Scribe in week 1: which clinicians? (Cost about $0.024/min, consent required.) | Pilot with 3 to 5 clinicians, expand in December | Nov 2 |
| Q-13 | Records retention for the old prod snapshot (7 years?), and legal sign-off on decommissioning | 7 years, counsel confirms | Nov 20 |
| Q-14 | Post prepayment credits, or opening balances only? (Depends on Valant's answer about netting.) | Per the Valant answer | Nov 3 |

---

## 10. Dated checklist

Status: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked.

| ID | Task | Owner | Due | Status |
|---|---|---|---|---|
| T-01 | Owner decisions Q-02, Q-11 (architecture, MFA) | SP/PL | Tue Oct 21 | ⬜ |
| T-02 | Mindaptix counts-only inventory of `altrixs-postgres` (§0) | MX/PL | Wed Oct 22 | ⬜ |
| T-03 | Request DrFirst **production** credentials + book the certification demo | PL | Wed Oct 21 | ⬜ |
| T-04 | Submit toll-free registration `registration-1e51b16a…`. Track `registration-ce2d3a4d…` (REVIEWING). | PL | Wed Oct 21 | 🟡 |
| T-05 | Waystar: production mailbox request, confirm the test-claim quota, verify payer IDs (100198) / receiver ID | BIL | Thu Oct 22 | 🟡 |
| T-06 | All payer claim/ERA/EFT enrollments submitted (the earlier plan said Oct 14; confirm) | BIL | Fri Oct 23 | ⬜ |
| T-07 | Valant: contract extension (Q-01), final export formats incl. ZIP/phone/payer/member ID, prepayment netting answer | SP/BIL | Fri Oct 23 | ⬜ |
| T-08 | Prod VPC, SGs, NAT, KMS CMK, secrets (new PHI key) | DEV/PL | Wed Oct 21 | ⬜ |
| T-09 | RDS `altrixs-prod-db` Multi-AZ, 35-day PITR, PI, deletion protection, `rds.force_ssl` | DEV | Thu Oct 22 | ⬜ |
| T-10 | S3 buckets, EFS, IAM role `altrixs-prod-ec2` (§2.6), Bedrock model access + guardrail | DEV | Thu Oct 22 | ⬜ |
| T-11 | Route 53 hosted zone with every record copied, ACM certificate | PL | Thu Oct 22 | ⬜ |
| T-12 | SES SPF / MAIL FROM / DMARC | PL | Thu Oct 22 | ⬜ |
| T-13 | AMI, app-a/app-b, ALB, WAF (+ allowlist), `cutover.altrixs.com` | DEV | Fri Oct 23 | ⬜ |
| T-14 | CloudWatch agent logs + `altrixs-prod-*` alarms. Confirm the alert email subscription. | DEV | Fri Oct 23 | ⬜ |
| T-15 | Fix the AWS Backup / RDS window clash (old + new plans). Prod backup plan. Staging RDS in a plan. | PL | Fri Oct 23 | ⬜ |
| T-16 | BAAs: AWS confirmed; DrFirst, Waystar, Mindaptix decision, Google | SP/PO | Oct 23–30 | ⬜ |
| T-17 | Nameserver switch to Route 53 + 24 h watch | PL | Mon Oct 26 | ⬜ |
| T-18 | Schema bootstrap on prod (Prisma tables once on the empty DB + `migrate.sh`), schema diff = staging | DEV | Mon Oct 26 | ⬜ |
| T-19 | First prod deploy (RC) at `cutover.altrixs.com`. Rolling deploy runbook written. | DEV | Tue Oct 27 | ⬜ |
| T-20 | Rehearsal R1 (full import on staging with a fresh export), timings recorded | DEV/BIL | Tue Oct 27 | ⬜ |
| T-21 | Waystar clean test-claim quota met | BIL | Tue Oct 27 | ⬜ |
| T-22 | Super-user training | CLN | Oct 26–27 | ⬜ |
| T-23 | Role training sessions (§5.2) | CLN/SU | Oct 28 – Nov 6 | ⬜ |
| T-24 | **Restore test** (PITR, EFS, AMI), evidence filed | DEV/PO | Wed Oct 28 | ⬜ |
| T-25 | MFA (TOTP), idle logoff 15 min, 12 h session, lockout: built, tested on staging | DEV | Fri Oct 30 | ⬜ |
| T-26 | Close the open security findings (org filters, `$queryRawUnsafe`) | DEV | Fri Oct 30 | ⬜ |
| T-27 | Prod startup guard for forbidden env vars. Seed/`_*` scripts excluded from the prod bundle. | DEV | Fri Oct 30 | ⬜ |
| T-28 | `deploy/crontab.production` + notifications caller pointing at `https://altrixs.com` | DEV | Fri Oct 30 | ⬜ |
| T-29 | **Code freeze**, RC tag | DEV/PL | Fri Oct 30 18:00 | ⬜ |
| T-30 | DrFirst certification passed. Prod credentials in `altrixs/prod/integrations`. | PL | Fri Oct 30 | ⬜ |
| T-31 | Waystar prod mailbox + prod connector + secret | BIL/DEV | Fri Oct 30 | ⬜ |
| T-32 | IAM clean-up: root keys deleted, MFA everywhere, Mindaptix access per Q-03, SSO prod permission sets | PL | Fri Oct 30 | ⬜ |
| T-33 | Staff import + roles + `rcopiaUsername` mapping in prod. Invites sent. | DEV/PL | Mon Nov 2 | ⬜ |
| T-34 | Config imports in prod (facilities, payers, measurement/lab types, fee schedule). Schedule templates rebuilt. | DEV/SU | Mon Nov 2 | ⬜ |
| T-35 | Rehearsal R2 on prod infrastructure (`altrixs_rehearsal`), incl. A/R posting dry run | DEV/BIL | Tue Nov 3 | ⬜ |
| T-36 | Role smoke tests on R2. Fix list. | SU/CLN | Wed Nov 4 | ⬜ |
| T-37 | EPCS done for every controlled-substance prescriber. PDMP access confirmed. | CLN | Wed Nov 4 | ⬜ |
| T-38 | Downtime drill per site. Packets printed. | SU | Wed Nov 4 | ⬜ |
| T-39 | Risk assessment update + Part 2 configuration check | PO/CLN | Wed Nov 4 | ⬜ |
| T-40 | **Go/no-go #1.** Final release deployed (rolling). Rehearsal DB dropped. MFA enrolment complete. | SP/PL | Thu Nov 5 | ⬜ |
| T-41 | Access review of every prod account | PO | Fri Nov 6 | ⬜ |
| T-42 | **Valant freeze**; snapshots (§6) | BIL/DEV | Fri Nov 6 18:00 | ⬜ |
| T-43 | Final exports + imports (§3.3–3.4) | BIL/DEV | Sat Nov 7 | ⬜ |
| T-44 | Acceptance checks, A/R sign-off, smoke tests | DEV/BIL/SU | Sun Nov 8 07:00–12:00 | ⬜ |
| T-45 | **Go/no-go #2 → DNS switch → integrations on** | SP/PL/DEV | Sun Nov 8 14:00–16:00 | ⬜ |
| T-46 | Old prod EC2 stopped. Old IAM keys deactivated. | PL | Sun Nov 8 | ⬜ |
| T-47 | First clinic day, hypercare | All | Mon Nov 9 – Fri Nov 20 | ⬜ |
| T-48 | First production claims released per payer. 999/277CA confirmed. | BIL | Nov 9–13 | ⬜ |
| T-49 | Document Intake backfill of historical notes for clients seen in weeks 1–2 | SU/DEV | Nov 9–20 | ⬜ |
| T-50 | Retire the `altrixs-production-*` alarms and the old Route 53 health check | DEV | Nov 13 | ⬜ |
| T-90 | Decommission: old EC2 terminated, `altrixs-postgres` final snapshot kept 7 years then deleted, unencrypted copies removed, `bridgecare-api` / `altrixs-connect` / old SMTP keys deleted | PL/PO | Mon Nov 30 | ⬜ |
| T-91 | 30-day review: rightsizing (PI data), Savings Plan / RI, DMARC to quarantine, December AI wave | PL | Dec 8 | ⬜ |

Already in place (✅): GuardDuty (S3/RDS/Lambda), Security Hub (FSBP), CloudTrail (KMS, validation, 1-year CloudWatch
Logs), Config + HIPAA conformance pack, VPC flow logs, IAM password policy, Access Analyzer, 14 CloudWatch alarms
with SNS email + SMS, Route 53 health checks, IMDSv2, encrypted staging EBS/RDS/S3, the staging PHI field key in
Secrets Manager, the migration ledger (`scripts/migrate.sh`), the append-only AuditLog, the Valant import tooling
with dry runs, and the DrFirst certification evidence (`docs/drfirst-certification/`).
