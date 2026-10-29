/**
 * Seed Front Office Patient Communication threads + messages.
 *   npm run db:seed:messages
 */
import "dotenv/config";
import {
  MessageThreadStatus,
  MessageThreadTopic,
  PrismaClient,
  RiskLevel,
  ThreadMessageSender,
  type Organization,
} from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

type SeedMsg = {
  senderType: ThreadMessageSender;
  senderName: string;
  content: string;
  minutesAgo: number;
};

type SeedThread = {
  clientName: string;
  emailLocal: string;
  topic: MessageThreadTopic;
  status: MessageThreadStatus;
  risk: RiskLevel;
  assignedStaff: string;
  forwardedTo?: string;
  unreadCount: number;
  messages: SeedMsg[];
};

const SEED: SeedThread[] = [
  {
    clientName: "Marcus Thompson",
    emailLocal: "marcus.thompson.msg",
    topic: "GENERAL",
    status: "FORWARDED",
    risk: "HIGH",
    assignedStaff: "Lisa Chen",
    forwardedTo: "Dr. Sarah Smith",
    unreadCount: 3,
    messages: [
      {
        senderType: "PATIENT",
        senderName: "Marcus Thompson",
        content: "I've had a hard week and my anxiety is getting worse.",
        minutesAgo: 180,
      },
      {
        senderType: "FRONT_OFFICE",
        senderName: "Lisa Chen",
        content: "I'm sorry you're going through this. Are you safe right now?",
        minutesAgo: 160,
      },
      {
        senderType: "PATIENT",
        senderName: "Marcus Thompson",
        content: "Yes, but I keep thinking about disappearing. Can someone call me?",
        minutesAgo: 140,
      },
      {
        senderType: "CLINICIAN_NOTE",
        senderName: "Lisa Chen",
        content:
          "Forwarded to Dr. Sarah Smith — crisis language in chat. Please prioritize outreach.",
        minutesAgo: 120,
      },
      {
        senderType: "PATIENT",
        senderName: "Marcus Thompson",
        content: "Still waiting — please help.",
        minutesAgo: 40,
      },
    ],
  },
  {
    clientName: "Janelle Williams",
    emailLocal: "janelle.williams.msg",
    topic: "SCHEDULING",
    status: "WAITING",
    risk: "LOW",
    assignedStaff: "Marcus Webb",
    unreadCount: 2,
    messages: [
      {
        senderType: "PATIENT",
        senderName: "Janelle Williams",
        content: "Can I reschedule Thursday's appointment to Friday afternoon?",
        minutesAgo: 90,
      },
      {
        senderType: "FRONT_OFFICE",
        senderName: "Marcus Webb",
        content: "Checking Friday openings for you now.",
        minutesAgo: 80,
      },
      {
        senderType: "PATIENT",
        senderName: "Janelle Williams",
        content: "2:30 or 3:00 would work best. Thanks!",
        minutesAgo: 25,
      },
    ],
  },
  {
    clientName: "Sarah Martinez",
    emailLocal: "sarah.martinez.msg",
    topic: "BILLING",
    status: "IN_PROGRESS",
    risk: "LOW",
    assignedStaff: "Lisa Chen",
    unreadCount: 1,
    messages: [
      {
        senderType: "PATIENT",
        senderName: "Sarah Martinez",
        content: "I got a bill for a $40 copay but I thought Medicaid covered it?",
        minutesAgo: 200,
      },
      {
        senderType: "FRONT_OFFICE",
        senderName: "Lisa Chen",
        content: "Thanks for flagging — I'll verify eligibility and reply today.",
        minutesAgo: 150,
      },
      {
        senderType: "PATIENT",
        senderName: "Sarah Martinez",
        content: "Any update on the copay?",
        minutesAgo: 30,
      },
    ],
  },
  {
    clientName: "James Robinson",
    emailLocal: "james.robinson.msg",
    topic: "RX_REFILL",
    status: "FORWARDED",
    risk: "MEDIUM",
    assignedStaff: "Lisa Chen",
    forwardedTo: "Dr. Priya Nair",
    unreadCount: 0,
    messages: [
      {
        senderType: "PATIENT",
        senderName: "James Robinson",
        content: "Need a refill on sertraline — pharmacy says none left.",
        minutesAgo: 300,
      },
      {
        senderType: "FRONT_OFFICE",
        senderName: "Lisa Chen",
        content: "Forwarding to your prescriber now.",
        minutesAgo: 280,
      },
      {
        senderType: "CLINICIAN_NOTE",
        senderName: "Lisa Chen",
        content: "Forwarded to Dr. Priya Nair — refill request for sertraline 50mg.",
        minutesAgo: 270,
      },
    ],
  },
  {
    clientName: "Priya Lakshmi",
    emailLocal: "priya.lakshmi.msg",
    topic: "SCHEDULING",
    status: "RESOLVED",
    risk: "LOW",
    assignedStaff: "Marcus Webb",
    unreadCount: 0,
    messages: [
      {
        senderType: "PATIENT",
        senderName: "Priya Lakshmi",
        content: "Confirming my Monday 1pm is still on?",
        minutesAgo: 1440,
      },
      {
        senderType: "FRONT_OFFICE",
        senderName: "Marcus Webb",
        content: "Confirmed — Monday 1:00 PM with Marcus Johnson. See you then!",
        minutesAgo: 1400,
      },
    ],
  },
  {
    clientName: "David Kim",
    emailLocal: "david.kim.msg",
    topic: "GENERAL",
    status: "RESOLVED",
    risk: "LOW",
    assignedStaff: "Lisa Chen",
    unreadCount: 0,
    messages: [
      {
        senderType: "PATIENT",
        senderName: "David Kim",
        content: "Where do I park for the Main Clinic?",
        minutesAgo: 2880,
      },
      {
        senderType: "FRONT_OFFICE",
        senderName: "Lisa Chen",
        content: "Lot B behind the building — visitor spots marked in blue.",
        minutesAgo: 2800,
      },
    ],
  },
];

