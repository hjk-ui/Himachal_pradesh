import type { TelehealthPlatform } from '@prisma/client';
import { createGoogleMeet, isGoogleMeetConfigured } from '@/lib/telehealth/googleMeet';
import { createZoomMeeting, isZoomConfigured } from '@/lib/telehealth/zoom';

export type ProvisionedMeeting = {
  roomId: string;
  joinUrl: string;
  hostUrl?: string;
};

export function isRealJoinUrl(platform: TelehealthPlatform, url: string | null | undefined) {
  if (!url) return false;
  if (platform === 'ZOOM') {
    return /zoom\.us\/j\//i.test(url);
  }
  if (platform === 'GOOGLE') {
    return /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(url);
  }
  return false;
}

export async function provisionTelehealthMeeting(input: {
  platform: TelehealthPlatform;
  topic: string;
  startAt: Date;
  durationMin: number;
}): Promise<ProvisionedMeeting> {
  if (input.platform === 'ZOOM') {
    if (!isZoomConfigured()) {
      throw new Error('Zoom is not configured');
    }
    const meeting = await createZoomMeeting({
      topic: input.topic,
      startAt: input.startAt,
      durationMin: input.durationMin,
    });
    return {
      roomId: meeting.meetingId,
      joinUrl: meeting.joinUrl,
      hostUrl: meeting.startUrl,
    };
  }

  if (input.platform === 'GOOGLE') {
    if (!(await isGoogleMeetConfigured())) {
      throw new Error('Google Meet not configured');
    }
    const meeting = await createGoogleMeet({
      topic: input.topic,
      startAt: input.startAt,
      durationMin: input.durationMin,
    });
    return {
      roomId: meeting.eventId,
      joinUrl: meeting.joinUrl,
    };
  }

  throw new Error('Choose Zoom or Google Meet. Doxy.me and Teams are not available for outbound links.');
}

export function sessionStartAt(sessionDateYmd: string, startTime: string) {
  const start = new Date(`${sessionDateYmd}T${startTime}:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid date or time');
  }
  return start;
}
