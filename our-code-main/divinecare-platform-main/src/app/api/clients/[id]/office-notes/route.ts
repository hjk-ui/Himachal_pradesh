import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const noteSchema = z.object({
  category: z.enum(['Scheduling', 'Billing', 'Contact Preference', 'Transportation', 'General']),
  noteText: z.string().min(1, 'Note text cannot be empty'),
  authorName: z.string().min(1),
  authorRole: z.string().min(1),
  isPinned: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: clientId } = await params;
    const notes = await (prisma as any).clientOfficeNote.findMany({
      where: { clientId },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ success: true, data: notes });
  } catch (err: any) {
    console.error('[office-notes-get] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch office notes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: clientId } = await params;
    const body = await req.json();
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const note = await (prisma as any).clientOfficeNote.create({
      data: {
        clientId,
        category: parsed.data.category,
        noteText: parsed.data.noteText,
        authorName: parsed.data.authorName,
        authorRole: parsed.data.authorRole,
        isPinned: parsed.data.isPinned || false,
      },
    });

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (err: any) {
    console.error('[office-notes-post] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create office note' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { noteId, isPinned, noteText, category } = body;
    if (!noteId) {
      return NextResponse.json({ error: 'noteId is required' }, { status: 400 });
    }

    const updated = await (prisma as any).clientOfficeNote.update({
      where: { id: noteId },
      data: {
        ...(typeof isPinned === 'boolean' ? { isPinned } : {}),
        ...(noteText ? { noteText } : {}),
        ...(category ? { category } : {}),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[office-notes-patch] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update office note' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const noteId = searchParams.get('noteId');
    if (!noteId) {
      return NextResponse.json({ error: 'noteId query param required' }, { status: 400 });
    }

    await (prisma as any).clientOfficeNote.delete({
      where: { id: noteId },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[office-notes-delete] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete office note' }, { status: 500 });
  }
}
