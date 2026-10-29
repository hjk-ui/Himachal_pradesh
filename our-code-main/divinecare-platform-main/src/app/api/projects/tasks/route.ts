import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    // 1. Fetch real active staff/users in this organization
    const orgUsers = await prisma.user.findMany({
      where: { organizationId: gate.organizationId, status: 'ACTIVE' },
      select: { id: true, name: true, role: true, email: true },
      orderBy: { name: 'asc' },
    });

    let tasks = await prisma.projectTask.findMany({
      where: { organizationId: gate.organizationId },
      include: {
        subtasks: { orderBy: { createdAt: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      success: true,
      users: orgUsers.map((u) => ({
        id: u.id,
        name: u.name || u.email,
        role: (u.role || 'Staff').replace(/_/g, ' '),
        email: u.email,
      })),
      tasks: tasks.map((t) => ({
        id: t.taskId,
        dbId: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        category: t.category,
        storyPoints: t.storyPoints,
        assigneeId: t.assigneeId || null,
        assignee: {
          id: t.assigneeId || undefined,
          name: t.assigneeName,
          role: t.assigneeRole,
          avatarColor: t.assigneeColor,
        },
        dueDate: t.dueDate ? t.dueDate.toISOString().split('T')[0] : '',
        tags: t.tags,
        blockedReason: t.blockedReason || undefined,
        subtasks: t.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          completed: s.completed,
        })),
        comments: t.comments.map((c) => ({
          id: c.id,
          author: c.authorName,
          authorRole: c.authorRole,
          avatarColor: c.avatarColor,
          timestamp: c.createdAt.toISOString(),
          content: c.content,
        })),
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch project tasks' },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  action: z.string().optional(),
  taskId: z.string(), // can be PRJ-101 or db uuid
  status: z.enum(['Backlog', 'To Do', 'In Progress', 'Blocked', 'Done']).optional(),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
  blockedReason: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  assigneeName: z.string().optional(),
  assigneeRole: z.string().optional(),
  toggleSubtaskId: z.string().optional(),
  subtaskId: z.string().optional(),
  content: z.string().optional(),
  newComment: z.object({
    content: z.string().min(1),
  }).optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = patchSchema.parse(await req.json());
    const task = await prisma.projectTask.findFirst({
      where: {
        OR: [{ taskId: body.taskId }, { id: body.taskId }],
        organizationId: gate.organizationId,
      },
      include: { subtasks: true },
    });

    if (!task) {
      return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
    }

    // Resolve real assignee if assigneeId changed
    let resolvedAssigneeName = body.assigneeName;
    let resolvedAssigneeRole = body.assigneeRole;
    if (body.assigneeId) {
      const u = await prisma.user.findFirst({
        where: { id: body.assigneeId, organizationId: gate.organizationId },
        select: { id: true, name: true, role: true, email: true },
      });
      if (u) {
        resolvedAssigneeName = u.name || u.email;
        resolvedAssigneeRole = (u.role || 'Staff').replace(/_/g, ' ');
      }
    }

    if (
      body.status ||
      body.priority !== undefined ||
      body.blockedReason !== undefined ||
      body.assigneeId !== undefined ||
      body.assigneeName !== undefined
    ) {
      await prisma.projectTask.update({
        where: { id: task.id },
        data: {
          status: body.status || undefined,
          priority: body.priority || undefined,
          blockedReason: body.blockedReason,
          assigneeId: body.assigneeId !== undefined ? body.assigneeId : undefined,
          assigneeName: resolvedAssigneeName || undefined,
          assigneeRole: resolvedAssigneeRole || undefined,
        },
      });
    }

    // Toggle subtask by subtaskId or toggleSubtaskId
    const targetSubtaskId = body.subtaskId || body.toggleSubtaskId;
    if (targetSubtaskId) {
      const subtask = (await prisma.projectSubtask.findUnique({
        where: { id: targetSubtaskId },
      })) || (await prisma.projectSubtask.findFirst({
        where: { taskId: task.id, id: targetSubtaskId },
      }));

      if (subtask) {
        await prisma.projectSubtask.update({
          where: { id: subtask.id },
          data: { completed: !subtask.completed },
        });
      }
    }

    // Add comment by direct content or newComment.content
    const commentText = body.content || body.newComment?.content;
    if (commentText && commentText.trim()) {
      const sessionUser = (gate as { session?: { user?: { name?: string; email?: string } } }).session?.user;
      const authorName = sessionUser?.name || sessionUser?.email || 'Staff Member';
      await prisma.projectComment.create({
        data: {
          taskId: task.id,
          authorName,
          authorRole: gate.role.replace(/_/g, ' '),
          avatarColor: '#5C2D91',
          content: commentText.trim(),
        },
      });
    }

    const updated = await prisma.projectTask.findUnique({
      where: { id: task.id },
      include: { subtasks: true, comments: true },
    });

    return NextResponse.json({ success: true, task: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update task' },
      { status: 400 }
    );
  }
}

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  status: z.enum(['Backlog', 'To Do', 'In Progress', 'Blocked', 'Done']).default('To Do'),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).default('Medium'),
  category: z.string().default('Clinical'),
  storyPoints: z.number().int().min(1).default(3),
  assigneeId: z.string().optional().nullable(),
  assigneeName: z.string().min(1),
  assigneeRole: z.string().default('Staff'),
  assigneeColor: z.string().optional(),
  dueDate: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = createTaskSchema.parse(await req.json());
    const count = await prisma.projectTask.count({
      where: { organizationId: gate.organizationId },
    });
    const taskId = `PRJ-${101 + count}`;

    // Resolve real user if assigneeId provided
    let realAssigneeName = body.assigneeName;
    let realAssigneeRole = body.assigneeRole;
    if (body.assigneeId) {
      const u = await prisma.user.findFirst({
        where: { id: body.assigneeId, organizationId: gate.organizationId },
        select: { id: true, name: true, role: true, email: true },
      });
      if (u) {
        realAssigneeName = u.name || u.email;
        realAssigneeRole = (u.role || 'Staff').replace(/_/g, ' ');
      }
    }

    const avatarColors = ['#0D47A1', '#1565C0', '#059669', '#7C3AED', '#DB2777', '#D97706', '#4F46E5'];
    const chosenColor = body.assigneeColor || avatarColors[Math.floor(Math.random() * avatarColors.length)];

    const created = await prisma.projectTask.create({
      data: {
        organizationId: gate.organizationId,
        taskId,
        title: body.title,
        description: body.description,
        status: body.status,
        priority: body.priority,
        category: body.category,
        storyPoints: body.storyPoints,
        assigneeId: body.assigneeId || null,
        assigneeName: realAssigneeName,
        assigneeRole: realAssigneeRole,
        assigneeColor: chosenColor,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        tags: body.tags,
      },
      include: {
        subtasks: true,
        comments: true,
      },
    });

    return NextResponse.json({
      success: true,
      task: {
        id: created.taskId,
        dbId: created.id,
        title: created.title,
        description: created.description,
        status: created.status,
        priority: created.priority,
        category: created.category,
        storyPoints: created.storyPoints,
        assigneeId: created.assigneeId || null,
        assignee: {
          id: created.assigneeId || undefined,
          name: created.assigneeName,
          role: created.assigneeRole,
          avatarColor: created.assigneeColor,
        },
        dueDate: created.dueDate ? created.dueDate.toISOString().split('T')[0] : '',
        tags: created.tags,
        subtasks: created.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          completed: s.completed,
        })),
        comments: created.comments.map((c) => ({
          id: c.id,
          author: c.authorName,
          authorRole: c.authorRole,
          avatarColor: c.avatarColor,
          timestamp: c.createdAt.toISOString(),
          content: c.content,
        })),
      },
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create task' },
      { status: 400 }
    );
  }
}
