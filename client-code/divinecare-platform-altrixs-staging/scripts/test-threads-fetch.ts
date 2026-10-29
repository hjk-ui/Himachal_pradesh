import { listMessageThreads, listThreadMessages } from '../src/lib/messages/manage';
import { prisma } from '../src/lib/db/prisma';

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, name: true, organizationId: true, role: true },
  });

  if (!admin) {
    console.log('No admin user found');
    return;
  }

  console.log('Testing listMessageThreads for Admin:', admin);
  const threads = await listMessageThreads({
    organizationId: admin.organizationId,
    actorUserId: admin.id,
    actorRole: admin.role,
  });

  console.log(`Threads returned: ${threads.length}`);
  for (const t of threads) {
    console.log(`  Thread: ${t.id} - Client: ${t.clientName} - LastMsg: "${t.lastMessage}" - Unread: ${t.unreadCount}`);
    const msgsResult = await listThreadMessages({
      threadId: t.id,
      organizationId: admin.organizationId,
      actorUserId: admin.id,
      actorRole: admin.role,
    });
    if (msgsResult.ok) {
      console.log(`    Messages count: ${msgsResult.messages.length}`);
    } else {
      console.log(`    Failed to fetch messages: ${msgsResult.error}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
