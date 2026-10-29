export interface MedicalClaimLine {
  id: string;
  cptCode: string;
  modifiers: string[];
  description: string;
  fee: number;
}

export interface MedicalClaimInput {
  id: string;
  patientId: string;
  patientName: string;
  payerId: string;
  secondaryPayerId?: string | null;
  dos: string; // YYYY-MM-DD
  location: 'Office' | 'Telehealth' | 'Facility';
  renderingProviderRole: 'Physician' | 'Nurse Practitioner' | 'Intern' | 'Resident' | 'Therapist';
  renderingProviderNpi: string;
  supervisingPhysicianNpi?: string | null;
  box24JNpi?: string | null;
  lines: MedicalClaimLine[];
  mspReviewRequired?: boolean;
}

export interface BillingRuleScrubberItem {
  id: string;
  name: string;
  ruleType: string;
  trigger: string;
  action: string;
  payers: string[];
  active: boolean;
  priority: number;
}

export interface PayerScrubberItem {
  payerId: string;
  name: string;
  shortName: string;
  payerType: string; // 'Medicare' | 'Medicaid' | 'Commercial' | 'Self-Pay'
  timely: number; // in days
  electronicSubmission: boolean;
}

export interface ScrubberResult {
  clean: boolean;
  modifiedClaim: MedicalClaimInput;
  warnings: string[];
  errors: string[];
  appliedRules: Array<{ priority: number; ruleName: string; details: string }>;
}

export function isRuleApplicableToPayer(rule: BillingRuleScrubberItem, payer: PayerScrubberItem | undefined): boolean {
  if (!payer) return true;
  if (!rule.payers || rule.payers.length === 0 || rule.payers.includes('All')) return true;
  if (rule.payers.includes(payer.payerId)) return true;
  if (rule.payers.includes('All except Medicaid') && payer.payerType !== 'Medicaid') return true;
  return false;
}

/**
 * Priority-driven automated claim scrubber engine.
 * Evaluates active rules in priority order (1 -> N).
 */
export function scrubMedicalClaim(
  claim: MedicalClaimInput,
  rules: BillingRuleScrubberItem[],
  payers: PayerScrubberItem[]
): ScrubberResult {
  const clonedClaim: MedicalClaimInput = JSON.parse(JSON.stringify(claim));
  const payer = payers.find((p) => p.payerId === clonedClaim.payerId);
  const activeRules = [...rules]
    .filter((r) => r.active && isRuleApplicableToPayer(r, payer))
    .sort((a, b) => a.priority - b.priority);

  const warnings: string[] = [];
  const errors: string[] = [];
  const appliedRules: Array<{ priority: number; ruleName: string; details: string }> = [];

  for (const rule of activeRules) {
    switch (rule.ruleType) {
      case 'supervisor_npi': {
        // Trigger: Rendering provider is intern or resident
        if (
          clonedClaim.renderingProviderRole === 'Intern' ||
          clonedClaim.renderingProviderRole === 'Resident'
        ) {
          if (!clonedClaim.supervisingPhysicianNpi) {
            errors.push('Supervising physician NPI is required for Intern / Resident rendering provider (Box 24J).');
          } else {
            clonedClaim.box24JNpi = clonedClaim.supervisingPhysicianNpi;
            appliedRules.push({
              priority: rule.priority,
              ruleName: rule.name,
              details: `Auto-populated Box 24J with supervising NPI (${clonedClaim.supervisingPhysicianNpi}).`,
            });
          }
        }
        break;
      }

      case 'telehealth_modifier': {
        if (clonedClaim.location === 'Telehealth') {
          const isMedicaid = payer?.payerType === 'Medicaid' || payer?.payerId === '77013';
          const neededModifier = isMedicaid ? 'GT' : '95';

          let modifiedAny = false;
          for (const line of clonedClaim.lines) {
            if (!line.modifiers.includes(neededModifier)) {
              line.modifiers.push(neededModifier);
              modifiedAny = true;
            }
          }
          if (modifiedAny) {
            appliedRules.push({
              priority: rule.priority,
              ruleName: rule.name,
              details: `Appended modifier -${neededModifier} to telehealth procedure lines.`,
            });
          }
        }
        break;
      }

      case 'modifier_auto': {
        // Preventive (99381-99397) + E&M (99202-99215) on same DOS
        const hasPreventive = clonedClaim.lines.some((l) => {
          const code = parseInt(l.cptCode, 10);
          return code >= 99381 && code <= 99397;
        });
        const emLine = clonedClaim.lines.find((l) => {
          const code = parseInt(l.cptCode, 10);
          return code >= 99202 && code <= 99215;
        });

        if (hasPreventive && emLine) {
          if (!emLine.modifiers.includes('25')) {
            emLine.modifiers.push('25');
            appliedRules.push({
              priority: rule.priority,
              ruleName: rule.name,
              details: `Auto-attached modifier -25 to E&M code (${emLine.cptCode}) to prevent bundling rejection.`,
            });
          }
        }
        break;
      }

      case 'payer_specific': {
        // Medicare Secondary Payer (MSP) Check: Primary = Medicare and secondary on file
        const isMedicare = payer?.payerType === 'Medicare' || payer?.payerId === '00840';
        if (isMedicare && clonedClaim.secondaryPayerId) {
          clonedClaim.mspReviewRequired = true;
          warnings.push('MSP Review Required: Patient has Medicare primary with secondary insurance on file.');
          appliedRules.push({
            priority: rule.priority,
            ruleName: rule.name,
            details: 'Flagged claim as MSP review required before submission.',
          });
        }
        break;
      }

      case 'custom': {
        // Timely filing warning check: DOS + timely filing limit <= 30 days remaining
        if (payer && payer.timely > 0) {
          const dosTime = new Date(clonedClaim.dos).getTime();
          if (!isNaN(dosTime)) {
            const filingDeadline = dosTime + payer.timely * 24 * 60 * 60 * 1000;
            const now = Date.now();
            const daysRemaining = Math.round((filingDeadline - now) / (24 * 60 * 60 * 1000));

            if (daysRemaining <= 30) {
              const warningText =
                daysRemaining <= 0
                  ? `Timely filing expired (${Math.abs(daysRemaining)} days past deadline of ${payer.timely} days).`
                  : `Approaching timely filing limit (${daysRemaining} days remaining of ${payer.timely} days).`;
              warnings.push(warningText);
              appliedRules.push({
                priority: rule.priority,
                ruleName: rule.name,
                details: warningText,
              });
            }
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return {
    clean: errors.length === 0,
    modifiedClaim: clonedClaim,
    warnings,
    errors,
    appliedRules,
  };
}
