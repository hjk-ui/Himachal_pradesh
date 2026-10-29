import { z } from 'zod';

const daySchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const practiceSetupSchema = z.object({
  practiceName: z.string().trim().min(2).max(120),
  practiceTagline: z.string().trim().max(200).optional().default(''),
  practiceAddress: z.string().trim().max(240).optional().default(''),
  practiceCity: z.string().trim().max(120).optional().default(''),
  practiceState: z.string().trim().max(2).optional().default('MD'),
  practiceZip: z.string().trim().max(12).optional().default(''),
  practicePhone: z.string().trim().regex(/^[0-9()+\-\s.]{7,24}$/),
  practiceWebsite: z.string().trim().url().or(z.literal('')).default(''),
  practiceBio: z.string().trim().max(1500).optional().default(''),
  fullName: z.string().trim().min(2).max(120),
  npi: z.string().trim().regex(/^\d{10}$/),
  caqhId: z.string().trim().max(40).optional().default(''),
  licenseNumber: z.string().trim().min(2).max(80),
  licenseType: z.string().trim().min(1).max(20),
  licenseState: z.string().trim().length(2),
  licenseExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  services: z
    .array(
      z.object({
        serviceId: z.string().min(1),
        name: z.string().trim().min(2).max(120),
        duration: z.number().int().min(15).max(180),
        fee: z.number().min(0).max(5000),
        description: z.string().trim().max(500),
        active: z.boolean().optional(),
      })
    )
    .min(1),
  acceptsInsurance: z.boolean(),
  acceptedPayers: z.array(z.string().trim().min(1).max(120)),
  selfPayRate: z.number().min(0).max(5000),
  acceptsSelfPay: z.boolean().optional().default(true),
  slidingScale: z.boolean().optional().default(false),
  slidingScaleMin: z.number().min(0).max(5000).optional().default(0),
  slidingScaleMax: z.number().min(0).max(5000).optional().default(0),
  slidingScalePolicy: z.string().trim().max(1000),
  availability: z.object({
    Mon: daySchema,
    Tue: daySchema,
    Wed: daySchema,
    Thu: daySchema,
    Fri: daySchema,
    Sat: daySchema,
    Sun: daySchema,
  }),
  bufferMinutes: z.number().int().min(0).max(120),
  leadTimeHours: z.number().int().min(0).max(168).optional().default(24),
  bookingWindowDays: z.number().int().min(1).max(365),
  requireCreditCard: z.boolean(),
  cancellationPolicy: z.enum(['24 hours', '48 hours', '72 hours', 'No cancellation policy']),
  remindersNote: z.string().trim().max(1000).optional().default(''),
});

export function hasDuplicateServices(services: { name: string }[]) {
  const names = services.map((service) => service.name.trim().toLowerCase());
  return new Set(names).size !== names.length;
}
