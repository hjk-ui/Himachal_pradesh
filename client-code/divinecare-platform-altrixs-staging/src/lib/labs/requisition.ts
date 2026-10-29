/**
 * Printable lab requisition (HTML, print-to-PDF). Pure and escaped. There is no electronic lab
 * interface: the requisition travels with the specimen / patient. Every identifier comes from the
 * record (ordering provider NPI from the staff profile, practice NPI / CLIA from Practice
 * settings); a missing value prints "Not on file" — nothing is invented.
 */
import { BILL_TO_OPTIONS, COLLECTION_SITES, performingLabLabel } from './facility';
import type { LabOrderDto } from './manage';

export type RequisitionContext = {
  order: Pick<
    LabOrderDto,
    | 'id' | 'clientName' | 'clientId' | 'lab' | 'priority' | 'specimen' | 'panels' | 'otherPanel' | 'icd10Codes' | 'clinicalNotes'
    | 'orderedByName' | 'orderedAt' | 'signerNpi' | 'facilityName' | 'facilityClia' | 'signatureHash' | 'testLines' | 'fastingRequired'
    | 'collectionSite' | 'billTo' | 'abnRequired' | 'abnNote'
  >;
  patient: {
    mrn: string | null;
    dateOfBirth: string | null;
    sex: string | null;
    phone: string | null;
    address: string | null;
    insurancePayer: string | null;
    insuranceMemberId: string | null;
    insuranceGroupNumber: string | null;
    insuranceType: string | null;
  };
  practice: { name: string; organizationNpi: string | null; phone: string | null; fax: string | null; address: string | null };
  /** Catalog details per line key (specimen / container / handling) */
  testDetails: Record<string, { specimenType: string | null; container: string | null; specialHandling: string | null }>;
};

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NOF = '<span class="nof">Not on file</span>';
const v = (x: string | null | undefined) => (x && x.trim() ? esc(x) : NOF);

