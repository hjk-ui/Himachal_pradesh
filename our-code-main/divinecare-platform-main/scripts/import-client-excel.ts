/**
 * Production-Grade Client Excel / CSV Ingestion Script
 *
 * Imports real client demographic and insurance sheets into PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/import-client-excel.ts <path-to-file.xlsx|csv> [options]
 *
 * Options:
 *   --location=<Name>   Default clinic location if not specified per row (e.g. "Bowie", "Silver Spring", "Lexington Park", "Baltimore")
 *   --org=<slug>        Target organization slug (default: "altrixs")
 *   --dry-run           Simulate ingestion and display parsed records without writing to PostgreSQL
 *   --limit=<N>         Limit import to first N records
 *
 * Column Mappings Handled Automatically:
 *   - First Name, Last Name (or Full Name)
 *   - DOB / Date of Birth (standardized to ISO)
 *   - Gender / Sex
 *   - Phone / Mobile (standardized to E.164: +1XXXXXXXXXX)
 *   - Email
 *   - Address, City, State, Zip / Postal Code
 *   - MRN / Medical Record Number
 *   - Primary Payer / Insurance Company
 *   - Policy Number / Member ID / Subscriber ID
 *   - Group Number
 *   - Location / Clinic / Facility
 */

import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { PrismaClient, ClientStatus, RiskLevel } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL;
let datasourceUrl = rawUrl;
if (rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === '127.0.0.1' && url.port === '5433') {
      url.searchParams.set('connection_limit', '5');
      url.searchParams.set('pool_timeout', '60');
      url.searchParams.set('connect_timeout', '30');
      url.searchParams.set('sslaccept', 'accept_invalid_certs');
    }
    datasourceUrl = url.toString();
  } catch {
    datasourceUrl = rawUrl;
  }
}

const prisma = new PrismaClient({
  datasourceUrl,
  log: ['error', 'warn'],
});

// Standardize phone number to E.164 (+1XXXXXXXXXX)
export function standardizePhoneE164(raw: unknown): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const cleaned = str.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    const digits = cleaned.replace(/\D/g, '');
    return digits.length >= 10 ? `+${digits}` : null;
  }

  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length > 10) {
    return `+${digits}`;
  }
  return null;
}

