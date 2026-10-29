import { SaxesParser } from 'saxes';
import { DrFirstError } from '../errors';
import { escapeXmlText } from '../fdb/xml';
import type { IntegrationPatient } from '../types';

type Node = { name: string; text: string; children: Node[] };
const MAX_NODES = 20_000;

function tag(name: string, value?: string) {
  return value ? `<${name}>${escapeXmlText(value)}</${name}>` : '';
}

/** Always emit the element — empty when cleared (DrFirst middle-name certification). */
function tagAlways(name: string, value?: string | null) {
  return `<${name}>${escapeXmlText(value || '')}</${name}>`;
}

export type RcopiaEnvelopeSettings = {
  apiVersion: string;
  vendorUsername: string;
  vendorPassword: string;
  application: string;
  applicationVersion: string;
  practiceName?: string;
  station?: string;
  practiceUsername: string;
  systemName: string;
  practiceId?: string;
  rcopiaUserName?: string;
};

export function buildRcopiaRequest(settings: RcopiaEnvelopeSettings, requestMessageId: string, requestXml: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<RCExtRequest version="${escapeXmlText(settings.apiVersion)}">` +
    `<TraceInformation>${tag('RequestMessageID', requestMessageId.slice(0, 40))}</TraceInformation>` +
    `<Caller>${tag('VendorName', settings.vendorUsername)}${tag('VendorPassword', settings.vendorPassword)}` +
    `${tag('Username', settings.vendorUsername)}${tag('Password', settings.vendorPassword)}` +
    `${tag('Application', settings.application)}${tag('Version', settings.applicationVersion)}` +
    `${tag('PracticeName', settings.practiceName || settings.practiceUsername)}` +
    `${tag('PracticeUserName', settings.practiceUsername)}${tag('PracticeID', settings.practiceId)}` +
    `${tag('RcopiaPracticeName', settings.practiceName || settings.practiceUsername)}${tag('Station', settings.station)}` +
    `${tag('RcopiaUserName', settings.rcopiaUserName)}</Caller>` +
    `${tag('RcopiaPracticeUsername', settings.practiceUsername)}${tag('SystemName', settings.systemName)}` +
    `<Request>${requestXml}</Request></RCExtRequest>`;
}

export function buildSendPatientRequest(patient: IntegrationPatient, externalId: string) {
  const dob = patient.dateOfBirth.split('-');
  if (dob.length !== 3 || !patient.firstName || !patient.lastName || !patient.sex) {
    throw new DrFirstError('DRFIRST_PATIENT_INVALID');
  }
  return `<Command>send_patient</Command><PatientList><Patient>` +
    `${tag('ExternalID', externalId)}${tag('FirstName', patient.firstName)}${tagAlways('MiddleName', patient.middleName)}` +
    `${tag('LastName', patient.lastName)}${tag('DOB', `${dob[1]}/${dob[2]}/${dob[0]}`)}${tag('Sex', patient.sex)}` +
    `${tag('Address1', patient.addressLine1)}${tag('City', patient.city)}${tag('State', patient.state)}` +
    `${tag('Zip', patient.postalCode)}${tag('HomePhone', patient.phone?.replace(/\D/g, ''))}` +
    `</Patient></PatientList>`;
}

export function buildNotificationCountRequest() {
  return '<Command>get_notification_count</Command><ReturnPrescriptionIDs>y</ReturnPrescriptionIDs><ReturnRefillIDs>y</ReturnRefillIDs>';
}

function parse(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  const root: Node = { name: '#document', text: '', children: [] };
  const stack = [root];
  let count = 0;
  let failed = false;
  const parser = new SaxesParser({ xmlns: false, position: false });
  parser.on('opentag', opened => {
    if (++count > MAX_NODES) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
    const node: Node = { name: opened.name.includes(':') ? opened.name.split(':').at(-1)! : opened.name, text: '', children: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on('text', value => { stack.at(-1)!.text += value; });
  parser.on('cdata', value => { stack.at(-1)!.text += value; });
  parser.on('closetag', () => { if (stack.length > 1) stack.pop(); });
  parser.on('doctype', () => { failed = true; });
  parser.on('error', () => { failed = true; });
  try { parser.write(xml).close(); } catch { failed = true; }
  if (failed || root.children.length !== 1) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  return root.children[0];
}

function descendants(node: Node, name: string): Node[] {
  const result: Node[] = [];
  for (const child of node.children) {
    if (child.name.toLowerCase() === name.toLowerCase()) result.push(child);
    result.push(...descendants(child, name));
  }
  return result;
}

function nodeText(node: Node): string {
  const own = node.text.trim();
  const nested = node.children.map(nodeText).filter(Boolean).join(' ');
  return [own, nested].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function vendorErrorDetail(xml: string) {
  try {
    const root = parse(xml);
    const nodes = [
      ...descendants(root, 'Error'),
      ...descendants(root, 'ErrorText'),
      ...descendants(root, 'Text'),
    ];
    const text = nodes.map(nodeText).find((value) => value.length > 0);
    return text ? text.slice(0, 240) : undefined;
  } catch {
    return undefined;
  }
}

export function validateRcopiaResponse(xml: string) {
  const root = parse(xml);
  if (descendants(root, 'Error').length || descendants(root, 'ErrorCode').length) {
    throw new DrFirstError('DRFIRST_UPSTREAM_REJECTED', 422, vendorErrorDetail(xml));
  }
  return root;
}


export function parseNotificationCounts(xml: string) {
  const root = validateRcopiaResponse(xml);
  const counts: Record<string, number> = {};
  for (const block of descendants(root, 'NotificationCount')) {
    const type = block.children.find(child => child.name.toLowerCase() === 'type')?.text.trim();
    const rawNumber = block.children.find(child => child.name.toLowerCase() === 'number')?.text.trim();
    if (!type || !rawNumber || !/^\d+$/.test(rawNumber)) continue;
    const value = Number(rawNumber);
    if (!Number.isSafeInteger(value)) continue;
    counts[type] = (counts[type] || 0) + value;
  }
  return counts;
}
