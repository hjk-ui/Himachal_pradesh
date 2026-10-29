# AWS HealthLake (FHIR R4) setup

Status: code is built and tested against fixtures. **No data store exists.** Nothing below has been run.
A HealthLake data store bills per hour while it exists (about $200/month at minimum), so create it
only after the owner approves.

Until `AWS_HEALTHLAKE_DATASTORE_ID` is set, every HealthLake route answers
`503 HEALTHLAKE_NOT_CONFIGURED` ("HealthLake is not connected — no data store configured"),
the dashboard page (EHR > HealthLake FHIR R4) shows the not-connected state, and
`scripts/healthlake-sync.ts` exits without doing anything.

Account `792233689095`, region `us-east-1`, CLI profile `altrixs`. Replace `<...>` placeholders.

```bash
export AWS_PROFILE=altrixs AWS_REGION=us-east-1 ACCT=792233689095
```

## 1. Customer-managed KMS key

```bash
aws kms create-key \
  --description "Altrixs HealthLake FHIR R4 data store + import/export objects" \
  --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT \
  --tags TagKey=app,TagValue=altrixs TagKey=data,TagValue=phi
# -> KeyMetadata.Arn  (call it KEY_ARN)
aws kms create-alias --alias-name alias/altrixs-healthlake --target-key-id <KEY_ID>
aws kms enable-key-rotation --key-id <KEY_ID>
```

Add this statement to the key policy (`aws kms get-key-policy` / `put-key-policy --policy-name default`)
so the instance role and the data-access role can use the key only through HealthLake and S3:

```json
{
  "Sid": "AltrixsHealthLakeUse",
  "Effect": "Allow",
  "Principal": { "AWS": [
    "arn:aws:iam::792233689095:role/<INSTANCE_ROLE_NAME>",
    "arn:aws:iam::792233689095:role/altrixs-healthlake-data-access"
  ] },
  "Action": ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey", "kms:CreateGrant"],
  "Resource": "*",
  "Condition": { "StringEquals": { "kms:ViaService": [
    "healthlake.us-east-1.amazonaws.com", "s3.us-east-1.amazonaws.com"
  ] } }
}
```

## 2. FHIR R4 data store (preload: none)

Preload is omitted on purpose (the only preload option is synthetic Synthea data).

```bash
aws healthlake create-fhir-datastore \
  --datastore-name altrixs-fhir-r4 \
  --datastore-type-version R4 \
  --sse-configuration '{"KmsEncryptionConfig":{"CmkType":"CUSTOMER_MANAGED_KMS_KEY","KmsKeyId":"<KEY_ARN>"}}' \
  --identity-provider-configuration AuthorizationStrategy=AWS_AUTH \
  --tags Key=app,Value=altrixs Key=data,Value=phi
# -> DatastoreId (32 hex chars) and DatastoreArn; wait until ACTIVE (can take ~30 min):
aws healthlake describe-fhir-datastore --datastore-id <DATASTORE_ID> \
  --query 'DatastoreProperties.DatastoreStatus'
```

## 3. Policy for the EC2 instance role (app server)

Find the role: `aws ec2 describe-instances --query 'Reservations[].Instances[].IamInstanceProfile.Arn'`
then `aws iam get-instance-profile --instance-profile-name <PROFILE>`.

`healthlake-app-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FhirReadWrite",
      "Effect": "Allow",
      "Action": [
        "healthlake:ReadResource",
        "healthlake:CreateResource",
        "healthlake:UpdateResource",
        "healthlake:DeleteResource",
        "healthlake:SearchWithGet",
        "healthlake:SearchWithPost",
        "healthlake:StartFHIRImportJob",
        "healthlake:StartFHIRExportJob",
        "healthlake:DescribeFHIRDatastore",
        "healthlake:DescribeFHIRImportJob",
        "healthlake:DescribeFHIRExportJob"
      ],
      "Resource": "arn:aws:healthlake:us-east-1:792233689095:datastore/fhir/<DATASTORE_ID>"
    },
    {
      "Sid": "PassDataAccessRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::792233689095:role/altrixs-healthlake-data-access",
      "Condition": { "StringEquals": { "iam:PassedToService": "healthlake.amazonaws.com" } }
    },
    {
      "Sid": "WriteImportNdjson",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::altrixs-healthlake-792233689095/import/*"
    },
    {
      "Sid": "KmsForHealthLakeAndS3",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      "Resource": "<KEY_ARN>",
      "Condition": { "StringEquals": { "kms:ViaService": [
        "healthlake.us-east-1.amazonaws.com", "s3.us-east-1.amazonaws.com"
      ] } }
    }
  ]
}
```

```bash
aws iam put-role-policy --role-name <INSTANCE_ROLE_NAME> \
  --policy-name altrixs-healthlake --policy-document file://healthlake-app-policy.json
```

## 4. Import/export bucket and data-access role

```bash
aws s3api create-bucket --bucket altrixs-healthlake-792233689095
aws s3api put-public-access-block --bucket altrixs-healthlake-792233689095 \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket altrixs-healthlake-792233689095 \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"<KEY_ARN>"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning --bucket altrixs-healthlake-792233689095 --versioning-configuration Status=Enabled
```

