# Altrixs staff app design system

One visual standard for the clinician and staff app (`/dashboard/**`) and the patient portal (`/patient/**`).
It is modelled on modern clinical and SaaS consoles (athenaOne, Epic Hyperspace's modern skin, SimplePractice,
Linear and the Stripe dashboard): quiet neutral surfaces, one brand colour for primary actions and selection,
colour only where it carries meaning (status, risk), dense but readable tables, and the same page frame on every screen.

- **Primitives:** `src/components/ui` (import from `@/components/ui`)
- **Tokens:** `src/components/ui/tokens.ts`, `tailwind.config.js`, `src/app/globals.css`
- **Audit of every page against this standard:** `docs/ui-audit.md` and `docs/ui-audit.json`
- **Reference pages:** `/dashboard/appointments` (header, KPIs, view switcher), `/dashboard/ehr/notes` (header, banners, worklist tabs, filters, list states), `/dashboard/billing` (header, banners, overview cards, section tabs)

Legacy helpers in `src/components/clinic/ui.tsx` (`PageHeader`, `StatCard`, `Badge`, `Panel`, `EmptyState`) still work and look the same. Move pages to the `@/components/ui` versions when you touch them.

---

## 1. Tokens

### Brand

Tailwind's `blue-*` scale is remapped to the Altrixs purple in `tailwind.config.js` (`brand-*` is an alias), so **`blue-600` is #5C2D91**. Use the scale classes. Do not hard-code hex values.

| Role | Class | Hex | Use |
|---|---|---|---|
| Primary | `bg-blue-600` / `text-blue-600` | #5C2D91 | Primary buttons, selected tab, links, focus ring |
| Primary hover | `bg-blue-700` | #4A2475 | Hover/pressed |
| Primary soft | `bg-blue-50`, `ring-blue-200`, `text-blue-700` | #F5F3FF | Selected rows, brand pills, info about the product |
| Navy | `text-blue-900` / `bg-[#141C34]` (sidebar only) | #141C34 | App chrome (sidebar). Not for page content |
| Gold accent | `#D4A017` | | Marketing and sidebar badges only. Never for status |
| Teal / coral accents | | #00897B / #E8673A | Marketing and illustrations only. In product UI, use the semantic colours below |

Do not use `purple-*`, `violet-*` or `indigo-*` for brand. They are near-duplicates of the brand scale and drift. Use `blue-*`.

### Neutrals

Use `slate` only. Do not use `gray`, `zinc`, `neutral` or `stone`.

