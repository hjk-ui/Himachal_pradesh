/**
 * E-Prescribe uploads the patient to Rcopia (demographics, ICD-10 problems, allergies, medications)
 * before opening it (GM10 / PDUM4 / DURM3 / AUM4 / MUM6). DRFIRST_REGISTER_ON_LAUNCH:
 *   'true'          every patient (production, after the cutover)
 *   'non_imported'  only patients created in Altrixs (no importedAt / sourcePlatform): staging, which
 *                   talks to DrFirst's test system and must not receive the imported (real) Valant patients
 *   unset / other   off
 */
export function registerOnLaunchEnabled(client?: { importedAt?: Date | null; sourcePlatform?: string | null }) {
  const mode = process.env.DRFIRST_REGISTER_ON_LAUNCH?.trim();
  if (mode === 'true') return true;
  if (mode === 'non_imported') return Boolean(client) && !client!.importedAt && !client!.sourcePlatform?.trim();
  return false;
}
