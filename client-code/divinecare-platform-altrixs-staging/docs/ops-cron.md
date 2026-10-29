# Notifications cron and two-way SMS (ops setup)

Nothing in this file is installed automatically. An owner or admin runs these steps on the server
and in AWS.

## 1. Cron: `/api/cron/notifications`

This route sends push, SMS and email appointment reminders, medication reminders and daily
check-in prompts. It runs only when something calls it. Until now the proxy also refused it
without a staff session; it is now a public path, and the route still requires
`Authorization: Bearer $CRON_SECRET`.

Reminder windows are 23 to 25 h and 100 to 140 min before the visit, so the cron must run at
least every 10 minutes. Sends are deduplicated per appointment, channel and window, so extra
runs never send a second text.

### 1a. Set the secret

In the app environment (the same `.env` the Next.js server reads):

```
CRON_SECRET=<long random string, e.g. `openssl rand -hex 32`>
UNSUBSCRIBE_SECRET=<another long random string>   # signs the one-click email unsubscribe link
```

Restart the app after you change these values.

### 1b. Caller script: `/usr/local/bin/altrixs-notifications-cron`

```bash
#!/usr/bin/env bash
# Calls the Altrixs notifications cron. Reads CRON_SECRET from the app env file.
set -euo pipefail
ENV_FILE="${ALTRIXS_ENV_FILE:-/opt/altrixs/.env}"
BASE_URL="${ALTRIXS_BASE_URL:-https://staging.altrixs.com}"
CRON_SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
if [ -z "$CRON_SECRET" ]; then
  echo "CRON_SECRET missing in $ENV_FILE" >&2
  exit 1
fi
curl -fsS --max-time 110 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -X POST "${BASE_URL}/api/cron/notifications" \
  -o /dev/null -w "%{http_code}\n"
```

Install it:

```
sudo install -m 0750 -o root -g root altrixs-notifications-cron /usr/local/bin/altrixs-notifications-cron
```

Change `ENV_FILE` and `BASE_URL` to the server's real paths. For production, use the production
URL.

### 1c. Schedule: `/etc/cron.d/altrixs-notifications`

```
# Altrixs notification reminders, every 10 minutes
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * root /usr/local/bin/altrixs-notifications-cron >> /var/log/altrixs-notifications-cron.log 2>&1
```

Files in `/etc/cron.d` must be owned by root, mode 0644, and end with a newline. Check the log
after 10 minutes. The response JSON has `results.appointmentSmsEmail` with sent, failed and
skipped counts. Each reminder is also logged in `NotificationLog` (columns `channel`, `status`,
`reason`).

## 2. SMS reminders: prerequisites

- Practice settings, Admin > Scheduling: turn on `SMS reminder 24 hours before`,
  `SMS reminder 2 hours before` and/or `Email reminder 24 hours before`.
- TCPA: a client gets texts only when `Client.smsConsent = true` (with `smsConsentAt` and
  `smsConsentSource`) and `smsOptOutAt` is empty. The migration sets `smsConsent = false` for
  every existing client. Record consent from intake, the portal or staff (with the source). Do
  not bulk-set it.
- The sending number must be registered (10DLC campaign or toll-free verification) in AWS End
  User Messaging. Its keyword responses for STOP and HELP must be set (see 3c).

## 3. Two-way SMS: STOP, START, HELP and C (confirm)

The inbound webhook is `POST /api/sms/inbound`. It verifies the SNS signature, uses only
certificates from `sns.<region>.amazonaws.com`, and requires the topic ARN to match
`SMS_INBOUND_TOPIC_ARN`. If that variable is not set, the webhook returns 503.

### 3a. SNS topic

In account 792233689095, in the region of the phone number (us-east-1):

1. Create a standard SNS topic, for example `altrixs-inbound-sms`. Turn on encryption with an
   AWS-managed or KMS key, because inbound texts can contain PHI.
2. In the topic access policy, allow `sms-voice.amazonaws.com` to `sns:Publish`, limited to your
   account with an `aws:SourceAccount` condition.

### 3b. Phone number: two-way SMS

AWS End User Messaging SMS > Phone numbers > (the sending number) > Two-way SMS:

- Turn on two-way messaging.
- Destination: the SNS topic from 3a.
- Self-managed opt-outs:
  - **Off (recommended)**: AWS keeps its own opt-out list and answers STOP and HELP with the
    keyword responses set on the number. Altrixs still records STOP and START on the client
    (`smsOptOutAt`).
  - **On**: set `SMS_SELF_MANAGED_KEYWORDS=true` in the app environment. Altrixs then sends the
    STOP, START and HELP replies itself.

### 3c. Keyword responses (when AWS manages them)

Set these on the phone number. They follow CTIA and contain no PHI.

- HELP: `<Practice name>: appointment reminders. Call <office phone> for help. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`
- STOP: `<Practice name>: You are unsubscribed and will receive no more texts. Reply START to resubscribe.`

### 3d. HTTPS subscription

1. Set `SMS_INBOUND_TOPIC_ARN=arn:aws:sns:us-east-1:792233689095:altrixs-inbound-sms` in the app
   env and restart the app.
2. SNS > the topic > Create subscription: protocol HTTPS, endpoint
   `https://<host>/api/sms/inbound`. Keep raw message delivery off, because the route expects the
   SNS envelope.
3. The route confirms the subscription by itself (audit action
   `SMS_INBOUND_SUBSCRIPTION_CONFIRMED`). Check that the subscription status is Confirmed.
4. Test it: text `HELP`, then `C` after a reminder, from a test phone that has consent. Check the
   `SmsInboundEvent` rows and `Appointment.confirmedAt`.

### 3e. What each keyword does

| Text from the patient | Effect |
|---|---|
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT | `smsOptOutAt` is set on every client with that number. No more texts. |
| START, UNSTOP | `smsOptOutAt` is cleared. Consent is recorded with source `sms_unstop`. |
| HELP, INFO | HELP reply (from AWS, or from Altrixs when self-managed). |
| C, CONFIRM | `confirmedAt` is set on the next upcoming appointment that got an SMS reminder in the last 3 days. A short confirmation reply is sent. |
| anything else | Only the keyword `other` is recorded. The message text is never stored. |

"CANCEL" is a CTIA opt-out word. Reminders therefore never say "reply CANCEL to cancel".
