const fs = require('fs');
function edit(path, fn) { fs.writeFileSync(path, fn(fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))); }
const fields = `  availityClaimId?: string | null;
  submissionInProgress?: boolean;
  submissionError?: string | null;
  clearinghouseDemo?: boolean;
  submissionData?: { payerId: string; diagnosisCodes: string[]; placeOfService: string; claimFilingCode: 'MC' | 'MB' | 'BL' | 'CI' } | null;
`;
edit('src/features/billing/claimsApi.ts', s => s.replace('export type ClaimRecord = {', 'export type ClaimRecord = {\n' + fields));
edit('src/lib/billing/claims.ts', s => s.replace('export type ClaimListItem = {', 'export type ClaimListItem = {\n' + fields)
 .replace('    id: row.id,', `    availityClaimId: row.availityClaimId,
    submissionInProgress: row.submissionInProgress, submissionError: row.submissionError,
    clearinghouseDemo: row.clearinghouseDemo,
    submissionData: row.submissionData as ClaimListItem['submissionData'],
    id: row.id,`)
 .replace('  const allowed = ALLOWED[existing.status] || [];', `  if (status === 'SUBMITTED') return { ok: false as const, error: 'Use the clearinghouse submission action', status: 400 as const };
  if (existing.submissionInProgress) return { ok: false as const, error: 'Reconcile the pending clearinghouse submission before editing this claim', status: 409 as const };
  const allowed = ALLOWED[existing.status] || [];`));
edit('src/app/dashboard/billing/claims/page.tsx', s => {
 s = s.replace("import Link from 'next/link';", "import Link from 'next/link';\nimport { ClaimsClearinghousePanel } from '@/components/clinical/ClaimsClearinghousePanel';");
 const start = s.indexOf('          <button\n            type="button"\n            disabled={busy}\n            onClick={async () => {');
 const end = s.indexOf('          <Link href="/dashboard/billing"', start);
 if(start < 0 || end < 0) throw Error('Batch button not found');
 s = s.slice(0,start) + s.slice(end);
 s = s.replace('submit → accept / deny / paid. Clearinghouse EDI is not configured; submit is a stub status change.', 'submit → accept / deny / paid. Prepare billing details and submit through the clearinghouse panel.');
 s = s.replace('      {error ? (', '      <ClaimsClearinghousePanel claims={visible} selected={selected} onChanged={load} />\n      {error ? (');
 s = s.replace("onClick={() => void run(() => patchClaimStatus(selected.id, 'SUBMITTED'))}", "onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}");
 s = s.replace('Submit stub', 'Prepare submission');
 return s;
});
edit('src/app/dashboard/billing/prior-auth/page.tsx', s => s
 .replace("  const [memberId, setMemberId] = useState('');", "  const [memberId, setMemberId] = useState('');\n  const [payerId, setPayerId] = useState('');\n  const [requestId, setRequestId] = useState('');\n  const [modes, setModes] = useState<Record<string, string>>({});")
 .replace("vendor: 'Carelon' | 'Availity' | 'MockClearinghouse';", "vendor: 'Carelon' | 'Availity';\n  demoMode?: boolean;")
 .replace("status: 'APPROVED' | 'PENDING_REVIEW' | 'DENIED' | 'ADDITIONAL_INFO_NEEDED';", "status: 'APPROVED' | 'PENDING_REVIEW' | 'DENIED' | 'ADDITIONAL_INFO_NEEDED' | 'SUBMITTING' | 'SUBMISSION_UNKNOWN';")
 .replace('data: PriorAuthRecord[] }>', 'data: PriorAuthRecord[]; mode?: Record<string, string>; errors?: string[] }>')
 .replaceAll('setRecords(res.data);', 'setRecords(res.data);\n        if (res.mode) setModes(res.mode);\n        if (res.errors?.length) setError(res.errors.join("; "));')
 .replace("memberId: memberId || 'MEM-992014',", 'memberId, payerId, requestId,')
 .replace("clinicalRationale: rationale || 'Medically necessary outpatient behavioral care.',", 'clinicalRationale: rationale,')
 .replace('onClick={() => setIsNewModalOpen(true)}', 'onClick={() => { setRequestId(crypto.randomUUID()); setError(null); setIsNewModalOpen(true); }}')
 .replace('{/* Summary Cards */}', '<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Carelon: {modes.Carelon || "Loading"} · Availity: {modes.Availity || "Loading"}. Demo requests do not create payer authorizations.</p>\n      {/* Summary Cards */}')
 .replace('referenceNumber: string;', 'referenceNumber: string;')
 .replace('{r.referenceNumber}', '{r.demoMode ? "DEMO · " : ""}{r.referenceNumber}')
 .replace('<label className=', '<label className=')
 .replace('{/* New', '{/* New')
);
// Place payer ID next to the existing member field without depending on visual styles.
edit('src/app/dashboard/billing/prior-auth/page.tsx', s => {
 const needle = 'value={memberId}';
 const pos = s.indexOf(needle);
 if(pos < 0) throw Error('Member field missing');
 const close = s.indexOf('</div>', pos);
 return s.slice(0, close + 6) + `\n<div><label className="text-sm font-semibold">Payer trading partner ID</label><input value={payerId} onChange={e => setPayerId(e.target.value)} className="mt-1 w-full rounded-lg border p-2" required /></div>` + s.slice(close + 6);
});
