# UI audit: staff app and patient portal

Generated 2026-10-21 against the standard in `docs/design-system.md`. The machine-readable copy is `docs/ui-audit.json`.

## Method

- **Scope:** every `page.tsx` under `src/app/dashboard/**` (except `hr/**`, which is being rebuilt separately) and `src/app/patient/**`. That is 148 routes: 141 with UI, plus 7 redirects or aliases (listed at the end).
- **Static scan:** each page is scanned together with the page-owned components it imports (same-route files and `@/features/**`, two levels deep; `@/components/**` too for thin wrapper pages). Shared primitives are not counted against pages.
- **Checks:** emoji and glyph icons; missing or duplicate h1; tables without `<thead>` or a scroll wrapper; text under 11px; card radius, shadow and gradient drift; inline styles; hex and off-palette colours; low-contrast text classes; missing loading, error and empty states for fetched data; non-responsive grids and fixed widths; button colour sprawl; hand-rolled headers.
- **Severity:** issues are weighted (emoji 4; missing title or `<thead>` 3; heavy tiny text 3; colour, contrast, radius and state gaps 1–2; minor drift 0.5). A score of 9 or more is **high** (broken, inaccessible or very inconsistent), 4 or more is **medium**, and anything lower is **low**. Emoji, a missing title or a table without a header raise a page to at least medium.
- **Effort** comes from the scanned lines of code: S under 250 (<1h), M under 900 (2–4h), L under 2000 (half to one day), XL beyond that (1–2 days). It assumes the page moves onto the `@/components/ui` primitives with no behaviour change.
- **Limits:** this is a heuristic scan with spot checks, not a pixel review. Counts of colour classes include legitimate status uses that still need mapping to semantic tones. Contrast flags are class-based, so verify them in the browser.

## Summary by area

| Area | High | Medium | Low | Pages | Est. effort (h) |
|---|---:|---:|---:|---:|---:|
| Clinical/EHR | 8 | 26 | 11 | 45 | ~189 |
| Scheduling/Front office | 5 | 2 | 0 | 7 | ~48 |
| Programs | 4 | 11 | 0 | 15 | ~90 |
| Billing | 6 | 12 | 3 | 21 | ~88 |
| Admin/Settings | 1 | 6 | 4 | 11 | ~49 |
| Reports | 1 | 8 | 3 | 12 | ~45 |
| Community/Communications | 3 | 7 | 1 | 11 | ~66 |
| Primary care/Medical | 4 | 7 | 2 | 13 | ~72 |
| Patient portal | 0 | 1 | 5 | 6 | ~14 |
| **Total** | **32** | **80** | **29** | **141** | **~661** |

## Most common deviations

| Deviation | Pages affected |
|---|---:|
| Off-palette colour families | 129 |
| Custom page header markup | 123 |
| No shared primitives | 109 |
| Low-contrast text (slate/gray-300/400) | 102 |
| Hard-coded hex colours | 92 |
| Inline styles | 83 |
| Mixed / non-standard card radius | 81 |
| Gradients | 51 |
| Fixed widths >= 500px | 27 |
| Gradient/inline-styled primary buttons | 27 |
| Tiny text (<11px) | 26 |
| Missing loading state | 23 |
| font-black / extrabold | 22 |
| Table not horizontally scrollable | 16 |
| Non-responsive grids | 13 |
| Too many button colours | 12 |
| Unicode glyph icons | 10 |
| Heavy shadows | 9 |
| Table without <thead> | 5 |
| Missing empty state | 5 |
| No page title | 2 |
| Missing error state | 2 |
| Emoji in UI | 1 |
| Multiple h1 | 1 |

## Recommended order

1. **Mechanical, app-wide fixes.** These are cheap and visible: replace emoji and glyph icons with Lucide; raise `text-[9px]`/`text-[10px]` to `text-[11px]`/`text-xs`; replace `text-gray-400`/`text-slate-400` text with `slate-500`; replace `gray-*` with `slate-*`, `red-*` with `rose-*`, and `green-*` with `emerald-*`; replace `bg-[#5C2D91]`/`style={{ background: PURPLE }}` with `bg-blue-600`; replace gradient buttons with `Button`.
2. **Daily-use high-severity screens:** clients and chart, appointments body, telehealth, notes editor, messages, alerts, the dashboard home and billing sub-pages. Move them to `PageHeader`, `Card`, `StatCard`, `StatusBadge` and `DataTable`.
3. **State coverage:** add `LoadingState`, `ErrorState` and `EmptyState` wherever the scan reports them missing.
4. **Responsive pass:** fix grid breakpoints, fixed widths and table scroll wrappers, then check every high/medium page at 768px and 375px.
5. **Modals:** migrate `fixed inset-0` overlays to `Modal` for focus management.

## Clinical/EHR

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/clients/[id]` | high | XL (1-2d) | 14 |
| `/dashboard/ehr/treatment-plans` | high | L (0.5-1d) | 14 |
| `/dashboard` | high | L (0.5-1d) | 12.5 |
| `/dashboard/ehr/eligibility` | high | L (0.5-1d) | 10.5 |
| `/dashboard/ehr/treatment-plans/[id]/document` | high | M (2-4h) | 10.5 |
| `/dashboard/alerts` | high | L (0.5-1d) | 10 |
| `/dashboard/ehr/treatment-plans/therapy` | high | L (0.5-1d) | 10 |
| `/dashboard/ehr/notes` (reference) | high | XL (1-2d) | 9.5 |
| `/dashboard/ehr/assessments` | medium | L (0.5-1d) | 8.5 |
| `/dashboard/ehr/assessments/cssrs` | medium | M (2-4h) | 7.5 |
| `/dashboard/ehr/labs` | medium | L (0.5-1d) | 7.5 |
| `/dashboard/ehr/locus` | medium | M (2-4h) | 7.5 |
| `/dashboard/ehr/note-builder` | medium | M (2-4h) | 7.5 |
| `/dashboard/ehr/evaluations` | medium | M (2-4h) | 7 |
| `/dashboard/ehr/scanner` | medium | M (2-4h) | 7 |
| `/dashboard/ehr/tms-spravato` | medium | XL (1-2d) | 6.5 |
| `/dashboard/ehr/consents/library` | medium | M (2-4h) | 6 |
| `/dashboard/ehr` | medium | M (2-4h) | 6 |
| `/dashboard/ehr/part2` | medium | L (0.5-1d) | 6 |
| `/dashboard/ehr/prescriptions/mock` | medium | M (2-4h) | 6 |
| `/dashboard/ehr/scanner/sud-radar` | medium | M (2-4h) | 6 |
| `/dashboard/ehr/assessments/sud` | medium | M (2-4h) | 5.5 |
| `/dashboard/ehr/consents/client/[clientId]` | medium | M (2-4h) | 5.5 |
| `/dashboard/ehr/safety-plan` | medium | L (0.5-1d) | 5.5 |
| `/dashboard/ehr/group-sessions/sessions/[sessionId]` | medium | M (2-4h) | 5 |
| `/dashboard/ehr/sud-groups/sessions/[sessionId]` | medium | M (2-4h) | 5 |
| `/dashboard/ehr/goal-bank` | medium | M (2-4h) | 4.5 |
| `/dashboard/ehr/hie` | medium | M (2-4h) | 4.5 |
| `/dashboard/ehr/prescriptions` | medium | M (2-4h) | 4.5 |
| `/dashboard/ehr/consents` | medium | M (2-4h) | 4 |
| `/dashboard/ehr/doc-intake` | medium | M (2-4h) | 4 |
| `/dashboard/ehr/group-sessions` | medium | M (2-4h) | 4 |
| `/dashboard/ehr/smart-phrases` | medium | M (2-4h) | 4 |
| `/dashboard/ehr/sud-groups` | medium | M (2-4h) | 4 |
| `/dashboard/ehr/discharge` | low | M (2-4h) | 3.5 |
| `/dashboard/ehr/group-sessions/[groupId]` | low | L (0.5-1d) | 3.5 |
| `/dashboard/ehr/notes/[id]/print` | low | S (<1h) | 3.5 |
| `/dashboard/ehr/sud-groups/[groupId]` | low | L (0.5-1d) | 3.5 |
| `/dashboard/ehr/supervisor-review` | low | M (2-4h) | 3.5 |
| `/dashboard/ehr/healthlake` | low | M (2-4h) | 2.5 |
| `/dashboard/ehr/diagnoses` | low | M (2-4h) | 2 |
| `/dashboard/scribe` | low | M (2-4h) | 1.5 |
| `/dashboard/ehr/consents/carelon` | low | S (<1h) | 1 |
| `/dashboard/ehr/consents/carelon/[clientId]` | low | M (2-4h) | 0.5 |
| `/dashboard/ehr/consents/packet/[id]` | low | S (<1h) | 0.5 |

### `/dashboard/clients/[id]` (high, XL (1-2d))

Files: `src/app/dashboard/clients/[id]/page.tsx`, `src/features/ehr/ImportedPlanNotice.tsx`, `src/features/caseload/sessionFrequency.tsx`, `src/features/sdoh/components/SocialNeedsCard.tsx`, `src/features/resources/ClientResourcesCard.tsx`, `src/features/sdoh/components/ui.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 1 line(s) — use Lucide Check/X/Star/Chevron
- Tiny text <11px used 2x
- rounded-2xl used 23x — standard card radius is rounded-xl
- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 6x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 52x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, purple, teal, indigo, gray, orange, violet) 76x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 6x (check AA contrast)
- 1 fixed widths >= 500px — check tablet/phone layout
- 6 different filled button colours — use Button primary/secondary/ghost/danger
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader

