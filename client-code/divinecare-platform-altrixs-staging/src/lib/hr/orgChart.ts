/**
 * Directory and org chart (every staff member can see names, titles, locations, programs and
 * reporting lines) and the headcount / turnover dashboard (HR + leadership). Staff data only.
 */
import { addDaysYmd, addMonthsYmd, headcountOn, turnoverPct } from './standard';
import { loadRoster, practiceTodayFor, type RosterPerson } from './server';

export type DirectoryPerson = {
  userId: string;
  name: string;
  preferredName: string | null;
  pronouns: string | null;
  jobTitle: string;
  department: string;
  role: string;
  programs: string[];
  locationNames: string[];
  email: string;
  workPhone: string | null;
  managerUserId: string | null;
  credentials: string | null;
  image: string | null;
  hrStatus: string;
};

export function toDirectory(p: RosterPerson): DirectoryPerson {
  return {
    userId: p.userId,
    name: p.name,
    preferredName: p.preferredName,
    pronouns: p.pronouns,
    jobTitle: p.jobTitle,
    department: p.department,
    role: p.role,
    programs: p.programs,
    locationNames: p.locationNames,
    email: p.email,
    workPhone: p.workPhone,
    managerUserId: p.managerUserId,
    credentials: p.credentials,
    image: p.image,
    hrStatus: p.hrStatus,
  };
}

export async function directory(organizationId: string) {
  const roster = await loadRoster(organizationId);
  return roster.filter((p) => p.hrStatus !== 'Terminated').map(toDirectory);
}

function countBy(rows: RosterPerson[], key: (p: RosterPerson) => string[]) {
  const m = new Map<string, number>();
  for (const r of rows) for (const k of key(r)) m.set(k || 'Not set', (m.get(k || 'Not set') ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export async function workforceAnalytics(organizationId: string) {
  const [roster, today] = await Promise.all([loadRoster(organizationId, { includeDeactivated: true }), practiceTodayFor(organizationId)]);
  const staff = roster.map((p) => ({ hireDate: p.hireDate, terminationDate: p.terminationDate }));
  const current = roster.filter((p) => p.accountStatus !== 'DEACTIVATED' && p.hrStatus !== 'Terminated' && (!p.terminationDate || p.terminationDate >= today));
  const monthEnds: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonthsYmd(`${today.slice(0, 7)}-01`, -i);
    monthEnds.push(i === 0 ? today : addDaysYmd(addMonthsYmd(m, 1), -1));
  }
  const series = monthEnds.map((d) => ({ month: d.slice(0, 7), headcount: headcountOn(staff, d) }));
  const yearAgo = addMonthsYmd(today, -12);
  const separations = roster.filter((p) => p.terminationDate && p.terminationDate > yearAgo && p.terminationDate <= today);
  const hires = roster.filter((p) => p.hireDate && p.hireDate > yearAgo && p.hireDate <= today);
  const avg = series.length ? series.reduce((s, x) => s + x.headcount, 0) / series.length : 0;
  const withHire = current.filter((p) => p.hireDate);
  const tenureYears = withHire.length
    ? Math.round((withHire.reduce((s, p) => s + (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${p.hireDate}T12:00:00Z`)), 0) / withHire.length / (365.25 * 86_400_000)) * 10) / 10
    : null;
  const missingHireDates = roster.filter((p) => !p.hireDate).length;
  return {
    today,
    headcount: current.length,
    hires12m: hires.length,
    separations12m: separations.length,
    turnover12mPct: turnoverPct(separations.length, avg, 365),
    avgTenureYears: tenureYears,
    missingHireDates,
    series,
    byLocation: countBy(current, (p) => (p.locationNames.length ? p.locationNames : ['No location'])),
    byProgram: countBy(current, (p) => (p.programs.length ? p.programs : ['Not set'])),
    byDepartment: countBy(current, (p) => [p.department || 'Not set']),
    byRole: countBy(current, (p) => [p.role]),
    byWorkerType: countBy(current, (p) => [p.workerType || 'Not set']),
  };
}
