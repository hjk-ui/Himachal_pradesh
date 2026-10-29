import { z } from 'zod';

const positive = (max: number) => z.coerce.number().positive().max(max);

/** Measured vitals; every value is required so nothing is defaulted or invented. */
export const vitalsSchema = z.object({
  systolic: positive(300),
  diastolic: positive(250),
  heartRate: positive(300),
  respRate: positive(100),
  temperatureF: positive(115),
  heightInches: positive(120),
  weightLbs: positive(1500),
  oxygenSat: positive(100),
});

export type VitalsInput = z.infer<typeof vitalsSchema>;

function bmiFrom(weightLbs: number, heightInches: number) {
  if (!weightLbs || !heightInches) return null;
  return Math.round(((weightLbs / (heightInches * heightInches)) * 703) * 10) / 10;
}

/** Column payload for MedicalVital (the model keeps legacy duplicate columns; write both). */
export function vitalColumns(v: VitalsInput) {
  const systolic = Math.round(v.systolic);
  const diastolic = Math.round(v.diastolic);
  const heartRate = Math.round(v.heartRate);
  const respRate = Math.round(v.respRate);
  const spO2 = Math.round(v.oxygenSat);
  return {
    systolic,
    bpSystolic: systolic,
    diastolic,
    bpDiastolic: diastolic,
    heartRate,
    respiratoryRate: respRate,
    respRate,
    temperature: v.temperatureF,
    spO2,
    o2Sat: spO2,
    weightLbs: v.weightLbs,
    heightInches: v.heightInches,
    bmi: bmiFrom(v.weightLbs, v.heightInches),
  };
}
