'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  RELATIONSHIP_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_METHODS,
  type PortalAccessLevel,
  type PortalRelationship,
} from '@/patient/domain/proxy-policy';

type Link = {
  id: string;
  relationship: PortalRelationship;
  accessLevel: PortalAccessLevel;
  accessLevelReason: string | null;
  state: 'active' | 'pending_verification' | 'revoked' | 'expired' | 'aged_out';
  portalUser: { id: string; email: string; displayName: string | null; status: string };
  verifiedAt: string | null;
  verificationMethod: string | null;
  legalDocumentRef: string | null;
  expiresAt: string | null;
  endsAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

type Item = { itemType: string; itemId: string; label: string; date: string | null; part2: boolean };
type Override = { itemType: string; itemId: string; visibility: string; reason: string | null };

type Data = {
  client: { ageYears: number | null; hasDateOfBirth: boolean; minor: boolean; minorSelfConsentMh: boolean; guardianOnChart: { name: string | null; relationship: string | null; email: string | null } | null };
  ownLogin: { id: string; email: string; status: string } | null;
  defaults: Record<'parent' | 'legal_guardian' | 'authorized_representative', PortalAccessLevel | null>;
  links: Link[];
  overrides: Override[];
  items: Item[];
  canSetClinicalVisibility: boolean;
};

const STATE: Record<Link['state'], { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending_verification: { label: 'Needs verification', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  revoked: { label: 'Revoked', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  expired: { label: 'Expired', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  aged_out: { label: 'Ended at 18', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error || 'Request failed');
  return json;
}

function VerificationFields({ value, onChange }: { value: { method: string; legalDocumentRef: string; note: string }; onChange: (v: { method: string; legalDocumentRef: string; note: string }) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-medium text-slate-600 sm:col-span-2">
        How authority was verified
        <select value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
          <option value="">Choose…</option>
          {VERIFICATION_METHODS.map((m) => <option key={m} value={m}>{VERIFICATION_LABEL[m]}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        Legal document reference (scan / file name)
        <input value={value.legalDocumentRef} onChange={(e) => onChange({ ...value, legalDocumentRef: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Required for guardians / custody / adults" />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Note (no clinical details)
        <input value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
      </label>
    </div>
  );
}

const emptyVerification = { method: '', legalDocumentRef: '', note: '' };

/**
 * Chart card "Portal access": the client's own login and every guardian / representative (proxy)
 * login, with verification of authority, access level, end date (18th birthday for minors), revoke,
 * and the clinician's confidential / shared-with-guardian decisions. API: /api/clients/[id]/portal-access.
 * Rules: src/patient/domain/proxy-policy.ts (Maryland defaults; docs/portal-proxy-access.md).
 */
export function PortalAccessCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', relationship: 'parent' as 'parent' | 'legal_guardian' | 'authorized_representative', accessLevel: '' as '' | PortalAccessLevel, accessLevelReason: '', expiresAt: '', verifyNow: true });
  const [verification, setVerification] = useState(emptyVerification);

  const base = `/api/clients/${encodeURIComponent(clientId)}/portal-access`;
  const load = useCallback(() => {
    fetch(base)
      .then(async (r) => {
        if (r.status === 403 || r.status === 404) { setHidden(true); return; }
        const j = await r.json();
        if (j.success) setData(j as Data);
      })
      .catch(() => setHidden(true));
  }, [base]);
  useEffect(load, [load]);

  const overrides = useMemo(() => new Map((data?.overrides ?? []).map((o) => [`${o.itemType}:${o.itemId}`, o])), [data]);

  if (hidden || !data) return null;
  const proxies = data.links.filter((l) => l.relationship !== 'self');
  const defaultLevel = data.defaults[form.relationship];

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      const r = (await fn()) as { warning?: string | null };
      toast.success(ok);
      if (r?.warning) toast(r.warning, { duration: 8000 });
      load();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    const ok = await run(
      () => call(base, 'POST', {
        action: 'grant',
        email: form.email,
        displayName: form.displayName,
        relationship: form.relationship,
        accessLevel: form.accessLevel || null,
        accessLevelReason: form.accessLevelReason || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt + 'T23:59:59').toISOString() : null,
        verification: form.verifyNow ? verification : null,
      }),
      form.verifyNow ? 'Guardian access added' : 'Guardian added; verify authority to activate'
    );
    if (ok) { setAdding(false); setVerification(emptyVerification); setForm((f) => ({ ...f, email: '', displayName: '', accessLevelReason: '', expiresAt: '' })); }
  }

  async function convert() {
    const ok = await run(
      () => call(base, 'POST', { action: 'convert_self', displayName: form.displayName, relationship: form.relationship, accessLevel: form.accessLevel || null, accessLevelReason: form.accessLevelReason || null, verification }),
      'Login converted to guardian access'
    );
    if (ok) { setConverting(false); setVerification(emptyVerification); }
  }

  return (
    <section aria-label="Portal access" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldCheck size={16} className="text-[#5C2D91]" aria-hidden /> Portal access
        </h3>
        <button type="button" onClick={() => { setAdding((v) => !v); setConverting(false); }} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[#5C2D91] hover:underline">
          <UserPlus size={14} aria-hidden /> Add guardian / representative
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {data.client.ageYears === null ? 'Date of birth missing: add it before granting guardian access.' :
          data.client.minor
            ? `Minor (${data.client.ageYears}). Default: ${data.client.ageYears < 12 ? 'full' : 'limited'} guardian access; ends automatically at 18. Confidential and substance use (Part 2) items are never shown to a guardian.`
            : `Adult (${data.client.ageYears}). A representative needs a court order / power of attorney; choose full or limited and record why.`}
      </p>

      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <span><span className="font-medium text-slate-800">Client&apos;s own login</span>{' '}<span className="text-slate-500">{data.ownLogin ? `${data.ownLogin.email} · ${data.ownLogin.status.toLowerCase()}` : 'none'}</span></span>
          {data.ownLogin && data.client.minor && (
            <button type="button" onClick={() => { setConverting((v) => !v); setAdding(false); }} className="text-xs font-semibold text-[#5C2D91] hover:underline" title="The email on this login is the parent's: make it the parent's guardian login">
              Convert to guardian login
            </button>
          )}
        </li>
        {proxies.length === 0 && <li className="text-slate-500">No guardian or representative has portal access.</li>}
        {proxies.map((l) => (
          <li key={l.id} className="rounded-xl border border-slate-200 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium text-slate-900">{l.portalUser.displayName || l.portalUser.email}</span>{' '}
                <span className="text-slate-500">{RELATIONSHIP_LABEL[l.relationship]} · {l.accessLevel} · {l.portalUser.email}{l.portalUser.status === 'INVITED' ? ' · invite not accepted yet' : ''}</span>
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATE[l.state].tone}`}>{STATE[l.state].label}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {l.verifiedAt ? `Verified ${fmt(l.verifiedAt)} (${l.verificationMethod ? VERIFICATION_LABEL[l.verificationMethod as keyof typeof VERIFICATION_LABEL] ?? l.verificationMethod : 'n/a'}${l.legalDocumentRef ? `, doc: ${l.legalDocumentRef}` : ''})` : 'Authority not verified yet: access is not active.'}
              {l.endsAt && !l.revokedAt ? ` · Ends ${fmt(l.endsAt)} (18th birthday)` : ''}
              {l.expiresAt && !l.revokedAt ? ` · Ends ${fmt(l.expiresAt)}` : ''}
              {l.revokedAt ? ` · Ended ${fmt(l.revokedAt)}${l.revokeReason ? `: ${l.revokeReason}` : ''}` : ''}
            </p>
            {!l.revokedAt && (
              <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                {!l.verifiedAt && <button type="button" disabled={busy} onClick={() => setVerifying(verifying === l.id ? null : l.id)} className="text-[#5C2D91] hover:underline">Record verification</button>}
                <button type="button" disabled={busy} onClick={() => {
                  const level = l.accessLevel === 'full' ? 'limited' : 'full';
                  const reason = window.prompt(`Why change to ${level} access?`);
                  if (reason) void run(() => call(`${base}/${l.id}`, 'PATCH', { action: 'level', accessLevel: level, reason }), `Access set to ${level}`);
                }} className="text-slate-700 hover:underline">Make {l.accessLevel === 'full' ? 'limited' : 'full'}</button>
                {l.portalUser.status === 'INVITED' && <button type="button" disabled={busy} onClick={() => void run(() => call(`${base}/${l.id}`, 'PATCH', { action: 'resend_invite' }), 'Invitation sent')} className="text-slate-700 hover:underline">Resend invite</button>}
                <button type="button" disabled={busy} onClick={() => {
                  const reason = window.prompt('Why is access revoked? (takes effect immediately)');
                  if (reason) void run(() => call(`${base}/${l.id}`, 'PATCH', { action: 'revoke', reason }), 'Access revoked');
                }} className="text-red-700 hover:underline">Revoke</button>
              </div>
            )}
            {verifying === l.id && (
              <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                <VerificationFields value={verification} onChange={setVerification} />
                <button type="button" disabled={busy || !verification.method} onClick={async () => {
                  if (await run(() => call(`${base}/${l.id}`, 'PATCH', { action: 'verify', ...verification }), 'Verified: access is active')) { setVerifying(null); setVerification(emptyVerification); }
                }} className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save verification</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {(adding || converting) && (
        <div className="mt-3 space-y-2 rounded-xl border border-purple-100 bg-purple-50/40 p-3">
          <p className="text-xs text-slate-600">
            {converting
              ? 'The client’s own login actually belongs to the parent / guardian. It keeps its email and password, becomes a guardian login, and can then be added to siblings by the same email.'
              : 'Use the guardian’s own email. If it already has a portal login (for example for a sibling), the same login is linked: one sign-in for every child. The invitation contains no client information.'}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Guardian full name
              <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
            </label>
            {!converting && (
              <label className="text-xs font-medium text-slate-600">Guardian email (their login)
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder={data.client.guardianOnChart?.email ?? ''} />
              </label>
            )}
            <label className="text-xs font-medium text-slate-600">Relationship
              <select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value as typeof form.relationship })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
                {data.client.minor && <option value="parent">Parent</option>}
                <option value="legal_guardian">Legal guardian</option>
                <option value="authorized_representative">Authorized representative</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">Access level
              <select value={form.accessLevel} onChange={(e) => setForm({ ...form, accessLevel: e.target.value as typeof form.accessLevel })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
                <option value="">{defaultLevel ? `Default for this age (${defaultLevel})` : 'Choose (required for adults)'}</option>
                <option value="full">Full</option>
                <option value="limited">Limited</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">Reason for the level (required for adults or when not the default)
              <input value={form.accessLevelReason} onChange={(e) => setForm({ ...form, accessLevelReason: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
            </label>
            {!converting && (
              <label className="text-xs font-medium text-slate-600">End date (optional; minors end at 18 automatically)
                <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" />
              </label>
            )}
          </div>
          {!converting && (
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input type="checkbox" checked={form.verifyNow} onChange={(e) => setForm({ ...form, verifyNow: e.target.checked })} />
              I verified the guardian&apos;s ID and authority now (otherwise access stays inactive until verified)
            </label>
          )}
          {(converting || form.verifyNow) && <VerificationFields value={verification} onChange={setVerification} />}
          <button type="button" disabled={busy || form.displayName.trim().length < 2 || (!converting && !form.email.trim()) || ((converting || form.verifyNow) && !verification.method)}
            onClick={() => void (converting ? convert() : grant())}
            className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {converting ? 'Convert login' : 'Add access'}
          </button>
        </div>
      )}

      {data.canSetClinicalVisibility && data.client.minor && (
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={data.client.minorSelfConsentMh} disabled={busy}
            onChange={(e) => void run(() => call(base, 'POST', { action: 'minor_consent', value: e.target.checked }), 'Saved')} />
          <span>The client consented to their own mental health treatment (Md. Health-General §20-104, 16+). A <em>limited</em> guardian then does not see treatment plans or medications unless you share an item below.</span>
        </label>
      )}

      {data.canSetClinicalVisibility && proxies.length > 0 && data.items.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">What the guardian sees ({data.overrides.length} decision{data.overrides.length === 1 ? '' : 's'})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {data.items.map((it) => {
              const o = overrides.get(`${it.itemType}:${it.itemId}`);
              return (
                <li key={`${it.itemType}:${it.itemId}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
                  <span className="text-slate-700">{it.label}{it.date ? ` · ${fmt(it.date)}` : ''}{it.part2 ? ' · Part 2 (hidden by default)' : ''}</span>
                  <select value={o?.visibility ?? ''} disabled={busy} aria-label={`Guardian visibility for ${it.label}`}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      const reason = v === 'shared_with_guardian' ? window.prompt(it.part2 ? 'Substance use record: cite the client’s written consent to share with the guardian' : 'Why share this with the guardian?') : v === 'confidential' ? window.prompt('Reason (optional)') ?? '' : '';
                      if (v === 'shared_with_guardian' && !reason) return;
                      void run(() => call(base, 'POST', { action: 'visibility', itemType: it.itemType, itemId: it.itemId, visibility: v, reason }), 'Saved');
                    }}
                    className="rounded border border-slate-300 p-1 text-xs">
                    <option value="">Default rules</option>
                    <option value="confidential">Confidential (hide)</option>
                    <option value="shared_with_guardian">Shared with guardian</option>
                  </select>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
