/** Ingredient RxCUI used as the standard drug code on chart rows. */
const BY_NAME: Array<{ match: RegExp; rxnormId: string }> = [
  { match: /sertraline/i, rxnormId: '36437' },
  { match: /escitalopram/i, rxnormId: '321988' },
  { match: /fluoxetine/i, rxnormId: '4493' },
  { match: /bupropion/i, rxnormId: '42347' },
  { match: /venlafaxine/i, rxnormId: '39786' },
  { match: /duloxetine/i, rxnormId: '72625' },
  { match: /lithium/i, rxnormId: '6448' },
  { match: /valpro/i, rxnormId: '11118' },
  { match: /lamotrigine/i, rxnormId: '28439' },
  { match: /aripiprazole/i, rxnormId: '89013' },
  { match: /quetiapine/i, rxnormId: '51272' },
  { match: /risperidone/i, rxnormId: '35636' },
  { match: /olanzapine/i, rxnormId: '61381' },
  { match: /buprenorphine/i, rxnormId: '1819' },
  { match: /lorazepam/i, rxnormId: '6470' },
  { match: /clonazepam/i, rxnormId: '2598' },
  { match: /alprazolam/i, rxnormId: '596' },
  { match: /amphetamine|adderall/i, rxnormId: '725' },
  { match: /methylphenidate/i, rxnormId: '6901' },
  { match: /lisdexamfetamine/i, rxnormId: '700810' },
  { match: /prazosin/i, rxnormId: '8629' },
  { match: /naltrexone/i, rxnormId: '7243' },
  { match: /penicillin/i, rxnormId: '7980' },
  { match: /sulfa/i, rxnormId: '10223' },
];

export function resolveDrugCode(name: string | null | undefined, explicit?: string | null) {
  const given = explicit?.trim();
  if (given && /^[A-Za-z0-9-]{3,20}$/.test(given)) return given;
  const found = BY_NAME.find((row) => row.match.test(name || ''));
  return found?.rxnormId ?? null;
}
