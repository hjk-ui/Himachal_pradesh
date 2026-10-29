'use client';

import React from 'react';
import {
  YES_NO,
  YES_NO_UNKNOWN,
  fieldVisible,
  optionLabel,
  sectionVisible,
  type FieldSpec,
  type FormData,
  type FormDefinition,
  type FormSignature,
} from '@/lib/aot/forms';
import {
  CERTIFIED_MAIL,
  LETTER_METHODS,
  LETTER_RE,
  LETTER_RESPONSES,
  LETTER_SIGNATURE_PROGRAM,
  LETTER_SIGNATURE_TITLE,
  LETTER_TEXT,
  LETTERHEAD,
  MDH_FOOTER,
} from '@/lib/aot/forms/nonresponsiveLetter';
import { COMPLAINT_ROUTING_NOTES, COMPLAINT_SUBMIT_TO, CONFIDENTIALITY_NOTICE } from '@/lib/aot/forms/complaint';

export type PrintableDocument = {
  formType: string;
  version: number;
  status: string;
  data: FormData;
  signatures: FormSignature[];
  mailing?: { trackingNumber: string; mailedDate: string } | null;
};

const fmtDate = (v: unknown) => {
  const s = String(v ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
};
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
};

function Box({ on }: { on: boolean }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 border border-black mr-1 align-[-2px] text-[10px] leading-none font-bold">
      {on ? 'X' : ''}
    </span>
  );
}

function Blank({ value, wide }: { value?: string; wide?: boolean }) {
  return value ? (
    <span className="whitespace-pre-wrap">{value}</span>
  ) : (
    <span className={`inline-block max-w-full border-b border-black ${wide ? 'w-72' : 'w-40'}`}>&nbsp;</span>
  );
}

function Choices({ options, value, multi }: { options: { value: string; label: string }[]; value: unknown; multi?: boolean }) {
  const list = multi ? (Array.isArray(value) ? (value as string[]) : []) : [String(value ?? '')];
  return (
    <span className="inline-flex flex-wrap gap-x-4 gap-y-0.5">
      {options.map((o) => (
        <span key={o.value}>
          <Box on={list.includes(o.value)} />
          {o.label}
        </span>
      ))}
    </span>
  );
}

