'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, MapPin, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Alert, Button, EmptyState, StatCard, StatusBadge, cx, FOCUS_RING, type Tone } from '@/components/ui';
import {
  ACCREDITATION_BODIES,
  BAA_STATUSES,
  COMMON_TAXONOMIES,
  COPAY_POLICIES,
  COSIGNABLE_ROLES,
  ESCALATION_ROLES,
  MD_RETENTION_NOTE,
  PRACTICE_TYPES,
  RENDERING_DEFAULTS,
  SPECIALTY_OPTIONS,
  TELEHEALTH_MODIFIERS,
  TELEHEALTH_PLATFORMS,
  TREATMENT_PLAN_NOTE,
  US_TIME_ZONES,
  type SettingsSectionKey,
} from '@/lib/practice/settings';
import type { BaaView, LocationView, PracticeSettingsView } from '@/lib/practice/checklist';
import { SECURITY_POLICY } from '@/lib/practice/securityPolicy';
import { PLACEHOLDER_LABEL, isPlaceholderNpi } from '@/lib/practice/placeholders';
import {
  isValidClia,
  isValidEin,
  isValidNpi,
  isValidTaxonomy,
} from '@/lib/practice/validators';
import { BillingProviderPanel, PayerMappingPanel } from '@/app/dashboard/billing/payer-settings/WaystarSettingsPanels';
import {
  Card,
  ChecklistList,
  Field,
  inputClass,
  MoneyInput,
  NumberInput,
  SaveBar,
  Select,
  TextInput,
  Toggle,
  useSaver,
  type Overview,
} from './ui';
import { ProgramsCapacitySection } from './programsCapacity';
import { MbcRuleList, useMbcOptions } from './mbcRules';

type SectionProps = { overview: Overview; onSaved: (o: Overview) => void; refresh?: () => void };

