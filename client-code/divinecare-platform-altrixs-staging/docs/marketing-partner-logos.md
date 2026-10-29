# Partner logos on the public site

The homepage and `/pricing` show an "Integrated with" strip (`src/components/marketing/PartnerStrip.tsx`)
for our live integration partners, configured in `src/components/marketing/partners.ts`:

| key | Partner | Role shown |
|---|---|---|
| `drfirst` | DrFirst (Rcopia) | e-prescribing & EPCS |
| `waystar` | Waystar | claims & remittance |
| `aws` | Amazon Web Services | hosting & AI, under a BAA |

By default every partner renders as a plain **text wordmark** (name + one-line role). No partner
logo is downloaded, copied from a partner website, or embedded in the repo.

## Before adding a logo: get written permission

Partner names and logos are trademarks. Use a logo only after the partner has approved it in
writing and only in the form their brand guidelines allow.

- **AWS**: apply through the AWS Partner Network for the "Powered by AWS" co-marketing badge and
  follow the AWS co-marketing / trademark guidelines. Use the badge artwork AWS provides, not the
  Amazon or AWS corporate logo.
- **DrFirst**: request approval and logo files from our DrFirst partner manager, with their brand
  guidelines (logo, clear space, the Rcopia name).
- **Waystar**: request approval and logo files from our Waystar partner manager, with their brand
  guidelines.

Keep each approval (email or signed co-marketing terms) with the vendor contract.

## Adding an approved logo

1. Save the approved file, unmodified, as `public/partners/<key>.svg` (preferred) or
   `public/partners/<key>.png` (at least 2x the display size: the strip shows logos at 144 x 32 px).
2. In `src/components/marketing/partners.ts`, set that partner's `logo` to the path, e.g.
   `logo: '/partners/drfirst.svg'`. Check `logoAlt` matches the guidelines (for AWS: "Powered by AWS").
3. Run `npx tsx --test tests/marketing-copy-standard.test.ts`. It fails if a `logo` path has no
   file under `public/`, or a path is not `/partners/<key>.svg|png`.

The footer line "DrFirst, Rcopia, Waystar and AWS are trademarks of their respective owners."
(`PARTNER_TRADEMARK_LINE`) stays on the homepage, `/pricing` and the legal/support pages whether
logos are shown or not. If a partner is added or removed, update that line too.

To remove a logo, set `logo` back to `null` (the text wordmark returns) and delete the file.
