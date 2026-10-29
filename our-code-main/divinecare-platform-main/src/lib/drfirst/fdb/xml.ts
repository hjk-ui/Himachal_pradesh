import { SaxesParser } from 'saxes';
import { DrFirstError } from '../errors';
import type { DrugAllergyResult, DrugAllergySearchResponse, FdbRequestContext, FdbSettings } from './types';

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

const MAX_XML_CHARACTERS = 2_000_000;
const MAX_XML_NODES = 20_000;

export function escapeXmlText(value: string) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
    throw new DrFirstError('DRFIRST_INVALID_INPUT');
  }
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function tag(name: string, value: string | undefined) {
  return value === undefined ? '' : `<${name}>${escapeXmlText(value)}</${name}>`;
}

export function buildDrugAllergySearchXml(
  settings: FdbSettings & { vendorName: string; vendorPassword: string; practiceUsername: string; systemName: string },
  request: FdbRequestContext,
) {
  const maximum = request.maximum === undefined ? '' : tag('Maximum', String(request.maximum));
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<RCExtRequest version="${escapeXmlText(settings.apiVersion)}">` +
    `<TraceInformation>${tag('RequestMessageID', request.requestMessageId)}</TraceInformation>` +
    `<Caller>${tag('VendorName', settings.vendorName)}${tag('VendorPassword', settings.vendorPassword)}` +
    `${tag('Application', settings.application)}${tag('Version', settings.applicationVersion)}` +
    `${tag('RcopiaPracticeName', settings.practiceName)}${tag('Station', settings.station)}</Caller>` +
    `${tag('RcopiaPracticeUsername', settings.practiceUsername)}${tag('SystemName', settings.systemName)}` +
    `<Request><Command>search_drug_allergy</Command><Search>${tag('SearchString', request.searchString)}${maximum}</Search></Request>` +
    `</RCExtRequest>`;
}

function localName(name: string) {
  return name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
}

function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_XML_CHARACTERS || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
  const document: XmlNode = { name: '#document', text: '', children: [] };
  const stack = [document];
  let nodes = 0;
  let parseError: unknown;
  const parser = new SaxesParser({ xmlns: false, position: false });
  parser.on('opentag', opened => {
    if (++nodes > MAX_XML_NODES) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
    const node: XmlNode = { name: localName(opened.name), text: '', children: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on('text', value => { stack.at(-1)!.text += value; });
  parser.on('cdata', value => { stack.at(-1)!.text += value; });
  parser.on('closetag', () => { if (stack.length > 1) stack.pop(); });
  parser.on('doctype', () => { parseError = new Error('DTD is not accepted'); });
  parser.on('error', error => { parseError = error; });
  try {
    parser.write(xml).close();
  } catch (error) {
    parseError = error;
  }
  if (parseError || document.children.length !== 1) {
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
  return document.children[0];
}

function children(node: XmlNode, name: string) {
  return node.children.filter(child => child.name === name);
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const child of node.children) {
    if (child.name === name) found.push(child);
    found.push(...descendants(child, name));
  }
  return found;
}

function value(node: XmlNode, name: string) {
  const result = children(node, name)[0]?.text.trim();
  return result ? result.slice(0, 2_000) : undefined;
}

export function parseDrugAllergySearchResponse(xml: string): DrugAllergySearchResponse {
  const root = parseXml(xml);
  const upstreamError = descendants(root, 'Error')[0];
  if (upstreamError) throw new DrFirstError('DRFIRST_UPSTREAM_REJECTED', 422);

  const drugs: DrugAllergyResult[] = descendants(root, 'Drug').slice(0, 200).map(drug => ({
    rcopiaId: value(drug, 'RcopiaID'),
    ndcId: value(drug, 'NDCID'),
    rxNormId: value(drug, 'RxnormID'),
    rxNormIdType: value(drug, 'RxnormIDType'),
    firstDataBankMedId: value(drug, 'FirstDataBankMedID'),
    brandName: value(drug, 'BrandName'),
    genericName: value(drug, 'GenericName'),
    form: value(drug, 'Form'),
    strength: value(drug, 'Strength'),
    schedule: value(drug, 'Schedule'),
    routeCode: value(drug, 'RouteCode'),
    drugNameType: value(drug, 'DrugNameType'),
    legendStatus: value(drug, 'LegendStatus'),
    brandingSource: value(drug, 'BrandingSource'),
    ingredients: children(drug, 'Ingredient').map(ingredient => ({
      rxNormId: value(ingredient, 'RxnormID'),
      rxNormIdType: value(ingredient, 'RxnormIDType'),
      firstDataBankMedId: value(ingredient, 'FirstDataBankMedID'),
    })),
    allergyGroups: descendants(drug, 'DrugGroup').map(group => ({
      groupId: value(group, 'GroupID'),
      groupName: value(group, 'GroupName'),
    })),
  }));
  const warnings = descendants(root, 'Warning').map(warning => ({
    code: value(warning, 'Code'),
    text: value(warning, 'Text') || 'DrFirst returned a warning.',
  }));
  return { drugs, warnings };
}
