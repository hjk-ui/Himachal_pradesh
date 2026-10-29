/**
 * Proposed "typo fix only" versions of the practice's sections (review note 8). Each is built
 * mechanically from the practice's version 1 by replacing ONLY the exact strings listed below, so
 * the reviewer can see every change. Status Draft until the owner approves; activating one retires
 * version 1 without requiring clients to re-sign (editorial change).
 */
import type { ConsentTemplateVersion, TemplateBlock, TemplateCheckbox } from './types';
import { PRACTICE_PACKET_V1 } from './practicePacket';
import { PROPOSED_FLAG } from './proposed';

export const TYPO_FIXES: Record<string, [from: string, to: string][]> = {
  'program-orientation': [['Psychiatric Rehabilitation Program (PRP', 'Psychiatric Rehabilitation Program (PRP)'], ['honestly ethically', 'honestly, ethically']],
  'duty-to-warn': [['animminent', 'an imminent']],
  'abuse-neglect-reporting': [['Maryland Statues', 'Maryland Statutes']],
  'program-rules': [['We serves', 'We serve'], ['keep us a safe', 'keep this a safe']],
  reinstatement: [['thereason', 'the reason']],
  'facility-orientation': [['We posts', 'We post']],
  'informed-consent-treatment': [
    ['foreducation', 'for education'],
    ['developmentand', 'development and'],
    ['thecommunity', 'the community'],
    ['participatein', 'participate in'],
  ],
};

function fix(text: string, pairs: [string, string][]): string {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

function fixBlock(b: TemplateBlock, pairs: [string, string][]): TemplateBlock {
  switch (b.kind) {
    case 'ul':
    case 'ol':
      return { ...b, items: b.items.map((i) => fix(i, pairs)) };
    case 'lead':
      return { ...b, text: fix(b.text, pairs) };
    default:
      return { ...b, text: fix(b.text, pairs) };
  }
}

/** The pairs actually applied to a template (a listed typo that does not occur is a bug, see tests). */
export function appliedTypoFixes(key: string): [string, string][] {
  const v1 = PRACTICE_PACKET_V1.find((t) => t.key === key);
  if (!v1) return [];
  const all = JSON.stringify(v1.blocks) + JSON.stringify(v1.checkboxes ?? []);
  return (TYPO_FIXES[key] ?? []).filter(([from]) => all.includes(from));
}

export const TYPO_FIX_TEMPLATES: ConsentTemplateVersion[] = Object.entries(TYPO_FIXES).map(([key, pairs]) => {
  const v1 = PRACTICE_PACKET_V1.find((t) => t.key === key);
  if (!v1) throw new Error(`typo fix for unknown template ${key}`);
  return {
    ...v1,
    version: 2,
    origin: 'proposed_typo_fix' as const,
    defaultStatus: 'DRAFT' as const,
    source: `${v1.source}; typos corrected (review note 8)`,
    blocks: v1.blocks.map((b) => fixBlock(b, pairs)),
    checkboxes: v1.checkboxes?.map((c): TemplateCheckbox => ({ ...c, label: fix(c.label, pairs) })),
    changeNote: `Typo corrections only: ${pairs.map(([a, b]) => `"${a}" → "${b}"`).join('; ')}.`,
    reviewFlags: [PROPOSED_FLAG, ...v1.reviewFlags.filter((f) => f.note !== '8')],
    resignOnNewVersion: false,
  };
});
