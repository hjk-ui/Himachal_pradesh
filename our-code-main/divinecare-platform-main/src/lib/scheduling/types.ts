import { z } from 'zod';

export const BOOKABLE_SERVICES = [
  {
    id: 'new_client_intake',
    title: 'New Client Intake',
    durationMin: 60,
    durationLabel: '60 min',
    telehealth: true,
    inPerson: true,
    enabled: true,
  },
  {
    id: 'individual_therapy',
    title: 'Individual Therapy',
    durationMin: 50,
    durationLabel: '45–60 min',
    telehealth: true,
    inPerson: true,
    enabled: true,
  },
  {
    id: 'psych_eval',
    title: 'Psychiatric Evaluation',
    durationMin: 75,
    durationLabel: '60–90 min',
    telehealth: true,
    inPerson: true,
    enabled: true,
  },
  {
    id: 'med_management',
    title: 'Medication Management',
    durationMin: 20,
    durationLabel: '15–30 min',
    telehealth: true,
    inPerson: true,
    enabled: true,
  },
  {
    id: 'telehealth_session',
    title: 'Telehealth Session',
    durationMin: 45,
    durationLabel: '45 min',
    telehealth: true,
    inPerson: false,
    enabled: true,
  },
  {
    id: 'group_therapy',
    title: 'Group Therapy',
    durationMin: 60,
    durationLabel: '60 min',
    telehealth: false,
    inPerson: true,
    enabled: true,
  },
] as const;

export type BookableServiceId = (typeof BOOKABLE_SERVICES)[number]['id'];

export type DayHours = {
  enabled: boolean;
  start: string;
  end: string;
};

export type SchedulingSettingsShape = {
  practiceName: string | null;
  practiceCity: string;
  contactPhone: string | null;
  contactEmail: string | null;
  services: Array<{
    id: string;
    title: string;
    durationMin: number;
    durationLabel: string;
    telehealth: boolean;
    inPerson: boolean;
    enabled: boolean;
  }>;
  hours: Record<string, DayHours>;
  bufferMinutes: number;
  bookAheadDays: number;
  minNoticeDays: number;
  rules: {
    requireInsurance: boolean;
    newClientsOnly: boolean;
  };
  embed: {
    color: string;
    mode: 'iframe' | 'button' | 'modal';
  };
  reminders: {
    emailConfirm: boolean;
    smsConfirm: boolean;
    emailReminder24h: boolean;
    smsReminder24h: boolean;
    smsReminder2h: boolean;
  };
};

const DEFAULT_HOURS: Record<string, DayHours> = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '13:00' },
  sun: { enabled: false, start: '09:00', end: '13:00' },
};

export function defaultSchedulingSettings(orgName?: string | null): SchedulingSettingsShape {
  return {
    practiceName: orgName ?? null,
    practiceCity: 'Baltimore',
    contactPhone: null,
    contactEmail: null,
    services: BOOKABLE_SERVICES.map((s) => ({ ...s })),
    hours: { ...DEFAULT_HOURS },
    bufferMinutes: 15,
    bookAheadDays: 30,
    minNoticeDays: 1,
    rules: {
      requireInsurance: false,
      newClientsOnly: false,
    },
    embed: {
      color: '#5C2D91',
      mode: 'iframe',
    },
    reminders: {
      emailConfirm: true,
      smsConfirm: false,
      emailReminder24h: true,
      smsReminder24h: false,
      smsReminder2h: false,
    },
  };
}

export const schedulingSettingsPutSchema = z.object({
  practiceName: z.string().nullable().optional(),
  practiceCity: z.string().min(1).optional(),
  contactPhone: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  services: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        durationMin: z.number().int().positive(),
        durationLabel: z.string(),
        telehealth: z.boolean(),
        inPerson: z.boolean(),
        enabled: z.boolean(),
      })
    )
    .optional(),
  hours: z
    .record(z.string(), z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }))
    .optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  bookAheadDays: z.number().int().min(1).max(180).optional(),
  minNoticeDays: z.number().int().min(0).max(14).optional(),
  rules: z
    .object({
      requireInsurance: z.boolean(),
      newClientsOnly: z.boolean(),
    })
    .optional(),
  embed: z
    .object({
      color: z.string(),
      mode: z.enum(['iframe', 'button', 'modal']),
    })
    .optional(),
  reminders: z
    .object({
      emailConfirm: z.boolean(),
      smsConfirm: z.boolean(),
      emailReminder24h: z.boolean(),
      smsReminder24h: z.boolean(),
      smsReminder2h: z.boolean(),
    })
    .optional(),
});

export const bookSchema = z.object({
  organizationId: z.string().min(1).optional(),
  organizationSlug: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  modality: z.enum(['telehealth', 'in_person']),
  providerId: z.string().nullable().optional(),
  startsAt: z.string().datetime(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().min(4),
  phone: z.string().min(7),
  email: z.string().email(),
  insurance: z.string().optional(),
  memberId: z.string().optional(),
  notes: z.string().optional(),
  hipaaConsent: z.literal(true),
});
