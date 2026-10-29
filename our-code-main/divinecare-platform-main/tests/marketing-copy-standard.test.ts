import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BAA_LEGAL_REVIEWED } from '../src/lib/legal/baa';
import {
  COMMUNITY_MODULE_LABEL,
  DEFAULT_TITLE,
  HERO,
  HOME_TITLE,
  PARTNER_STRIP_H2,
  PARTNER_TRADEMARK,
  PRICING_TITLE,
} from '../src/lib/marketing/homeContent';

const root = join(process.cwd());
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('marketing-copy-standard', () => {
  it('titles and hero are behavioral health EHR (not CRM product)', () => {
    assert.equal(DEFAULT_TITLE, 'Altrixs | Behavioral Health EHR');
    assert.match(HOME_TITLE, /Behavioral Health EHR/);
    assert.equal(HERO.kicker, 'Behavioral health EHR');
    assert.match(HERO.headline, /behavioral health EHR with primary care/);
    assert.equal(HERO.primaryCta.label, 'Start free trial');
    assert.equal(HERO.secondaryCta.label, 'Request a demo');
    assert.equal(PRICING_TITLE, 'Pricing | Altrixs Behavioral Health EHR');
    assert.equal(COMMUNITY_MODULE_LABEL, 'Community and outreach CRM');
  });

  it('public pages never call the product a CRM or name competitor EHRs', () => {
    const files = [
      'src/components/marketing/HomePage.tsx',
      'src/app/get-started/page.tsx',
      'src/app/pricing/page.tsx',
      'src/lib/marketing/homeContent.ts',
    ];
    const banned = /\b(Valant|SimplePractice|TherapyNotes|TheraNest|clinic CRM|Clinic Operations CRM)\b/i;
    for (const f of files) {
      const src = read(f);
      assert.equal(banned.test(src), false, f);
      const crmHits = [...src.matchAll(/\bCRM\b/g)];
      for (const hit of crmHits) {
        const idx = hit.index || 0;
        const window = src.slice(Math.max(0, idx - 48), idx + 48);
        const allowed =
          /Community and outreach CRM/.test(window) ||
          /avoids CRM except/.test(window) ||
          /may use the word CRM/.test(window);
        assert.ok(allowed, `CRM outside module label in ${f}: ${window}`);
      }
    }
  });

  it('partner strip + trademark + no absolute HIPAA certified hype', () => {
    assert.equal(PARTNER_STRIP_H2, 'Integrated with');
    assert.match(PARTNER_TRADEMARK, /DrFirst, Rcopia, Waystar and AWS/);
    const home = read('src/components/marketing/HomePage.tsx');
    assert.equal(/HIPAA certified/i.test(home), false);
    assert.equal(BAA_LEGAL_REVIEWED, false);
    assert.equal(/BAA accepted online at sign-up/i.test(home), false);
  });
});
