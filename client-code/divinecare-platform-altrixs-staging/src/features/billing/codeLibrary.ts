import { MODIFIER_CODES, POS_CODES } from '@/lib/constants/cpt';

/** Legacy tuple shape used by older widgets — sourced from shared catalog. */
export const BILLING_MODIFIERS = MODIFIER_CODES.map(
  (m) => [m.modifier, m.desc] as const
);

export const PLACE_OF_SERVICE = POS_CODES.map((p) => [p.pos, p.desc] as const);

export { MODIFIER_CODES, POS_CODES };
