import { v4 as uuidv4 } from 'uuid';
import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteMeetingCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  DeleteMediaCapturePipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines';

export const CHIME_REGION = 'us-east-1';
export const DEMO_MODE = !process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID.trim() === '';

export function isDemoMode(): boolean {
  return DEMO_MODE;
}

function getMeetingsClient(): ChimeSDKMeetingsClient {
  return new ChimeSDKMeetingsClient({
    region: CHIME_REGION,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
          }
        : undefined,
  });
}

function getPipelinesClient(): ChimeSDKMediaPipelinesClient {
  return new ChimeSDKMediaPipelinesClient({
    region: CHIME_REGION,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
          }
        : undefined,
  });
}

export interface ChimeMeetingOutput {
  meetingId: string;
  externalMeetingId: string;
  mediaRegion: string;
  meeting: Record<string, unknown>;
  clinicianAttendee: Record<string, unknown>;
  clinicianJoinToken: string;
  clinicianAttendeeId: string;
  patientAttendee: Record<string, unknown>;
  patientJoinToken: string;
  patientAttendeeId: string;
  pipelineId?: string | null;
  demoMode: boolean;
}

/**
 * Creates an Amazon Chime SDK Meeting and provisions both Clinician & Patient attendees.
 * Supports transparent fallback to simulated demo meeting when AWS credentials are not set.
 */
export async function createChimeMeeting(input: {
  appointmentId: string;
  patientId: string;
  clinicianId: string;
  enableRecording?: boolean;
}): Promise<ChimeMeetingOutput> {
  const externalMeetingId = `altrixs-meeting-${input.appointmentId}`.slice(0, 64);

  if (DEMO_MODE) {
    const meetingId = `demo-meeting-${input.appointmentId}-${uuidv4().slice(0, 8)}`;
    const clinicianAttendeeId = `demo-clinician-${uuidv4().slice(0, 8)}`;
    const clinicianJoinToken = `demo-clin-token-${uuidv4()}`;
    const patientAttendeeId = `demo-patient-${uuidv4().slice(0, 8)}`;
    const patientJoinToken = `demo-pat-token-${uuidv4()}`;

    const mockMeeting = {
      MeetingId: meetingId,
      ExternalMeetingId: externalMeetingId,
      MediaRegion: CHIME_REGION,
      MediaPlacement: {
        AudioHostUrl: `demo-audio.${CHIME_REGION}.mock.aws.chime`,
        AudioFallbackUrl: `demo-audio-fallback.${CHIME_REGION}.mock.aws.chime`,
        SignalingUrl: `wss://demo-signal.${CHIME_REGION}.mock.aws.chime`,
        TurnControlUrl: `https://demo-turn.${CHIME_REGION}.mock.aws.chime`,
        ScreenDataUrl: `wss://demo-data.${CHIME_REGION}.mock.aws.chime`,
        ScreenViewingUrl: `wss://demo-screen.${CHIME_REGION}.mock.aws.chime`,
        ScreenSharingUrl: `wss://demo-share.${CHIME_REGION}.mock.aws.chime`,
        EventIngestionUrl: `https://demo-events.${CHIME_REGION}.mock.aws.chime`,
      },
      Features: {
        Audio: {
          EchoReduction: 'AVAILABLE',
        },
      },
      demoMode: true,
    };

    const mockClinicianAttendee = {
      AttendeeId: clinicianAttendeeId,
      ExternalUserId: input.clinicianId.slice(0, 64),
      JoinToken: clinicianJoinToken,
    };

    const mockPatientAttendee = {
      AttendeeId: patientAttendeeId,
      ExternalUserId: input.patientId.slice(0, 64),
      JoinToken: patientJoinToken,
    };

    return {
      meetingId,
      externalMeetingId,
      mediaRegion: CHIME_REGION,
      meeting: mockMeeting,
      clinicianAttendee: mockClinicianAttendee,
      clinicianJoinToken,
      clinicianAttendeeId,
      patientAttendee: mockPatientAttendee,
      patientJoinToken,
      patientAttendeeId,
      pipelineId: input.enableRecording ? `demo-pipeline-${uuidv4().slice(0, 8)}` : null,
      demoMode: true,
    };
  }

  // Production AWS Chime SDK implementation
  const meetingsClient = getMeetingsClient();

  const meetingRes = await meetingsClient.send(
    new CreateMeetingCommand({
      ClientRequestToken: `${input.appointmentId}-${uuidv4().slice(0, 8)}`,
      ExternalMeetingId: externalMeetingId,
      MediaRegion: CHIME_REGION,
      MeetingFeatures: {
        Audio: {
          EchoReduction: 'AVAILABLE',
        },
      },
    })
  );

  const meeting = meetingRes.Meeting;
  if (!meeting?.MeetingId) {
    throw new Error('Chime CreateMeetingCommand failed: No MeetingId returned');
  }

  // Create Clinician Attendee (Full Audio, Video, Screen Share)
  const clinicianRes = await meetingsClient.send(
    new CreateAttendeeCommand({
      MeetingId: meeting.MeetingId,
      ExternalUserId: `clinician-${input.clinicianId}`.slice(0, 64),
      Capabilities: {
        Audio: 'SendReceive',
        Video: 'SendReceive',
        Content: 'SendReceive',
      },
    })
  );

  // Create Patient Attendee (Audio & Video SendReceive, Content None)
  const patientRes = await meetingsClient.send(
    new CreateAttendeeCommand({
      MeetingId: meeting.MeetingId,
      ExternalUserId: `patient-${input.patientId}`.slice(0, 64),
      Capabilities: {
        Audio: 'SendReceive',
        Video: 'SendReceive',
        Content: 'None',
      },
    })
  );

  let pipelineId: string | null = null;
  if (input.enableRecording && process.env.TELEHEALTH_S3_RECORDINGS_BUCKET) {
    try {
      const pipelinesClient = getPipelinesClient();
      const pipeRes = await pipelinesClient.send(
        new CreateMediaCapturePipelineCommand({
          SourceType: 'ChimeSdkMeeting',
          SourceArn: `arn:aws:chime::meetings:${meeting.MeetingId}`,
          SinkType: 'S3Bucket',
          SinkArn: `arn:aws:s3:::${process.env.TELEHEALTH_S3_RECORDINGS_BUCKET}/recordings/${meeting.MeetingId}`,
        })
      );
      pipelineId = pipeRes.MediaCapturePipeline?.MediaPipelineId || null;
    } catch (pipeErr) {
      console.warn('[chime] media capture pipeline failed to initialize:', pipeErr);
    }
  }

  return {
    meetingId: meeting.MeetingId,
    externalMeetingId,
    mediaRegion: meeting.MediaRegion || CHIME_REGION,
    meeting: meeting as unknown as Record<string, unknown>,
    clinicianAttendee: clinicianRes.Attendee as unknown as Record<string, unknown>,
    clinicianJoinToken: clinicianRes.Attendee?.JoinToken || '',
    clinicianAttendeeId: clinicianRes.Attendee?.AttendeeId || '',
    patientAttendee: patientRes.Attendee as unknown as Record<string, unknown>,
    patientJoinToken: patientRes.Attendee?.JoinToken || '',
    patientAttendeeId: patientRes.Attendee?.AttendeeId || '',
    pipelineId,
    demoMode: false,
  };
}

