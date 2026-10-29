'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ScanLine,
  RefreshCw,
  Search,
  ChevronDown,
  CheckCircle2,
  XCircle,
  CircleHelp,
  ShieldAlert,
} from 'lucide-react';
import { ClinicalModal } from '@/components/clinic/ClinicalModal';
import { PageHeader } from '@/components/clinic/ui';
import {
  SCANNER_PATIENTS,
  SERVICES,
  SERVICE_DESCRIPTIONS,
  SCAN_STATUSES,
  filterScannerPatients,
  type Service,
  type ScanStatus,
  type ScannerPatient,
} from './scannerData';

const tones: Record<ScanStatus, string> = {
  Eligible: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Potential: 'bg-amber-50 text-amber-800 border-amber-200',
  'Needs Data': 'bg-sky-50 text-sky-700 border-sky-200',
};
const button =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
type Action =
  | 'Refer / Schedule Assessment'
  | 'Add Missing Data to Chart'
  | 'Add to Care Plan'
  | 'Document in Chart';
type Activity = { patient: string; service: Service; action: Action; detail: string; time: string };

export function ServiceScanner() {
  const [query, setQuery] = useState('');
  const [service, setService] = useState<Service | null>(null);
  const [status, setStatus] = useState<ScanStatus | 'All'>('All');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailService, setDetailService] = useState<Service>('PRP');
  const [lastScan, setLastScan] = useState('September 10, 2026, 9:00 AM (demo)');
  const [scanning, setScanning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [action, setAction] = useState<{
    patient: ScannerPatient;
    service: Service;
    type: Action;
  } | null>(null);
  const [detail, setDetail] = useState('');
  const [activity, setActivity] = useState<Activity[]>([]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const patients = filterScannerPatients(SCANNER_PATIENTS, query, service, status);
  function rescan() {
    if (scanning) return;
    setScanning(true);
    timer.current = setTimeout(() => {
      setLastScan(new Date().toLocaleString());
      setScanning(false);
    }, 1200);
  }
  function openAction(patient: ScannerPatient, type: Action) {
    setAction({ patient, service: detailService, type });
    setDetail(
      type === 'Add Missing Data to Chart'
        ? ''
        : `${detailService}: ${patient.services[detailService].recommendation}`,
    );
  }
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <strong>Clinical decision support · Demo preview.</strong> These eight fictional patients
        illustrate screening workflows. Results require clinician verification and do not establish
        diagnosis, coverage, treatment authorization or legal eligibility. Actions stay in this
        preview; no live charts are changed.
      </div>
      <PageHeader
        title="Service Eligibility Scanner"
        description="Review service opportunities and documentation gaps across your care team."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span aria-live="polite" className="text-xs text-slate-500">
              Last scan: {lastScan}
            </span>
            <button
              onClick={rescan}
              disabled={scanning}
              className="flex items-center gap-2 rounded-xl bg-[#6B5CC8] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-70"
            >
              <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} />
              {scanning ? 'Scanning patients…' : 'Re-Scan All Patients'}
            </button>
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {SERVICES.map((key) => (
          <button
            key={key}
            aria-pressed={service === key}
            onClick={() => {
              setService(service === key ? null : key);
              setStatus(service === key ? 'All' : status === 'All' ? 'Eligible' : status);
              setDetailService(key);
            }}
            className={`rounded-2xl border p-4 text-left shadow-sm transition ${service === key ? 'border-[#6B5CC8] bg-violet-50 ring-2 ring-[#6B5CC8]/20' : 'border-slate-200 bg-white hover:border-[#6B5CC8]'}`}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{key}</h2>
              <ScanLine size={20} className="text-[#6B5CC8]" />
            </div>
            <p className="mt-1 min-h-10 text-xs text-slate-500">{SERVICE_DESCRIPTIONS[key]}</p>
            <div className="mt-4 grid grid-cols-3 gap-1">
              {SCAN_STATUSES.map((state) => (
                <div key={state}>
                  <p className="text-xl font-semibold text-slate-900">
                    {
                      SCANNER_PATIENTS.filter((patient) => patient.services[key].status === state)
                        .length
                    }
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600">{state}</p>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <label className="relative min-w-0 flex-1">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              aria-label="Search patients or diagnosis"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patients or diagnosis…"
              className="w-full min-w-48 rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm"
            />
          </label>
          <select
            aria-label="Screening status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ScanStatus | 'All')}
            className={button}
          >
            <option>All</option>
            {SCAN_STATUSES.map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
          {service && (
            <button className={button} onClick={() => setService(null)}>
              Clear {service} filter
            </button>
          )}
          <span className="text-xs text-slate-500">{patients.length} patients</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['Patient', 'Age / Gender', 'Primary Diagnosis', ...SERVICES, 'Details'].map(
                  (heading) => (
                    <th key={heading} className="px-4 py-3 font-semibold">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map((patient) => (
                <Fragment key={patient.id}>
                  <tr
                    onClick={() => setExpanded(expanded === patient.id ? null : patient.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-4 font-semibold text-slate-900">{patient.name}</td>
                    <td className="px-4 py-4 text-slate-500">
                      {patient.age} / {patient.gender}
                    </td>
                    <td className="max-w-56 px-4 py-4 text-slate-600">{patient.diagnosis}</td>
                    {SERVICES.map((key) => (
                      <td key={key} className="px-4 py-4">
                        <span
                          className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${tones[patient.services[key].status]}`}
                        >
                          {patient.services[key].status}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-4">
                      <button
                        aria-label={`Details for ${patient.name}`}
                        aria-expanded={expanded === patient.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpanded(expanded === patient.id ? null : patient.id);
                        }}
                        className="rounded-lg p-2 hover:bg-violet-100"
                      >
                        <ChevronDown
                          size={18}
                          className={expanded === patient.id ? 'rotate-180' : ''}
                        />
                      </button>
                    </td>
                  </tr>
                  {expanded === patient.id && (
                    <tr>
                      <td colSpan={SERVICES.length + 4} className="bg-slate-50 p-5">
                        <div
                          className="flex gap-2"
                          role="tablist"
                          aria-label={`${patient.name} services`}
                        >
                          {SERVICES.map((key) => (
                            <button
                              key={key}
                              role="tab"
                              aria-selected={detailService === key}
                              onClick={() => setDetailService(key)}
                              className={`${button} ${detailService === key ? '!border-[#6B5CC8] !bg-[#6B5CC8] !text-white' : ''}`}
                            >
                              {key}
                            </button>
                          ))}
                        </div>
                        <div role="tabpanel" aria-label={`${detailService} screening details`}>
                          <div className="mt-4 grid gap-3 lg:grid-cols-3">
                            {[
                              {
                                title: 'Criteria Met',
                                items: patient.services[detailService].met,
                                Icon: CheckCircle2,
                                color: 'text-emerald-600',
                              },
                              {
                                title: 'Criteria Not Met',
                                items: patient.services[detailService].notMet,
                                Icon: XCircle,
                                color: 'text-red-600',
                              },
                              {
                                title: 'Missing Data',
                                items: patient.services[detailService].missing,
                                Icon: CircleHelp,
                            color: 'text-sky-600',
                              },
                            ].map(({ title, items, Icon, color }) => (
                              <div
                                key={title}
                                className="rounded-xl border border-slate-200 bg-white p-4"
                              >
                                <h3 className={`text-sm font-semibold ${color}`}>{title}</h3>
                                <ul className="mt-3 space-y-2">
                                  {items.length ? (
                                    items.map((item) => (
                                      <li
                                        key={item}
                                        className="flex gap-2 text-xs leading-5 text-slate-600"
                                      >
                                        <Icon size={15} className={`mt-0.5 shrink-0 ${color}`} />
                                        {item}
                                      </li>
                                    ))
                                  ) : (
                                    <li className="text-xs text-slate-400">
                                      None recorded in this demo screening.
                                    </li>
                                  )}
                                </ul>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
                            <h3 className="font-semibold text-[#6B5CC8]">
                              Clinical Recommendation
                            </h3>
                            <p className="mt-2 text-sm text-slate-700">
                              {patient.services[detailService].recommendation}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              {detailService === 'Residential' && (
                                <Link
                                  href="/dashboard/residential"
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 transition"
                                >
                                  Open Residential Admissions (ASAM 3.1/3.5) &rarr;
                                </Link>
                              )}
                              {detailService === 'PRP' && (
                                <Link
                                  href="/dashboard/prp/assessment"
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:bg-teal-700 transition"
                                >
                                  Open PRP Assessment &rarr;
                                </Link>
                              )}
                              {detailService === 'AOT' && (
                                <Link
                                  href="/dashboard/aot"
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:bg-purple-700 transition"
                                >
                                  Open AOT Court Screener &rarr;
                                </Link>
                              )}
                              {(detailService === 'Spravato' || detailService === 'TMS') && (
                                <Link
                                  href="/dashboard/ehr/tms-spravato"
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 transition"
                                >
                                  Open TMS & Spravato Suite &rarr;
                                </Link>
                              )}
                              {patient.services[detailService].status === 'Eligible' && (
                                <button
                                  className={button}
                                  onClick={() => openAction(patient, 'Refer / Schedule Assessment')}
                                >
                                  Refer / Schedule Assessment
                                </button>
                              )}
                              {patient.services[detailService].status === 'Needs Data' && (
                                <button
                                  className={button}
                                  onClick={() => openAction(patient, 'Add Missing Data to Chart')}
                                >
                                  Add Missing Data to Chart
                                </button>
                              )}
                              <button
                                className={button}
                                onClick={() => openAction(patient, 'Add to Care Plan')}
                              >
                                Add to Care Plan
                              </button>
                              <button
                                className={button}
                                onClick={() => openAction(patient, 'Document in Chart')}
                              >
                                Document in Chart
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {patients.length === 0 && (
            <p className="p-10 text-center text-sm text-slate-500">
              No patients match these filters.
            </p>
          )}
        </div>
      </section>
      {activity.length > 0 && (
        <section aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Preview activity</h2>
          <p className="mt-1 text-xs text-slate-500">Draft actions for this session only.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {activity.map((item, index) => (
              <li key={index} className="py-3 text-sm">
                <p className="font-medium">
                  {item.patient} · {item.service} · {item.action}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">{item.detail}</p>
                <p className="mt-1 text-xs text-slate-400">{item.time}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <ShieldAlert size={20} className="shrink-0" />
        <div>
          <strong>AOT Legal Notice</strong>
          <p className="mt-1">
            AOT requires statutory criteria, due process and court review. Maryland Health General
            Article §10-632 addresses involuntary admission hearings; AOT provisions are in Subtitle
            6A. A scanner result cannot authorize involuntary treatment.
          </p>
          <a
            href="https://health.maryland.gov/bha/Pages/Assisted-Outpatient-Treatment.aspx"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Maryland AOT guidance
          </a>
        </div>
      </div>
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <ShieldAlert size={20} className="shrink-0" />
        <div>
          <strong>Spravato REMS Warning</strong>
          <p className="mt-1">
            Verify certified treatment setting and outpatient enrollment in SPRAVATO REMS. Mandatory
            observation is at least 2 hours after each dose, with clinician assessment before
            discharge. JANSSEN CAREPATH enrollment / access support does not replace REMS
            enrollment.
          </p>
          <a
            href="https://www.spravatorems.com/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Official SPRAVATO REMS requirements
          </a>
        </div>
      </div>
      {action && (
        <ClinicalModal title={`${action.type} — Preview`} onClose={() => setAction(null)}>
          <p className="text-sm text-slate-600">
            {action.patient.name} · {action.service}. Save a draft to preview activity for clinical
            review.
          </p>
          <label className="block text-sm font-medium">
            {action.type === 'Refer / Schedule Assessment'
              ? 'Referral details / preferred assessment time'
              : action.type === 'Add Missing Data to Chart'
                ? 'Additional clinical data'
                : 'Draft documentation'}
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={5}
              maxLength={4000}
              className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal"
            />
          </label>
          <button
            disabled={!detail.trim()}
            className="rounded-xl bg-[#6B5CC8] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => {
              setActivity((items) => [
                {
                  patient: action.patient.name,
                  service: action.service,
                  action: action.type,
                  detail: detail.trim(),
                  time: new Date().toLocaleString(),
                },
                ...items,
              ]);
              setAction(null);
            }}
          >
            Save preview draft
          </button>
        </ClinicalModal>
      )}
    </div>
  );
}
