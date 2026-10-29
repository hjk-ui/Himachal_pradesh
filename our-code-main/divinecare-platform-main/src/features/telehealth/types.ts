export type TeleSessionStatus = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';
export type TelePlatform = 'zoom' | 'doxy' | 'google' | 'teams' | 'phone';

export interface TelehealthSession {
  id: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  clinicianName: string | null;
  type: string;
  sessionDate: string;
  startTime: string;
  durationMin: number;
  status: TeleSessionStatus;
  platform: TelePlatform;
  roomId: string | null;
  joinUrl: string | null;
  hostUrl?: string | null;
  source?: 'session' | 'appointment';
  riskLevel: 'high' | 'medium' | 'low';
  rating: number | null;
  notesSummary: string | null;
}

export interface TelehealthStats {
  sessionsToday: number;
  sessionsWeek: number;
  avgDuration: number;
  satisfaction: number | null;
}

export interface TelehealthSettings {
  defaultPlatform: TelePlatform;
  reminderMinutes: number;
  recordingMode: string;
  autoSendLinkMinutes: number;
  waitingRoom: boolean;
  platforms: {
    zoom: boolean;
    doxy: boolean;
    google: boolean;
    teams: boolean;
    phone: boolean;
  };
  zoomConfigured?: boolean;
  googleMeetConfigured?: boolean;
}

export interface CreateSessionInput {
  clientId: string;
  type: string;
  platform: 'zoom' | 'google' | 'phone';
  sessionDate: string;
  startTime: string;
  durationMin?: number;
  clinicianId?: string | null;
  extraNotes?: string | null;
  emailClient?: boolean;
}