/**
 * Creates an additional Attendee on demand for a Chime meeting.
 */
export async function createChimeAttendee(input: {
  meetingId: string;
  externalUserId: string;
  canShareScreen?: boolean;
}): Promise<{
  attendee: Record<string, unknown>;
  attendeeId: string;
  joinToken: string;
  demoMode: boolean;
}> {
  if (DEMO_MODE || input.meetingId.startsWith('demo-meeting-') || input.meetingId.startsWith('demo-chime-')) {
    const attendeeId = `demo-attendee-${uuidv4().slice(0, 8)}`;
    const joinToken = `demo-join-${uuidv4()}`;
    return {
      attendee: {
        AttendeeId: attendeeId,
        ExternalUserId: input.externalUserId.slice(0, 64),
        JoinToken: joinToken,
      },
      attendeeId,
      joinToken,
      demoMode: true,
    };
  }

  const client = getMeetingsClient();
  const attendeeRes = await client.send(
    new CreateAttendeeCommand({
      MeetingId: input.meetingId,
      ExternalUserId: input.externalUserId.slice(0, 64),
      Capabilities: {
        Audio: 'SendReceive',
        Video: 'SendReceive',
        Content: input.canShareScreen ? 'SendReceive' : 'None',
      },
    })
  );

  const attendee = attendeeRes.Attendee;
  if (!attendee?.JoinToken || !attendee?.AttendeeId) {
    throw new Error('Chime CreateAttendeeCommand returned invalid Attendee object');
  }

  return {
    attendee: attendee as unknown as Record<string, unknown>,
    attendeeId: attendee.AttendeeId,
    joinToken: attendee.JoinToken,
    demoMode: false,
  };
}

/**
 * Terminates meeting and capture pipeline on Amazon Chime.
 */
export async function endChimeMeeting(meetingId: string, pipelineId?: string | null): Promise<void> {
  if (DEMO_MODE || meetingId.startsWith('demo-meeting-') || meetingId.startsWith('demo-chime-')) {
    return;
  }

  // 1. Delete Media Pipeline if active
  if (pipelineId && !pipelineId.startsWith('demo-pipeline-')) {
    try {
      const pipelinesClient = getPipelinesClient();
      await pipelinesClient.send(
        new DeleteMediaCapturePipelineCommand({
          MediaPipelineId: pipelineId,
        })
      );
    } catch (err) {
      console.warn('[chime] delete pipeline failed:', err);
    }
  }

  // 2. Delete Chime Meeting
  try {
    const meetingsClient = getMeetingsClient();
    await meetingsClient.send(
      new DeleteMeetingCommand({
        MeetingId: meetingId,
      })
    );
  } catch (err) {
    console.warn('[chime] delete meeting failed:', err);
  }
}