`healthlake-trust.json` (HealthLake assumes this role for import/export jobs, only for our data store):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "healthlake.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "792233689095" },
      "ArnEquals": { "aws:SourceArn": "arn:aws:healthlake:us-east-1:792233689095:datastore/fhir/<DATASTORE_ID>" }
    }
  }]
}
```

`healthlake-data-access.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadImport",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::altrixs-healthlake-792233689095/import/*"
    },
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketPublicAccessBlock", "s3:GetEncryptionConfiguration"],
      "Resource": "arn:aws:s3:::altrixs-healthlake-792233689095"
    },
    {
      "Sid": "WriteJobOutputAndExport",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::altrixs-healthlake-792233689095/import-output/*",
        "arn:aws:s3:::altrixs-healthlake-792233689095/export/*"
      ]
    },
    {
      "Sid": "Kms",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      "Resource": "<KEY_ARN>"
    }
  ]
}
```

```bash
aws iam create-role --role-name altrixs-healthlake-data-access \
  --assume-role-policy-document file://healthlake-trust.json
aws iam put-role-policy --role-name altrixs-healthlake-data-access \
  --policy-name altrixs-healthlake-s3-kms --policy-document file://healthlake-data-access.json
```

## 5. Environment (.env on the server)

```bash
AWS_LIVE=true                                   # instance role (already set on staging)
AWS_HEALTHLAKE_DATASTORE_ID=<DATASTORE_ID>      # 32 hex chars; this alone turns HealthLake on
# AWS_HEALTHLAKE_REGION=us-east-1               # optional, defaults to AWS_REGION
# Bulk initial load ($import) and export, both optional:
AWS_HEALTHLAKE_DATA_ACCESS_ROLE_ARN=arn:aws:iam::792233689095:role/altrixs-healthlake-data-access
AWS_HEALTHLAKE_KMS_KEY_ARN=<KEY_ARN>
AWS_HEALTHLAKE_IMPORT_S3_URI=s3://altrixs-healthlake-792233689095/import/
AWS_HEALTHLAKE_IMPORT_OUTPUT_S3_URI=s3://altrixs-healthlake-792233689095/import-output/
AWS_HEALTHLAKE_EXPORT_S3_URI=s3://altrixs-healthlake-792233689095/export/
```

Static keys (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) also work and take precedence; the instance
role is preferred. Restart the app after editing `.env`.

Apply `prisma/migrations/20261017_fhir_sync.sql` (idempotent) before the first sync.

## 6. Turn it on

1. Dashboard > EHR > HealthLake FHIR R4: confirm "CONNECTED", then tick **Sync this organization**.
   **Send 42 CFR Part 2 records** stays off unless the practice explicitly decides otherwise.
2. Optional first load: **Bulk initial load** writes NDJSON of not-yet-synced resources to
   `AWS_HEALTHLAKE_IMPORT_S3_URI/<org>/<timestamp>/` and starts an import job. Rows show IMPORTING until
   the job completes (refreshed by the jobs list and the cron).
3. Cron (every 15 minutes), same shape as the DrFirst sweep:

```cron
*/15 * * * * cd /home/ubuntu/altrixs-platform && npx tsx --conditions=react-server --env-file=.env scripts/healthlake-sync.ts >> /home/ubuntu/logs/healthlake-sync.log 2>&1
```

Adjust the path to the app checkout on the server. Each run prints one line per organization (counts only)
and writes one `FhirSyncRun` row and one `HEALTHLAKE_SYNC_ORG` audit row.

## How the sync works

- `src/lib/fhir/mapping/*` maps rows to FHIR R4 (pure, tested): Patient, Practitioner, Organization, Location,
  Condition, MedicationStatement, AllergyIntolerance, Encounter, DocumentReference, Observation. Resource ids are
  derived from our ids, so PUT is idempotent. Every resource carries `meta.tag urn:altrixs:organization|<orgId>`.
- `FhirSyncState` is the outbox (hashes and status only, never resource content). Each run rebuilds the
  resources, compares sha256 hashes with the last synced hash, queues PUTs for new/changed resources and DELETEs
  for removed or newly excluded ones, then works due rows with retry and exponential backoff
  (1 min doubling to 6 h; DEAD after 8 attempts; a 401/403 stops the run without burning attempts).
- Search (`GET /api/healthlake/fhir/<Type>`) always adds `_tag=urn:altrixs:organization|<caller org>` and drops any
  returned entry without that tag.
- Export covers the whole data store (HealthLake cannot filter by organization), so it is refused while the store
  holds another organization's resources.

## 42 CFR Part 2 rule

Default: off (`allowPart2Sync` false; turning it on needs an explicit confirmation and is audited).

- Part 2 client = any progress note flagged Part 2 (column or legacy `part2="true"`), or a protected record whose
  classification names Part 2 / 42 CFR / SUD.
- Part 2 content = Part 2 notes; SUD diagnoses (ICD-10-CM F10-F16, F18, F19; tobacco F17 excluded per 42 CFR 2.11);
  SUD medications (buprenorphine, methadone, naltrexone, disulfiram, acamprosate, lofexidine and brands);
  SUD reason codes on medical visits.
- Off: nothing about a Part 2 client is sent (not even Patient); Part 2 content of other clients is held back; any
  of it already in HealthLake is deleted on the next run.
- On: everything is sent; Part 2 resources get `meta.security` `v3-ActCode#42CFRPart2`, `v3-ActCode#NORDSCLCD`,
  and `v3-Confidentiality#R`.
- Protected-record (SensitiveRecord) clients are always sent with `v3-Confidentiality#R`.
- Unsigned (draft) notes are never sent.

## Teardown (stops billing)

```bash
aws healthlake delete-fhir-datastore --datastore-id <DATASTORE_ID>
```
