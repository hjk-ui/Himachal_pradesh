'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CheckSquare, Kanban, List, MessageSquare, Plus, Search, Send } from 'lucide-react';
import { useAuth } from '@/features/auth';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  FormField,
  IconButton,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatusBadge,
  Tabs,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';

export type TaskStatus = 'Backlog' | 'To Do' | 'In Progress' | 'Blocked' | 'Done';
export type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TaskCategory = 'Clinical' | 'Technology' | 'Compliance' | 'Operations' | 'Marketing' | 'HR' | 'Billing';

export interface ProjectSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface ProjectComment {
  id: string;
  author: string;
  authorRole: string;
  avatarColor: string;
  timestamp: string;
  content: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
}

export interface ProjectTask {
  id: string;
  dbId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  storyPoints: number; // Fibonacci: 1, 2, 3, 5, 8, 13
  assigneeId?: string | null;
  assignee: {
    id?: string;
    name: string;
    role: string;
    avatarColor: string;
  };
  dueDate: string;
  tags: string[];
  subtasks: ProjectSubtask[];
  blockedReason?: string;
  comments: ProjectComment[];
}

const COLUMNS: { status: TaskStatus; label: string; tone: Tone }[] = [
  { status: 'Backlog', label: 'Backlog', tone: 'neutral' },
  { status: 'To Do', label: 'To Do', tone: 'info' },
  { status: 'In Progress', label: 'In Progress', tone: 'warning' },
  { status: 'Blocked', label: 'Blocked', tone: 'danger' },
  { status: 'Done', label: 'Done', tone: 'success' },
];

const STATUS_TONE: Record<TaskStatus, Tone> = {
  Backlog: 'neutral',
  'To Do': 'info',
  'In Progress': 'warning',
  Blocked: 'danger',
  Done: 'success',
};

const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'neutral',
  Low: 'neutral',
};

/** Column status dot (decorative; the column label carries the meaning). */
const TONE_DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-blue-600',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