/** Embedded panels save through their own APIs; this re-reads the checklist afterwards. */
function RefreshButton({ refresh }: { refresh?: () => void }) {
  if (!refresh) return null;
  return (
    <button type="button" onClick={refresh} className={cx('inline-flex items-center gap-1 rounded text-sm font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh checklist
    </button>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const tzOptions = US_TIME_ZONES.map((z) => ({ value: z, label: z.replace('America/', '').replace('Pacific/', '').replace('_', ' ') }));
const roleLabel = (r: string) => r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Draft copy of the settings, reset whenever the saved row changes. */
function useDraft(settings: PracticeSettingsView) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const set = <K extends keyof PracticeSettingsView>(k: K, v: PracticeSettingsView[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return { draft, set };
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

export function SectionItems({ overview, section }: { overview: Overview; section: SettingsSectionKey }) {
  const items = overview.checklist.items.filter((i) => i.section === section);
  if (!items.length) return null;
  return (
    <Card title="Checklist" description="What this section still needs.">
      <ChecklistList items={items} />
    </Card>
  );
}

// ─── Practice profile ────────────────────────────────────────────────────────

const PROFILE_KEYS = [
  'legalName', 'dbaName', 'practiceType', 'specialties', 'organizationNpi', 'taxonomyCodes', 'medicaidProviderNumber',
  'medicarePtan', 'cliaNumber', 'omhcLicenseNumber', 'omhcLicenseExpiresOn', 'prpLicenseNumber', 'prpLicenseExpiresOn',
  'accreditationBody', 'accreditationExpiresOn', 'logoUrl', 'brandColor', 'mainPhone', 'mainFax', 'mainEmail', 'website',
  'timeZone', 'fiscalYearStartMonth',
] as const;

export function ProfileSection({ overview, onSaved }: SectionProps) {
  const { draft, set } = useDraft(overview.settings);
  const [taxId, setTaxId] = useState('');
  const [taxonomyText, setTaxonomyText] = useState(overview.settings.taxonomyCodes.join(', '));
  useEffect(() => setTaxonomyText(overview.settings.taxonomyCodes.join(', ')), [overview.settings.taxonomyCodes]);
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  const taxonomies = taxonomyText.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const npiBad = (Boolean(draft.organizationNpi) && !isValidNpi(draft.organizationNpi)) || isPlaceholderNpi(draft.organizationNpi);
  const einBad = Boolean(taxId) && !isValidEin(taxId);
  const taxonomyBad = taxonomies.some((t) => !isValidTaxonomy(t));
  const cliaBad = Boolean(draft.cliaNumber) && !draft.cliaFromEnv && !isValidClia(draft.cliaNumber);

  const save = () => {
    const data: Record<string, unknown> = { ...pick(draft, PROFILE_KEYS), taxonomyCodes: taxonomies };
    if (draft.cliaFromEnv && draft.cliaNumber === overview.settings.cliaNumber) data.cliaNumber = null;
    if (taxId.trim()) data.taxId = taxId.trim();
    void run('/api/practice-settings', { section: 'profile', data }).then((ok) => ok && setTaxId(''));
  };

  return (
    <div className="space-y-5">
      <Card title="Identity" description="Legal entity and practice type, as registered with the IRS and NPPES.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Legal business name" required>
            <TextInput value={draft.legalName} onChange={(v) => set('legalName', v)} disabled={ro} />
          </Field>
          <Field label="DBA / doing business as">
            <TextInput value={draft.dbaName} onChange={(v) => set('dbaName', v)} disabled={ro} />
          </Field>
          <Field label="Practice type" required>
            <Select value={draft.practiceType} onChange={(v) => set('practiceType', v || null)} options={PRACTICE_TYPES} placeholder="Select…" disabled={ro} />
          </Field>
          <Field label="Time zone">
            <Select value={draft.timeZone} onChange={(v) => set('timeZone', v)} options={tzOptions} disabled={ro} />
          </Field>
        </div>
        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium text-slate-700">Services / specialties</span>
          <div className="flex flex-wrap gap-2">
            {SPECIALTY_OPTIONS.map((s) => {
              const on = draft.specialties.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={ro}
                  onClick={() => set('specialties', on ? draft.specialties.filter((x) => x !== s) : [...draft.specialties, s])}
                  aria-pressed={on}
                  className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 transition', FOCUS_RING, on ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-200 hover:ring-blue-600')}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card title="Identifiers" description="Used on claims, eligibility, labs and e-prescribing. Leave blank until you have the real number — nothing is pre-filled.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Organization NPI (Type 2)" required error={isPlaceholderNpi(draft.organizationNpi) ? PLACEHOLDER_LABEL : npiBad ? 'Fails the NPI check digit' : null} hint="10 digits from NPPES">
            <TextInput value={draft.organizationNpi} onChange={(v) => set('organizationNpi', v.replace(/\D/g, '').slice(0, 10))} disabled={ro} invalid={npiBad} />
          </Field>
          <Field
            label="Tax ID (EIN)"
            required
            error={einBad ? 'EIN is 9 digits (NN-NNNNNNN) with a valid IRS prefix' : null}
            hint={overview.settings.hasTaxId ? `On file: ${overview.settings.taxIdMasked}. Enter a new EIN only to replace it.` : 'Not on file'}
          >
            <TextInput value={taxId} onChange={setTaxId} disabled={ro} placeholder={overview.settings.hasTaxId ? overview.settings.taxIdMasked : 'NN-NNNNNNN'} invalid={einBad} />
          </Field>
          <Field
            label="Taxonomy codes"
            required
            error={taxonomyBad ? 'Each code is 10 characters ending in X' : null}
            hint={<>First code is primary. Common: {COMMON_TAXONOMIES.slice(0, 3).map((t) => `${t.code} (${t.label.split(' — ')[1] || t.label})`).join(', ')}</>}
            className="sm:col-span-2"
          >
            <TextInput value={taxonomyText} onChange={setTaxonomyText} disabled={ro} placeholder="261QM0801X" invalid={taxonomyBad} />
          </Field>
          <Field label="Medicaid provider number" hint="Maryland Medicaid (MMIS) number for this organization">
            <TextInput value={draft.medicaidProviderNumber} onChange={(v) => set('medicaidProviderNumber', v)} disabled={ro} />
          </Field>
          <Field label="Medicare PTAN" hint="Only if enrolled in Medicare">
            <TextInput value={draft.medicarePtan} onChange={(v) => set('medicarePtan', v.toUpperCase())} disabled={ro} />
          </Field>
          <Field
            label="CLIA number"
            error={cliaBad ? 'CLIA is 2 digits, D, 7 digits' : null}
            hint={draft.cliaFromEnv ? 'Currently from server configuration (LAB_FACILITY_CLIA). Save a value here to manage it in settings.' : 'Needed only for in-house lab testing; printed on lab requisitions'}
          >
            <TextInput value={draft.cliaNumber} onChange={(v) => { set('cliaNumber', v.toUpperCase()); set('cliaFromEnv', false); }} disabled={ro} invalid={cliaBad} />
          </Field>
        </div>
      </Card>

      <Card title="Licenses & accreditation" description="Maryland behavioral health program licenses (COMAR 10.63) and accreditation.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="OMHC license number">
            <TextInput value={draft.omhcLicenseNumber} onChange={(v) => set('omhcLicenseNumber', v)} disabled={ro} />
          </Field>
          <Field label="OMHC license expires">
            <TextInput type="date" value={draft.omhcLicenseExpiresOn} onChange={(v) => set('omhcLicenseExpiresOn', v || null)} disabled={ro} />
          </Field>
          <Field label="PRP license / approval number">
            <TextInput value={draft.prpLicenseNumber} onChange={(v) => set('prpLicenseNumber', v)} disabled={ro} />
          </Field>
          <Field label="PRP license expires">
            <TextInput type="date" value={draft.prpLicenseExpiresOn} onChange={(v) => set('prpLicenseExpiresOn', v || null)} disabled={ro} />
          </Field>
          <Field label="Accreditation">
            <Select value={draft.accreditationBody} onChange={(v) => set('accreditationBody', v || null)} options={ACCREDITATION_BODIES} placeholder="Not recorded" disabled={ro} />
          </Field>
          <Field label="Accreditation expires">
            <TextInput type="date" value={draft.accreditationExpiresOn} onChange={(v) => set('accreditationExpiresOn', v || null)} disabled={ro || !draft.accreditationBody || draft.accreditationBody === 'none'} />
          </Field>
        </div>
      </Card>

      <Card title="Contact & branding">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Main phone" required>
            <TextInput value={draft.mainPhone} onChange={(v) => set('mainPhone', v)} disabled={ro} placeholder="(301) 555-0100" />
          </Field>
          <Field label="Fax">
            <TextInput value={draft.mainFax} onChange={(v) => set('mainFax', v)} disabled={ro} />
          </Field>
          <Field label="Main email" required>
            <TextInput type="email" value={draft.mainEmail} onChange={(v) => set('mainEmail', v)} disabled={ro} />
          </Field>
          <Field label="Website">
            <TextInput value={draft.website} onChange={(v) => set('website', v)} disabled={ro} placeholder="https://" />
          </Field>
          <Field label="Logo URL" hint="https:// link or a site path such as /logo.png">
            <TextInput value={draft.logoUrl} onChange={(v) => set('logoUrl', v)} disabled={ro} />
          </Field>
          <Field label="Brand color">
            <div className="flex items-center gap-2">
              <input type="color" className="h-9 w-12 rounded border border-slate-200" value={draft.brandColor || '#5C2D91'} disabled={ro} onChange={(e) => set('brandColor', e.target.value.toUpperCase())} />
              <TextInput value={draft.brandColor} onChange={(v) => set('brandColor', v)} disabled={ro} placeholder="#5C2D91" />
            </div>
          </Field>
          <Field label="Fiscal year starts">
            <Select value={String(draft.fiscalYearStartMonth)} onChange={(v) => set('fiscalYearStartMonth', Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} disabled={ro} />
          </Field>
        </div>
        {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={save} disabled={npiBad || einBad || taxonomyBad || cliaBad} /> : null}
      </Card>
    </div>
  );
}

// ─── Billing & claims ────────────────────────────────────────────────────────

const BILLING_KEYS = [
  'billingContactName', 'billingContactPhone', 'billingContactEmail', 'payToSameAsBilling', 'payToAddressLine1', 'payToAddressLine2',
  'payToCity', 'payToState', 'payToZip', 'renderingProviderDefault', 'posOffice', 'posTelehealthHome', 'posTelehealthOther',
  'telehealthModifierDefault', 'statementRemitName', 'statementRemitAddressLine1', 'statementRemitAddressLine2', 'statementRemitCity',
  'statementRemitState', 'statementRemitZip', 'statementMessage', 'paymentTermsDays', 'lateFeesEnabled', 'lateFeeCents',
  'copayCollectionPolicy', 'noShowFeeEnabled', 'noShowFeeCents', 'lateCancelFeeEnabled', 'lateCancelFeeCents', 'cancellationWindowHours',
] as const;

const POS_OPTIONS = [
  { value: '11', label: '11 — Office' },
  { value: '22', label: '22 — Outpatient hospital' },
  { value: '53', label: '53 — Community mental health center' },
  { value: '99', label: '99 — Other' },
];
const TELE_POS = [
  { value: '10', label: '10 — Telehealth in patient’s home' },
  { value: '02', label: '02 — Telehealth other than home' },
];

export function BillingSection({ overview, onSaved, refresh }: SectionProps) {
  const { draft, set } = useDraft(overview.settings);
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  return (
    <div className="space-y-5">
      <Card
        title="Billing providers (837P loop 2010AA)"
        description="Organization NPIs, tax ID and NPPES service address that claims are billed under. Claims read these per claim."
        actions={<RefreshButton refresh={refresh} />}
      >
        <BillingProviderPanel />
      </Card>

      <Card title="Billing contact & pay-to address">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Billing contact name" required>
            <TextInput value={draft.billingContactName} onChange={(v) => set('billingContactName', v)} disabled={ro} />
          </Field>
          <Field label="Billing phone">
            <TextInput value={draft.billingContactPhone} onChange={(v) => set('billingContactPhone', v)} disabled={ro} />
          </Field>
          <Field label="Billing email">
            <TextInput type="email" value={draft.billingContactEmail} onChange={(v) => set('billingContactEmail', v)} disabled={ro} />
          </Field>
        </div>
        <div className="mt-4">
          <Toggle
            checked={draft.payToSameAsBilling}
            onChange={(v) => set('payToSameAsBilling', v)}
            disabled={ro}
            label="Payments go to the billing provider address"
            hint="Turn off when remittances go to a different address (837P loop 2010AB pay-to, e.g. a lockbox)."
          />
        </div>
        {!draft.payToSameAsBilling ? (
          <AddressFields
            prefix="payTo"
            draft={draft}
            set={set}
            ro={ro}
            zipHint="ZIP+4 (9 digits)"
          />
        ) : null}
      </Card>

      <Card title="Claim defaults" description="Per-payer telehealth modifiers are set on each payer mapping (Payers section); these are the defaults.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Rendering provider">
            <Select value={draft.renderingProviderDefault} onChange={(v) => set('renderingProviderDefault', v)} options={RENDERING_DEFAULTS} disabled={ro} />
          </Field>
          <Field label="Place of service — in person">
            <Select value={draft.posOffice} onChange={(v) => set('posOffice', v)} options={POS_OPTIONS} disabled={ro} />
          </Field>
          <Field label="Place of service — telehealth, patient at home">
            <Select value={draft.posTelehealthHome} onChange={(v) => set('posTelehealthHome', v)} options={TELE_POS} disabled={ro} />
          </Field>
          <Field label="Place of service — telehealth, other location">
            <Select value={draft.posTelehealthOther} onChange={(v) => set('posTelehealthOther', v)} options={TELE_POS} disabled={ro} />
          </Field>
          <Field label="Default telehealth modifier">
            <Select value={draft.telehealthModifierDefault} onChange={(v) => set('telehealthModifierDefault', v)} options={TELEHEALTH_MODIFIERS} disabled={ro} />
          </Field>
          <Field label="Fee schedule">
            <Link href="/dashboard/billing/fee-schedule" className="inline-flex items-center gap-1 py-2 text-sm font-semibold text-blue-700 hover:underline">
              Open fee schedule <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Field>
        </div>
      </Card>

      <Card title="Patient statements">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Remit-to name" hint="Name printed on the statement remittance stub">
            <TextInput value={draft.statementRemitName} onChange={(v) => set('statementRemitName', v)} disabled={ro} />
          </Field>
          <Field label="Payment terms (days)">
            <NumberInput value={draft.paymentTermsDays} onChange={(v) => set('paymentTermsDays', v)} min={0} max={120} disabled={ro} />
          </Field>
        </div>
        <AddressFields prefix="statementRemit" draft={draft} set={set} ro={ro} zipHint="5 or 9 digits" />
        <div className="mt-4">
          <Field label="Statement message">
            <textarea className={inputClass()} rows={2} value={draft.statementMessage ?? ''} disabled={ro} onChange={(e) => set('statementMessage', e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle checked={draft.lateFeesEnabled} onChange={(v) => set('lateFeesEnabled', v)} disabled={ro} label="Charge late fees on overdue balances" hint="Off by default" />
          {draft.lateFeesEnabled ? (
            <Field label="Late fee">
              <MoneyInput cents={draft.lateFeeCents} onChange={(v) => set('lateFeeCents', v)} disabled={ro} />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title="Front-desk financial policy">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Copay collection">
            <Select value={draft.copayCollectionPolicy} onChange={(v) => set('copayCollectionPolicy', v)} options={COPAY_POLICIES} disabled={ro} />
          </Field>
          <Field label="Late-cancel window (hours before the visit)">
            <NumberInput value={draft.cancellationWindowHours} onChange={(v) => set('cancellationWindowHours', v)} min={0} max={168} disabled={ro} />
          </Field>
          <Toggle checked={draft.noShowFeeEnabled} onChange={(v) => set('noShowFeeEnabled', v)} disabled={ro} label="Charge a no-show fee" hint="Off: no-shows are recorded but not charged" />
          {draft.noShowFeeEnabled ? (
            <Field label="No-show fee">
              <MoneyInput cents={draft.noShowFeeCents} onChange={(v) => set('noShowFeeCents', v)} disabled={ro} />
            </Field>
          ) : <span />}
          <Toggle checked={draft.lateCancelFeeEnabled} onChange={(v) => set('lateCancelFeeEnabled', v)} disabled={ro} label="Charge a late-cancel fee" hint="Off: late cancels are recorded but not charged" />
          {draft.lateCancelFeeEnabled ? (
            <Field label="Late-cancel fee">
              <MoneyInput cents={draft.lateCancelFeeCents} onChange={(v) => set('lateCancelFeeCents', v)} disabled={ro} />
            </Field>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-slate-500">Medicaid beneficiaries may not be charged for missed appointments; fees apply only to commercial / self-pay clients.</p>
        {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={() => void run('/api/practice-settings', { section: 'billing', data: pick(draft, BILLING_KEYS) })} /> : null}
      </Card>
    </div>
  );
}

function AddressFields({
  prefix,
  draft,
  set,
  ro,
  zipHint,
}: {
  prefix: 'payTo' | 'statementRemit';
  draft: PracticeSettingsView;
  set: <K extends keyof PracticeSettingsView>(k: K, v: PracticeSettingsView[K]) => void;
  ro: boolean;
  zipHint: string;
}) {
  const k = (s: string) => `${prefix}${s}` as keyof PracticeSettingsView;
  const val = (s: string) => draft[k(s)] as string | null;
  const upd = (s: string, v: string) => set(k(s), v as never);
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-6">
      <Field label="Street address" className="sm:col-span-3">
        <TextInput value={val('AddressLine1')} onChange={(v) => upd('AddressLine1', v)} disabled={ro} />
      </Field>
      <Field label="Suite / line 2" className="sm:col-span-3">
        <TextInput value={val('AddressLine2')} onChange={(v) => upd('AddressLine2', v)} disabled={ro} />
      </Field>
      <Field label="City" className="sm:col-span-3">
        <TextInput value={val('City')} onChange={(v) => upd('City', v)} disabled={ro} />
      </Field>
      <Field label="State" className="sm:col-span-1">
        <TextInput value={val('State')} onChange={(v) => upd('State', v.toUpperCase().slice(0, 2))} disabled={ro} />
      </Field>
      <Field label="ZIP" hint={zipHint} className="sm:col-span-2">
        <TextInput value={val('Zip')} onChange={(v) => upd('Zip', v)} disabled={ro} />
      </Field>
    </div>
  );
}

// ─── Locations ───────────────────────────────────────────────────────────────

const DAYS: Array<[string, string]> = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const DEFAULT_HOURS = Object.fromEntries(DAYS.map(([d]) => [d, { enabled: !['sat', 'sun'].includes(d), start: '09:00', end: '17:00' }]));

function blankLocation(): LocationView {
  return {
    id: '',
    name: '',
    code: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: 'MD',
    postalCode: null,
    phone: null,
    fax: null,
    npi: null,
    posCode: '11',
    timezone: 'America/New_York',
    active: true,
    isPrimary: false,
    businessHours: null,
    unverifiedFields: [],
  };
}

export function LocationsSection({ overview, onSaved }: SectionProps) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <span className="flex min-w-0 items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
          Each site&apos;s claim and contact fields. Location overview, staff assignment and import mapping are under Locations &amp; enterprise.
        </span>
        <Link href="/dashboard/enterprise" className="font-semibold text-blue-700 hover:underline">
          Locations &amp; enterprise
        </Link>
      </div>
      {overview.migrationPending ? (
        <Alert tone="warning">Location NPI, POS and hours need the 20261018_practice_settings migration.</Alert>
      ) : null}
      {overview.locations.map((l) => (
        <LocationEditor key={l.id} location={l} overview={overview} onSaved={onSaved} />
      ))}
      {overview.locations.length === 0 && !adding ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <EmptyState icon={<MapPin />} title="No locations yet" description="Each service location you add appears here with its claim and contact fields. Add the first site to start billing from it." />
        </div>
      ) : null}
      {adding ? (
        <LocationEditor location={blankLocation()} overview={overview} onSaved={(o) => { setAdding(false); onSaved(o); }} />
      ) : overview.canEdit ? (
        <Button variant="secondary" onClick={() => setAdding(true)} icon={<Plus />}>
          Add location
        </Button>
      ) : null}
    </div>
  );
}

function LocationEditor({ location, overview, onSaved }: { location: LocationView; overview: Overview; onSaved: (o: Overview) => void }) {
  const [d, setD] = useState(location);
  useEffect(() => setD(location), [location]);
  const set = <K extends keyof LocationView>(k: K, v: LocationView[K]) => setD((x) => ({ ...x, [k]: v }));
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  const hours = d.businessHours ?? (DEFAULT_HOURS as NonNullable<LocationView['businessHours']>);
  const placeholderNpi = isPlaceholderNpi(d.npi);
  const placeholderAddress = location.unverifiedFields.includes('addressLine1') && d.addressLine1 === location.addressLine1;
  const npiBad = (Boolean(d.npi) && !isValidNpi(d.npi)) || placeholderNpi;
  const save = () =>
    void run('/api/practice-settings/locations', {
      ...(d.id ? { id: d.id } : {}),
      name: d.name,
      code: d.code,
      addressLine1: d.addressLine1,
      addressLine2: d.addressLine2,
      city: d.city,
      state: d.state,
      postalCode: d.postalCode,
      phone: d.phone,
      fax: d.fax,
      npi: d.npi,
      posCode: d.posCode,
      timezone: d.timezone,
      active: d.active,
      businessHours: d.businessHours,
    });
  return (
    <Card
      title={d.id ? d.name || 'Location' : 'New location'}
      description={d.isPrimary ? 'Primary location' : undefined}
      actions={<Toggle checked={d.active} onChange={(v) => set('active', v)} disabled={ro} label="Active" />}
    >
      {location.unverifiedFields.length ? (
        <Alert tone="warning" className="mb-4">
          {PLACEHOLDER_LABEL}: {location.unverifiedFields.map((f) => (f === 'npi' ? 'site NPI' : 'street address')).join(' and ')} came from an early seed, not from the practice.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <Field label="Name" required className="sm:col-span-3">
          <TextInput value={d.name} onChange={(v) => set('name', v)} disabled={ro} />
        </Field>
        <Field label="Short code" className="sm:col-span-1">
          <TextInput value={d.code} onChange={(v) => set('code', v.toUpperCase())} disabled={ro} maxLength={12} />
        </Field>
        <Field label="Time zone" className="sm:col-span-2">
          <Select value={d.timezone} onChange={(v) => set('timezone', v)} options={tzOptions} disabled={ro} />
        </Field>
        <Field label="Street address" required className="sm:col-span-3" error={placeholderAddress ? PLACEHOLDER_LABEL : null}>
          <TextInput value={d.addressLine1} onChange={(v) => set('addressLine1', v)} disabled={ro} invalid={placeholderAddress} />
        </Field>
        <Field label="Suite / line 2" className="sm:col-span-3">
          <TextInput value={d.addressLine2} onChange={(v) => set('addressLine2', v)} disabled={ro} />
        </Field>
        <Field label="City" required className="sm:col-span-3">
          <TextInput value={d.city} onChange={(v) => set('city', v)} disabled={ro} />
        </Field>
        <Field label="State" required className="sm:col-span-1">
          <TextInput value={d.state} onChange={(v) => set('state', v.toUpperCase().slice(0, 2))} disabled={ro} />
        </Field>
        <Field label="ZIP" required className="sm:col-span-2">
          <TextInput value={d.postalCode} onChange={(v) => set('postalCode', v)} disabled={ro} />
        </Field>
        <Field label="Phone" required className="sm:col-span-2">
          <TextInput value={d.phone} onChange={(v) => set('phone', v)} disabled={ro} />
        </Field>
        <Field label="Fax" className="sm:col-span-2">
          <TextInput value={d.fax} onChange={(v) => set('fax', v)} disabled={ro} />
        </Field>
        <Field label="Place of service" className="sm:col-span-2">
          <Select value={d.posCode} onChange={(v) => set('posCode', v || null)} options={POS_OPTIONS} placeholder="Not set" disabled={ro} />
        </Field>
        <Field label="Site NPI (if this location has its own)" error={placeholderNpi ? PLACEHOLDER_LABEL : npiBad ? 'Fails the NPI check digit' : null} hint="Leave blank to bill under the billing provider" className="sm:col-span-3">
          <TextInput value={d.npi} onChange={(v) => set('npi', v.replace(/\D/g, '').slice(0, 10) || null)} disabled={ro} invalid={npiBad} />
        </Field>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Business hours</span>
          {!d.businessHours && !ro ? (
            <button type="button" className={cx('rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)} onClick={() => set('businessHours', DEFAULT_HOURS as LocationView['businessHours'])}>
              Set hours
            </button>
          ) : null}
        </div>
        {d.businessHours ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {DAYS.map(([key, label]) => {
              const h = hours[key] ?? { enabled: false, start: '09:00', end: '17:00' };
              const upd = (patch: Partial<typeof h>) => set('businessHours', { ...hours, [key]: { ...h, ...patch } });
              return (
                <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={h.enabled} disabled={ro} onChange={(e) => upd({ enabled: e.target.checked })} />
                    {label}
                  </label>
                  {h.enabled ? (
                    <div className="mt-1 flex items-center gap-1">
                      <input type="time" aria-label={`${label} opens`} className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20" value={h.start} disabled={ro} onChange={(e) => upd({ start: e.target.value })} />
                      <span className="text-xs text-slate-500">–</span>
                      <input type="time" aria-label={`${label} closes`} className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20" value={h.end} disabled={ro} onChange={(e) => upd({ end: e.target.value })} />
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Closed</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Not set.</p>
        )}
      </div>
      {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={save} disabled={npiBad || !d.name.trim()} label={d.id ? 'Save location' : 'Add location'} /> : null}
    </Card>
  );
}

// ─── Payers ──────────────────────────────────────────────────────────────────

export function PayersSection({ overview, refresh }: SectionProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Mapped payers" value={overview.payers.active} />
        <Stat label="Verified" value={overview.payers.verified} />
        <Stat label="Unverified" value={overview.payers.active - overview.payers.verified} warn={overview.payers.active > overview.payers.verified} />
      </div>
      <Card
        title="Waystar payer mapping"
        description="Each payer's Waystar payer ID, claim filing indicator, telehealth modifier and prior-auth rule. Payer details (addresses, timely filing, ERA / EFT) live in Billing › Payers."
        actions={
          <div className="flex flex-wrap gap-4">
            <RefreshButton refresh={refresh} />
            <Link href="/dashboard/billing/payer-settings" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
              Payers <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        }
      >
        <PayerMappingPanel />
      </Card>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <StatCard label={label} value={value} tone={warn ? 'warning' : 'neutral'} icon={warn ? <AlertTriangle /> : undefined} hint={warn ? 'Needs attention' : undefined} />
  );
}

// ─── Clinical policy ─────────────────────────────────────────────────────────

const CLINICAL_KEYS = [
  'noteSignDeadlineHours', 'lateNoteEscalationHours', 'lateNoteEscalationRole', 'cosignRequiredRoles', 'cosignDeadlineHours',
  'treatmentPlanReviewDays', 'prpIrpReviewDays', 'phq9IntervalDays', 'gad7IntervalDays', 'assessAtIntake', 'aiNoteConsentRequired',
  'safetyPlanRequiredHighRisk', 'sudRadarAutoAssignMeasures',
  'mbcAutoSend', 'mbcVisitRule', 'mbcProgramRule', 'mbcProviderRule', 'mbcProgramMeasures', 'mbcProviderMeasures',
] as const;

function Enforced({ by }: { by?: string }) {
  return by ? (
    <span className="text-emerald-700">Used by: {by}</span>
  ) : (
    <span className="text-slate-500">Practice policy on record — not yet enforced automatically</span>
  );
}

export function ClinicalSection({ overview, onSaved }: SectionProps) {
  const { draft, set } = useDraft(overview.settings);
  const mbc = useMbcOptions();
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  return (
    <div className="space-y-5">
      <Card title="Documentation">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Sign notes within (hours) — practice policy" hint={<Enforced by="Notes worklist (due soon / overdue), late-entry reason at signing, Inbox › unsigned notes" />}>
            <Select value={String(draft.noteSignDeadlineHours)} onChange={(v) => set('noteSignDeadlineHours', Number(v))} options={[24, 48, 72].map((h) => ({ value: String(h), label: `${h} hours` }))} disabled={ro} />
          </Field>
          <Field label="Escalate late notes after (hours)" hint={<Enforced />}>
            <NumberInput value={draft.lateNoteEscalationHours} onChange={(v) => set('lateNoteEscalationHours', v)} min={1} max={720} disabled={ro} />
          </Field>
          <Field label="Escalate to">
            <Select value={draft.lateNoteEscalationRole} onChange={(v) => set('lateNoteEscalationRole', v)} options={ESCALATION_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} disabled={ro} />
          </Field>
          <Field label="Co-sign within (hours)" hint={<Enforced />}>
            <NumberInput value={draft.cosignDeadlineHours} onChange={(v) => set('cosignDeadlineHours', v)} min={1} max={720} disabled={ro} />
          </Field>
        </div>
        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium text-slate-700">Roles whose notes need a supervisor co-signature</span>
          <div className="flex flex-wrap gap-3">
            {COSIGNABLE_ROLES.map((r) => (
              <label key={r} className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.cosignRequiredRoles.includes(r)}
                  disabled={ro}
                  onChange={(e) => set('cosignRequiredRoles', e.target.checked ? [...draft.cosignRequiredRoles, r] : draft.cosignRequiredRoles.filter((x) => x !== r))}
                />
                {roleLabel(r)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Clinicians on a licensure track (e.g. LGPC, LGSW) always need a co-signature from their supervisor. <Enforced />
          </p>
        </div>
      </Card>
      <Card title="Treatment plans & measurement" description={TREATMENT_PLAN_NOTE}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Outpatient treatment plan review (days, adults; max 180 — under 18 always at most 90)" hint={<Enforced />}>
            <NumberInput value={draft.treatmentPlanReviewDays} onChange={(v) => set('treatmentPlanReviewDays', v)} min={30} max={180} disabled={ro} />
          </Field>
          <Field label="PRP IRP review (days, adults; max 180 — under 18 always at most 90)" hint={<Enforced />}>
            <NumberInput value={draft.prpIrpReviewDays} onChange={(v) => set('prpIrpReviewDays', v)} min={30} max={180} disabled={ro} />
          </Field>
          <Field label="PHQ-9 every (days)" hint={<Link className="text-blue-700 hover:underline" href="/dashboard/mbc/outcomes">Outcome schedules</Link>}>
            <NumberInput value={draft.phq9IntervalDays} onChange={(v) => set('phq9IntervalDays', v)} min={7} max={365} disabled={ro} />
          </Field>
          <Field label="GAD-7 every (days)">
            <NumberInput value={draft.gad7IntervalDays} onChange={(v) => set('gad7IntervalDays', v)} min={7} max={365} disabled={ro} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Toggle checked={draft.assessAtIntake} onChange={(v) => set('assessAtIntake', v)} disabled={ro} label="PHQ-9 / GAD-7 at intake" />
          <Toggle checked={draft.aiNoteConsentRequired} onChange={(v) => set('aiNoteConsentRequired', v)} disabled={ro} label="Require client consent before AI note drafting" hint="Recommended; record consent in Consents" />
          <Toggle checked={draft.safetyPlanRequiredHighRisk} onChange={(v) => set('safetyPlanRequiredHighRisk', v)} disabled={ro} label="Safety plan required for high-risk clients" hint="C-SSRS moderate / high risk" />
          <Toggle checked={draft.sudRadarAutoAssignMeasures} onChange={(v) => set('sudRadarAutoAssignMeasures', v)} disabled={ro} label="Auto-assign substance-use measures when a patient appears on the SUD Referral Radar" hint="AUDIT, CAGE-AID, NIDA-Modified ASSIST and BAM on the MBC schedule; never re-assigns an open measure. Off by default" />
        </div>
        {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={() => void run('/api/practice-settings', { section: 'clinical', data: pick(draft, CLINICAL_KEYS) })} /> : null}
      </Card>
      <Card
        title="Measurement-based care"
        description="Outcome measures sent to patients before visits: completed on their phone, scored automatically, into the chart and offered in the note's assessment / measures section. Everything here is off until you turn it on. A measure is only ever sent to a patient with an email on file (not opted out) or text-message consent and a date of birth on the chart; 42 CFR Part 2 substance-use measures go only when the Part 2 consent covers it."
      >
        <div className="grid grid-cols-1 gap-3">
          <Toggle
            checked={draft.mbcAutoSend}
            onChange={(v) => set('mbcAutoSend', v)}
            disabled={ro}
            label="Send measures to patients before visits"
            hint="Email (and text when the patient consented and texting is available) 3 days and 1 day before a visit, for measures due. No health details in the message; the link asks for date of birth. Off by default"
          />
          <Toggle
            checked={draft.mbcVisitRule}
            onChange={(v) => set('mbcVisitRule', v)}
            disabled={ro}
            label="Rule: therapy and med-management visits get PHQ-9 (PHQ-A under 18) and GAD-7"
            hint="At the PHQ-9 / GAD-7 intervals above (default every 30 days). Off by default"
          />
          <Toggle
            checked={draft.mbcProgramRule}
            onChange={(v) => set('mbcProgramRule', v)}
            disabled={ro}
            label="Rule: intensive program clients get the program's measures"
            hint="While admitted; the measures end at discharge. Off by default"
          />
          {mbc ? (
            <MbcRuleList
              idKey="programId"
              label="Program"
              rows={draft.mbcProgramMeasures}
              choices={mbc.programs}
              instruments={mbc.instruments}
              disabled={ro}
              onChange={(rows) => set('mbcProgramMeasures', rows)}
            />
          ) : null}
          <Toggle
            checked={draft.mbcProviderRule}
            onChange={(v) => set('mbcProviderRule', v)}
            disabled={ro}
            label="Rule: provider-specific extra measures"
            hint="Added for that provider's patients with an upcoming visit. Off by default"
          />
          {mbc ? (
            <MbcRuleList
              idKey="userId"
              label="Provider"
              rows={draft.mbcProviderMeasures}
              choices={mbc.providers}
              instruments={mbc.instruments}
              disabled={ro}
              onChange={(rows) => set('mbcProviderMeasures', rows)}
            />
          ) : null}
          <p className="text-xs text-slate-500">
            Schedules and send status: <Link className="text-blue-700 hover:underline" href="/dashboard/mbc/outcomes">Outcome schedules</Link>. NIDA-Modified ASSIST and BAM stay in session until a licensed copy is added. Texting needs the toll-free registration; until then texts are recorded as not sent and email still goes.
          </p>
        </div>
        {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={() => void run('/api/practice-settings', { section: 'clinical', data: pick(draft, CLINICAL_KEYS) })} /> : null}
      </Card>
    </div>
  );
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export function SchedulingSection({ overview, onSaved }: SectionProps) {
  const [cancelHours, setCancelHours] = useState(overview.settings.cancellationWindowHours);
  const [platform, setPlatform] = useState(overview.scheduling.telehealthPlatform || 'CHIME');
  useEffect(() => {
    setCancelHours(overview.settings.cancellationWindowHours);
    setPlatform(overview.scheduling.telehealthPlatform || 'CHIME');
  }, [overview.settings.cancellationWindowHours, overview.scheduling.telehealthPlatform]);
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  return (
    <div className="space-y-5">
      <Card
        title="Appointment types"
        description="Durations, default CPT and booking modalities are edited in Scheduling settings."
        actions={
          <Link href="/dashboard/admin/scheduling-settings" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
            Scheduling settings <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <th scope="col" className="px-4 py-2">Type</th>
                <th scope="col" className="px-4 py-2">Duration</th>
                <th scope="col" className="px-4 py-2">Default CPT</th>
                <th scope="col" className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.scheduling.appointmentTypes.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{t.title}</td>
                  <td className="px-4 py-3 text-slate-700">{t.durationMin} min</td>
                  <td className="px-4 py-3 text-slate-700">{t.defaultCpt || <span className="text-slate-500">Not set</span>}</td>
                  <td className="px-4 py-3">{t.enabled ? <StatusBadge tone="success" size="sm">Enabled</StatusBadge> : <StatusBadge tone="neutral" size="sm">Off</StatusBadge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Reminders: {overview.scheduling.reminderChannels.length ? overview.scheduling.reminderChannels.map((c) => c.toUpperCase()).join(' + ') : 'off'} (timing and channels in Scheduling settings). Business hours per site are under Service locations.
        </p>
      </Card>
      <Card title="Cancellations & telehealth">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Cancellation window (hours before the visit)" hint="Cancellations inside this window count as late cancels">
            <NumberInput value={cancelHours} onChange={setCancelHours} min={0} max={168} disabled={ro} />
          </Field>
          <Field label="Default telehealth platform">
            <Select value={platform} onChange={setPlatform} options={TELEHEALTH_PLATFORMS.map((p) => ({ value: p, label: p === 'CHIME' ? 'Amazon Chime (built in)' : roleLabel(p) }))} disabled={ro} />
          </Field>
        </div>
        {overview.canEdit ? (
          <SaveBar busy={busy} message={message} onSave={() => void run('/api/practice-settings', { section: 'scheduling', data: { cancellationWindowHours: cancelHours, telehealthDefaultPlatform: platform } })} />
        ) : null}
      </Card>
    </div>
  );
}

// ─── Compliance & privacy ────────────────────────────────────────────────────

const COMPLIANCE_KEYS = [
  'privacyOfficerName', 'privacyOfficerEmail', 'privacyOfficerPhone', 'securityOfficerName', 'securityOfficerEmail', 'securityOfficerPhone',
  'breachContactName', 'breachContactEmail', 'breachContactPhone', 'part2Program', 'recordRetentionYearsAdult', 'recordRetentionMinorAge',
  'mfaRequired',
] as const;

export function ComplianceSection({ overview, onSaved }: SectionProps) {
  const { draft, set } = useDraft(overview.settings);
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  const contact = (title: string, p: 'privacyOfficer' | 'securityOfficer' | 'breachContact', hint: string) => (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      <div className="space-y-3">
        <Field label="Name"><TextInput value={draft[`${p}Name`]} onChange={(v) => set(`${p}Name`, v)} disabled={ro} /></Field>
        <Field label="Email"><TextInput type="email" value={draft[`${p}Email`]} onChange={(v) => set(`${p}Email`, v)} disabled={ro} /></Field>
        <Field label="Phone"><TextInput value={draft[`${p}Phone`]} onChange={(v) => set(`${p}Phone`, v)} disabled={ro} /></Field>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <Card title="HIPAA contacts">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {contact('Privacy officer', 'privacyOfficer', '45 CFR 164.530(a) — privacy policies and complaints')}
          {contact('Security officer', 'securityOfficer', '45 CFR 164.308(a)(2) — security program')}
          {contact('Breach notification contact', 'breachContact', 'Receives breach reports (164.400–414)')}
        </div>
      </Card>
      <Card title="Records" description={MD_RETENTION_NOTE}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="42 CFR Part 2 program?" hint={<>A federally assisted SUD program must segregate Part 2 records. <Link href="/dashboard/ehr/part2" className="text-blue-700 hover:underline">Part 2 records</Link></>}>
            <Select
              value={draft.part2Program === null ? '' : draft.part2Program ? 'yes' : 'no'}
              onChange={(v) => set('part2Program', v === '' ? null : v === 'yes')}
              options={[{ value: 'yes', label: 'Yes — Part 2 program' }, { value: 'no', label: 'No' }]}
              placeholder="Not answered"
              disabled={ro}
            />
          </Field>
          <Field label="Keep adult records (years)">
            <NumberInput value={draft.recordRetentionYearsAdult} onChange={(v) => set('recordRetentionYearsAdult', v)} min={5} max={30} disabled={ro} />
          </Field>
          <Field label="Keep minor records until age">
            <NumberInput value={draft.recordRetentionMinorAge} onChange={(v) => set('recordRetentionMinorAge', v)} min={18} max={30} disabled={ro} />
          </Field>
        </div>
        <p className="mt-3 text-sm">
          <Link href="/dashboard/ehr/consents" className="font-semibold text-blue-700 hover:underline">Consent templates</Link>
          <span className="text-slate-500" aria-hidden> · </span>
          <Link href="/dashboard/admin" className="font-semibold text-blue-700 hover:underline">HIPAA audit log</Link>
        </p>
        {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={() => void run('/api/practice-settings', { section: 'compliance', data: pick(draft, COMPLIANCE_KEYS) })} /> : null}
      </Card>
      <Card
        title="Staff sign-in"
        description="Two-factor sign-in (authenticator app) for every staff account. Keep it required; turn it off only to pause a rollout problem, then turn it back on."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Require two-factor sign-in for staff">
            <Select
              value={draft.mfaRequired === false ? 'no' : 'yes'}
              onChange={(v) => set('mfaRequired', v !== 'no')}
              options={[{ value: 'yes', label: 'Required (recommended)' }, { value: 'no', label: 'Not required' }]}
              disabled={ro}
            />
          </Field>
        </div>
        {overview.canEdit ? <SaveBar busy={busy} message={message} onSave={() => void run('/api/practice-settings', { section: 'compliance', data: pick(draft, COMPLIANCE_KEYS) })} /> : null}
      </Card>
      <Card title="Business associate agreements" description="Status only — keep the signed agreements in your document store.">
        <div className="divide-y divide-slate-100">
          {overview.baas.map((b) => (
            <BaaRow key={b.vendorKey} baa={b} overview={overview} onSaved={onSaved} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function BaaRow({ baa, overview, onSaved }: { baa: BaaView; overview: Overview; onSaved: (o: Overview) => void }) {
  const [d, setD] = useState(baa);
  useEffect(() => setD(baa), [baa]);
  const { busy, message, run } = useSaver(onSaved);
  const ro = !overview.canEdit;
  const tone = baa.status === 'signed' || baa.status === 'not_required' ? 'text-emerald-700' : baa.status === 'not_recorded' ? 'text-slate-500' : 'text-amber-700';
  return (
    <div className="grid grid-cols-1 items-end gap-3 py-3 sm:grid-cols-12">
      <div className="sm:col-span-3">
        <p className="text-sm font-semibold text-slate-900">{baa.vendorName}</p>
        <p className="text-xs text-slate-500">{baa.service}</p>
        <p className={`text-xs font-semibold ${tone}`}>{baa.status === 'not_recorded' ? 'Not recorded' : BAA_STATUSES.find((s) => s.value === baa.status)?.label}{baa.requiredForGoLive ? ' · required' : ''}</p>
      </div>
      <Field label="Status" className="sm:col-span-3">
        <Select value={d.status === 'not_recorded' ? '' : d.status} onChange={(v) => setD({ ...d, status: (v || 'not_recorded') as BaaView['status'] })} options={BAA_STATUSES} placeholder="Not recorded" disabled={ro} />
      </Field>
      <Field label="Signed" className="sm:col-span-2">
        <TextInput type="date" value={d.signedOn} onChange={(v) => setD({ ...d, signedOn: v || null })} disabled={ro} />
      </Field>
      <Field label="Expires" className="sm:col-span-2">
        <TextInput type="date" value={d.expiresOn} onChange={(v) => setD({ ...d, expiresOn: v || null })} disabled={ro} />
      </Field>
      <div className="sm:col-span-2">
        {overview.canEdit ? (
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy || d.status === 'not_recorded'}
            onClick={() => void run('/api/practice-settings/baas', { vendorKey: d.vendorKey, vendorName: d.vendorName, status: d.status, signedOn: d.signedOn, expiresOn: d.expiresOn, notes: d.notes })}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
        {message ? <p className={`mt-1 text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>{message.text}</p> : null}
      </div>
    </div>
  );
}

// ─── Users & security ────────────────────────────────────────────────────────

export function UsersSection({ overview }: SectionProps) {
  const s = overview.staff;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Stat label="Active staff" value={s.active} />
        <Stat label="Leadership" value={s.leadership} warn={s.leadership === 0} />
        <Stat label="Clinicians" value={s.clinicians} warn={s.clinicians === 0} />
        <Stat label="Clinicians missing NPI" value={s.cliniciansMissingNpi} warn={s.cliniciansMissingNpi > 0} />
      </div>
      <Card
        title="Staff & roles"
        description="Invite staff, assign roles and locations, and set each clinician's NPI and license in Admin & Compliance."
        actions={
          <Link href="/dashboard/admin" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
            Manage staff <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECURITY_POLICY.slice(0, 2).map((sec) => (
            <div key={sec.title} className="rounded-lg bg-slate-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-blue-600" aria-hidden /> {sec.title}
              </p>
              {sec.items.map((i) => (
                <div key={i.label} className="flex justify-between gap-3 border-b border-slate-200 py-1.5 text-sm last:border-0">
                  <span className="text-slate-600">{i.label}</span>
                  <span className={`text-right font-medium ${i.gap ? 'text-amber-700' : 'text-slate-800'}`}>{i.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Two-factor sign-in is required for staff by default (Compliance &amp; privacy › Staff sign-in). Idle sign-out, session length, lockout and the password rule apply to every practice.</p>
      </Card>
    </div>
  );
}

// ─── Integrations ────────────────────────────────────────────────────────────

const STATE_TONE: Record<string, Tone> = {
  configured: 'success',
  partial: 'warning',
  demo: 'neutral',
  error: 'danger',
};

export function IntegrationsSection({ overview }: SectionProps) {
  return (
    <Card title="Integration health" description="Read-only. Detected from server configuration; no keys or account IDs are shown.">
      <div className="divide-y divide-slate-100">
        {overview.integrations.map((i) => (
          <div key={i.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{i.label}</p>
              <p className="text-xs text-slate-500">{i.detail}</p>
            </div>
            <StatusBadge tone={STATE_TONE[i.state] ?? 'neutral'} className="capitalize">{i.state === 'demo' ? 'Demo / off' : i.state}</StatusBadge>
          </div>
        ))}
      </div>
    </Card>
  );
}

export const SECTION_COMPONENTS: Record<SettingsSectionKey, (p: SectionProps) => React.ReactNode> = {
  profile: ProfileSection,
  billing: BillingSection,
  locations: LocationsSection,
  payers: PayersSection,
  clinical: ClinicalSection,
  programs: ProgramsCapacitySection,
  scheduling: SchedulingSection,
  compliance: ComplianceSection,
  users: UsersSection,
  integrations: IntegrationsSection,
};

export function useSectionPercent(overview: Overview | null) {
  return useMemo(() => new Map((overview?.checklist.sections ?? []).map((s) => [s.key, s])), [overview]);
}
