#!/bin/bash
set -uo pipefail
APP=/opt/altrixs/app; REGION=us-east-1
pkill -f "next[ ]build" || true; pkill -f "crawl-roles" || true
aws s3 cp s3://altrixs-staging-artifacts-792233689095/source/altrixs-staging-COMMIT.bundle /tmp/up.bundle --region $REGION --only-show-errors && chmod 644 /tmp/up.bundle
cd $APP && sudo -u altrixs git fetch -q /tmp/up.bundle staging/hardening && sudo -u altrixs git reset -q --hard FETCH_HEAD && rm -f /tmp/up.bundle
echo "code: $(sudo -u altrixs git log -1 --format='%h %s')"
sudo -u altrixs -H bash -c "cd $APP && npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -1"
echo "== field encryption key"
if grep -q '^PHI_FIELD_ENCRYPTION_KEY=' $APP/.env; then echo "already set"; else
  K=$(openssl rand -hex 32)
  if aws secretsmanager create-secret --region us-east-1 --name altrixs/staging/phi-field-encryption-key --description "AES-256 key for PHI field encryption (SSN). Losing it makes encrypted SSNs unreadable." --secret-string "$K" >/dev/null 2>&1; then
    echo "PHI_FIELD_ENCRYPTION_KEY=$K" >> $APP/.env && echo "generated, stored in Secrets Manager and .env"
  else echo "could not store key in Secrets Manager; NOT set"; fi
  unset K
fi
echo "== env for pricing + scribe"
setenv() { if grep -q "^$1=" $APP/.env; then sed -i "s|^$1=.*|$1=$2|" $APP/.env; else echo "$1=$2" >> $APP/.env; fi; echo "set $1"; }
setenv SCRIBE_TRANSCRIBE_VOCABULARY altrixs-behavioral-health
setenv NEXT_PUBLIC_PRICING_APPROVED true
setenv DRFIRST_REGISTER_ON_LAUNCH non_imported
k=$(grep -E '^STRIPE_SECRET_KEY=' $APP/.env | cut -d= -f2- | tr -d '"'); case "$k" in sk_test_*) echo "stripe key: TEST";; sk_live_*) echo "stripe key: LIVE";; "") echo "stripe key: none";; *) echo "stripe key: other";; esac; STRIPE_MODE=$(case "$k" in sk_test_*) echo test;; *) echo no;; esac); unset k
echo "== migrations (ledger)"
sudo -u altrixs -H bash -c "set -o pipefail; cd $APP && bash scripts/migrate.sh --status 2>&1 | tail -15"
sudo -u altrixs -H bash -c "set -o pipefail; cd $APP && bash scripts/migrate.sh 2>&1 | tail -25"; mrc=$?; echo "migrate exit $mrc"; [ $mrc -eq 0 ] || exit $mrc
grep -q "^ALTRIXS_ENV=" $APP/.env || echo "ALTRIXS_ENV=staging" >> $APP/.env; echo "env: $(grep ^ALTRIXS_ENV= $APP/.env)"
# Keep the previous builds' static chunks so tabs opened before this deploy keep working
mkdir -p /opt/altrixs/static-keep && [ -d $APP/.next/static ] && cp -a $APP/.next/static/. /opt/altrixs/static-keep/ && chown -R altrixs:altrixs /opt/altrixs/static-keep
echo "== prebuilt build (CodeBuild)"; start=$(date +%s)
COMMIT=$(sudo -u altrixs git -C $APP rev-parse --short=7 HEAD)
sudo -u altrixs -H bash -c "cd $APP && npx prisma generate >/dev/null 2>&1"; echo "prisma generate exit $?"
aws s3 cp s3://altrixs-staging-artifacts-792233689095/builds/$COMMIT.tar.gz /tmp/next-build.tar.gz --region $REGION --only-show-errors || { echo "no prebuilt build for $COMMIT"; exit 3; }
rm -rf $APP/.next.new && mkdir -p $APP/.next.new && tar xzf /tmp/next-build.tar.gz -C $APP/.next.new && rm -f /tmp/next-build.tar.gz
[ "$(cat $APP/.next.new/ALTRIXS_BUILD_COMMIT 2>/dev/null)" = "$COMMIT" ] || { echo "build commit mismatch"; rm -rf $APP/.next.new; exit 4; }
[ -f $APP/.next.new/BUILD_ID ] || { echo "no BUILD_ID"; rm -rf $APP/.next.new; exit 4; }
rm -rf $APP/.next/cache  # the server no longer builds; never carry the build cache forward (it reached 15 GB)
rm -rf $APP/.next.prev && [ -d $APP/.next ] && mv $APP/.next $APP/.next.prev; mv $APP/.next.new $APP/.next && chown -R altrixs:altrixs $APP/.next
echo "build swapped in ($(( $(date +%s)-start ))s), previous kept at .next.prev"
cp -an /opt/altrixs/static-keep/. $APP/.next/static/ && chown -R altrixs:altrixs $APP/.next/static && find /opt/altrixs/static-keep -type f -mtime +30 -delete && echo "kept old chunks: $(find /opt/altrixs/static-keep -type f | wc -l) files"
sudo -u altrixs -H pm2 restart altrixs-staging --update-env >/dev/null
for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login); [ "$c" = 200 ] && break; sleep 2; done; echo "app /login: $c"
for p in /api/drfirst/sync /api/billing/specialized /api/clients/x/medications /api/ehr/doc-intake /api/patient/notifications; do echo "GET $p signed out: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000$p)"; done
aws s3 cp s3://altrixs-staging-artifacts-792233689095/tools/errcheck.js /tmp/errcheck.js --region us-east-1 --only-show-errors
echo "== migration page check"; cp /tmp/errcheck.js $APP/.errcheck.js && chown altrixs:altrixs $APP/.errcheck.js
echo "== version"; curl -s http://127.0.0.1:3000/api/version; echo
rm -f $APP/.errcheck.js
run() { echo; echo "===== $1"; sudo -u altrixs -H bash -c "cd $APP && timeout 1200 npx tsx --conditions=react-server --env-file=.env $2 2>&1 | tail -${3:-80}"; echo "exit: $?"; }
echo "register mode: $(grep ^DRFIRST_REGISTER_ON_LAUNCH= $APP/.env)"