export default function ProjectsKanbanPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [viewMode, setViewMode] = useState<'Kanban' | 'List'>('Kanban');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedAssignee, setSelectedAssignee] = useState<string>('all');

  // Modals & Drawers
  const [selectedTaskForDrawer, setSelectedTaskForDrawer] = useState<ProjectTask | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  // New Task Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newStatus, setNewStatus] = useState<TaskStatus>('To Do');
  const [newPriority, setNewPriority] = useState<TaskPriority>('Medium');
  const [newCategory, setNewCategory] = useState<TaskCategory>('Clinical');
  const [newPoints, setNewPoints] = useState<number>(3);
  const [newAssigneeId, setNewAssigneeId] = useState<string>('');
  const [newAssigneeName, setNewAssigneeName] = useState('Staff Member');
  const [newDueDate, setNewDueDate] = useState('2026-10-20');
  const [newTags, setNewTags] = useState('Clinical, EHR');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Real team members including logged-in user
  const availableMembers = useMemo(() => {
    const list = [...teamMembers];
    if (user && !list.some((m) => m.id === user.id || (user.email && m.email === user.email))) {
      list.unshift({
        id: user.id || 'curr-user',
        name: user.name || user.email || 'You',
        role: (user.role || 'Staff').replace(/_/g, ' '),
        email: user.email || '',
      });
    }
    return list;
  }, [teamMembers, user]);

  useEffect(() => {
    if (availableMembers.length > 0 && !newAssigneeId) {
      setNewAssigneeId(availableMembers[0].id);
      setNewAssigneeName(availableMembers[0].name);
    }
  }, [availableMembers, newAssigneeId]);

  // Load tasks from live PostgreSQL backend
  const loadTasksFromApi = async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const res = await fetch('/api/projects/tasks');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setTeamMembers(data.users);
        }
        if (Array.isArray(data.tasks)) {
          setTasks(data.tasks);
          return;
        }
      }
      setLoadError(!res.ok);
      setTasks([]);
    } catch (err) {
      console.error('Failed to load tasks from API:', err);
      setLoadError(true);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasksFromApi();
  }, []);

  const saveTasks = (newTasks: ProjectTask[]) => {
    setTasks(newTasks);
  };

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
      if (selectedPriority !== 'all' && t.priority !== selectedPriority) return false;
      if (selectedAssignee === 'me') {
        const matchesId = user?.id && (t.assigneeId === user.id || t.assignee?.id === user.id);
        const matchesName = user?.name && t.assignee.name.toLowerCase() === user.name.toLowerCase();
        if (!matchesId && !matchesName) return false;
      } else if (selectedAssignee !== 'all') {
        const matchesName = t.assignee.name === selectedAssignee;
        const matchesId = t.assigneeId === selectedAssignee || t.assignee?.id === selectedAssignee;
        if (!matchesName && !matchesId) return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mTitle = t.title.toLowerCase().includes(q);
        const mDesc = t.description.toLowerCase().includes(q);
        const mId = t.id.toLowerCase().includes(q);
        const mTags = t.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!mTitle && !mDesc && !mId && !mTags) return false;
      }
      return true;
    });
  }, [tasks, selectedCategory, selectedPriority, selectedAssignee, searchTerm, user]);

  // HTML5 Drag-and-Drop
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    setDraggedTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    if (!taskId) return;

    const blockedReason =
      targetStatus !== 'Blocked'
        ? undefined
        : tasks.find((t) => t.id === taskId)?.blockedReason || 'Blocked pending dependency.';

    const next = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          status: targetStatus,
          blockedReason,
        };
      }
      return t;
    });

    saveTasks(next);
    setDraggedTaskId(null);

    // Update active drawer if open
    if (selectedTaskForDrawer?.id === taskId) {
      setSelectedTaskForDrawer((prev) =>
        prev ? { ...prev, status: targetStatus, blockedReason } : null
      );
    }

    // Persist to PostgreSQL backend
    try {
      await fetch('/api/projects/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateStatus',
          taskId,
          status: targetStatus,
          blockedReason,
        }),
      });
    } catch (err) {
      console.error('Failed to update task status in DB:', err);
    }
  };

  // Add Comment
  const handleAddComment = async () => {
    if (!selectedTaskForDrawer || !newCommentText.trim()) return;

    const commentContent = newCommentText.trim();
    const newComment: ProjectComment = {
      id: `c-${Date.now()}`,
      author: user?.name || 'Authorized Staff',
      authorRole: user?.role || 'Clinician',
      avatarColor: '#5C2D91',
      timestamp: new Date().toISOString(),
      content: commentContent,
    };

    const next = tasks.map((t) => {
      if (t.id === selectedTaskForDrawer.id) {
        return {
          ...t,
          comments: [...t.comments, newComment],
        };
      }
      return t;
    });

    saveTasks(next);
    setSelectedTaskForDrawer({
      ...selectedTaskForDrawer,
      comments: [...selectedTaskForDrawer.comments, newComment],
    });
    setNewCommentText('');

    // Persist comment to PostgreSQL backend
    try {
      await fetch('/api/projects/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addComment',
          taskId: selectedTaskForDrawer.id,
          content: commentContent,
        }),
      });
    } catch (err) {
      console.error('Failed to persist comment in DB:', err);
    }
  };

  // Toggle Subtask
  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    const next = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          subtasks: t.subtasks.map((st) =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
          ),
        };
      }
      return t;
    });
    saveTasks(next);
    if (selectedTaskForDrawer?.id === taskId) {
      setSelectedTaskForDrawer(next.find((t) => t.id === taskId) || null);
    }

    // Persist subtask toggle in DB
    try {
      await fetch('/api/projects/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggleSubtask',
          taskId,
          subtaskId,
        }),
      });
    } catch (err) {
      console.error('Failed to toggle subtask in DB:', err);
    }
  };

  // Reassign Task to Team Member
  const handleReassignTask = async (taskId: string, targetUserId: string) => {
    const targetMember = availableMembers.find((m) => m.id === targetUserId);
    if (!targetMember) return;

    const next = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          assigneeId: targetMember.id,
          assignee: {
            ...t.assignee,
            id: targetMember.id,
            name: targetMember.name,
            role: targetMember.role,
          },
        };
      }
      return t;
    });
    saveTasks(next);

    if (selectedTaskForDrawer?.id === taskId) {
      setSelectedTaskForDrawer((prev) =>
        prev
          ? {
              ...prev,
              assigneeId: targetMember.id,
              assignee: {
                ...prev.assignee,
                id: targetMember.id,
                name: targetMember.name,
                role: targetMember.role,
              },
            }
          : null
      );
    }

    try {
      await fetch('/api/projects/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reassign',
          taskId,
          assigneeId: targetMember.id,
          assigneeName: targetMember.name,
          assigneeRole: targetMember.role,
        }),
      });
    } catch (err) {
      console.error('Failed to reassign task in DB:', err);
    }
  };

  // Create Task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenMember = availableMembers.find((m) => m.id === newAssigneeId);
    const resolvedName = chosenMember ? chosenMember.name : (newAssigneeName || 'Staff Member');
    const resolvedRole = chosenMember ? chosenMember.role : 'Staff Member';
    const resolvedId = chosenMember ? chosenMember.id : null;

    const tagsArray = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch('/api/projects/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDesc.trim(),
          status: newStatus,
          priority: newPriority,
          category: newCategory,
          storyPoints: Number(newPoints),
          assigneeId: resolvedId,
          assigneeName: resolvedName,
          assigneeRole: resolvedRole,
          dueDate: newDueDate,
          tags: tagsArray,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.task) {
          saveTasks([data.task, ...tasks]);
        } else {
          void loadTasksFromApi();
        }
      } else {
        // Fallback optimistic
        const newTask: ProjectTask = {
          id: `PRJ-${Math.floor(100 + Math.random() * 900)}`,
          title: newTitle.trim(),
          description: newDesc.trim(),
          status: newStatus,
          priority: newPriority,
          category: newCategory,
          storyPoints: Number(newPoints),
          assigneeId: resolvedId,
          assignee: {
            id: resolvedId || undefined,
            name: resolvedName,
            role: resolvedRole,
            avatarColor: '#0D47A1',
          },
          dueDate: newDueDate,
          tags: tagsArray,
          subtasks: [],
          comments: [],
        };
        saveTasks([newTask, ...tasks]);
      }
    } catch {
      void loadTasksFromApi();
    }

    setShowNewTaskModal(false);
    setNewTitle('');
    setNewDesc('');
  };

  const initials = (name: string) => name.split(' ').map((n) => n[0]).slice(0, 2).join('');

  return (
    <Page className="pb-16">
      <PageHeader
        title="Project Tracker & Agile Sprint Board"
        badges={<StatusBadge tone="brand">Q4 Clinical Sprint</StatusBadge>}
        description="Linear / Jira-style project management for clinical, compliance, IT, and operational initiatives"
        actions={
          <>
            <Tabs
              variant="pill"
              label="Project view"
              controlsPanels={false}
              value={viewMode}
              onChange={setViewMode}
              items={[
                { key: 'Kanban', label: 'Kanban Board', icon: <Kanban /> },
                { key: 'List', label: 'List View', icon: <List /> },
              ]}
            />
            <Button icon={<Plus />} onClick={() => setShowNewTaskModal(true)}>
              New Task
            </Button>
          </>
        }
      />

      {/* Filter Bar */}
      <Card className="flex flex-col items-stretch justify-between gap-4 p-4 lg:flex-row lg:items-center">
        <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="text"
              aria-label="Search tasks"
              placeholder="Search tasks, IDs, or tags…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={cx(inputClasses, 'pl-9')}
            />
          </div>

          {/* Category Filter */}
          <select
            aria-label="Filter tasks by category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className={cx(inputClasses, 'w-full font-medium text-slate-700 sm:w-auto')}
          >
            <option value="all">All Categories</option>
            <option value="Clinical">Clinical</option>
            <option value="Technology">Technology</option>
            <option value="Compliance">Compliance</option>
            <option value="Operations">Operations</option>
            <option value="Marketing">Marketing</option>
            <option value="HR">HR</option>
            <option value="Billing">Billing</option>
          </select>

          {/* Priority Filter */}
          <select
            aria-label="Filter tasks by priority"
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className={cx(inputClasses, 'w-full font-medium text-slate-700 sm:w-auto')}
          >
            <option value="all">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          {/* Assignee Filter */}
          <select
            aria-label="Filter tasks by assignee"
            value={selectedAssignee}
            onChange={(e) => setSelectedAssignee(e.target.value)}
            className={cx(inputClasses, 'w-full max-w-full font-medium text-slate-700 sm:w-auto')}
          >
            <option value="all">All Assignees</option>
            <option value="me">Assigned to Me</option>
            {availableMembers.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-slate-500">
          Sprint Total: <strong className="font-semibold text-slate-700">{filteredTasks.length}</strong> tasks &bull;{' '}
          <strong className="font-semibold text-slate-700">{filteredTasks.reduce((s, t) => s + t.storyPoints, 0)}</strong> Story Points
        </div>
      </Card>

      {loading && tasks.length === 0 ? (
        <Card>
          <LoadingState label="Loading tasks…" rows={5} />
        </Card>
      ) : loadError && tasks.length === 0 ? (
        <Card>
          <ErrorState
            title="Could not load project tasks"
            description="The task list did not load. Check your connection and try again."
            onRetry={() => void loadTasksFromApi()}
          />
        </Card>
      ) : null}

      {/* VIEW 1: KANBAN BOARD */}
      {viewMode === 'Kanban' && !(loading && tasks.length === 0) && !(loadError && tasks.length === 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status);
            const colPoints = colTasks.reduce((s, t) => s + t.storyPoints, 0);

            return (
              <div
                key={col.status}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.status)}
                className="flex min-h-[500px] min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-100/60 p-3"
              >
                {/* Column Header */}
                <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <span className={cx('h-2.5 w-2.5 rounded-full', TONE_DOT_CLASS[col.tone])} aria-hidden />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">{col.label}</h2>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-800">{colTasks.length}</span>
                    <span className="tabular-nums">({colPoints} pts)</span>
                  </div>
                </div>

                {/* Task Cards */}
                <div className="flex-1 space-y-3">
                  {colTasks.map((task) => {
                    const completedSubtasks = task.subtasks.filter((st) => st.completed).length;

                    return (
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${task.id}: ${task.title}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onClick={() => setSelectedTaskForDrawer(task)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedTaskForDrawer(task);
                          }
                        }}
                        className={cx(
                          'group relative cursor-grab rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs transition hover:border-slate-300 hover:shadow-sm active:cursor-grabbing',
                          FOCUS_RING,
                        )}
                      >
                        {/* Priority & Category Badges */}
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-semibold text-slate-500 transition group-hover:text-blue-700">
                            {task.id}
                          </span>
                          <div className="flex min-w-0 items-center gap-1">
                            <StatusBadge size="sm" tone={PRIORITY_TONE[task.priority]}>
                              {task.priority}
                            </StatusBadge>
                            <StatusBadge size="sm" tone="brand">
                              {task.category}
                            </StatusBadge>
                          </div>
                        </div>

                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{task.title}</h3>

                        {/* Blocked reason callout if blocked */}
                        {task.status === 'Blocked' && task.blockedReason && (
                          <div className="mt-2 line-clamp-2 rounded-md border border-rose-200 bg-rose-50 p-1.5 text-xs text-rose-800">
                            <strong className="font-semibold">Blocked:</strong> {task.blockedReason}
                          </div>
                        )}

                        {/* Footer: Points, Subtasks, Assignee */}
                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
                              {task.storyPoints} pt
                            </span>

                            {task.subtasks.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[11px]">
                                <CheckSquare className="h-3 w-3 text-slate-400" aria-hidden />
                                {completedSubtasks}/{task.subtasks.length}
                              </span>
                            )}

                            {task.comments.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[11px]">
                                <MessageSquare className="h-3 w-3 text-slate-400" aria-hidden />
                                {task.comments.length}
                              </span>
                            )}
                          </div>

                          <span
                            title={`${task.assignee.name} (${task.assignee.role})`}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700"
                          >
                            {initials(task.assignee.name)}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {colTasks.length === 0 && (
                    <div className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-500">
                      Drop items here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: LIST VIEW */}
      {viewMode === 'List' && !(loading && tasks.length === 0) && !(loadError && tasks.length === 0) && (
        <Card className="overflow-hidden">
          <div className="clinic-scroll-x">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <caption className="sr-only">Project tasks</caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600">Task ID</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Title &amp; Category</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Status</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Priority</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Story Pts</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Assignee</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Due Date</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600">Subtasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        compact
                        title="No tasks yet"
                        description="Tasks matching your filters appear here. Use New Task to add one."
                      />
                    </td>
                  </tr>
                )}
                {filteredTasks.map((task) => {
                  const completedSubtasks = task.subtasks.filter((st) => st.completed).length;
                  return (
                    <tr
                      key={task.id}
                      onClick={() => setSelectedTaskForDrawer(task)}
                      className="group cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      <td className="sticky left-0 z-10 bg-white px-4 py-3 group-hover:bg-slate-50">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTaskForDrawer(task);
                          }}
                          className={cx('rounded font-mono text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                        >
                          {task.id}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{task.title}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <StatusBadge size="sm" tone="brand">
                            {task.category}
                          </StatusBadge>
                          <span>{task.tags.join(', ')}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONE[task.status] || 'neutral'}>{task.status}</StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={PRIORITY_TONE[task.priority]}>{task.priority}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-700">{task.storyPoints}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
                            {initials(task.assignee.name)}
                          </span>
                          <span className="font-medium text-slate-800">{task.assignee.name}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{task.dueDate}</td>
                      <td className="px-4 py-3">
                        {task.subtasks.length > 0 ? (
                          <span className="tabular-nums text-slate-700">
                            {completedSubtasks}/{task.subtasks.length}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Task Detail Dialog */}
      {selectedTaskForDrawer && (
        <Modal
          title={selectedTaskForDrawer.title}
          onClose={() => setSelectedTaskForDrawer(null)}
          footer={
            <Button variant="secondary" onClick={() => setSelectedTaskForDrawer(null)}>
              Close Drawer
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="brand" className="font-mono">
              {selectedTaskForDrawer.id}
            </StatusBadge>
            <StatusBadge tone="neutral">{selectedTaskForDrawer.category}</StatusBadge>
          </div>
          <p className="text-sm leading-relaxed text-slate-600">{selectedTaskForDrawer.description}</p>

          {/* Workflow Status Selector */}
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-2">
            <FormField label="Status Column" labelClassName="mb-1 block text-xs font-medium text-slate-600">
              <select
                value={selectedTaskForDrawer.status}
                onChange={(e) => {
                  const newSt = e.target.value as TaskStatus;
                  const next = tasks.map((t) =>
                    t.id === selectedTaskForDrawer.id ? { ...t, status: newSt } : t
                  );
                  saveTasks(next);
                  setSelectedTaskForDrawer({ ...selectedTaskForDrawer, status: newSt });
                }}
                className={cx(inputClasses, 'font-semibold')}
              >
                {COLUMNS.map((c) => (
                  <option key={c.status} value={c.status}>
                    {c.label}
                  </option>
                ))}
              </select>
            </FormField>

            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">Priority &amp; Points</span>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge tone={PRIORITY_TONE[selectedTaskForDrawer.priority]}>{selectedTaskForDrawer.priority}</StatusBadge>
                <span className="text-xs font-semibold tabular-nums text-blue-700">
                  {selectedTaskForDrawer.storyPoints} Story Points
                </span>
              </div>
            </div>
          </div>

          {/* Blocked Reason if blocked */}
          {selectedTaskForDrawer.status === 'Blocked' && (
            <Alert tone="danger" title="Blocked Reason:">
              {selectedTaskForDrawer.blockedReason || 'Blocked awaiting dependencies or regulatory sign-off.'}
            </Alert>
          )}

          {/* Assignee & Dates */}
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <span className="mb-1 block text-xs text-slate-500">Primary Assignee</span>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
                  {initials(selectedTaskForDrawer.assignee.name)}
                </span>
                <select
                  aria-label="Reassign task to team member"
                  value={selectedTaskForDrawer.assigneeId || selectedTaskForDrawer.assignee.name}
                  onChange={(e) => handleReassignTask(selectedTaskForDrawer.id, e.target.value)}
                  className={cx(inputClasses, 'min-w-0 truncate font-semibold')}
                >
                  {availableMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className="block text-xs text-slate-500">Target Due Date</span>
              <div className="mt-1 font-semibold tabular-nums text-slate-800">{selectedTaskForDrawer.dueDate}</div>
            </div>
          </div>

          {/* Subtasks Section */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Subtasks Checklist ({selectedTaskForDrawer.subtasks.filter((s) => s.completed).length}/
              {selectedTaskForDrawer.subtasks.length})
            </h3>

            <div className="space-y-1.5">
              {selectedTaskForDrawer.subtasks.map((st) => (
                <label
                  key={st.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 p-2 text-sm text-slate-800 transition hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={st.completed}
                    onChange={() => handleToggleSubtask(selectedTaskForDrawer.id, st.id)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span className={st.completed ? 'text-slate-500 line-through' : 'font-medium'}>{st.title}</span>
                </label>
              ))}
              {selectedTaskForDrawer.subtasks.length === 0 && (
                <p className="text-xs text-slate-500">No subtasks defined for this ticket.</p>
              )}
            </div>
          </div>

          {/* Comments Thread */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Activity &amp; Comments ({selectedTaskForDrawer.comments.length})
            </h3>

            <div className="space-y-3">
              {selectedTaskForDrawer.comments.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{c.author}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="leading-relaxed text-slate-700">{c.content}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                aria-label="Add an update comment"
                placeholder="Add an update comment…"
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                className={cx(inputClasses, 'flex-1')}
              />
              <IconButton
                label="Post comment"
                icon={<Send className="h-4 w-4" />}
                onClick={handleAddComment}
                className="h-9 w-9 bg-blue-600 text-white hover:bg-blue-700"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* New Task Modal */}
      {showNewTaskModal && (
        <Modal
          title="Create New Project Task"
          onClose={() => setShowNewTaskModal(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowNewTaskModal(false)}>
                Cancel
              </Button>
              <Button type="submit" form="new-project-task-form">
                Create Task
              </Button>
            </>
          }
        >
          <form id="new-project-task-form" onSubmit={handleCreateTask} className="space-y-4">
            <FormField label="Task Title" required>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Conduct Joint Commission physical plant safety survey"
                className={inputClasses}
              />
            </FormField>

            <FormField label="Detailed Description" required>
              <textarea
                rows={3}
                required
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Provide scope, deliverables, and acceptance criteria…"
                className={cx(inputClasses, 'leading-relaxed')}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Category" required>
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as any)} className={inputClasses}>
                  <option value="Clinical">Clinical</option>
                  <option value="Technology">Technology</option>
                  <option value="Compliance">Compliance</option>
                  <option value="Operations">Operations</option>
                  <option value="Marketing">Marketing</option>
                  <option value="HR">HR</option>
                  <option value="Billing">Billing</option>
                </select>
              </FormField>
              <FormField label="Priority" required>
                <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as any)} className={inputClasses}>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Story Points (Fibonacci)">
                <select value={newPoints} onChange={(e) => setNewPoints(Number(e.target.value))} className={inputClasses}>
                  <option value={1}>1 pt (Trivial)</option>
                  <option value={2}>2 pts (Small)</option>
                  <option value={3}>3 pts (Medium)</option>
                  <option value={5}>5 pts (Large)</option>
                  <option value={8}>8 pts (Significant)</option>
                  <option value={13}>13 pts (Epic / Complex)</option>
                </select>
              </FormField>
              <FormField label="Workflow Status">
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as any)} className={inputClasses}>
                  <option value="Backlog">Backlog</option>
                  <option value="To Do">To Do</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Done">Done</option>
                </select>
              </FormField>
              <FormField label="Target Due Date">
                <input
                  type="date"
                  required
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className={inputClasses}
                />
              </FormField>
            </div>

            <FormField label="Assignee (Staff Team Member)" required>
              <select
                value={newAssigneeId}
                onChange={(e) => {
                  const selId = e.target.value;
                  setNewAssigneeId(selId);
                  const selMem = availableMembers.find((m) => m.id === selId);
                  if (selMem) {
                    setNewAssigneeName(selMem.name);
                  }
                }}
                className={cx(inputClasses, 'font-medium')}
              >
                {availableMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} &bull; {m.role} {m.email ? `(${m.email})` : ''}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Tags (Comma separated)">
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="e.g. Compliance, JointCommission, Audit"
                className={inputClasses}
              />
            </FormField>
          </form>
        </Modal>
      )}
    </Page>
  );
}