### `/dashboard/ehr/treatment-plans` (high, L (0.5-1d))

Files: `src/app/dashboard/ehr/treatment-plans/page.tsx`, `src/features/ehr/PlanCareFields.tsx`, `src/features/ehr/ImportedPlanNotice.tsx`, `src/features/ehr/ImportedPlanDetail.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 1 line(s) — use Lucide Check/X/Star/Chevron
- Tiny text <11px used 2x
- Gradients 6x — use flat brand/semantic fills
- Inline style={{}} 18x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 13x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: violet, purple, red (13x)
- text-slate/gray-400 for text 4x (check AA contrast)
- Fetches data but no loading state found
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard` (high, L (0.5-1d))

Files: `src/app/dashboard/page.tsx`, `src/features/dashboard/components/RoleHomeRouter.tsx`, `src/features/dashboard/components/FrontDeskHome.tsx`, `src/features/dashboard/hooks/useRoleHomeFeed.tsx`, `src/features/dashboard/components/RoleHomes.tsx`

- 8 h1/page headers — one h1 per page
- Tiny text <11px used 3x
- rounded-2xl used 6x — standard card radius is rounded-xl
- Gradients 20x — use flat brand/semantic fills
- Inline style={{}} 4x
- Hard-coded hex colour classes 22x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (gray, red, green, orange, purple, teal, pink) 177x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- 4 fixed widths >= 500px — check tablet/phone layout
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader

### `/dashboard/ehr/eligibility` (high, L (0.5-1d))

Files: `src/app/dashboard/ehr/eligibility/page.tsx`, `src/features/ehr/NightlyEligibilityCard.tsx`

- Gradients 5x — use flat brand/semantic fills
- Inline style={{}} 14x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 16x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, violet, purple) 25x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 4x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/treatment-plans/[id]/document` (high, M (2-4h))

Files: `src/app/dashboard/ehr/treatment-plans/[id]/document/page.tsx`, `src/components/notes/structuredNoteUi.tsx`, `src/components/therapy/TreatmentPlanDocument.tsx`

- Emoji/pictograph characters in UI strings (1 lines) — replace with Lucide icons
- Tiny text <11px used 2x
- Hard-coded hex colour classes 11x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: violet, teal (6x)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/alerts` (high, L (0.5-1d))

Files: `src/app/dashboard/alerts/page.tsx`, `src/features/caseload/sessionFrequency.tsx`

- rounded-2xl used 21x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 5x
- Hard-coded hex colour classes 41x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, gray, orange, purple, teal) 74x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 8x — headings use semibold
- text-slate/gray-400 for text 3x (check AA contrast)
- 2 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/treatment-plans/therapy` (high, L (0.5-1d))

Files: `src/app/dashboard/ehr/treatment-plans/therapy/page.tsx`, `src/components/therapy/TherapyPlanEditor.tsx`, `src/components/clinical/DiagnosisAutocomplete.tsx`, `src/components/notes/structuredNoteUi.tsx`, `src/components/therapy/TemplateFields.tsx`, `src/components/therapy/PlanSignaturePanel.tsx`, `src/components/therapy/RewriteFromValantPanel.tsx`, `src/components/therapy/PlanHierarchyEditor.tsx`

- Tiny text <11px used 7x
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 2x
- Hard-coded hex colour classes 23x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (teal, violet, gray, purple, red) 37x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- 4 different filled button colours — use Button primary/secondary/ghost/danger
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/notes` (high, XL (1-2d))

Files: `src/app/dashboard/ehr/notes/page.tsx`

> Reference: header, banners, worklist card, tabs, filters, row actions and loading/empty/error states converted. Note editor modal not yet converted.

- Unicode glyphs used as icons (check/cross/star/triangle) on 2 line(s) — use Lucide Check/X/Star/Chevron
- Gradients 3x — use flat brand/semantic fills
- Inline style={{}} 14x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 28x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (orange, indigo, violet, teal, cyan, fuchsia, pink, purple, lime, gray) 67x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"

### `/dashboard/ehr/assessments` (medium, L (0.5-1d))

Files: `src/app/dashboard/ehr/assessments/page.tsx`

- rounded-2xl used 11x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 5x — cards use shadow-xs; only overlays use shadow-lg/xl
- Hard-coded hex colour classes 24x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, purple) 60x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 8x — headings use semibold
- text-slate/gray-400 for text 4x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/assessments/cssrs` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/assessments/cssrs/page.tsx`

- rounded-2xl used 5x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 9x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: red (4x)
- No empty state found for list/table data
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/labs` (medium, L (0.5-1d))

Files: `src/app/dashboard/ehr/labs/page.tsx`, `src/components/labs/LabWorklist.tsx`, `src/components/labs/LabOrderCard.tsx`, `src/components/labs/LabOrderForm.tsx`, `src/components/labs/StandingOrdersList.tsx`

- Tiny text <11px used 5x
- Hard-coded hex colour classes 22x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: purple (7x)
- text-slate/gray-300/400 for text 12x — fails AA on white (use slate-500+)
- 2 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/locus` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/locus/page.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Hard-coded hex colour classes 11x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, purple) 16x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 6x — headings use semibold
- text-slate/gray-400 for text 4x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/note-builder` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/note-builder/page.tsx`

- Gradients 4x — use flat brand/semantic fills
- Inline style={{}} 2x
- Hard-coded hex colour classes 4x
- Off-palette colour families: violet (1x)
- Fetches data but no loading state found
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/evaluations` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/evaluations/page.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Hard-coded hex colour classes 17x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, purple) 20x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 4x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/scanner` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/scanner/page.tsx`, `src/components/clinical/ServiceEligibilityScanner.tsx`

- Tiny text <11px used 2x
- rounded-2xl used 9x — standard card radius is rounded-xl
- Hard-coded hex colour classes 9x
- Off-palette/duplicate colour families (purple, gray, red, indigo) 149x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- 1 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/tms-spravato` (medium, XL (1-2d))

Files: `src/app/dashboard/ehr/tms-spravato/page.tsx`

- rounded-2xl used 9x — standard card radius is rounded-xl
- Inline style={{}} 12x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (purple, gray, red, green, teal) 246x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/consents/library` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/consents/library/page.tsx`

- 1 table(s) without <thead>
- Tiny text <11px used 1x
- Hard-coded hex colour classes 10x
- Off-palette colour families: violet (3x)
- 1 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones

