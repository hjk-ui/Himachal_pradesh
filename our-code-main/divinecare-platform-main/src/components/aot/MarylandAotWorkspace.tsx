'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/features/auth';
import { useClients } from '@/features/clients';

const JURISDICTIONS = [
  'Allegany', 'Anne Arundel', 'Baltimore City', 'Baltimore County', 'Calvert', 'Caroline',
  'Carroll', 'Cecil', 'Charles', 'Dorchester', 'Frederick', 'Garrett', 'Harford', 'Howard',
  'Kent', 'Montgomery', 'Prince George\'s', 'Queen Anne\'s', 'St. Mary\'s', 'Somerset',
  'Talbot', 'Washington', 'Wicomico', 'Worcester',
];

const PETITIONERS = ['Family member', 'Treating clinician', 'Hospital', 'Residential program', 'Local behavioral health authority'];

type SavedForm = {
  id: string;
  clientId: string;
  clientName: string;
  jurisdiction: string;
  petitionerType: string;
  narrative: string;
  affidavitOn: string;
};

export function MarylandAotWorkspace() {
  const { user } = useAuth();
  const { clients } = useClients();
  const [clientId, setClientId] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Prince George\'s');
  const [petitionerType, setPetitionerType] = useState(PETITIONERS[1]);
  const [narrative, setNarrative] = useState('');
  const [affidavitOn, setAffidavitOn] = useState('');
  const [saved, setSaved] = useState<SavedForm[]>([]);
  const [openId, setOpenId] = useState('');
  const [message, setMessage] = useState('');
  const hideDiagnosis = user?.role === 'PEER_SUPPORT' || user?.role === 'CASE_MANAGER' || user?.role === 'PRP_SPECIALIST';
  const selected = clients.find((client) => client.id === clientId);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/aot/forms', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.success) setSaved(data.forms || []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const checklist = useMemo(() => [
    { label: 'Participant is a client on this chart', done: Boolean(selected) },
    { label: 'Jurisdiction is selected', done: Boolean(jurisdiction) },
    { label: 'Petitioner type is selected', done: Boolean(petitionerType) },
    { label: 'Affidavit date is entered', done: Boolean(affidavitOn) },
    { label: 'Facts for the petition are saved in the narrative', done: narrative.trim().length > 20 },
  ], [selected, jurisdiction, petitionerType, affidavitOn, narrative]);

  function prefill(nextId: string) {
    setClientId(nextId);
    const client = clients.find((row) => row.id === nextId);
    if (!client) return;
    const address = [client.addressLine1, client.city, client.state, client.postalCode].filter(Boolean).join(', ');
    const diagnosis = hideDiagnosis ? '' : [client.primaryDiagnosisCode, client.primaryDiagnosis].filter(Boolean).join(' ');
    setNarrative(
      [
        `Participant: ${client.name}`,
        client.dateOfBirth ? `Date of birth: ${String(client.dateOfBirth).slice(0, 10)}` : '',
        address ? `Address: ${address}` : '',
        client.phone ? `Phone: ${client.phone}` : '',
        diagnosis ? `Chart diagnosis: ${diagnosis}` : '',
      ].filter(Boolean).join('\n')
    );
  }

  async function save() {
    setMessage('');
    const response = await fetch('/api/aot/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, jurisdiction, petitionerType, narrative, affidavitOn }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'Could not save the form.');
      return;
    }
    setSaved((prev) => [data.form, ...prev.filter((row) => row.id !== data.form.id)]);
    setOpenId(data.form.id);
    setMessage('Form saved. Reopen it from the list or print this page.');
  }

  function reopen(form: SavedForm) {
    setOpenId(form.id);
    setClientId(form.clientId);
    setJurisdiction(form.jurisdiction);
    setPetitionerType(form.petitionerType);
    setNarrative(form.narrative);
    setAffidavitOn(form.affidavitOn);
  }

  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Maryland AOT workspace</h2>
          <p className="text-xs text-slate-500">Participant list, petition checklist, and a form that saves on the client.</p>
        </div>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold">Print</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Participants</h3>
          <ul className="mt-2 max-h-48 divide-y divide-slate-100 overflow-auto text-sm">
            {clients.length === 0 ? <li className="py-2 text-slate-500">No clients on your list.</li> : clients.map((client) => (
              <li key={client.id}>
                <button type="button" className="w-full py-2 text-left hover:text-indigo-700" onClick={() => prefill(client.id)}>
                  {client.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Petition checklist</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {checklist.map((item) => (
              <li key={item.label} className={item.done ? 'text-emerald-700' : 'text-slate-500'}>
                {item.done ? 'Done' : 'Open'} · {item.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">Jurisdiction
          <select className="mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm" value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)}>
            {JURISDICTIONS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Petitioner
          <select className="mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm" value={petitionerType} onChange={(event) => setPetitionerType(event.target.value)}>
            {PETITIONERS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Affidavit date
          <input type="date" className="mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm" value={affidavitOn} onChange={(event) => setAffidavitOn(event.target.value)} />
        </label>
      </div>
      <textarea className="min-h-32 w-full rounded-lg border px-3 py-2 text-sm" value={narrative} onChange={(event) => setNarrative(event.target.value)} placeholder="Facts prefilled from the chart" />
      <button type="button" onClick={() => void save()} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white">Save form</button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}

      <div>
        <h3 className="text-sm font-bold text-slate-800">Saved forms</h3>
        <ul className="mt-2 divide-y text-sm">
          {saved.length === 0 ? <li className="py-2 text-slate-500">No saved Maryland forms yet.</li> : saved.map((form) => (
            <li key={form.id} className="flex items-center justify-between py-2">
              <span>{form.clientName} · {form.jurisdiction}{openId === form.id ? ' · open' : ''}</span>
              <button type="button" className="font-semibold text-indigo-700" onClick={() => reopen(form)}>Reopen</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <h3 className="font-bold text-slate-900">Maryland resource center</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Jurisdictions: the 23 Maryland counties and Baltimore City. File in the circuit court for the respondent&apos;s jurisdiction.</li>
          <li>988: call or text 988 for the Suicide and Crisis Lifeline. This is the crisis line, separate from the court petition.</li>
          <li>Affidavit timing: the petition needs an examination affidavit. Confirm the current filing window with that circuit court and the Behavioral Health Administration before you file.</li>
          <li>MDH contact: Maryland Department of Health, Behavioral Health Administration, health.maryland.gov/bha.</li>
          <li>Petitioner types: family member, treating clinician, hospital, residential program, or the local behavioral health authority.</li>
          <li>Complaint destination: the circuit court in the respondent&apos;s jurisdiction, with a copy to the Behavioral Health Administration.</li>
        </ul>
      </div>
    </section>
  );
}
