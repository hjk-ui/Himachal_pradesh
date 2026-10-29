'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Kanban,
  List,
  Plus,
  Search,
  Filter,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Calendar,
  User,
  Tag,
  CheckSquare,
  MessageSquare,
  ChevronRight,
  X,
  Send,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/features/auth';

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

const COLUMNS: { status: TaskStatus; label: string; color: string; bgLight: string; borderLight: string }[] = [
  { status: 'Backlog', label: 'Backlog', color: '#6B7280', bgLight: 'bg-slate-50', borderLight: 'border-slate-200' },
  { status: 'To Do', label: 'To Do', color: '#3B82F6', bgLight: 'bg-blue-50/50', borderLight: 'border-blue-200' },
  { status: 'In Progress', label: 'In Progress', color: '#F59E0B', bgLight: 'bg-amber-50/50', borderLight: 'border-amber-200' },
  { status: 'Blocked', label: 'Blocked', color: '#EF4444', bgLight: 'bg-rose-50/50', borderLight: 'border-rose-200' },
  { status: 'Done', label: 'Done', color: '#10B981', bgLight: 'bg-emerald-50/50', borderLight: 'border-emerald-200' },
];

const INITIAL_TASKS: ProjectTask[] = [];

const STORAGE_KEY = 'divinecare_projects_tasks_v1';

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
      setTasks(INITIAL_TASKS);
    } catch (err) {
      console.error('Failed to load tasks from API, using fallback:', err);
      setTasks(INITIAL_TASKS);
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
      avatarColor: '#4F46E5',
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm">
                  <Kanban className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    Project Tracker &amp; Agile Sprint Board
                    <span className="bg-indigo-100 text-indigo-700 text-xs px-2.5 py-0.5 rounded-full font-mono">
                      Q4 Clinical Sprint
                    </span>
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Linear / Jira-style project management for clinical, compliance, IT, and operational initiatives
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* View Switcher */}
              <div className="bg-slate-100 p-1 rounded-lg border border-slate-200 flex items-center gap-1">
                <button
                  onClick={() => setViewMode('Kanban')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                    viewMode === 'Kanban'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Kanban className="w-3.5 h-3.5" />
                  Kanban Board
                </button>
                <button
                  onClick={() => setViewMode('List')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                    viewMode === 'List'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  List View
                </button>
              </div>

              <button
                onClick={() => setShowNewTaskModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                New Task
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* Filter Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search tasks, IDs, or tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Category Filter */}
            <select
              aria-label="Filter tasks by category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
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
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
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
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
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
            Sprint Total: <strong>{filteredTasks.length}</strong> tasks &bull;{' '}
            <strong>{filteredTasks.reduce((s, t) => s + t.storyPoints, 0)}</strong> Story Points
          </div>
        </div>

        {/* VIEW 1: KANBAN BOARD */}
        {viewMode === 'Kanban' && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.status === col.status);
              const colPoints = colTasks.reduce((s, t) => s + t.storyPoints, 0);

              return (
                <div
                  key={col.status}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.status)}
                  className={`rounded-xl border ${col.borderLight} ${col.bgLight} p-3 min-h-[500px] flex flex-col`}
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                      <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">{col.label}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                      <span className="font-bold text-slate-800">{colTasks.length}</span>
                      <span>({colPoints} pts)</span>
                    </div>
                  </div>

                  {/* Task Cards */}
                  <div className="space-y-3 flex-1">
                    {colTasks.map((task) => {
                      const completedSubtasks = task.subtasks.filter((st) => st.completed).length;

                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task.id)}
                          onClick={() => setSelectedTaskForDrawer(task)}
                          className="bg-white rounded-lg border border-slate-200 p-3.5 shadow-xs hover:shadow-md hover:border-indigo-300 transition cursor-grab active:cursor-grabbing group relative"
                        >
                          {/* Priority & Category Badges */}
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold font-mono text-slate-400 group-hover:text-indigo-600 transition">
                              {task.id}
                            </span>
                            <div className="flex items-center gap-1">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  task.priority === 'Critical'
                                    ? 'bg-rose-100 text-rose-800'
                                    : task.priority === 'High'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {task.priority}
                              </span>
                              <span className="bg-indigo-50 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded font-medium">
                                {task.category}
                              </span>
                            </div>
                          </div>

                          <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">
                            {task.title}
                          </h4>

                          {/* Blocked reason callout if blocked */}
                          {task.status === 'Blocked' && task.blockedReason && (
                            <div className="mt-2 p-1.5 bg-rose-50 border border-rose-200 rounded text-[11px] text-rose-800 line-clamp-2">
                              <strong className="font-bold">Blocked:</strong> {task.blockedReason}
                            </div>
                          )}

                          {/* Footer: Points, Subtasks, Assignee */}
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] font-bold bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                {task.storyPoints} pt
                              </span>

                              {task.subtasks.length > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px]">
                                  <CheckSquare className="w-3 h-3 text-slate-400" />
                                  {completedSubtasks}/{task.subtasks.length}
                                </span>
                              )}

                              {task.comments.length > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px]">
                                  <MessageSquare className="w-3 h-3 text-slate-400" />
                                  {task.comments.length}
                                </span>
                              )}
                            </div>

                            <div
                              title={`${task.assignee.name} (${task.assignee.role})`}
                              className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-xs"
                              style={{ backgroundColor: task.assignee.avatarColor }}
                            >
                              {task.assignee.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {colTasks.length === 0 && (
                      <div className="h-24 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-400 italic">
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
        {viewMode === 'List' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Task ID</th>
                    <th className="py-3 px-4">Title &amp; Category</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Story Pts</th>
                    <th className="py-3 px-4">Assignee</th>
                    <th className="py-3 px-4">Due Date</th>
                    <th className="py-3 px-4">Subtasks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTasks.map((task) => {
                    const completedSubtasks = task.subtasks.filter((st) => st.completed).length;
                    return (
                      <tr
                        key={task.id}
                        onClick={() => setSelectedTaskForDrawer(task)}
                        className="hover:bg-slate-50/80 transition cursor-pointer"
                      >
                        <td className="py-3 px-4 font-mono font-bold text-indigo-700">{task.id}</td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 text-sm">{task.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                              {task.category}
                            </span>
                            <span>{task.tags.join(', ')}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className="inline-block px-2.5 py-0.5 rounded-full font-bold text-[11px] text-white"
                            style={{
                              backgroundColor: COLUMNS.find((c) => c.status === task.status)?.color || '#6B7280',
                            }}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold">{task.priority}</td>
                        <td className="py-3 px-4 font-mono font-bold">{task.storyPoints}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0"
                              style={{ backgroundColor: task.assignee.avatarColor }}
                            >
                              {task.assignee.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                            </div>
                            <span className="text-slate-800 font-medium">{task.assignee.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">{task.dueDate}</td>
                        <td className="py-3 px-4">
                          {task.subtasks.length > 0 ? (
                            <span className="font-mono text-slate-700">
                              {completedSubtasks}/{task.subtasks.length}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Task Detail Slide-Over Drawer */}
      {selectedTaskForDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between overflow-y-auto">
            {/* Drawer Header */}
            <div>
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    {selectedTaskForDrawer.id}
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {selectedTaskForDrawer.category}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedTaskForDrawer(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="p-6 space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{selectedTaskForDrawer.title}</h2>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    {selectedTaskForDrawer.description}
                  </p>
                </div>

                {/* Workflow Status Selector */}
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                      Status Column
                    </span>
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
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-bold"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.status} value={c.status}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                      Priority &amp; Points
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-bold text-slate-800">{selectedTaskForDrawer.priority}</span>
                      <span className="text-slate-300">&bull;</span>
                      <span className="font-mono text-xs font-bold text-indigo-700">
                        {selectedTaskForDrawer.storyPoints} Story Points
                      </span>
                    </div>
                  </div>
                </div>

                {/* Blocked Reason if blocked */}
                {selectedTaskForDrawer.status === 'Blocked' && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                    <span className="text-xs font-bold text-rose-900 block mb-1">Blocked Reason:</span>
                    <p className="text-xs text-rose-800 leading-relaxed">
                      {selectedTaskForDrawer.blockedReason || 'Blocked awaiting dependencies or regulatory sign-off.'}
                    </p>
                  </div>
                )}

                {/* Assignee & Dates */}
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px] mb-1">Primary Assignee</span>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: selectedTaskForDrawer.assignee.avatarColor }}
                      >
                        {selectedTaskForDrawer.assignee.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </div>
                      <select
                        aria-label="Reassign task to team member"
                        value={selectedTaskForDrawer.assigneeId || selectedTaskForDrawer.assignee.name}
                        onChange={(e) => handleReassignTask(selectedTaskForDrawer.id, e.target.value)}
                        className="text-xs font-semibold px-2 py-1 border border-slate-300 rounded-md bg-white text-slate-800 focus:ring-1 focus:ring-indigo-500 max-w-[170px] truncate"
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
                    <span className="text-slate-400 block text-[11px]">Target Due Date</span>
                    <div className="font-mono font-bold text-slate-800 mt-1">{selectedTaskForDrawer.dueDate}</div>
                  </div>
                </div>

                {/* Subtasks Section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Subtasks Checklist ({selectedTaskForDrawer.subtasks.filter((s) => s.completed).length}/
                      {selectedTaskForDrawer.subtasks.length})
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {selectedTaskForDrawer.subtasks.map((st) => (
                      <label
                        key={st.id}
                        className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 border border-slate-200 text-xs text-slate-800 cursor-pointer transition"
                      >
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => handleToggleSubtask(selectedTaskForDrawer.id, st.id)}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={st.completed ? 'line-through text-slate-400' : 'font-medium'}>
                          {st.title}
                        </span>
                      </label>
                    ))}
                    {selectedTaskForDrawer.subtasks.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No subtasks defined for this ticket.</p>
                    )}
                  </div>
                </div>

                {/* Comments Thread */}
                <div>
                  <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                    Activity &amp; Comments ({selectedTaskForDrawer.comments.length})
                  </div>

                  <div className="space-y-3">
                    {selectedTaskForDrawer.comments.map((c) => (
                      <div key={c.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900">{c.author}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-700 leading-relaxed">{c.content}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Add an update comment..."
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={handleAddComment}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setSelectedTaskForDrawer(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Task Modal */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Create New Project Task</h3>
              <button
                onClick={() => setShowNewTaskModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Conduct Joint Commission physical plant safety survey"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Detailed Description *
                </label>
                <textarea
                  rows={3}
                  required
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Provide scope, deliverables, and acceptance criteria..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Clinical">Clinical</option>
                    <option value="Technology">Technology</option>
                    <option value="Compliance">Compliance</option>
                    <option value="Operations">Operations</option>
                    <option value="Marketing">Marketing</option>
                    <option value="HR">HR</option>
                    <option value="Billing">Billing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Priority *
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Story Points (Fibonacci)
                  </label>
                  <select
                    value={newPoints}
                    onChange={(e) => setNewPoints(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={1}>1 pt (Trivial)</option>
                    <option value={2}>2 pts (Small)</option>
                    <option value={3}>3 pts (Medium)</option>
                    <option value={5}>5 pts (Large)</option>
                    <option value={8}>8 pts (Significant)</option>
                    <option value={13}>13 pts (Epic / Complex)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Workflow Status
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Backlog">Backlog</option>
                    <option value="To Do">To Do</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Blocked">Blocked</option>
                    <option value="Done">Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Target Due Date
                  </label>
                  <input
                    type="date"
                    required
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assignee (Staff Team Member) *
                </label>
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800 bg-white"
                >
                  {availableMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} &bull; {m.role} {m.email ? `(${m.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tags (Comma separated)
                </label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="e.g. Compliance, JointCommission, Audit"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                >
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