function minutesAgo(m: number) {
  return new Date(Date.now() - m * 60 * 1000);
}

async function resolveOrgs(): Promise<Organization[]> {
  if (ORG_SLUG) {
    const one = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
    if (!one) throw new Error(`Org not found: ${ORG_SLUG}`);
    return [one];
  }
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
}

async function ensureLocation(orgId: string) {
  let loc = await prisma.location.findFirst({
    where: { organizationId: orgId, active: true },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  });
  if (!loc) {
    loc = await prisma.location.create({
      data: {
        organizationId: orgId,
        name: "Main Clinic",
        code: "MAIN",
        isPrimary: true,
        active: true,
      },
    });
  }
  return loc;
}

async function ensureClient(
  orgId: string,
  locationId: string,
  name: string,
  emailLocal: string,
  risk: RiskLevel
) {
  const email = `${emailLocal}+${orgId.slice(-6)}@seed.altrixs.local`.toLowerCase();
  let client = await prisma.client.findFirst({ where: { email } });
  if (!client) {
    client = await prisma.client.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        OR: [
          { location: { organizationId: orgId } },
          { assignedTo: { organizationId: orgId } },
        ],
      },
    });
  }
  if (!client) {
    client = await prisma.client.create({
      data: {
        name,
        email,
        locationId,
        status: "ACTIVE",
        active: true,
        riskLevel: risk,
      },
    });
  } else {
    client = await prisma.client.update({
      where: { id: client.id },
      data: {
        name,
        locationId: client.locationId || locationId,
        riskLevel: risk,
        status: "ACTIVE",
        active: true,
        email: client.email || email,
      },
    });
  }
  return client;
}

async function seedOrg(org: Organization) {
  console.log(`\nSeeding messages for: ${org.name} (${org.slug})`);
  const location = await ensureLocation(org.id);

  await prisma.threadMessage.deleteMany({
    where: { thread: { organizationId: org.id } },
  });
  await prisma.messageThread.deleteMany({
    where: { organizationId: org.id },
  });

  for (const row of SEED) {
    const client = await ensureClient(
      org.id,
      location.id,
      row.clientName,
      row.emailLocal,
      row.risk
    );
    const last = row.messages[row.messages.length - 1];
    const thread = await prisma.messageThread.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        clientName: row.clientName,
        topic: row.topic,
        status: row.status,
        risk: row.risk,
        assignedStaff: row.assignedStaff,
        forwardedTo: row.forwardedTo || null,
        lastMessage: last.content,
        lastMessageAt: minutesAgo(last.minutesAgo),
        unreadCount: row.unreadCount,
      },
    });

    for (const msg of row.messages) {
      await prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          senderType: msg.senderType,
          senderName: msg.senderName,
          content: msg.content,
          read: msg.senderType !== "PATIENT" || row.unreadCount === 0,
          createdAt: minutesAgo(msg.minutesAgo),
        },
      });
    }

    console.log(
      `  ${row.clientName} [${row.topic}/${row.status}] unread=${row.unreadCount} msgs=${row.messages.length}`
    );
  }
}

async function main() {
  const orgs = await resolveOrgs();
  for (const org of orgs) await seedOrg(org);
  console.log(`\nDone. ${SEED.length} threads × ${orgs.length} org(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
