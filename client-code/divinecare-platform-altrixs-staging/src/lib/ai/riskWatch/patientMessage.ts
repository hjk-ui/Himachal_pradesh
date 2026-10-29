/**
 * Patient-message entry point for the risk language watch. Import-safe: only the pure rule engine
 * loads with the module; the server pipeline (database, Bedrock, audit) is imported lazily, so the
 * patient message code path never pulls server-only modules at load time. If the pipeline cannot
 * load or fails, the rule result alone decides the crisis-resource payload.
 */
import { scanRiskText } from './engine';
import { patientSafetyPayload, type PatientSafetyPayload } from './crisisResources';

export async function patientMessageSafety(input: {
  organizationId: string;
  clientId: string;
  threadId: string;
  messageId: string;
  text: string;
}): Promise<PatientSafetyPayload | null> {
  try {
    const { watchPatientMessage } = await import('./hooks');
    return await watchPatientMessage(input);
  } catch {
    const sev = scanRiskText(input.text, 'patient_message').severity;
    return sev === 'high' || sev === 'medium' ? patientSafetyPayload(sev) : null;
  }
}
