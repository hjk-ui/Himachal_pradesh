/**
 * Seed data the previous SDOH page exported for scripts/seed-ehr-modules.ts (ClinicModuleState
 * 'sdoh-resources' / 'sdoh-screenings'). Kept only so that script keeps working. These entries were
 * never verified with the organizations: the new directory (SdohResource) never reads this file;
 * staff copy an org's module list with "Import existing resource list", marked "verify details".
 */
interface LegacyResource {
  id: string;
  name: string;
  domain: 'housing' | 'food' | 'transport' | 'safety' | 'financial' | 'social';
  cost: string;
  phone: string;
  hours: string;
  notes: string;
}

export const SDOH_RESOURCES_SEED: LegacyResource[] = [
  {
    id: 'h1',
    name: "Prince George's County Housing Assistance",
    domain: 'housing',
    cost: 'Free',
    phone: '(301) 952-4366',
    hours: 'Mon–Fri 8 AM–5 PM',
    notes: 'Same-day intake available. Emergency rental assistance, eviction prevention.',
  },
  {
    id: 'h2',
    name: 'Rebuilding Together',
    domain: 'housing',
    cost: 'Free for qualifying homeowners',
    phone: '(301) 625-0505',
    hours: 'Mon–Fri 9 AM–4 PM',
    notes: 'Emergency home repairs for low-income homeowners and seniors.',
  },
  {
    id: 'h3',
    name: 'Community Crisis Services',
    domain: 'housing',
    cost: 'Free',
    phone: '(301) 864-7130',
    hours: '24/7',
    notes: 'Emergency shelter placement and crisis intervention. Walk-ins accepted.',
  },
  {
    id: 'h4',
    name: 'DHCD Homeless Prevention Program',
    domain: 'housing',
    cost: 'Free',
    phone: '(301) 883-5531',
    hours: 'Mon–Fri 8:30 AM–4:30 PM',
    notes: 'County rental/utility assistance for residents facing eviction.',
  },
  {
    id: 'f1',
    name: 'Capital Area Food Bank',
    domain: 'food',
    cost: 'Free',
    phone: '(202) 769-5900',
    hours: 'Vary by distribution site',
    notes: 'Largest regional food bank. Find nearest pantry at capitalareafoodbank.org.',
  },
  {
    id: 'f2',
    name: "St. Mary's Food Pantry — Hyattsville",
    domain: 'food',
    cost: 'Free',
    phone: '(301) 779-0675',
    hours: 'Mon, Wed, Fri 10 AM–12 PM',
    notes: 'No referral required. Serves PG County residents. Limit 2x/month.',
  },
  {
    id: 'f3',
    name: 'SNAP Benefits Enrollment — DHR Maryland',
    domain: 'food',
    cost: 'Free',
    phone: '1-800-332-6347',
    hours: 'Mon–Fri 8 AM–5 PM',
    notes: 'Apply online at mymdthink.maryland.gov. Clinician can assist with application documentation.',
  },
  {
    id: 'f4',
    name: 'Meals on Wheels — PG County',
    domain: 'food',
    cost: 'Sliding scale',
    phone: '(301) 699-2697',
    hours: 'Mon–Fri delivery',
    notes: 'For homebound adults 60+. Includes wellness check with delivery.',
  },
  {
    id: 't1',
    name: 'Medicaid Non-Emergency Medical Transport',
    domain: 'transport',
    cost: 'Free (Medicaid members)',
    phone: '1-800-682-5119',
    hours: 'Must schedule 2 business days in advance',
    notes: 'Covers rides to Medicaid-covered medical and behavioral health appointments.',
  },
  {
    id: 't2',
    name: 'Ride United — 211 Referral',
    domain: 'transport',
    cost: 'Free or low-cost',
    phone: 'Dial 2-1-1',
    hours: 'Mon–Fri 9 AM–5 PM',
    notes: 'Volunteer driver program for medical appointments. Sliding scale.',
  },
  {
    id: 't3',
    name: 'MTA Mobility Paratransit',
    domain: 'transport',
    cost: 'ADA fare ($4.60 max)',
    phone: '(410) 764-8181',
    hours: 'Same hours as fixed-route service',
    notes: 'For individuals with disabilities who cannot use fixed-route buses.',
  },
  {
    id: 'sa1',
    name: 'CHASI — Community Healing and Support',
    domain: 'safety',
    cost: 'Free',
    phone: '(301) 779-2100',
    hours: '24/7 crisis line',
    notes: 'Domestic violence, sexual assault, and trauma support. Bilingual services available.',
  },
  {
    id: 'sa2',
    name: 'House of Ruth Maryland',
    domain: 'safety',
    cost: 'Free',
    phone: '(410) 889-7884',
    hours: '24/7 hotline',
    notes: 'Emergency shelter, legal advocacy, counseling. Serves MD residents.',
  },
  {
    id: 'sa3',
    name: 'Maryland Network Against Domestic Violence',
    domain: 'safety',
    cost: 'Free',
    phone: '1-800-MD-HELPS',
    hours: '24/7',
    notes: 'Statewide DV hotline and resource directory. Text "HELP" to 1-800-643-4357.',
  },
  {
    id: 'fi1',
    name: 'SNAP Benefits Enrollment — DHR Maryland',
    domain: 'financial',
    cost: 'Free',
    phone: '1-800-332-6347',
    hours: 'Mon–Fri 8 AM–5 PM',
    notes: 'Also covers utility assistance (MEAP). Online: mymdthink.maryland.gov.',
  },
  {
    id: 'fi2',
    name: 'PG County Community Action Agency',
    domain: 'financial',
    cost: 'Free',
    phone: '(301) 883-6260',
    hours: 'Mon–Fri 8 AM–5 PM',
    notes: 'Emergency utility shutoff prevention, LIHEAP enrollment, crisis assistance.',
  },
  {
    id: 'fi3',
    name: 'CASH Campaign of Maryland',
    domain: 'financial',
    cost: 'Free',
    phone: '(410) 234-8008',
    hours: 'Seasonal (Jan–Apr)',
    notes: 'Free tax preparation, EITC enrollment. May maximize client refund/benefits.',
  },
  {
    id: 'so1',
    name: 'PG County Senior Centers',
    domain: 'social',
    cost: 'Free / low-cost',
    phone: '(301) 265-8450',
    hours: 'Mon–Fri 9 AM–4 PM',
    notes: 'Activities, meals, and peer connections for adults 55+.',
  },
  {
    id: 'so2',
    name: 'NAMI PG County — Peer Support',
    domain: 'social',
    cost: 'Free',
    phone: '(301) 474-7053',
    hours: 'Weekly groups — call for schedule',
    notes: 'Peer-led support groups for individuals with mental illness and their families.',
  },
  {
    id: 'so3',
    name: '211 Maryland — Social Connections',
    domain: 'social',
    cost: 'Free',
    phone: 'Dial 2-1-1',
    hours: '24/7',
    notes: 'Connects to community programs, volunteer opportunities, faith communities.',
  },
];

export const SDOH_SCREENINGS_SEED: unknown[] = [];