export function buildRequisitionHtml(ctx: RequisitionContext): string {
  const { order, patient, practice } = ctx;
  const lines = order.testLines.length
    ? order.testLines
    : [...order.panels, ...(order.otherPanel ? [order.otherPanel] : [])].map((name) => ({
        key: null,
        name,
        diagnoses: order.icd10Codes.map((code) => ({ code, description: null })),
        loinc: null,
        cpt: null,
        fastingRequired: order.fastingRequired,
        orderType: 'lab' as const,
      }));
  const allDx = new Map<string, string | null>();
  for (const l of lines) for (const d of l.diagnoses) if (!allDx.has(d.code) || (!allDx.get(d.code) && d.description)) allDx.set(d.code, d.description);
  const dxIndex = [...allDx.keys()];
  const pointer = (code: string) => String.fromCharCode(65 + dxIndex.indexOf(code));

  const testRows = lines
    .map((l) => {
      const det = l.key ? ctx.testDetails[l.key] : undefined;
      const handling = [l.fastingRequired ? 'Fasting' : '', det?.specimenType ?? '', det?.container ?? ''].filter(Boolean).join(' · ');
      return `<tr>
        <td><strong>${esc(l.name)}</strong>${l.orderType === 'in_office_procedure' ? ' <em>(in-office procedure)</em>' : ''}${det?.specialHandling ? `<div class="sub">${esc(det.specialHandling)}</div>` : ''}</td>
        <td class="mono">${l.cpt ? esc(l.cpt) : '<span class="nof">code needed</span>'}</td>
        <td class="mono">${l.loinc ? esc(l.loinc) : '—'}</td>
        <td class="mono">${l.diagnoses.map((d) => pointer(d.code)).join(', ') || '—'}</td>
        <td>${esc(handling) || '—'}</td>
      </tr>`;
    })
    .join('');

  const dxRows = dxIndex.length
    ? dxIndex.map((c) => `<li><strong>${pointer(c)}. ${esc(c)}</strong>${allDx.get(c) ? ` — ${esc(allDx.get(c))}` : ''}</li>`).join('')
    : `<li>${NOF}</li>`;
  const site = COLLECTION_SITES.find((s) => s.id === order.collectionSite)?.label ?? null;
  const billTo = BILL_TO_OPTIONS.find((b) => b.id === order.billTo)?.label ?? null;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Lab requisition ${esc(order.id)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; font-size: 11.5px; line-height: 1.4; margin: 0; padding: 16px; }
  h1 { font-size: 16px; margin: 0; }
  .muted { color: #6B7280; }
  .nof { color: #9CA3AF; font-style: italic; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #5C2D91; padding-bottom: 8px; margin-bottom: 10px; }
  .prio { font-weight: 800; text-transform: uppercase; color: ${/stat/i.test(order.priority) ? '#B91C1C' : '#111827'}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin-bottom: 10px; }
  .box { border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 10px; }
  .t { font-size: 9.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #6B7280; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
  th, td { border-bottom: 1px solid #E5E7EB; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { font-size: 9.5px; text-transform: uppercase; color: #6B7280; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .sub { font-size: 10px; color: #4B5563; }
  .abn { border: 1px solid #F59E0B; background: #FFFBEB; border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; }
  .sig { border: 1px solid #D1D5DB; border-radius: 6px; padding: 8px 10px; display: flex; justify-content: space-between; }
  ul { margin: 2px 0 0 16px; padding: 0; }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>Laboratory requisition</h1>
      <div class="muted">Performing lab: <strong>${esc(performingLabLabel(order.lab))}</strong> · Not transmitted electronically — send this form with the specimen / patient</div>
    </div>
    <div style="text-align:right">
      <div class="mono"><strong>${esc(order.id)}</strong></div>
      <div class="prio">Priority: ${esc(order.priority)}</div>
      <div class="muted">Ordered ${esc(new Date(order.orderedAt).toLocaleString('en-US'))}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <div class="t">Patient</div>
      <div><strong>${esc(order.clientName)}</strong></div>
      <div>DOB: ${v(patient.dateOfBirth)} · Sex: ${v(patient.sex)} · MRN: ${v(patient.mrn)}</div>
      <div>Phone: ${v(patient.phone)}</div>
      <div>Address: ${v(patient.address)}</div>
    </div>
    <div class="box">
      <div class="t">Ordering provider / practice</div>
      <div><strong>${v(order.orderedByName)}</strong> · NPI: ${v(order.signerNpi)}</div>
      <div>${v(practice.name)} · Practice NPI: ${v(practice.organizationNpi)}</div>
      <div>CLIA: ${v(order.facilityClia)}</div>
      <div>Phone: ${v(practice.phone)} · Fax: ${v(practice.fax)}</div>
      <div>${v(practice.address)}</div>
    </div>
    <div class="box">
      <div class="t">Billing</div>
      <div>Bill to: ${v(billTo)}</div>
      <div>Primary insurance: ${v(patient.insurancePayer)}${patient.insuranceType ? ` (${esc(patient.insuranceType)})` : ''}</div>
      <div>Member ID: ${v(patient.insuranceMemberId)} · Group: ${v(patient.insuranceGroupNumber)}</div>
    </div>
    <div class="box">
      <div class="t">Collection</div>
      <div>${v(site)}</div>
      <div>Fasting: <strong>${order.fastingRequired ? 'YES — fasting specimen' : 'No'}</strong></div>
      <div>Specimen: ${v(order.specimen)}</div>
      <div>Collected (date/time): ____________________ By: ____________</div>
    </div>
  </div>

  ${order.abnRequired ? `<div class="abn"><strong>Medicare ABN:</strong> an Advance Beneficiary Notice was flagged for this order.${order.abnNote ? ` ${esc(order.abnNote)}` : ''}</div>` : ''}

  <div class="t">Tests ordered</div>
  <table>
    <thead><tr><th>Test</th><th>CPT</th><th>LOINC</th><th>Dx pointer</th><th>Specimen / container</th></tr></thead>
    <tbody>${testRows}</tbody>
  </table>

  <div class="t">Diagnoses (ICD-10-CM) — medical necessity</div>
  <ul>${dxRows}</ul>
  ${order.clinicalNotes ? `<p><span class="t">Clinical notes</span><br />${esc(order.clinicalNotes)}</p>` : ''}

  <div class="sig" style="margin-top:12px">
    <div>
      <div class="t">Electronically signed</div>
      <div><strong>${v(order.orderedByName)}</strong> · NPI ${v(order.signerNpi)}</div>
      <div class="muted">Signed ${esc(new Date(order.orderedAt).toLocaleString('en-US'))} in Altrixs</div>
    </div>
    <div class="muted mono" style="font-size:9px;max-width:45%;word-break:break-all">${order.signatureHash ? `SHA-256 ${esc(order.signatureHash)}` : ''}</div>
  </div>
  <p class="muted" style="font-size:9.5px">Specimen and container requirements are typical; follow the performing lab's directory of services.</p>
</body></html>`;
}
