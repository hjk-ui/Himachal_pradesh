const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      return [k, v];
    })
);

if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
  console.log('MISSING_CREDS');
  process.exit(2);
}

console.log(
  'KEY_PREFIX',
  env.AWS_ACCESS_KEY_ID.slice(0, 8) + '...',
  'REGION',
  env.AWS_REGION || 'us-east-1'
);

async function main() {
  const {
    ChimeSDKMeetingsClient,
    CreateMeetingCommand,
    CreateAttendeeCommand,
    DeleteMeetingCommand,
  } = require('@aws-sdk/client-chime-sdk-meetings');

  const chime = new ChimeSDKMeetingsClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  try {
    const res = await chime.send(
      new CreateMeetingCommand({
        ClientRequestToken: 'altrixs-chime-probe-' + Date.now(),
        ExternalMeetingId: ('probe-' + Date.now()).slice(0, 64),
        MediaRegion: 'us-east-1',
      })
    );
    const mid = res.Meeting && res.Meeting.MeetingId;
    console.log('CHIME_CREATE', 'OK', mid || 'no-id');

    if (mid) {
      try {
        const att = await chime.send(
          new CreateAttendeeCommand({
            MeetingId: mid,
            ExternalUserId: 'probe-clinician',
          })
        );
        console.log(
          'CHIME_ATTENDEE',
          'OK',
          att.Attendee && att.Attendee.AttendeeId ? 'has-token' : 'missing'
        );
      } catch (e) {
        console.log('CHIME_ATTENDEE', e.name || 'Error', String(e.message || '').slice(0, 300));
      }

      try {
        await chime.send(new DeleteMeetingCommand({ MeetingId: mid }));
        console.log('CHIME_DELETE', 'OK');
      } catch (e) {
        console.log('CHIME_DELETE', e.name || 'Error', String(e.message || '').slice(0, 300));
      }
    }

    console.log('RESULT', 'CHIME_READY');
  } catch (e) {
    console.log('CHIME_CREATE', e.name || 'Error', String(e.message || '').slice(0, 500));
    if (e.$metadata) console.log('CHIME_HTTP', e.$metadata.httpStatusCode);
    const msg = String(e.message || e.name || '');
    if (/not authorized|AccessDenied|Unauthorized/i.test(msg)) {
      console.log('RESULT', 'NEEDS_IAM_POLICY');
    } else {
      console.log('RESULT', 'FAILED_OTHER');
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