### `/dashboard/ehr` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/page.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 13x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 9x
- Off-palette colour families: red, orange (8x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/part2` (medium, L (0.5-1d))

Files: `src/app/dashboard/ehr/part2/page.tsx`, `src/app/dashboard/ehr/part2/Part2AuditTrail.tsx`, `src/app/dashboard/ehr/part2/Part2Disclosures.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 1 line(s) — use Lucide Check/X/Star/Chevron
- Inline style={{}} 20x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (red, violet) 32x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- Custom page header markup — use PageHeader

### `/dashboard/ehr/prescriptions/mock` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/prescriptions/mock/page.tsx`, `src/components/drfirst/DrFirstPanel.tsx`

- No page title (h1/PageHeader) found
- Off-palette colour families: red, indigo, purple (11x)
- Fetches data but no loading state found
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/scanner/sud-radar` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/scanner/sud-radar/page.tsx`, `src/components/clinical/SudReferralRadar.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 4x
- Off-palette/duplicate colour families (gray, purple, green, cyan, red) 68x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/assessments/sud` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/assessments/sud/page.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Off-palette/duplicate colour families (red, green, orange, gray, purple) 122x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- 4 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/consents/client/[clientId]` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/consents/client/[clientId]/page.tsx`

- 1 table(s) without <thead>
- Hard-coded hex colour classes 17x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: violet (4x)

### `/dashboard/ehr/safety-plan` (medium, L (0.5-1d))

Files: `src/app/dashboard/ehr/safety-plan/page.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 2 line(s) — use Lucide Check/X/Star/Chevron
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 22x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: red, indigo (6x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/group-sessions/sessions/[sessionId]` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/group-sessions/sessions/[sessionId]/page.tsx`, `src/features/groups/SessionRunner.tsx`, `src/features/groups/shared.tsx`

- rounded-2xl used 6x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Hard-coded hex colour classes 8x
- Off-palette colour families: purple, teal (9x)
- 1 fixed widths >= 500px — check tablet/phone layout
- 5 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader

### `/dashboard/ehr/sud-groups/sessions/[sessionId]` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/sud-groups/sessions/[sessionId]/page.tsx`, `src/features/groups/SessionRunner.tsx`, `src/features/groups/shared.tsx`

- rounded-2xl used 6x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Hard-coded hex colour classes 8x
- Off-palette colour families: purple, teal (9x)
- 1 fixed widths >= 500px — check tablet/phone layout
- 5 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader

### `/dashboard/ehr/goal-bank` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/goal-bank/page.tsx`

- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 3x
- Off-palette colour families: red (1x)
- text-slate/gray-400 for text 2x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/hie` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/hie/page.tsx`

- rounded-2xl used 5x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 2x
- Hard-coded hex colour classes 4x
- Off-palette colour families: purple (1x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/prescriptions` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/prescriptions/page.tsx`

- Tiny text <11px used 1x
- rounded-2xl used 5x — standard card radius is rounded-xl
- Inline style={{}} 3x
- Off-palette colour families: indigo, purple (14x)
- text-slate/gray-400 for text 5x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/consents` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/consents/page.tsx`

- Hard-coded hex colour classes 16x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: orange, violet (11x)
- text-slate/gray-400 for text 5x (check AA contrast)
- 2 fixed widths >= 500px — check tablet/phone layout

### `/dashboard/ehr/doc-intake` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/doc-intake/page.tsx`

- Inline style={{}} 1x
- Off-palette/duplicate colour families (gray, green, red) 59x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/group-sessions` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/group-sessions/page.tsx`, `src/features/groups/GroupsWorkspace.tsx`, `src/features/groups/GroupForm.tsx`, `src/features/groups/shared.tsx`

- Inline style={{}} 1x
- Hard-coded hex colour classes 11x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: purple, teal (9x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader

### `/dashboard/ehr/smart-phrases` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/smart-phrases/page.tsx`

- Hard-coded hex colour classes 20x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: red (7x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/sud-groups` (medium, M (2-4h))

Files: `src/app/dashboard/ehr/sud-groups/page.tsx`, `src/features/groups/GroupsWorkspace.tsx`, `src/features/groups/GroupForm.tsx`, `src/features/groups/shared.tsx`

- Inline style={{}} 1x
- Hard-coded hex colour classes 11x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: purple, teal (9x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader

### `/dashboard/ehr/discharge` (low, M (2-4h))

Files: `src/app/dashboard/ehr/discharge/page.tsx`

- Inline style={{}} 8x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: red (3x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/group-sessions/[groupId]` (low, L (0.5-1d))

Files: `src/app/dashboard/ehr/group-sessions/[groupId]/page.tsx`, `src/features/groups/GroupDetail.tsx`, `src/features/groups/GroupForm.tsx`, `src/features/groups/shared.tsx`

- Inline style={{}} 1x
- Hard-coded hex colour classes 10x
- Off-palette colour families: teal, purple (8x)
- text-slate/gray-400 for text 1x (check AA contrast)
- 2 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader

### `/dashboard/ehr/notes/[id]/print` (low, S (<1h))

Files: `src/app/dashboard/ehr/notes/[id]/print/page.tsx`

- Hard-coded hex colour classes 1x
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/sud-groups/[groupId]` (low, L (0.5-1d))

Files: `src/app/dashboard/ehr/sud-groups/[groupId]/page.tsx`, `src/features/groups/GroupDetail.tsx`, `src/features/groups/GroupForm.tsx`, `src/features/groups/shared.tsx`

- Inline style={{}} 1x
- Hard-coded hex colour classes 10x
- Off-palette colour families: teal, purple (8x)
- text-slate/gray-400 for text 1x (check AA contrast)
- 2 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader

### `/dashboard/ehr/supervisor-review` (low, M (2-4h))

Files: `src/app/dashboard/ehr/supervisor-review/page.tsx`

- Hard-coded hex colour classes 21x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: red (4x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/healthlake` (low, M (2-4h))

Files: `src/app/dashboard/ehr/healthlake/page.tsx`

- Hard-coded hex colour classes 3x
- Off-palette colour families: red (7x)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/diagnoses` (low, M (2-4h))

Files: `src/app/dashboard/ehr/diagnoses/page.tsx`

- Inline style={{}} 4x
- Off-palette colour families: red (1x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/scribe` (low, M (2-4h))

Files: `src/app/dashboard/scribe/page.tsx`

- Hard-coded hex colour classes 9x
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ehr/consents/carelon` (low, S (<1h))

Files: `src/app/dashboard/ehr/consents/carelon/page.tsx`

- Hard-coded hex colour classes 5x
- Off-palette colour families: violet (2x)

### `/dashboard/ehr/consents/carelon/[clientId]` (low, M (2-4h))

Files: `src/app/dashboard/ehr/consents/carelon/[clientId]/page.tsx`

- Hard-coded hex colour classes 3x

### `/dashboard/ehr/consents/packet/[id]` (low, S (<1h))

Files: `src/app/dashboard/ehr/consents/packet/[id]/page.tsx`

- Hard-coded hex colour classes 5x

## Scheduling/Front office

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/telehealth` | high | XL (1-2d) | 18 |
| `/dashboard/appointments` (reference) | high | XL (1-2d) | 13.5 |
| `/dashboard/clients` | high | L (0.5-1d) | 11 |
| `/dashboard/clients/intake` | high | L (0.5-1d) | 10 |
| `/dashboard/clients/waitlist` | high | L (0.5-1d) | 9 |
| `/dashboard/inbox` | medium | M (2-4h) | 5 |
| `/dashboard/tasks` | medium | M (2-4h) | 4 |

### `/dashboard/telehealth` (high, XL (1-2d))

Files: `src/app/dashboard/telehealth/page.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 7 line(s) — use Lucide Check/X/Star/Chevron
- Mixed card radii (rounded-xl 81, rounded-2xl 33, rounded-3xl/arbitrary 4) — standard is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 14x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 3x — use flat brand/semantic fills
- Inline style={{}} 9x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 20x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (green, orange, indigo, teal, gray, purple, red) 298x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 17x — headings use semibold
- text-slate/gray-300/400 for text 9x — fails AA on white (use slate-500+)
- 2 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- 2 fixed widths >= 500px — check tablet/phone layout
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/appointments` (high, XL (1-2d))

Files: `src/app/dashboard/appointments/page.tsx`, `src/app/dashboard/appointments/NoShowRiskPanel.tsx`, `src/app/dashboard/appointments/AppointmentLabelLegend.tsx`, `src/app/dashboard/appointments/ScheduleFilterBar.tsx`

> Reference: header, error banner, KPI row and view switcher converted. Calendar/board/list bodies and modals not yet converted.

- Tiny text <11px used 2x
- rounded-2xl used 19x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 8x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 24x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 58x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (gray, purple, red, orange, teal, violet) 347x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 8x (check AA contrast)
- 2 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- 1 fixed widths >= 500px — check tablet/phone layout
- Gradient primary buttons via inline style — use Button variant="primary"

### `/dashboard/clients` (high, L (0.5-1d))

Files: `src/app/dashboard/clients/page.tsx`, `src/features/clients/components/PatientBulkTransfer.tsx`

- rounded-2xl used 11x — standard card radius is rounded-xl
- Gradients 3x — use flat brand/semantic fills
- Inline style={{}} 5x
- Hard-coded hex colour classes 19x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (purple, orange, teal, gray, indigo) 20x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- 1 fixed widths >= 500px — check tablet/phone layout
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/clients/intake` (high, L (0.5-1d))

Files: `src/app/dashboard/clients/intake/page.tsx`, `src/features/ehr/TextractInsuranceScan.tsx`

- rounded-2xl used 10x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 4x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 4x
- Hard-coded hex colour classes 45x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (green, red, gray, purple, violet) 135x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/clients/waitlist` (high, L (0.5-1d))

Files: `src/app/dashboard/clients/waitlist/page.tsx`

- rounded-2xl used 6x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 3x
- Off-palette/duplicate colour families (gray, purple, green, red) 81x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/inbox` (medium, M (2-4h))

Files: `src/app/dashboard/inbox/page.tsx`

- Tiny text <11px used 1x
- Hard-coded hex colour classes 12x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: teal (1x)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/tasks` (medium, M (2-4h))

Files: `src/app/dashboard/tasks/page.tsx`

- Hard-coded hex colour classes 7x
- Off-palette/duplicate colour families (violet, orange, teal, purple, indigo) 21x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

## Programs

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/prp` | high | L (0.5-1d) | 13 |
| `/dashboard/aot` | high | XL (1-2d) | 10 |
| `/dashboard/residential` | high | XL (1-2d) | 10 |
| `/dashboard/programs/intensive` | high | L (0.5-1d) | 9.5 |
| `/dashboard/crisis` | medium | XL (1-2d) | 8.5 |
| `/dashboard/sdoh` | medium | L (0.5-1d) | 8.5 |
| `/dashboard/programs/intensive/[enrollmentId]` | medium | M (2-4h) | 8 |
| `/dashboard/mbc` | medium | M (2-4h) | 7 |
| `/dashboard/aot/forms/[docId]/print` | medium | M (2-4h) | 6.5 |
| `/dashboard/aot/forms/[docId]` | medium | M (2-4h) | 6 |
| `/dashboard/prp/assessment` | medium | L (0.5-1d) | 6 |
| `/dashboard/peer-support` | medium | L (0.5-1d) | 5.5 |
| `/dashboard/prp/enroll` | medium | M (2-4h) | 5.5 |
| `/dashboard/prp/referral` | medium | M (2-4h) | 5 |
| `/dashboard/prp/irp` | medium | L (0.5-1d) | 4 |

### `/dashboard/prp` (high, L (0.5-1d))

Files: `src/app/dashboard/prp/page.tsx`, `src/app/dashboard/prp/prpShared.tsx`

- 1 table(s) without <thead>
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (gray, green, purple, red) 208x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-300/400 for text 10x — fails AA on white (use slate-500+)
- 3 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/aot` (high, XL (1-2d))

Files: `src/app/dashboard/aot/page.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 1 line(s) — use Lucide Check/X/Star/Chevron
- Off-palette/duplicate colour families (gray, purple, indigo, green, teal, red) 437x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 4x — headings use semibold
- text-slate/gray-300/400 for text 12x — fails AA on white (use slate-500+)
- Fetches data but no loading state found
- 5 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/residential` (high, XL (1-2d))

Files: `src/app/dashboard/residential/page.tsx`

- Inline style={{}} 1x
- Hard-coded hex colour classes 4x
- Off-palette/duplicate colour families (red, green, gray, indigo, purple) 331x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 4x — headings use semibold
- text-slate/gray-300/400 for text 11x — fails AA on white (use slate-500+)
- Fetches data but no loading state found
- 10 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/programs/intensive` (high, L (0.5-1d))

Files: `src/app/dashboard/programs/intensive/page.tsx`, `src/app/dashboard/programs/intensive/shared.tsx`, `src/app/dashboard/programs/intensive/ProgramSetup.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (gray, purple, red, green) 169x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 6x (check AA contrast)
- Fetches data but no loading state found
- 2 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/crisis` (medium, XL (1-2d))

Files: `src/app/dashboard/crisis/page.tsx`

- Inline style={{}} 1x
- Off-palette/duplicate colour families (red, orange, green, gray, purple, indigo, teal) 345x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-300/400 for text 9x — fails AA on white (use slate-500+)
- Fetches data but no loading state found
- 6 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/sdoh` (medium, L (0.5-1d))

Files: `src/app/dashboard/sdoh/page.tsx`, `src/features/sdoh/components/ScreenTab.tsx`, `src/features/sdoh/components/WorklistTab.tsx`, `src/features/sdoh/components/DirectoryTab.tsx`, `src/features/sdoh/components/SummaryTab.tsx`, `src/features/sdoh/components/ScreeningResults.tsx`, `src/features/sdoh/components/ScreeningWizard.tsx`, `src/features/sdoh/components/ui.tsx`

- Tiny text <11px used 1x
- Mixed card radii (rounded-xl 17, rounded-2xl 20, rounded-3xl/arbitrary 5) — standard is rounded-xl
- Inline style={{}} 2x
- Hard-coded hex colour classes 35x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- text-slate/gray-300/400 for text 15x — fails AA on white (use slate-500+)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/programs/intensive/[enrollmentId]` (medium, M (2-4h))

Files: `src/app/dashboard/programs/intensive/[enrollmentId]/page.tsx`, `src/app/dashboard/programs/intensive/shared.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 5x
- Off-palette/duplicate colour families (purple, red, gray, green) 117x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 4x (check AA contrast)
- Fetches data but no loading state found
- 1 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/mbc` (medium, M (2-4h))

Files: `src/app/dashboard/mbc/page.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Hard-coded hex colour classes 3x
- Off-palette/duplicate colour families (red, purple) 26x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 4x — headings use semibold
- text-slate/gray-400 for text 1x (check AA contrast)
- No empty state found for list/table data
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/aot/forms/[docId]/print` (medium, M (2-4h))

Files: `src/app/dashboard/aot/forms/[docId]/print/page.tsx`, `src/components/aot/forms/FormDocument.tsx`

- Tiny text <11px used 9x
- Off-palette colour families: gray, red (7x)
- Fetches data but no loading state found
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- 2 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/aot/forms/[docId]` (medium, M (2-4h))

Files: `src/app/dashboard/aot/forms/[docId]/page.tsx`

- Inline style={{}} 1x
- Off-palette/duplicate colour families (red, gray, green) 63x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/prp/assessment` (medium, L (0.5-1d))

Files: `src/app/dashboard/prp/assessment/page.tsx`, `src/app/dashboard/prp/prpShared.tsx`

- Inline style={{}} 10x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 1x
- Off-palette/duplicate colour families (red, purple, green, gray) 64x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/peer-support` (medium, L (0.5-1d))

Files: `src/app/dashboard/peer-support/page.tsx`, `src/features/peerSupport/components/ContactForm.tsx`, `src/features/peerSupport/components/GoalsBoard.tsx`, `src/features/peerSupport/components/PlacementsPanel.tsx`, `src/features/peerSupport/components/ResourcesPanel.tsx`, `src/features/peerSupport/components/LegacyPanel.tsx`, `src/features/peerSupport/components/ui.tsx`

- Tiny text <11px used 2x
- rounded-2xl used 11x — standard card radius is rounded-xl
- Hard-coded hex colour classes 21x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- text-slate/gray-400 for text 6x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/prp/enroll` (medium, M (2-4h))

Files: `src/app/dashboard/prp/enroll/page.tsx`, `src/app/dashboard/prp/prpShared.tsx`

- Inline style={{}} 8x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (green, gray, purple, red) 183x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/prp/referral` (medium, M (2-4h))

Files: `src/app/dashboard/prp/referral/page.tsx`, `src/app/dashboard/prp/prpShared.tsx`

- Inline style={{}} 3x
- Off-palette/duplicate colour families (green, gray, purple, red) 146x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/prp/irp` (medium, L (0.5-1d))

Files: `src/app/dashboard/prp/irp/page.tsx`, `src/app/dashboard/prp/prpShared.tsx`

- Inline style={{}} 2x
- Off-palette/duplicate colour families (purple, gray, red, green) 151x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

## Billing

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/billing/authorizations` | high | L (0.5-1d) | 12.5 |
| `/dashboard/billing/ar-control` | high | L (0.5-1d) | 10.5 |
| `/dashboard/billing/denials` | high | M (2-4h) | 10 |
| `/dashboard/billing/payments` | high | L (0.5-1d) | 10 |
| `/dashboard/billing/statements` | high | M (2-4h) | 9.5 |
| `/dashboard/billing/panels` | high | S (<1h) | 9 |
| `/dashboard/billing/claim-scrubber` | medium | M (2-4h) | 8 |
| `/dashboard/billing/claims` | medium | M (2-4h) | 8 |
| `/dashboard/billing/clearinghouse` | medium | M (2-4h) | 7.5 |
| `/dashboard/billing/superbills` | medium | M (2-4h) | 7.5 |
| `/dashboard/billing` (reference) | medium | XL (1-2d) | 7 |
| `/dashboard/billing/valant-balances` | medium | L (0.5-1d) | 7 |
| `/dashboard/programs/intensive/billing` | medium | M (2-4h) | 7 |
| `/dashboard/subscription` | medium | M (2-4h) | 7 |
| `/dashboard/billing/payer-settings` | medium | L (0.5-1d) | 6 |
| `/dashboard/billing/provider-collections` | medium | M (2-4h) | 6 |
| `/dashboard/billing/residential-crisis` | medium | M (2-4h) | 5.5 |
| `/dashboard/coding` | medium | L (0.5-1d) | 4 |
| `/dashboard/billing/fee-schedule` | low | M (2-4h) | 3.5 |
| `/dashboard/billing/autopay` | low | M (2-4h) | 3 |
| `/dashboard/billing/insurance-companies` | low | M (2-4h) | 2 |

### `/dashboard/billing/authorizations` (high, L (0.5-1d))

Files: `src/app/dashboard/billing/authorizations/page.tsx`, `src/app/dashboard/billing/authorizations/_components/PriorAuthTracking.tsx`, `src/app/dashboard/billing/authorizations/_components/ElectronicPriorAuth.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 12x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, purple) 19x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 5x — headings use semibold
- text-slate/gray-400 for text 5x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/ar-control` (high, L (0.5-1d))

Files: `src/app/dashboard/billing/ar-control/page.tsx`, `src/app/dashboard/billing/ar-control/ValantRunoutSection.tsx`

- rounded-2xl used 12x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 15x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 17x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: violet, purple (13x)
- font-black/extrabold 15x — headings use semibold
- 3 fixed widths >= 500px — check tablet/phone layout
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/denials` (high, M (2-4h))

Files: `src/app/dashboard/billing/denials/page.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (gray, purple, red, green, indigo) 73x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- Fetches data but no loading state found
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/payments` (high, L (0.5-1d))

Files: `src/app/dashboard/billing/payments/page.tsx`

- Mixed card radii (rounded-xl 10, rounded-2xl 21, rounded-3xl/arbitrary 6) — standard is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 5x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 1x — use flat brand/semantic fills
- Hard-coded hex colour classes 10x
- Off-palette/duplicate colour families (violet, indigo) 40x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 22x — headings use semibold
- text-slate/gray-400 for text 2x (check AA contrast)
- 1 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/statements` (high, M (2-4h))

Files: `src/app/dashboard/billing/statements/page.tsx`

- Mixed card radii (rounded-xl 11, rounded-2xl 6, rounded-3xl/arbitrary 1) — standard is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 3x
- Hard-coded hex colour classes 4x
- Off-palette/duplicate colour families (violet) 16x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 5x — headings use semibold
- text-slate/gray-400 for text 2x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/panels` (high, S (<1h))

Files: `src/app/dashboard/billing/panels/page.tsx`

- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 3x
- Off-palette/duplicate colour families (green, gray, red, purple) 65x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Fetches data but no error state found
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/claim-scrubber` (medium, M (2-4h))

Files: `src/app/dashboard/billing/claim-scrubber/page.tsx`

- rounded-2xl used 6x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 6x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 2x
- Off-palette colour families: violet (6x)
- font-black/extrabold 4x — headings use semibold
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/claims` (medium, M (2-4h))

Files: `src/app/dashboard/billing/claims/page.tsx`, `src/app/dashboard/billing/claims/_components/ClaimOutboundTools.tsx`

- Tiny text <11px used 2x
- Mixed card radii (rounded-xl 20, rounded-2xl 5, rounded-3xl/arbitrary 6) — standard is rounded-xl
- Hard-coded hex colour classes 11x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: indigo, violet (11x)
- font-black/extrabold 10x — headings use semibold
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/clearinghouse` (medium, M (2-4h))

Files: `src/app/dashboard/billing/clearinghouse/page.tsx`

- Mixed card radii (rounded-xl 10, rounded-2xl 3, rounded-3xl/arbitrary 6) — standard is rounded-xl
- Hard-coded hex colour classes 12x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: violet (7x)
- font-black/extrabold 9x — headings use semibold
- 1 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/superbills` (medium, M (2-4h))

Files: `src/app/dashboard/billing/superbills/page.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Hard-coded hex colour classes 22x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- text-slate/gray-400 for text 4x (check AA contrast)
- Fetches data but no loading state found
- 1 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing` (medium, XL (1-2d))

Files: `src/app/dashboard/billing/page.tsx`, `src/features/billing/NewClaimModal.tsx`, `src/features/billing/overview/BillingOverviewPanel.tsx`, `src/features/billing/overview/OverviewSections.tsx`

> Reference: header, clearinghouse/notice/HIPAA banners, overview cards, section tabs and primary buttons converted. Tab bodies (payers, codes, statements) partly converted.

- Inline style={{}} 8x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 3x
- Off-palette/duplicate colour families (green, red, gray, purple, teal, orange) 205x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- 3 fixed widths >= 500px — check tablet/phone layout
- 3 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones

### `/dashboard/billing/valant-balances` (medium, L (0.5-1d))

Files: `src/app/dashboard/billing/valant-balances/page.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 1 line(s) — use Lucide Check/X/Star/Chevron
- Tiny text <11px used 4x
- rounded-2xl used 9x — standard card radius is rounded-xl
- Inline style={{}} 3x
- Hard-coded hex colour classes 7x
- Off-palette colour families: purple, teal (4x)
- text-slate/gray-400 for text 3x (check AA contrast)
- 2 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/programs/intensive/billing` (medium, M (2-4h))

Files: `src/app/dashboard/programs/intensive/billing/page.tsx`, `src/app/dashboard/programs/intensive/shared.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 1x
- Off-palette/duplicate colour families (purple, gray, red, green) 51x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/subscription` (medium, M (2-4h))

Files: `src/app/dashboard/subscription/page.tsx`

- rounded-2xl used 9x — standard card radius is rounded-xl
- Hard-coded hex colour classes 23x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, violet, teal) 17x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 12x — headings use semibold
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/payer-settings` (medium, L (0.5-1d))

Files: `src/app/dashboard/billing/payer-settings/page.tsx`, `src/app/dashboard/billing/payer-settings/WaystarSettingsPanels.tsx`, `src/app/dashboard/billing/payer-settings/ValantEdiReference.tsx`

- Off-palette/duplicate colour families (purple, gray, green, indigo, teal) 150x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-300/400 for text 9x — fails AA on white (use slate-500+)
- 2 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/provider-collections` (medium, M (2-4h))

Files: `src/app/dashboard/billing/provider-collections/page.tsx`

- rounded-2xl used 5x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Hard-coded hex colour classes 3x
- Off-palette colour families: purple (3x)
- text-slate/gray-400 for text 4x (check AA contrast)
- 1 fixed widths >= 500px — check tablet/phone layout
- 1 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/residential-crisis` (medium, M (2-4h))

Files: `src/app/dashboard/billing/residential-crisis/page.tsx`

- Off-palette/duplicate colour families (red, green, cyan, gray, indigo, purple) 120x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/coding` (medium, L (0.5-1d))

Files: `src/app/dashboard/coding/page.tsx`

- Inline style={{}} 22x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: indigo (5x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/fee-schedule` (low, M (2-4h))

Files: `src/app/dashboard/billing/fee-schedule/page.tsx`

- Hard-coded hex colour classes 8x
- Off-palette colour families: purple (2x)
- text-slate/gray-400 for text 1x (check AA contrast)
- 1 fixed widths >= 500px — check tablet/phone layout
- 1 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones

### `/dashboard/billing/autopay` (low, M (2-4h))

Files: `src/app/dashboard/billing/autopay/page.tsx`

- Hard-coded hex colour classes 7x
- text-slate/gray-400 for text 3x (check AA contrast)
- 1 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/billing/insurance-companies` (low, M (2-4h))

Files: `src/app/dashboard/billing/insurance-companies/page.tsx`, `src/app/dashboard/admin/migration/ValantPayersImport.tsx`

- Inline style={{}} 3x
- Hard-coded hex colour classes 10x
- Off-palette colour families: purple (2x)
- text-slate/gray-400 for text 5x (check AA contrast)

## Admin/Settings

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/admin/migration` | high | XL (1-2d) | 14 |
| `/dashboard/compliance/mandatory-reporting` | medium | L (0.5-1d) | 7 |
| `/dashboard/compliance` | medium | M (2-4h) | 7 |
| `/dashboard/admin/locations` | medium | M (2-4h) | 6 |
| `/dashboard/admin/scheduling-settings` | medium | L (0.5-1d) | 5 |
| `/dashboard/grievances` | medium | M (2-4h) | 5 |
| `/dashboard/incidents` | medium | M (2-4h) | 5 |
| `/dashboard/admin/audit-log` | low | M (2-4h) | 3.5 |
| `/dashboard/admin/measurement-types` | low | S (<1h) | 3 |
| `/dashboard/admin` | low | L (0.5-1d) | 2 |
| `/dashboard/settings` | low | M (2-4h) | 1 |

### `/dashboard/admin/migration` (high, XL (1-2d))

Files: `src/app/dashboard/admin/migration/page.tsx`, `src/app/dashboard/admin/migration/ValantReferenceImport.tsx`, `src/app/dashboard/admin/migration/ValantTransactionsImport.tsx`, `src/app/dashboard/admin/migration/ValantFeeScheduleImport.tsx`, `src/app/dashboard/admin/migration/ValantLabRequestTypesImport.tsx`, `src/app/dashboard/admin/migration/ValantMeasurementTypesImport.tsx`, `src/app/dashboard/admin/migration/ValantPayersImport.tsx`, `src/app/dashboard/admin/migration/ValantFacilitiesImport.tsx`, `src/app/dashboard/admin/migration/ValantProviderMap.tsx`, `src/app/dashboard/admin/migration/ValantDocumentsImport.tsx`

- 3 table(s) without <thead>
- Tiny text <11px used 2x
- rounded-2xl used 22x — standard card radius is rounded-xl
- Inline style={{}} 16x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 66x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (purple, red, teal) 21x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- 3 fixed widths >= 500px — check tablet/phone layout
- 5 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/compliance/mandatory-reporting` (medium, L (0.5-1d))

Files: `src/app/dashboard/compliance/mandatory-reporting/page.tsx`

- rounded-2xl used 13x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 4x — cards use shadow-xs; only overlays use shadow-lg/xl
- Hard-coded hex colour classes 8x
- Off-palette/duplicate colour families (red, purple, pink) 47x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 9x — headings use semibold
- text-slate/gray-400 for text 3x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/compliance` (medium, M (2-4h))

Files: `src/app/dashboard/compliance/page.tsx`

- rounded-2xl used 9x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 2x
- Off-palette/duplicate colour families (red, orange, violet, fuchsia, teal, indigo) 38x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- 5 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/admin/locations` (medium, M (2-4h))

Files: `src/app/dashboard/admin/locations/page.tsx`

- Tiny text <11px used 1x
- Inline style={{}} 6x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 9x
- Off-palette colour families: red (2x)
- text-slate/gray-300/400 for text 10x — fails AA on white (use slate-500+)

### `/dashboard/admin/scheduling-settings` (medium, L (0.5-1d))

Files: `src/app/dashboard/admin/scheduling-settings/page.tsx`, `src/app/dashboard/admin/scheduling-settings/CalendarLabelsSection.tsx`

- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 8x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 10x
- Off-palette colour families: purple (2x)
- 1 fixed widths >= 500px — check tablet/phone layout

### `/dashboard/grievances` (medium, M (2-4h))

Files: `src/app/dashboard/grievances/page.tsx`

- rounded-2xl used 10x — standard card radius is rounded-xl
- Inline style={{}} 2x
- Off-palette/duplicate colour families (indigo, red) 20x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/incidents` (medium, M (2-4h))

Files: `src/app/dashboard/incidents/page.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Off-palette/duplicate colour families (red, orange, indigo, teal) 43x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/admin/audit-log` (low, M (2-4h))

Files: `src/app/dashboard/admin/audit-log/page.tsx`, `src/app/dashboard/admin/AuditLogPanel.tsx`, `src/app/dashboard/admin/audit-log/UnusualAccessPanel.tsx`

- Tiny text <11px used 1x
- Off-palette colour families: violet (6x)
- text-slate/gray-300/400 for text 9x — fails AA on white (use slate-500+)

### `/dashboard/admin/measurement-types` (low, S (<1h))

Files: `src/app/dashboard/admin/measurement-types/page.tsx`

- Tiny text <11px used 1x
- Hard-coded hex colour classes 3x
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/admin` (low, L (0.5-1d))

Files: `src/app/dashboard/admin/page.tsx`, `src/app/dashboard/admin/AuditLogLinks.tsx`

- Off-palette colour families: violet (1x)
- text-slate/gray-400 for text 2x (check AA contrast)
- 2 fixed widths >= 500px — check tablet/phone layout

### `/dashboard/settings` (low, M (2-4h))

Files: `src/app/dashboard/settings/page.tsx`

- No empty state found for list/table data

## Reports

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/enterprise` | high | L (0.5-1d) | 17 |
| `/dashboard/qi` | medium | L (0.5-1d) | 7.5 |
| `/dashboard/analytics/schedule` | medium | M (2-4h) | 7 |
| `/dashboard/ai-insights` | medium | M (2-4h) | 6.5 |
| `/dashboard/mbc/outcomes` | medium | M (2-4h) | 6 |
| `/dashboard/analytics/productivity` | medium | M (2-4h) | 5.5 |
| `/dashboard/reports/run/[id]` | medium | M (2-4h) | 5.5 |
| `/dashboard/projects` | medium | L (0.5-1d) | 5 |
| `/dashboard/reports/outcomes` | medium | M (2-4h) | 4 |
| `/dashboard/analytics/surveys` | low | M (2-4h) | 3.5 |
| `/dashboard/population` | low | M (2-4h) | 3 |
| `/dashboard/reports` | low | M (2-4h) | 3 |

### `/dashboard/enterprise` (high, L (0.5-1d))

Files: `src/app/dashboard/enterprise/page.tsx`, `src/app/dashboard/enterprise/CensusTab.tsx`, `src/app/dashboard/enterprise/FacilityView.tsx`

- 1 table(s) without <thead>
- Tiny text <11px used 7x
- rounded-2xl used 6x — standard card radius is rounded-xl
- Inline style={{}} 24x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 14x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, purple) 16x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 9x — headings use semibold
- text-slate/gray-300/400 for text 14x — fails AA on white (use slate-500+)
- 6 fixed widths >= 500px — check tablet/phone layout
- 6 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/qi` (medium, L (0.5-1d))

Files: `src/app/dashboard/qi/page.tsx`

- rounded-2xl used 13x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Off-palette/duplicate colour families (indigo, violet, purple) 29x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 5x — headings use semibold
- Fetches data but no error state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/analytics/schedule` (medium, M (2-4h))

Files: `src/app/dashboard/analytics/schedule/page.tsx`

- Tiny text <11px used 1x
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 21x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: red (4x)
- text-slate/gray-400 for text 2x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/ai-insights` (medium, M (2-4h))

Files: `src/app/dashboard/ai-insights/page.tsx`, `src/features/insights/clinical/ClinicalInsightsPage.tsx`, `src/features/insights/clinical/ClientDrawer.tsx`, `src/features/insights/clinical/ui.tsx`

- Inline style={{}} 3x
- Hard-coded hex colour classes 34x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (red, orange, yellow, teal) 16x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- 2 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader

### `/dashboard/mbc/outcomes` (medium, M (2-4h))

Files: `src/app/dashboard/mbc/outcomes/page.tsx`

- Gradients 2x — use flat brand/semantic fills
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: red (12x)
- text-slate/gray-400 for text 5x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/analytics/productivity` (medium, M (2-4h))

Files: `src/app/dashboard/analytics/productivity/page.tsx`

- Inline style={{}} 9x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 1x
- Off-palette/duplicate colour families (red, orange) 17x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/reports/run/[id]` (medium, M (2-4h))

Files: `src/app/dashboard/reports/run/[id]/page.tsx`, `src/features/reports/ReportRunner.tsx`

- Tiny text <11px used 1x
- Inline style={{}} 7x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 8x
- Off-palette colour families: red (7x)
- text-slate/gray-400 for text 4x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/projects` (medium, L (0.5-1d))

Files: `src/app/dashboard/projects/page.tsx`

- Inline style={{}} 5x
- Off-palette/duplicate colour families (indigo) 32x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/reports/outcomes` (medium, M (2-4h))

Files: `src/app/dashboard/reports/outcomes/page.tsx`

- Tiny text <11px used 2x
- Inline style={{}} 5x
- Hard-coded hex colour classes 1x
- Off-palette colour families: red (6x)
- text-slate/gray-400 for text 4x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/analytics/surveys` (low, M (2-4h))

Files: `src/app/dashboard/analytics/surveys/page.tsx`

- Inline style={{}} 9x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette colour families: red (7x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/population` (low, M (2-4h))

Files: `src/app/dashboard/population/page.tsx`

- Inline style={{}} 5x
- Off-palette colour families: red (10x)
- 1 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/reports` (low, M (2-4h))

Files: `src/app/dashboard/reports/page.tsx`, `src/features/reports/SavedReports.tsx`

- Inline style={{}} 2x
- Hard-coded hex colour classes 10x
- Off-palette colour families: red (7x)
- text-slate/gray-400 for text 6x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

## Community/Communications

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/communications` | high | XL (1-2d) | 18 |
| `/dashboard/messages` | high | L (0.5-1d) | 10 |
| `/dashboard/practice-setup` | high | XL (1-2d) | 9 |
| `/dashboard/community/referrals` | medium | M (2-4h) | 7 |
| `/dashboard/community` | medium | L (0.5-1d) | 6.5 |
| `/dashboard/notifications` | medium | L (0.5-1d) | 6.5 |
| `/dashboard/protected-records` | medium | M (2-4h) | 6 |
| `/dashboard/pr` | medium | L (0.5-1d) | 5.5 |
| `/dashboard/practice-setup/booking` | medium | M (2-4h) | 5.5 |
| `/dashboard/resources` | medium | L (0.5-1d) | 4 |
| `/dashboard/resources/staff` | low | M (2-4h) | 3 |

### `/dashboard/communications` (high, XL (1-2d))

Files: `src/app/dashboard/communications/page.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 1 line(s) — use Lucide Check/X/Star/Chevron
- No page title (h1/PageHeader) found
- rounded-2xl used 15x — standard card radius is rounded-xl
- Gradients 4x — use flat brand/semantic fills
- Inline style={{}} 18x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 15x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (gray, violet, indigo, cyan, purple, red, teal) 311x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 4x — headings use semibold
- text-slate/gray-400 for text 8x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- 4 different filled button colours — use Button primary/secondary/ghost/danger
- Gradient primary buttons via inline style — use Button variant="primary"
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/messages` (high, L (0.5-1d))

Files: `src/app/dashboard/messages/page.tsx`

- rounded-2xl used 10x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 4x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 3x — use flat brand/semantic fills
- Inline style={{}} 9x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 2x
- Off-palette/duplicate colour families (indigo, gray, purple, red) 101x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/practice-setup` (high, XL (1-2d))

Files: `src/app/dashboard/practice-setup/page.tsx`, `src/app/dashboard/practice-setup/_components/ui.tsx`, `src/app/dashboard/practice-setup/_components/sections.tsx`, `src/app/dashboard/billing/payer-settings/WaystarSettingsPanels.tsx`, `src/app/dashboard/practice-setup/_components/programsCapacity.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Hard-coded hex colour classes 35x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (purple, gray) 55x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-300/400 for text 12x — fails AA on white (use slate-500+)
- 2 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/community/referrals` (medium, M (2-4h))

Files: `src/app/dashboard/community/referrals/page.tsx`

- rounded-2xl used 10x — standard card radius is rounded-xl
- Inline style={{}} 10x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 4x
- Off-palette/duplicate colour families (orange, violet, green) 23x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/community` (medium, L (0.5-1d))

Files: `src/app/dashboard/community/page.tsx`, `src/features/community/CommunityOutreachPage.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 13x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Hard-coded hex colour classes 12x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: violet, teal, orange (11x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/notifications` (medium, L (0.5-1d))

Files: `src/app/dashboard/notifications/page.tsx`

- rounded-2xl used 10x — standard card radius is rounded-xl
- Hard-coded hex colour classes 18x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette/duplicate colour families (purple, red) 42x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/protected-records` (medium, M (2-4h))

Files: `src/app/dashboard/protected-records/page.tsx`

- rounded-2xl used 8x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 2x
- Hard-coded hex colour classes 7x
- Off-palette colour families: violet, purple (4x)
- text-slate/gray-400 for text 2x (check AA contrast)
- Gradient primary buttons via inline style — use Button variant="primary"
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/pr` (medium, L (0.5-1d))

Files: `src/app/dashboard/pr/page.tsx`, `src/features/pr/PrMarketingPage.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Inline style={{}} 5x
- Hard-coded hex colour classes 35x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: pink, teal, violet (6x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/practice-setup/booking` (medium, M (2-4h))

Files: `src/app/dashboard/practice-setup/booking/page.tsx`

- rounded-2xl used 8x — standard card radius is rounded-xl
- Inline style={{}} 1x
- Hard-coded hex colour classes 5x
- Off-palette/duplicate colour families (violet) 17x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/resources` (medium, L (0.5-1d))

Files: `src/app/dashboard/resources/page.tsx`, `src/features/resources/CrisisLinesButton.tsx`, `src/features/resources/AssignResourceDialog.tsx`, `src/features/resources/ItemEditor.tsx`

- rounded-2xl used 7x — standard card radius is rounded-xl
- Hard-coded hex colour classes 52x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- text-slate/gray-400 for text 3x (check AA contrast)
- Custom page header markup — use PageHeader

### `/dashboard/resources/staff` (low, M (2-4h))

Files: `src/app/dashboard/resources/staff/page.tsx`, `src/features/resources/ItemEditor.tsx`

- Hard-coded hex colour classes 11x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader

## Primary care/Medical

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/dashboard/medical/billing` | high | L (0.5-1d) | 10.5 |
| `/dashboard/medical/visits` | high | XL (1-2d) | 10.5 |
| `/dashboard/medical/labs` | high | L (0.5-1d) | 9.5 |
| `/dashboard/medical` | high | XL (1-2d) | 9 |
| `/dashboard/medical/referrals` | medium | L (0.5-1d) | 8.5 |
| `/dashboard/medical/vitals` | medium | M (2-4h) | 7 |
| `/dashboard/medical/preventive-care` | medium | M (2-4h) | 6.5 |
| `/dashboard/medical/payer-settings` | medium | L (0.5-1d) | 6 |
| `/dashboard/medical/patients/intake` | medium | L (0.5-1d) | 5.5 |
| `/dashboard/medical/problem-list` | medium | M (2-4h) | 5.5 |
| `/dashboard/medical/ai` | medium | M (2-4h) | 5 |
| `/dashboard/medical/patients` | low | M (2-4h) | 3.5 |
| `/dashboard/medical/history` | low | M (2-4h) | 3 |

### `/dashboard/medical/billing` (high, L (0.5-1d))

Files: `src/app/dashboard/medical/billing/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`, `src/features/billing/overview/MedicalBillingSummaryPanel.tsx`, `src/features/billing/overview/OverviewSections.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 4x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 6x — move colours/sizes to Tailwind tokens (dynamic widths ok)
- Off-palette/duplicate colour families (indigo, purple, gray) 80x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 4x (check AA contrast)
- 1 fixed widths >= 500px — check tablet/phone layout
- 3 table(s) not wrapped in overflow-x-auto — horizontal overflow on phones
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/visits` (high, XL (1-2d))

Files: `src/app/dashboard/medical/visits/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`, `src/features/medical/components/PrimaryCareVisitWorkflow.tsx`, `src/features/medical/components/CareGapActionForm.tsx`

- Unicode glyphs used as icons (check/cross/star/triangle) on 2 line(s) — use Lucide Check/X/Star/Chevron
- rounded-2xl used 9x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Hard-coded hex colour classes 17x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: indigo, purple (11x)
- font-black/extrabold 6x — headings use semibold
- text-slate/gray-400 for text 2x (check AA contrast)
- Fetches data but no loading state found
- 5 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader

### `/dashboard/medical/labs` (high, L (0.5-1d))

Files: `src/app/dashboard/medical/labs/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`, `src/components/labs/LabWorklist.tsx`, `src/components/labs/LabOrderCard.tsx`, `src/components/labs/LabOrderForm.tsx`, `src/components/labs/StandingOrdersList.tsx`

- Tiny text <11px used 5x
- rounded-2xl used 4x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Hard-coded hex colour classes 21x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: indigo, purple (8x)
- text-slate/gray-300/400 for text 13x — fails AA on white (use slate-500+)
- 2 fixed widths >= 500px — check tablet/phone layout
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical` (high, XL (1-2d))

Files: `src/app/dashboard/medical/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`, `src/features/medical/components/RoomingPanel.tsx`, `src/features/medical/components/ProviderInBasket.tsx`, `src/features/medical/components/MaWorklist.tsx`, `src/features/medical/components/PrimaryCareSettingsCard.tsx`, `src/features/medical/components/CareGapActionForm.tsx`

- Tiny text <11px used 3x
- rounded-2xl used 8x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Hard-coded hex colour classes 35x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: indigo (2x)
- font-black/extrabold 5x — headings use semibold
- text-slate/gray-400 for text 6x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/referrals` (medium, L (0.5-1d))

Files: `src/app/dashboard/medical/referrals/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- rounded-2xl used 4x — standard card radius is rounded-xl
- Heavy shadows (shadow-md/lg/xl/arbitrary) 4x — cards use shadow-xs; only overlays use shadow-lg/xl
- Gradients 1x — use flat brand/semantic fills
- Off-palette/duplicate colour families (indigo) 25x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 5x (check AA contrast)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/vitals` (medium, M (2-4h))

Files: `src/app/dashboard/medical/vitals/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 3x — use flat brand/semantic fills
- Off-palette/duplicate colour families (indigo, yellow) 28x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-300/400 for text 10x — fails AA on white (use slate-500+)
- 2 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/preventive-care` (medium, M (2-4h))

Files: `src/app/dashboard/medical/preventive-care/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 2x — use flat brand/semantic fills
- Off-palette/duplicate colour families (indigo) 25x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- font-black/extrabold 4x — headings use semibold
- text-slate/gray-400 for text 3x (check AA contrast)
- 4 different filled button colours — use Button primary/secondary/ghost/danger
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/payer-settings` (medium, L (0.5-1d))

Files: `src/app/dashboard/medical/payer-settings/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- rounded-2xl used 11x — standard card radius is rounded-xl
- Gradients 1x — use flat brand/semantic fills
- Hard-coded hex colour classes 38x (e.g. bg-[#5C2D91]) — use blue-600/brand tokens
- Off-palette colour families: purple, teal, indigo (14x)
- text-slate/gray-400 for text 6x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/patients/intake` (medium, L (0.5-1d))

Files: `src/app/dashboard/medical/patients/intake/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 1x
- Hard-coded hex colour classes 1x
- Off-palette colour families: indigo (1x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader

### `/dashboard/medical/problem-list` (medium, M (2-4h))

Files: `src/app/dashboard/medical/problem-list/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 2x — use flat brand/semantic fills
- Off-palette/duplicate colour families (purple, indigo) 29x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 3x (check AA contrast)
- 1 grid(s) with unprefixed grid-cols-3 or 7+ (no phone breakpoint; globals.css only rescues 4-6) — start at 1 column
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/ai` (medium, M (2-4h))

Files: `src/app/dashboard/medical/ai/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 1x — use flat brand/semantic fills
- Inline style={{}} 1x
- Off-palette/duplicate colour families (indigo) 20x — map to brand + semantic tones (slate, emerald, amber, rose, sky)
- text-slate/gray-400 for text 2x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/patients` (low, M (2-4h))

Files: `src/app/dashboard/medical/patients/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 1x — use flat brand/semantic fills
- Hard-coded hex colour classes 7x
- Off-palette colour families: red, indigo (6x)
- text-slate/gray-400 for text 6x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/dashboard/medical/history` (low, M (2-4h))

Files: `src/app/dashboard/medical/history/page.tsx`, `src/features/medical/components/MedicalNavHeader.tsx`

- Gradients 1x — use flat brand/semantic fills
- Off-palette colour families: indigo (13x)
- text-slate/gray-400 for text 1x (check AA contrast)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

## Patient portal

| Page | Severity | Effort | Score |
|---|---|---|---:|
| `/patient/login` | medium | S (<1h) | 4.5 |
| `/patient/billing` | low | M (2-4h) | 3.5 |
| `/patient/documents` | low | M (2-4h) | 3.5 |
| `/patient/home` | low | M (2-4h) | 3.5 |
| `/patient/accept` | low | S (<1h) | 3 |
| `/patient/resources` | low | M (2-4h) | 2 |

### `/patient/login` (medium, S (<1h))

Files: `src/app/patient/login/page.tsx`

- Hard-coded hex colour classes 6x
- Off-palette colour families: red (3x)
- Fetches data but no loading state found
- No empty state found for list/table data
- Custom page header markup — use PageHeader

### `/patient/billing` (low, M (2-4h))

Files: `src/app/patient/billing/page.tsx`, `src/features/patient/PortalPersonSwitcher.tsx`

- Off-palette colour families: red (7x)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/patient/documents` (low, M (2-4h))

Files: `src/app/patient/documents/page.tsx`, `src/features/patient/PortalPersonSwitcher.tsx`

- Off-palette colour families: red (4x)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/patient/home` (low, M (2-4h))

Files: `src/app/patient/home/page.tsx`, `src/features/patient/ProfileEditor.tsx`, `src/features/patient/PortalPersonSwitcher.tsx`

- Hard-coded hex colour classes 1x
- Off-palette colour families: red, green (9x)
- Fetches data but no loading state found
- Custom page header markup — use PageHeader

### `/patient/accept` (low, S (<1h))

Files: `src/app/patient/accept/page.tsx`

- Hard-coded hex colour classes 9x
- Off-palette colour families: red, indigo (9x)
- No empty state found for list/table data
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

### `/patient/resources` (low, M (2-4h))

Files: `src/app/patient/resources/page.tsx`, `src/features/resources/CrisisLinesButton.tsx`, `src/features/patient/PortalPersonSwitcher.tsx`

- Hard-coded hex colour classes 10x
- Off-palette colour families: red (4x)
- Custom page header markup — use PageHeader
- No shared UI primitives used (all hand-rolled chrome)

## Redirects and aliases (no UI of their own)

- `/dashboard/billing/prior-auth`: Legacy redirect (no UI)
- `/dashboard/ehr/mandatory-reporting`: Alias of /dashboard/compliance/mandatory-reporting (audited there)
- `/dashboard/ehr/prior-auths`: Legacy redirect (no UI)
- `/dashboard/ehr/session-ai`: Legacy redirect (no UI)
- `/dashboard/medical/patients/[id]`: Legacy redirect (no UI)
- `/dashboard/prior-auth`: Legacy redirect (no UI)
- `/dashboard/statements`: Legacy redirect (no UI)
