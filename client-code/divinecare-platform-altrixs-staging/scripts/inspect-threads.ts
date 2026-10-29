import { prisma } from '../src/lib/db/prisma';

async function main() {
  const threads = await prisma.messageThread.findMany({
    include: {
      client: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  console.log(`TOTAL THREADS: ${threads.length}`);
  for (const t of threads) {
    console.log(`\nThread ID: ${t.id}`);
    console.log(`Client: ${t.client?.name} (ID: ${t.clientId})`);
    console.log(`Org: ${t.organizationId}`);
    console.log(`Status: ${t.status}, ForwardedTo: ${t.forwardedTo}`);
    console.log(`Message Count: ${t.messages.length}`);
    for (const m of t.messages) {
      console.log(`  [${m.id}] ${m.senderName} (${m.senderType}): "${m.content.slice(0, 50)}" at ${m.createdAt.toISOString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
