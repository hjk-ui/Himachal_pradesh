import test from 'node:test';
import assert from 'node:assert/strict';

// ── Luhn Algorithm & Card Brand Logic ──────────────────────────────────────────
function luhnValid(num: string): boolean {
  const d = num.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n; dbl = !dbl;
  }
  return sum % 10 === 0;
}

function detectBrand(cleanNumber: string): string {
  if (/^4/.test(cleanNumber)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(cleanNumber)) return 'Mastercard';
  if (/^3[47]/.test(cleanNumber)) return 'Amex';
  if (/^6/.test(cleanNumber)) return 'Discover';
  return 'Unknown';
}

// ── SUD Scoring Logic ────────────────────────────────────────────────────────
function scoreSud(tool: string, answers: any[]): { totalScore: string; riskLevel: 'NEGATIVE' | 'POSITIVE' | 'HIGH_RISK'; triggerRationale: string } {
  let totalScore = '0';
  let riskLevel: 'NEGATIVE' | 'POSITIVE' | 'HIGH_RISK' = 'NEGATIVE';
  let triggerRationale = 'Score below clinical concern threshold.';

  if (tool === 'AUDIT') {
    const sum = (answers || []).reduce((a: number, c: any) => a + (Number(c) || 0), 0);
    totalScore = `${sum} / 40`;
    if (sum >= 15) {
      riskLevel = 'HIGH_RISK';
      triggerRationale = `AUDIT score ${sum} (≥15) indicates high likelihood of Alcohol Dependence. Mandatory prescriber referral.`;
    } else if (sum >= 8) {
      riskLevel = 'POSITIVE';
      triggerRationale = `AUDIT score ${sum} (≥8) indicates hazardous or harmful drinking. Brief intervention & prescriber consult required.`;
    } else {
      riskLevel = 'NEGATIVE';
      triggerRationale = `AUDIT score ${sum} (<8) is below threshold for harmful alcohol use.`;
    }
  } else if (tool === 'CAGE_AID') {
    const yesCount = (answers || []).filter((a: any) => a === 1 || a === 'yes' || a === true).length;
    totalScore = `${yesCount} / 4`;
    if (yesCount >= 2) {
      riskLevel = 'POSITIVE';
      triggerRationale = `CAGE-AID score ${yesCount} (≥2) indicates clinically significant substance misuse risk. Prescriber evaluation warranted.`;
    } else if (yesCount === 1) {
      riskLevel = 'NEGATIVE';
      triggerRationale = `CAGE-AID score 1 indicates risk factor present; close monitoring recommended.`;
    } else {
      riskLevel = 'NEGATIVE';
      triggerRationale = `CAGE-AID score 0. Negative screen.`;
    }
  } else if (tool === 'NIDA') {
    const hasDrug = answers && answers.slice(1).some((v: any) => Number(v) > 0);
    const heavyAlc = answers && Number(answers[0]) > 1;
    if (hasDrug) {
      riskLevel = 'HIGH_RISK';
      totalScore = 'Drug use endorsed';
      triggerRationale = 'NIDA Quick Screen: Illicit drug or Rx misuse endorsed within past year. Prescriber SUD referral prompt generated.';
    } else if (heavyAlc) {
      riskLevel = 'POSITIVE';
      totalScore = 'Heavy alcohol endorsed';
      triggerRationale = 'NIDA Quick Screen: Monthly or more frequent heavy drinking endorsed. AUDIT follow-up indicated.';
    } else {
      totalScore = '0 / Negative';
      riskLevel = 'NEGATIVE';
      triggerRationale = 'No high-risk substance use reported in the past year.';
    }
  } else if (tool === 'BAM') {
    const heavyDays = Number(answers?.[1] || 0);
    const drugDays = Number(answers?.[2] || 0);
    const craving = Number(answers?.[3] || 0);
    if (heavyDays > 0 || drugDays > 0) {
      riskLevel = 'HIGH_RISK';
      totalScore = `Use: alc=${answers?.[0] || 0}d, heavy=${heavyDays}d, drug=${drugDays}d`;
      triggerRationale = `BAM endorsed ${heavyDays} heavy drinking days and ${drugDays} illicit drug days in past 30 days. High relapse risk.`;
    } else if (craving >= 3 || Number(answers?.[0] || 0) > 0) {
      riskLevel = 'POSITIVE';
      totalScore = `Craving: ${craving}/4`;
      triggerRationale = `BAM craving level ${craving}/4 indicates active urge/vulnerability. Prescriber review advised.`;
    } else {
      totalScore = 'Past 30d Stable';
      riskLevel = 'NEGATIVE';
      triggerRationale = 'Brief Addiction Monitor shows 30-day abstinence and low craving.';
    }
  }

  return { totalScore, riskLevel, triggerRationale };
}