function PrintField({ f, d }: { f: FieldSpec; d: FormData }) {
  const v = d[f.key];
  const num = f.num ? <strong>{f.num}. </strong> : null;
  switch (f.type) {
    case 'static':
      return (
        <p className="my-1.5">
          {num}
          {f.text}
        </p>
      );
    case 'checkbox':
      return (
        <p className="my-1">
          <Box on={v === true} />
          {num}
          {f.label}
        </p>
      );
    case 'yesno':
    case 'yesnounknown':
    case 'radio':
    case 'checkboxes':
      return (
        <div className="my-1.5">
          <p className="font-medium">
            {num}
            {f.label}
          </p>
          <div className="ml-4">
            <Choices options={f.type === 'yesno' ? YES_NO : f.type === 'yesnounknown' ? YES_NO_UNKNOWN : f.options ?? []} value={v} multi={f.type === 'checkboxes'} />
          </div>
        </div>
      );
    case 'select':
      return (
        <p className="my-1">
          {num}
          <span className="font-medium">{f.label}:</span> <Blank value={v ? optionLabel(f.options, v) : ''} />
        </p>
      );
    case 'table': {
      const rows = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
      const cols = f.columns ?? [];
      return (
        <div className="my-2">
          <p className="font-medium mb-1">
            {num}
            {f.label}
          </p>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className="border border-black px-1 py-0.5 text-left align-top">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.length ? rows : [{}, {}]).map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const cv = r[c.key];
                    const text =
                      c.type === 'checkbox'
                        ? cv === true ? 'X' : ''
                        : c.type === 'checkboxes'
                          ? (Array.isArray(cv) ? (cv as string[]) : []).map((x) => optionLabel(c.options, x)).join(', ')
                          : c.type === 'select' || c.type === 'yesno'
                            ? cv ? optionLabel(c.type === 'yesno' ? YES_NO : c.options, cv) : ''
                            : c.type === 'date'
                              ? fmtDate(cv)
                              : String(cv ?? '');
                    return (
                      <td key={c.key} className="border border-black px-1 py-0.5 align-top whitespace-pre-wrap h-5">{text}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'textarea':
      return (
        <div className="my-1.5">
          <p className="font-medium">
            {num}
            {f.label}
          </p>
          <div className="ml-4 min-h-[2.5em] border-b border-black whitespace-pre-wrap">{String(v ?? '')}</div>
        </div>
      );
    default:
      return (
        <p className="my-1">
          {num}
          <span className="font-medium">{f.label}:</span> <Blank value={f.type === 'date' ? fmtDate(v) : String(v ?? '')} />
        </p>
      );
  }
}

function Signatures({ def, doc }: { def: FormDefinition; doc: PrintableDocument }) {
  return (
    <div className="mt-6 space-y-3 break-inside-avoid">
      {def.signers.map((slot) => {
        const s = doc.signatures.find((x) => x.slot === slot.id);
        return (
          <div key={slot.id} className="grid grid-cols-3 gap-3 items-end">
            <div>
              <div className="border-b border-black min-h-[1.5em] italic">{s ? `/s/ ${s.name} (electronically signed)` : ''}</div>
              <p className="text-[10px]">{slot.label}</p>
            </div>
            <div>
              <div className="border-b border-black min-h-[1.5em]">{s ? [s.name, s.title].filter(Boolean).join(', ') : ''}</div>
              <p className="text-[10px]">Name{slot.askTitle ? ' / title' : ''}</p>
            </div>
            <div>
              <div className="border-b border-black min-h-[1.5em]">{s ? fmtDateTime(s.signedAt) : ''}</div>
              <p className="text-[10px]">Date</p>
            </div>
          </div>
        );
      })}
      {doc.signatures.length > 0 && (
        <p className="text-[10px] text-gray-700">Attestation: {def.attestation}</p>
      )}
    </div>
  );
}

function Footer({ def, doc }: { def: FormDefinition; doc: PrintableDocument }) {
  return (
    <div className="mt-8 pt-2 border-t border-black text-[10px] flex flex-wrap justify-between gap-2">
      <span>
        {def.mdhNumber ? `${def.mdhNumber} · ` : ''}Revised {def.revised}
      </span>
      <span>
        Altrixs version {doc.version} · {doc.status === 'signed' ? 'Signed' : doc.status === 'superseded' ? 'Superseded by a later version' : 'DRAFT — not signed'}
      </span>
    </div>
  );
}

function LetterDocument({ doc }: { doc: PrintableDocument }) {
  const d = doc.data;
  const attempts = Array.isArray(d.outreachAttempts) ? (d.outreachAttempts as Record<string, unknown>[]) : [];
  const resp = Array.isArray(d.responseStatus) ? (d.responseStatus as string[]) : [];
  const sig = doc.signatures[0];
  const respLabel = (v: string) => LETTER_RESPONSES.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="text-[12px] leading-relaxed">
      <div className="text-center">
        <p className="font-bold text-[14px] tracking-wide">{LETTERHEAD}</p>
        <p>{String(d.regionalOfficeAddress ?? '')}</p>
        <p>{String(d.regionalOfficeCity ?? '')}</p>
        <p>
          {String(d.regionalOfficePhone ?? '')}
          {d.regionalOfficeEmail ? ` · ${String(d.regionalOfficeEmail)}` : ''}
        </p>
      </div>
      <p className="mt-5 font-bold">{CERTIFIED_MAIL}</p>
      {doc.mailing && <p className="text-[11px]">Certified mail tracking # {doc.mailing.trackingNumber} · mailed {fmtDate(doc.mailing.mailedDate)}</p>}
      <p className="mt-3">{fmtDate(d.letterDate)}</p>
      <div className="mt-3">
        <p>{String(d.respondentName ?? '')}</p>
        <p className="whitespace-pre-wrap">{String(d.mailingAddress ?? '')}</p>
      </div>
      <p className="mt-4">
        <strong>Re:</strong> {LETTER_RE}
      </p>
      <p className="mt-4">Dear {String(d.respondentName ?? '')}:</p>
      <p className="mt-3">{LETTER_TEXT.intro}</p>

      <p className="mt-4 font-bold">{LETTER_TEXT.outreachHeading}</p>
      <p className="mt-1">{LETTER_TEXT.outreachIntro}</p>
      <table className="w-full border-collapse mt-2 text-[11px]">
        <thead>
          <tr>
            <th className="border border-black px-1 py-0.5 text-left">Date</th>
            <th className="border border-black px-1 py-0.5 text-left">Method (Phone / Mail / In-Person / Other)</th>
            <th className="border border-black px-1 py-0.5 text-left">Result</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a, i) => (
            <tr key={i}>
              <td className="border border-black px-1 py-0.5">{fmtDate(a.date)}</td>
              <td className="border border-black px-1 py-0.5">{optionLabel(LETTER_METHODS, a.method)}</td>
              <td className="border border-black px-1 py-0.5">{String(a.result ?? '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 space-y-0.5">
        <p><Box on={resp.includes('declined')} />{respLabel('declined')}</p>
        <p><Box on={resp.includes('no_response')} />{respLabel('no_response')}</p>
        <p>
          <Box on={resp.includes('other')} />
          Other: {resp.includes('other') ? String(d.responseOther ?? '') : <Blank />}
        </p>
      </div>

      <p className="mt-4 font-bold">{LETTER_TEXT.orientationHeading}</p>
      <p className="mt-1">{LETTER_TEXT.orientation1}</p>
      <p className="mt-2">{LETTER_TEXT.orientation2}</p>

      <p className="mt-4 font-bold">{LETTER_TEXT.preferencesHeading}</p>
      <p className="mt-1">{LETTER_TEXT.preferencesIntro}</p>
      <ul className="list-disc ml-6 mt-1">
        {LETTER_TEXT.preferencesBullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <p className="mt-2">{LETTER_TEXT.preferencesReturn}</p>

      <p className="mt-4 font-bold">{LETTER_TEXT.contactHeading}</p>
      <p className="mt-1">{LETTER_TEXT.contactIntro}</p>
      <div className="mt-1 ml-4">
        <p>AOT Program Contact: <Blank value={String(d.contactName ?? '')} /></p>
        <p>Phone: <Blank value={String(d.contactPhone ?? '')} /></p>
        <p>Email: <Blank value={String(d.contactEmail ?? '')} /></p>
      </div>
      <p className="mt-2">{LETTER_TEXT.contactClosing}</p>

      <div className="mt-6 break-inside-avoid">
        <p>{LETTER_TEXT.sincerely}</p>
        <p className="mt-4 italic min-h-[1.5em]">{sig ? `/s/ ${sig.name} (electronically signed ${fmtDateTime(sig.signedAt)})` : ''}</p>
        <p>{String(d.directorName ?? '')}</p>
        <p>{LETTER_SIGNATURE_TITLE}</p>
        <p>{LETTER_SIGNATURE_PROGRAM}</p>
      </div>
      <p className="mt-4">{LETTER_TEXT.enclosures}</p>
      <p className="mt-1">{LETTER_TEXT.cc}</p>
      <div className="mt-8 pt-2 border-t border-black text-[10px] text-center">
        <p>{MDH_FOOTER}</p>
        <p className="mt-1">
          Altrixs version {doc.version} · {doc.status === 'signed' ? 'Signed' : doc.status === 'superseded' ? 'Superseded' : 'DRAFT — not signed'}
        </p>
      </div>
    </div>
  );
}

function AffidavitDocument({ def, doc }: { def: FormDefinition; doc: PrintableDocument }) {
  const d = doc.data;
  const c = (k: string) => d[k] === true;
  const txt = (k: string) => String(d[k] ?? '');
  const facts = (k: string) => (txt(k) ? <p className="ml-10 text-[11px] whitespace-pre-wrap">{txt(k)}</p> : null);
  return (
    <div className="text-[12px] leading-relaxed">
      <p>
        I, <Blank value={txt('psychiatristName')} />, hereby, under penalty of perjury, affirm that:
      </p>
      <ol className="list-decimal ml-5 mt-2 space-y-2">
        <li>
          I personally examined <Blank value={txt('respondentName')} /> on <Blank value={fmtDate(d.examDate)} />.
        </li>
        <li>
          The respondent meets the criteria of Health-General §10-6A-05:
          <div className="ml-4 mt-1 space-y-1">
            <p><Box on={c('c_adult')} />a. The respondent is at least 18 years old (date of birth {fmtDate(d.respondentDob)}).</p>
            <p><Box on={c('c_spmi')} />b. The respondent has a serious and persistent mental illness.</p>
            {facts('c_spmiFacts')}
            <p>c. The respondent has a history of lack of adherence to treatment for mental illness:</p>
            <p className="ml-4"><Box on={c('c_hospitalization')} />(i) {def.sections[1].fields.find((f) => f.key === 'c_hospitalization')?.label}.</p>
            {c('c_hospitalization') && facts('c_hospitalizationDetails')}
            <p className="ml-4"><Box on={c('c_violence')} />(ii) {def.sections[1].fields.find((f) => f.key === 'c_violence')?.label}.</p>
            {c('c_violence') && facts('c_violenceDetails')}
            <p><Box on={c('c_needsAot')} />d. {def.sections[1].fields.find((f) => f.key === 'c_needsAot')?.label}.</p>
            {facts('c_needsAotFacts')}
            <p><Box on={c('c_unlikelyAdhere')} />e. {def.sections[1].fields.find((f) => f.key === 'c_unlikelyAdhere')?.label}.</p>
            {facts('c_unlikelyAdhereFacts')}
          </div>
        </li>
        <li><Box on={c('willingToTestify')} />I am willing and able to testify.</li>
        <li><Box on={c('notRelatedToRespondent')} />I am not related by blood or marriage to the respondent.</li>
        <li>
          <Box on={c('notRelatedToPetitioner')} />I am not related to <Blank value={txt('petitionerName')} /> (petitioner).
        </li>
        <li>
          <p><Box on={txt('financialInterest') === 'none'} />I have no financial interest in the outcome; or</p>
          <p><Box on={txt('financialInterest') === 'disclosed'} />I have the following financial interest, which I disclosed to the respondent:</p>
          {txt('financialInterest') === 'disclosed' && <p className="ml-6 whitespace-pre-wrap">{txt('financialInterestDescription')}</p>}
        </li>
      </ol>
      <Signatures def={def} doc={doc} />
      <Footer def={def} doc={doc} />
    </div>
  );
}

export default function FormDocument({ def, doc }: { def: FormDefinition; doc: PrintableDocument }) {
  const watermark =
    doc.status !== 'signed' ? (
      <p className="text-center text-[11px] font-bold border border-black py-1 mb-3">
        {doc.status === 'superseded' ? 'SUPERSEDED — a later version of this form exists' : 'DRAFT — NOT SIGNED — NOT FOR FILING'}
      </p>
    ) : null;

  if (def.type === 'nonresponsive_letter') {
    return (
      <div>
        {watermark}
        <LetterDocument doc={doc} />
      </div>
    );
  }

  const isComplaint = def.type === 'complaint';
  return (
    <div className="text-[12px] leading-snug text-black">
      {watermark}
      {isComplaint && <p className="text-[10px] font-bold border border-black p-1.5 mb-3">{CONFIDENTIALITY_NOTICE}</p>}
      <div className="text-center mb-4">
        <p className="text-[11px] uppercase tracking-wide">Maryland Department of Health · Behavioral Health Administration</p>
        <h1 className="text-[16px] font-bold">{def.title}</h1>
        <p className="text-[11px]">Maryland Assisted Outpatient Treatment (AOT) Program</p>
      </div>
      {isComplaint && (
        <div className="mb-3 text-[11px] border border-black p-2">
          <p className="font-bold">Purpose and routing</p>
          <ul className="list-disc ml-5">
            {COMPLAINT_ROUTING_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>Submit the completed report to {COMPLAINT_SUBMIT_TO}.</li>
          </ul>
        </div>
      )}
      {def.type === 'psychiatrist_affidavit' ? (
        <AffidavitDocument def={def} doc={doc} />
      ) : (
        <>
          {def.sections.filter((s) => sectionVisible(s, doc.data)).map((s) => (
            <section key={s.id} className="mb-3 break-inside-avoid-page">
              <h2 className="text-[13px] font-bold border-b border-black mb-1">{s.title}</h2>
              {s.intro && <p className="text-[11px] italic mb-1 whitespace-pre-line">{s.intro}</p>}
              {s.fields.filter((f) => fieldVisible(f, doc.data)).map((f) => (
                <PrintField key={f.key} f={f} d={doc.data} />
              ))}
            </section>
          ))}
          <Signatures def={def} doc={doc} />
          {isComplaint && (
            <section className="mt-5 border border-black p-2 min-h-[5em]">
              <h2 className="text-[12px] font-bold">Section X. For MDH use only</h2>
            </section>
          )}
          {isComplaint && <p className="mt-3 text-[10px] font-bold">{CONFIDENTIALITY_NOTICE}</p>}
          <Footer def={def} doc={doc} />
        </>
      )}
    </div>
  );
}