| Token | Class | Use |
|---|---|---|
| App background | `bg-slate-50` (#F8FAFC, set on `body`) | Behind cards |
| Surface | `bg-white` | Cards, tables, modals |
| Subtle surface | `bg-slate-50` | Table header, card footer, filter bar |
| Border | `border-slate-200` | Cards, inputs (`border-slate-300` for form controls), dividers |
| Divider (inside cards) | `divide-slate-100` / `border-slate-100` | Table rows, list rows |
| Text, primary | `text-slate-900` | Titles, values |
| Text, body | `text-slate-700` | Paragraphs, table cells |
| Text, secondary | `text-slate-500`, `text-slate-600` | Descriptions, meta, labels |
| Text, disabled/placeholder | `text-slate-500` | Placeholders. **`slate-400` and lighter are for icons and borders only.** They fail AA on white |

### Semantic status colours

Choose the colour by what it means, never by taste. `tokens.ts` exports the exact class sets (`TONE_SOFT`, `TONE_BANNER`, `TONE_DOT`, `TONE_ICON`).

| Tone | Family | Meaning | Soft pill (bg / text / ring) |
|---|---|---|---|
| `success` | emerald | Done, active, paid, signed, eligible | `bg-emerald-50 text-emerald-800 ring-emerald-200` |
| `warning` | amber | Needs attention, pending, due soon, unsigned | `bg-amber-50 text-amber-800 ring-amber-200` |
| `danger` | rose | Failed, denied, overdue, high risk, destructive | `bg-rose-50 text-rose-700 ring-rose-200` |
| `info` | sky | In progress, scheduled, submitted, informational | `bg-sky-50 text-sky-800 ring-sky-200` |
| `brand` | blue (purple) | Product or feature labels, role chips, AI | `bg-blue-50 text-blue-700 ring-blue-200` |
| `neutral` | slate | Draft, inactive, cancelled, unknown | `bg-slate-100 text-slate-700 ring-slate-200` |

Do not use `red-*` (use `rose-*`), `green-*` (use `emerald-*`), `yellow-*`/`orange-*` (use `amber-*`), or `teal`/`cyan`/`pink`/`fuchsia`/`lime` for status.
Crisis and risk UI uses `danger`. 988 and crisis content keeps its existing `CrisisFooter`.

### Spacing

Use Tailwind's 4px scale. In practice:

| Context | Value |
|---|---|
| Between page sections (`Page`) | `space-y-6` (24px) |
| Between cards in a grid | `gap-4` (16px) |
| Card padding | `p-5` (20px). Compact cards and KPI tiles use `p-4` |
| Card header | `px-5 py-4` |
| Inside a form | `space-y-4` between fields, `gap-4` in field grids |
| Button groups | `gap-2` |
| Table cells | `px-4 py-3` (comfortable), `px-4 py-2` (compact) |

### Radius, shadow, border

- **Card radius: `rounded-xl` (12px). One radius for every card, panel, table wrapper and banner container.**
- Controls (buttons, inputs, selects, tabs in pill mode): `rounded-lg` (8px).
- Pills and badges: `rounded-full`.
- Modals and drawers: `rounded-xl` (existing `ClinicalModal` uses `rounded-2xl`; it is grandfathered).
- `rounded-2xl` and `rounded-3xl` are not used for content cards.
- **Shadow: `shadow-xs` on cards.** `shadow-sm` is allowed on hover for clickable cards. `shadow-lg`/`shadow-xl` are for overlays only (menus, popovers, modals). No coloured or arbitrary shadows.
- Border: `border border-slate-200` on every card. No coloured card borders (`border-purple-100` etc.); use a status `Alert` or a `StatusBadge` to carry colour.
- No gradients in product UI (buttons, cards, headers, KPI tiles). Flat brand and semantic fills only.

### Typography

Inter, with tabular numbers for figures (`stat-number` / `tabular-nums`).

| Level | Classes | Size | Use |
|---|---|---|---|
| Page title | `text-2xl font-semibold tracking-tight text-slate-900` | 24px | One `h1` per page, via `PageHeader` |
| Page description | `text-sm text-slate-500` | 14px | One line under the title |
| Section title | `text-base font-semibold text-slate-900` | 16px | `Section` (`h2`) |
| Card title | `text-sm font-semibold text-slate-900` | 14px | `CardHeader` (`h2`/`h3`) |
| Body | `text-sm text-slate-700` | 14px | Paragraphs, table cells, form values |
| Meta / helper | `text-xs text-slate-500` | 12px | Timestamps, helper text, table header |
| KPI value | `text-2xl font-semibold tabular-nums` | 24px | `StatCard` |
| Smallest allowed | `text-[11px]` | 11px | Badges, count pills, eyebrow labels only |

Rules:
- Nothing under 11px. Content text (anything a user must read to act) is at least 12px (`text-xs`).
- Headings use `font-semibold`. `font-bold` is acceptable for KPI values. Do not use `font-black` or `font-extrabold`.
- No ALL-CAPS body text. Uppercase is only for tiny eyebrow labels, with `tracking-wider`.
- The `.business-app` CSS in `globals.css` normalises legacy billing/admin pages. New pages should not depend on it.

### Icons

Lucide React only. No emoji, and no Unicode glyphs used as icons (✓ ✕ ★ ▲ →).

| Context | Size |
|---|---|
| Inline in buttons, badges, table actions | 16px (`h-4 w-4`). 14px (`h-3.5 w-3.5`) in `sm` badges |
| Card header / Alert | 16–20px |
| KPI chip / EmptyState | 18–20px in a 36–40px chip |

Decorative icons get `aria-hidden`. An icon-only button must use `IconButton`, which requires a `label`.

---

## 2. Page layout

```tsx
<Page>                                   {/* mx-auto max-w-7xl space-y-6; width="full" for calendars/boards */}
  <PageHeader
    title="Billing"
    description="Claims · ERA · Payments · Revenue Cycle"
    badges={<StatusBadge tone="brand">Beta</StatusBadge>}
    actions={<>
      <Button variant="secondary" icon={<Download />}>Export</Button>   {/* secondary first */}
      <Button icon={<Plus />}>New claim</Button>                         {/* primary last, rightmost */}
    </>}
  />
  <Alert tone="warning">…page-level status…</Alert>
  <StatGrid columns={4}>…<StatCard/>…</StatGrid>
  <Card>
    <CardHeader title="Claims" description="…" actions={…} />
    <DataTable … />
  </Card>
</Page>
```

- The app shell already provides page padding (`px-3 sm:px-6`, top `py-3 sm:py-4`). Pages do not add their own outer padding.
- Max width: `max-w-7xl` (1280px) by default. Use `width="full"` for schedule grids, boards, split chart views and editors. Use `width="narrow"` (`max-w-3xl`) for single forms and settings.
- Header order: title, then badges, then description. Actions sit on the right and wrap below the title on phones. **Only one primary button per page header.**
- Order of a page: header, page-level alerts, KPIs, filters or tabs, content.

## 3. Cards and sections

- `Card` is the single surface. Use `CardHeader` (title, optional description, actions) and `CardBody` (`p-5`, or `flush` for tables and lists). `CardFooter` holds form actions, right-aligned.
- `Section` groups several cards under an `h2` without adding another box. Do not nest cards in cards. Inside a card, use dividers or a `bg-slate-50` sub-panel with `rounded-lg`.
- Coloured cards (`bg-purple-50`, tinted borders) are not used for content. Colour belongs in `Alert`, `StatusBadge` or a KPI icon chip.

## 4. KPI / stat cards

`StatCard` has a white surface, a neutral label (13px, slate-600), a 24px tabular value and an optional hint (12px). The tone colours **only** the small icon chip. Pass `href` to make the whole tile a link with a focus ring. Lay KPIs out with `StatGrid` (1 column on phones, 2 on tablets, 2–5 on desktop).
Do not use per-tile background colours, ALL-CAPS labels or `font-extrabold` values.

## 5. Tables

Use `DataTable` for lists, or match its markup:

- Wrapper: inside a `Card` (flush), horizontally scrollable (`clinic-scroll-x`) so phones scroll the table, not the page.
- Every table has a `<thead>` with `<th scope="col">`. Header: `bg-slate-50`, `text-xs font-semibold text-slate-600`, sentence case (no uppercase tracking).
- Rows: `divide-y divide-slate-100`, `hover:bg-slate-50`, cells `px-4 py-3 text-sm text-slate-700`. `density="compact"` (`py-2`) is for dense work queues.
- Numbers are right-aligned (`align: 'right'`) and tabular.
- Status columns use `StatusBadge`. Row actions sit in the last column as `sm` secondary or ghost buttons. At most one primary action per row.
- On phones, hide low-value columns with `hideOnMobile` and keep 2–3 columns.
- States are built in: loading (skeleton rows), error (`ErrorState` with retry), empty (`EmptyState`, which says what would appear and how to add it).
- Pagination sits in the `footer` slot: "1–25 of 312" on the left, previous/next `IconButton`s on the right.

## 6. Tabs

`Tabs` follows the WAI-ARIA tabs pattern (arrow keys, Home/End, `aria-selected`).

- `variant="underline"` (default) for page or card sections. The selected tab gets `border-blue-600 text-blue-700`.
- `variant="pill"` for compact view switchers (Calendar / Board / List).
- Use `count` for queue sizes and `countTone="attention"` when the count needs action.
- If the tab re-renders page content without a `TabPanel`, pass `controlsPanels={false}`.

## 7. Forms

Use `FormField` around every control. It wires `id`, `aria-describedby`, `aria-invalid` and `aria-required`.

- The label sits above the control (`text-sm font-medium text-slate-700`). Required fields show a rose `*`, and the control gets `aria-required`.
- Helper text goes below the control (`text-xs text-slate-500`). Error text goes below it in rose-700, and the helper text stays visible.
- Controls use `inputClasses`: `rounded-lg border-slate-300`, 36–40px tall, brand focus border and ring, rose border when invalid.
- Layout: one column on phones. Use `sm:grid-cols-2` for short fields. Form actions go in a `CardFooter` or modal footer, right-aligned, with Cancel (secondary) before Save (primary).
- Validate on submit and on blur. Never only by colour.

## 8. Buttons

`Button` / `buttonClasses()` (use `buttonClasses` for `<Link>`s that look like buttons).

| Variant | Look | Use |
|---|---|---|
| `primary` | `bg-blue-600 text-white` | The one main action in a header, form or modal |
| `secondary` | white, `border-slate-300`, slate-700 text | Everything else: export, filter, cancel |
| `ghost` | text only, `hover:bg-slate-100` | Toolbar and row actions, low emphasis |
| `danger` | `bg-rose-700 text-white` | Destructive actions, always behind `ConfirmDialog` |

Sizes: `sm` (32px, row actions and toolbars), `md` (36px, default), `lg` (40px, single-form submit).
`loading` shows a spinner, disables the button and sets `aria-busy`. Icons sit on the left at 16px. Do not use gradient buttons, inline `style={{ background }}` buttons or one-off filled colours.

## 9. Badges and status pills

`StatusBadge tone=… [dot] [icon] [size="sm"]`. Use `toneForStatus(status)` for common workflow strings (paid, denied, pending, signed, no show, and so on).
Badges are `rounded-full`, 12px (11px for `sm`), `font-medium`, and use the soft tone set. Always say the status in text. The colour is a reinforcement, never the only signal.

## 10. Alerts and banners

`Alert tone title actions`. Use it for page or section messages: connection status, compliance notices, save results, prerequisites ("Intake signed. Next: the treatment plan.").
`danger`/`warning` use `role="alert"`. The others use `role="status"`. Use toasts (`react-hot-toast`) only for transient confirmations of an action the user just took.

## 11. Modals and drawers

`Modal` (alias of `ClinicalModal`): a native `<dialog>` with a focus trap, Escape to close, a sticky header with the title (`h2`) and close button, and a sticky footer for actions. Sizes run `sm` (confirmations) to `xl` (editors). Use `ConfirmDialog` for destructive or legally significant confirmations.
Hand-rolled `fixed inset-0` overlays are legacy. They lack focus management, so move them to `Modal` when touched.

## 12. Empty, loading and error states

Every data-backed view handles all three:

- **Loading:** `LoadingState` (spinner and label), or `rows={n}` skeleton lines for lists and tables. Keep the page chrome rendered while loading.
- **Empty:** `EmptyState`. Write it as a sentence that says what will appear here, plus the next action ("No claims yet. Create a claim from a signed note.").
- **Error:** `ErrorState` with `onRetry`, or a danger `Alert` when the rest of the page still works. Say what failed in plain words. No stack traces or raw JSON.

## 13. Accessibility (WCAG 2.1 AA)

- Contrast: body text is at least 4.5:1. `text-slate-500` on white is the lightest text allowed. Placeholder text is `slate-500`.
- Focus: every interactive element shows the brand ring. `globals.css` sets `:focus-visible { outline: 2px solid #5C2D91 }`, and primitives add `focus-visible:ring-2 ring-blue-600`. Never `outline-none` without a replacement.
- One `h1` per page (`PageHeader`). Headings descend without skipping (h1, then h2 in Section/CardHeader, then h3).
- Icon-only controls use `IconButton` (required `label`). Decorative icons are `aria-hidden`.
- Tables have `<thead>`/`th scope="col"` and an optional `caption` (screen-reader only).
- Status is never colour-only: badges carry text, and errors carry text.
- Target size is at least 32px for row actions and 36px for primary controls. On phones, inputs render at 16px (no iOS zoom; see `globals.css`).
- Respect `prefers-reduced-motion` (handled globally).

## 14. Responsive

- Design for 1280+ desktop, 768–1024 tablet (front desk iPads) and 375 phone (clinicians on the go).
- Grids always start at one column and add columns at `sm:`/`md:`/`lg:`. Never use `grid-cols-3+` without a breakpoint prefix.
- No fixed widths over 480px. Use `max-w-*` and `min-w-0` on flex children so long names truncate.
- Tables scroll horizontally inside their card, with `hideOnMobile` on secondary columns.
- Header actions wrap under the title on phones. Tab lists scroll horizontally.

## 15. Do and don't

| Do | Don't |
|---|---|
| `<PageHeader title description actions />` | Hand-rolled `<h1 className="text-[22px] font-bold text-[#141C34]">` |
| `<Card>` (`rounded-xl border-slate-200 shadow-xs`) | `rounded-2xl border-purple-100 shadow-md`, `rounded-3xl`, tinted cards |
| `<Button>` / `buttonClasses()` | `style={{ background: 'linear-gradient(135deg,#5C2D91,#7C3AED)' }}` |
| `bg-blue-600`, `text-blue-700` | `bg-[#5C2D91]`, `text-purple-700`, `bg-violet-600` |
| `StatusBadge tone="danger"` for denied | Red text with no label, `bg-red-100`, `text-orange-600` |
| `StatCard` with tone on the icon only | Four differently tinted KPI tiles with `text-3xl font-extrabold` |
| `text-xs text-slate-500` for meta | `text-[10px] text-gray-400` |
| Lucide `<Check />`, `<X />` | `✓`, `✕`, emoji |
| `EmptyState` with a next step | Blank table body or "No data" |
| `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` | `grid-cols-4` |
| `Modal` / `ConfirmDialog` | `fixed inset-0 bg-black/50` overlays without focus management |