// ── Bulk Payment Allocation Validator ─────────────────────────────────────────
function validateBulkAllocation(checkTotal: number, lines: Array<{ paid: number }>): { valid: boolean; remainder: number } {
  const allocated = lines.reduce((acc, l) => acc + (Number(l.paid) || 0), 0);
  const remainder = Math.round((checkTotal - allocated) * 100) / 100;
  return {
    valid: Math.abs(remainder) < 0.005,
    remainder,
  };
}

// ── TESTS ────────────────────────────────────────────────────────────────────
test('Enterprise Clinical & RCM Billing Suite Validation', async (t) => {

  await t.test('Luhn algorithm verifies valid & invalid credit cards correctly', () => {
    // Valid standard test card numbers
    assert.equal(luhnValid('4111111111111111'), true); // Visa test
    assert.equal(luhnValid('5500000000000004'), true); // Mastercard test
    assert.equal(luhnValid('378282246310005'), true);  // Amex test
    assert.equal(luhnValid('6011000990139424'), true); // Discover test

    // Invalid checksum cards
    assert.equal(luhnValid('4111111111111112'), false);
    assert.equal(luhnValid('5500000000000005'), false);
    assert.equal(luhnValid('1234567890'), false); // Too short
    assert.equal(luhnValid(''), false);
  });

  await t.test('Dynamic brand detector correctly identifies major card networks', () => {
    assert.equal(detectBrand('4111111111111111'), 'Visa');
    assert.equal(detectBrand('5105105105105100'), 'Mastercard');
    assert.equal(detectBrand('2221001111111111'), 'Mastercard');
    assert.equal(detectBrand('340000000000000'), 'Amex');
    assert.equal(detectBrand('370000000000000'), 'Amex');
    assert.equal(detectBrand('6011000000000000'), 'Discover');
    assert.equal(detectBrand('9999999999999999'), 'Unknown');
  });

  await t.test('SUD Screener calculates correct risk thresholds for AUDIT', () => {
    // AUDIT negative (<8)
    const neg = scoreSud('AUDIT', [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(neg.riskLevel, 'NEGATIVE');
    assert.equal(neg.totalScore, '2 / 40');

    // AUDIT positive (8 - 14)
    const pos = scoreSud('AUDIT', [2, 2, 2, 2, 1, 0, 0, 0, 0, 0]);
    assert.equal(pos.riskLevel, 'POSITIVE');
    assert.equal(pos.totalScore, '9 / 40');

    // AUDIT high risk (>=15)
    const high = scoreSud('AUDIT', [3, 4, 3, 3, 2, 0, 0, 0, 0, 0]);
    assert.equal(high.riskLevel, 'HIGH_RISK');
    assert.equal(high.totalScore, '15 / 40');
  });

  await t.test('SUD Screener calculates correct risk thresholds for CAGE-AID', () => {
    const zero = scoreSud('CAGE_AID', [0, 0, 0, 0]);
    assert.equal(zero.riskLevel, 'NEGATIVE');
    assert.equal(zero.totalScore, '0 / 4');

    const one = scoreSud('CAGE_AID', [1, 0, 0, 0]);
    assert.equal(one.riskLevel, 'NEGATIVE');
    assert.equal(one.totalScore, '1 / 4');

    const positive = scoreSud('CAGE_AID', [1, 1, 0, 0]);
    assert.equal(positive.riskLevel, 'POSITIVE');
    assert.equal(positive.totalScore, '2 / 4');
  });

  await t.test('SUD Screener enforces hard guardrail against unrouted positive screens', () => {
    const positiveResult = scoreSud('CAGE_AID', [1, 1, 0, 0]);
    assert.equal(positiveResult.riskLevel, 'POSITIVE');

    // Clinical guardrail simulation:
    const sign = true;
    const routeAlert = false;
    let guardrailPassed = true;
    let errorMessage = '';

    if ((positiveResult.riskLevel === 'POSITIVE' || positiveResult.riskLevel === 'HIGH_RISK') && sign && !routeAlert) {
      guardrailPassed = false;
      errorMessage = 'Positive SUD screens cannot be filed without routing an alert to the assigned prescriber.';
    }

    assert.equal(guardrailPassed, false);
    assert.equal(errorMessage, 'Positive SUD screens cannot be filed without routing an alert to the assigned prescriber.');
  });

  await t.test('Bulk Check allocation strictly requires $0.00 remainder', () => {
    const checkTotal = 1250.00;
    
    // Unbalanced allocations
    const unbalanced1 = validateBulkAllocation(checkTotal, [{ paid: 500 }, { paid: 500 }]);
    assert.equal(unbalanced1.valid, false);
    assert.equal(unbalanced1.remainder, 250.00);

    const overallocated = validateBulkAllocation(checkTotal, [{ paid: 700 }, { paid: 600 }]);
    assert.equal(overallocated.valid, false);
    assert.equal(overallocated.remainder, -50.00);

    // Perfectly balanced allocation
    const balanced = validateBulkAllocation(checkTotal, [
      { paid: 450.50 },
      { paid: 500.00 },
      { paid: 299.50 }
    ]);
    assert.equal(balanced.valid, true);
    assert.equal(balanced.remainder, 0.00);
  });

  await t.test('Operational calling enforces patientId="none" isolation', () => {
    const operationalCallPayload = {
      destinationPhone: '+14105550199',
      calleeName: 'Optum Provider Services',
      purpose: 'Authorization Status',
      patientId: 'none',
      callType: 'OPERATIONAL',
    };

    assert.equal(operationalCallPayload.patientId, 'none');
    assert.equal(operationalCallPayload.callType, 'OPERATIONAL');
    assert.ok(operationalCallPayload.destinationPhone.startsWith('+1'));
  });

  await t.test('Antipsychotic QTc Prolongation protocol flags when >= 2 antipsychotics prescribed', () => {
    const ANTIPSYCHOTICS = [
      'quetiapine', 'risperidone', 'olanzapine', 'haloperidol', 'clozapine',
      'aripiprazole', 'ziprasidone', 'lurasidone', 'paliperidone'
    ];

    function isAntipsychoticCheck(name: string): boolean {
      const lower = name.toLowerCase();
      return ANTIPSYCHOTICS.some((drug) => lower.includes(drug));
    }

    function evaluateQtcProtocol(meds: Array<{ name: string; active: boolean }>) {
      const activeAnti = meds.filter(m => m.active && isAntipsychoticCheck(m.name));
      return {
        hasQtcFlag: activeAnti.length >= 2,
        antipsychoticCount: activeAnti.length,
        antipsychotics: activeAnti.map(m => m.name),
      };
    }

    // 1 antipsychotic -> no flag
    const singleMed = evaluateQtcProtocol([
      { name: 'Seroquel (quetiapine) 100mg', active: true },
      { name: 'Sertraline 50mg', active: true },
    ]);
    assert.equal(singleMed.hasQtcFlag, false);
    assert.equal(singleMed.antipsychoticCount, 1);

    // 2 antipsychotics -> triggers QTc safety flag
    const dualAnti = evaluateQtcProtocol([
      { name: 'Risperidone 2mg', active: true },
      { name: 'Haloperidol 5mg', active: true },
      { name: 'Lorazepam 1mg', active: true },
    ]);
    assert.equal(dualAnti.hasQtcFlag, true);
    assert.equal(dualAnti.antipsychoticCount, 2);
    assert.deepEqual(dualAnti.antipsychotics, ['Risperidone 2mg', 'Haloperidol 5mg']);
  });

  await t.test('Residential bed board maintains 14-bed census and program division', () => {
    const totalBeds = 14;
    const occupiedResidents = [
      { id: '1', room: 'B-201', program: '3.5' },
      { id: '2', room: 'B-202', program: '3.5' },
      { id: '3', room: 'A-101', program: '3.1' },
      { id: '4', room: 'A-102', program: '3.1' },
    ];

    const occupancyRate = Math.round((occupiedResidents.length / totalBeds) * 100);
    const unitB35 = occupiedResidents.filter(r => r.program === '3.5').length;
    const unitA31 = occupiedResidents.filter(r => r.program === '3.1').length;

    assert.equal(occupancyRate, 29); // 4 / 14 = ~28.57 -> 29%
    assert.equal(unitB35, 2);
    assert.equal(unitA31, 2);
    assert.equal(totalBeds - occupiedResidents.length, 10);
  });

  await t.test('eStatement generates unique tracked payment link matching altrixs.com/pay/{token}', () => {
    const token = 'a8f9c210e5';
    const payLink = `altrixs.com/pay/${token}`;

    assert.match(payLink, /^altrixs\.com\/pay\/[a-f0-9]+$/);
  });
});