// Standardize date into Date object
export function standardizeDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  if (typeof raw === 'number') {
    // Excel serial number
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Check formats: MM/DD/YYYY, YYYY-MM-DD
  const mdyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdyMatch) {
    let year = parseInt(mdyMatch[3], 10);
    if (year < 100) year += year < 30 ? 2000 : 1900;
    const month = parseInt(mdyMatch[1], 10) - 1;
    const day = parseInt(mdyMatch[2], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (!isNaN(d.getTime())) return d;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

// Standardize Gender
export function standardizeGender(raw: unknown): string | null {
  if (!raw) return null;
  const str = String(raw).trim().toLowerCase();
  if (!str) return null;
  if (str === 'm' || str === 'male') return 'Male';
  if (str === 'f' || str === 'female') return 'Female';
  if (str.includes('non') || str.includes('binary')) return 'Non-Binary';
  return String(raw).trim();
}

// Normalize column header keys for flexible matching
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface ParsedClientRow {
  firstName: string;
  lastName: string;
  fullName: string;
  dob: Date | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  mrn: string | null;
  primaryPayer: string | null;
  policyNumber: string | null;
  groupNumber: string | null;
  rawLocation: string | null;
}

function mapRow(row: Record<string, unknown>): ParsedClientRow {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    norm[normalizeKey(k)] = v;
  }

  const getVal = (...keys: string[]): unknown => {
    for (const key of keys) {
      const cleanKey = normalizeKey(key);
      if (norm[cleanKey] !== undefined && norm[cleanKey] !== null && norm[cleanKey] !== '') {
        return norm[cleanKey];
      }
    }
    return undefined;
  };

  const rawFirst = String(getVal('firstname', 'first', 'patientfirstname', 'clientfirstname') || '').trim();
  const rawLast = String(getVal('lastname', 'last', 'patientlastname', 'clientlastname') || '').trim();
  const rawFull = String(getVal('name', 'fullname', 'patientname', 'clientname') || '').trim();

  let firstName = rawFirst;
  let lastName = rawLast;
  let fullName = '';

  if (firstName && lastName) {
    fullName = `${firstName} ${lastName}`.trim();
  } else if (rawFull) {
    fullName = rawFull;
    if (rawFull.includes(',')) {
      const parts = rawFull.split(',').map((s) => s.trim());
      lastName = parts[0] || '';
      firstName = parts[1] || '';
    } else {
      const parts = rawFull.split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }
  }

  const dobVal = getVal('dob', 'dateofbirth', 'birthdate', 'birth');
  const phoneVal = getVal('phone', 'phonenumber', 'cell', 'cellphone', 'mobile', 'telephone');
  const emailVal = getVal('email', 'emailaddress', 'clientemail', 'patientemail');
  const genderVal = getVal('gender', 'sex');

  const addrVal = getVal('address', 'addressline1', 'address1', 'streetaddress', 'street');
  const addr2Val = getVal('addressline2', 'address2', 'apt', 'suite', 'unit');
  const cityVal = getVal('city');
  const stateVal = getVal('state');
  const zipVal = getVal('zip', 'zipcode', 'postalcode', 'postal');

  const mrnVal = getVal('mrn', 'medicalrecordnumber', 'chartnumber', 'patientid', 'clientid');
  const payerVal = getVal('primarypayer', 'insurancepayer', 'payer', 'insurance', 'primaryinsurance', 'insurancename');
  const policyVal = getVal('policynumber', 'policyno', 'memberid', 'insurancememberid', 'subscriberid', 'policyid');
  const groupVal = getVal('groupnumber', 'groupno', 'insurancegroupnumber', 'grp');
  const locVal = getVal('location', 'clinic', 'facility', 'site', 'practicelocation');

  return {
    firstName,
    lastName,
    fullName: fullName || `${firstName} ${lastName}`.trim(),
    dob: standardizeDate(dobVal),
    gender: standardizeGender(genderVal),
    phone: standardizePhoneE164(phoneVal),
    email: emailVal ? String(emailVal).trim().toLowerCase() : null,
    addressLine1: addrVal ? String(addrVal).trim() : null,
    addressLine2: addr2Val ? String(addr2Val).trim() : null,
    city: cityVal ? String(cityVal).trim() : null,
    state: stateVal ? String(stateVal).trim().toUpperCase() : 'MD',
    postalCode: zipVal ? String(zipVal).trim() : null,
    mrn: mrnVal ? String(mrnVal).trim() : null,
    primaryPayer: payerVal ? String(payerVal).trim() : null,
    policyNumber: policyVal ? String(policyVal).trim() : null,
    groupNumber: groupVal ? String(groupVal).trim() : null,
    rawLocation: locVal ? String(locVal).trim() : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));

  const dryRun = args.includes('--dry-run');
  const locationArg = args.find((a) => a.startsWith('--location='))?.split('=')[1]?.trim();
  const orgSlugArg = args.find((a) => a.startsWith('--org='))?.split('=')[1]?.trim() || 'altrixs';
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1]?.trim();
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       DIVINE CARE / ALTRIXS CLIENT EXCEL INGESTION ENGINE      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (!filePath) {
    console.log('📖 READY TO INGEST CLIENT EXCEL / CSV DATA.');
    console.log('\nUsage:');
    console.log('  npx tsx scripts/import-client-excel.ts <path-to-file.xlsx|csv> [options]\n');
    console.log('Options:');
    console.log('  --location=<Name>   Default location (Bowie, Silver Spring, Lexington Park, Baltimore)');
    console.log('  --org=<slug>        Target organization (default: altrixs)');
    console.log('  --dry-run           Simulate ingestion without writing to PostgreSQL');
    console.log('  --limit=<N>         Import only the first N rows\n');
    console.log('Expected Columns (flexible header names accepted):');
    console.log('  - First Name, Last Name');
    console.log('  - DOB (Date of Birth)');
    console.log('  - Gender');
    console.log('  - Phone (standardized to E.164: +1XXXXXXXXXX)');
    console.log('  - Email');
    console.log('  - Address, City, State, Zip Code');
    console.log('  - MRN (auto-generated if omitted)');
    console.log('  - Primary Payer (Medicaid, Medicare, BCBS, etc.)');
    console.log('  - Policy Number / Member ID');
    console.log('  - Clinic Location (Bowie, Silver Spring, Lexington Park, Baltimore)\n');
    process.exit(0);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Error: File not found at path: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`📂 Reading source file: ${resolvedPath}`);
  const workbook = XLSX.readFile(resolvedPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.error('❌ Error: Excel workbook contains no sheets.');
    process.exit(1);
  }

  const sheet = workbook.Sheets[sheetName];
  let rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);
  console.log(`📊 Found ${rawRows.length} total rows in worksheet: "${sheetName}"`);

  if (limit && limit > 0) {
    rawRows = rawRows.slice(0, limit);
    console.log(`⚡ Processing limited to first ${rawRows.length} rows`);
  }

  // 1. Resolve Target Organization
  const org =
    (await prisma.organization.findUnique({ where: { slug: orgSlugArg } })) ||
    (await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } }));

  if (!org) {
    console.error(`❌ Error: Target organization "${orgSlugArg}" not found in database.`);
    process.exit(1);
  }
  console.log(`🏢 Organization: ${org.name} (ID: ${org.id}, Slug: ${org.slug})`);

  // 2. Fetch and Cache Active Practice Locations
  const locations = await prisma.location.findMany({
    where: { organizationId: org.id, active: true },
  });

  const locationByName = new Map<string, string>();
  locations.forEach((l) => {
    locationByName.set(l.name.toLowerCase().trim(), l.id);
    if (l.city) locationByName.set(l.city.toLowerCase().trim(), l.id);
  });

  const primaryLoc = locations.find((l) => l.isPrimary) || locations[0];
  console.log(`📍 Found ${locations.length} clinic practice locations:`);
  locations.forEach((l) => console.log(`   • ${l.name} (${l.city || 'MD'}) [ID: ${l.id}]`));

  function resolveLocationId(rawLoc?: string | null): string | null {
    if (locationArg) {
      const match = locationByName.get(locationArg.toLowerCase().trim());
      if (match) return match;
    }
    if (rawLoc) {
      const trimmed = rawLoc.toLowerCase().trim();
      const match = locationByName.get(trimmed);
      if (match) return match;
      for (const [key, id] of locationByName.entries()) {
        if (trimmed.includes(key) || key.includes(trimmed)) return id;
      }
    }
    return primaryLoc ? primaryLoc.id : null;
  }

  // 3. Process & Map Rows
  const parsedRows: ParsedClientRow[] = [];
  for (const r of rawRows) {
    const parsed = mapRow(r);
    if (parsed.fullName || parsed.firstName || parsed.lastName) {
      parsedRows.push(parsed);
    }
  }

  console.log(`\n✨ Successfully parsed ${parsedRows.length} valid client records`);

  if (dryRun) {
    console.log('\n🔍 [DRY RUN MODE] Simulating ingestion without writing to PostgreSQL:');
    parsedRows.slice(0, 5).forEach((p, idx) => {
      const targetLocId = resolveLocationId(p.rawLocation);
      const locName = locations.find((l) => l.id === targetLocId)?.name || 'Default';
      console.log(`\n[Preview #${idx + 1}]`);
      console.log(`  Name: ${p.fullName} (First: ${p.firstName}, Last: ${p.lastName})`);
      console.log(`  DOB: ${p.dob ? p.dob.toISOString().split('T')[0] : 'N/A'} | Gender: ${p.gender || 'N/A'}`);
      console.log(`  Phone: ${p.phone || 'N/A'} (E.164) | Email: ${p.email || 'N/A'}`);
      console.log(`  Address: ${p.addressLine1 || ''}, ${p.city || ''}, ${p.state || ''} ${p.postalCode || ''}`);
      console.log(`  Insurance: ${p.primaryPayer || 'N/A'} | Policy #: ${p.policyNumber || 'N/A'}`);
      console.log(`  Clinic Location: ${locName}`);
    });
    console.log(`\n🏁 Dry run finished. ${parsedRows.length} records verified.`);
    return;
  }

  // 4. Ingest Records into PostgreSQL
  console.log('\n🚀 Ingesting client records into PostgreSQL...');
  let importedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const locationCounts: Record<string, number> = {};
  const payerCounts: Record<string, number> = {};

  const year = new Date().getFullYear();
  let nextSeq = (org.mrnNextSequence || 100) + 1;

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const locId = resolveLocationId(row.rawLocation);
    const locName = locations.find((l) => l.id === locId)?.name || 'Main Clinic';
    locationCounts[locName] = (locationCounts[locName] || 0) + 1;

    const payer = row.primaryPayer || 'Self-Pay';
    payerCounts[payer] = (payerCounts[payer] || 0) + 1;

    // Generate MRN if not provided
    let mrn = row.mrn;
    if (!mrn) {
      const seqStr = String(nextSeq++).padStart(6, '0');
      mrn = `ALT-CLIN-${year}-${seqStr}`;
    }

    try {
      // Find existing by MRN or Email
      const existing = await prisma.client.findFirst({
        where: {
          organizationId: org.id,
          OR: [
            { mrn: mrn },
            ...(row.email ? [{ email: row.email }] : []),
          ],
        },
      });

      if (existing) {
        await prisma.client.update({
          where: { id: existing.id },
          data: {
            name: row.fullName,
            dateOfBirth: row.dob,
            gender: row.gender,
            phone: row.phone,
            email: row.email,
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            city: row.city,
            state: row.state,
            postalCode: row.postalCode,
            insurancePayer: row.primaryPayer,
            insuranceMemberId: row.policyNumber,
            insuranceGroupNumber: row.groupNumber,
            locationId: locId,
            sourcePlatform: 'EXCEL_IMPORT',
            importedAt: new Date(),
          },
        });
        updatedCount++;
      } else {
        await prisma.client.create({
          data: {
            organizationId: org.id,
            name: row.fullName,
            dateOfBirth: row.dob,
            gender: row.gender,
            phone: row.phone,
            email: row.email,
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            city: row.city,
            state: row.state,
            postalCode: row.postalCode,
            mrn: mrn,
            insurancePayer: row.primaryPayer,
            insuranceMemberId: row.policyNumber,
            insuranceGroupNumber: row.groupNumber,
            locationId: locId,
            status: ClientStatus.ACTIVE,
            riskLevel: RiskLevel.LOW,
            sourcePlatform: 'EXCEL_IMPORT',
            importedAt: new Date(),
          },
        });
        importedCount++;
      }

      if ((i + 1) % 50 === 0 || i + 1 === parsedRows.length) {
        process.stdout.write(`  Processed ${i + 1}/${parsedRows.length} records...\r`);
      }
    } catch (err) {
      errorCount++;
      console.error(`\n❌ Error importing row #${i + 1} (${row.fullName}):`, err);
    }
  }

  // Update org sequence
  await prisma.organization.update({
    where: { id: org.id },
    data: { mrnNextSequence: nextSeq },
  });

  console.log('\n\n════════════════════════════════════════════════════════════════');
  console.log('🎉 INGESTION SUMMARY');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`✅ Newly Created Clients: ${importedCount}`);
  console.log(`🔄 Updated Existing Clients: ${updatedCount}`);
  if (errorCount > 0) console.log(`⚠️ Errors / Failed Rows: ${errorCount}`);
  console.log(`📋 Total Clients Processed: ${importedCount + updatedCount}`);

  console.log('\n📍 Location Allocation:');
  for (const [loc, count] of Object.entries(locationCounts)) {
    console.log(`   • ${loc}: ${count} clients`);
  }

  console.log('\n💳 Insurance Payers:');
  for (const [p, count] of Object.entries(payerCounts)) {
    console.log(`   • ${p}: ${count} clients`);
  }

  console.log('\n✅ READY FOR LIVE CLIENT WORKFLOWS & CLINICAL SESSIONS!');
}

main()
  .catch((e) => {
    console.error('Fatal error during Excel ingestion:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
