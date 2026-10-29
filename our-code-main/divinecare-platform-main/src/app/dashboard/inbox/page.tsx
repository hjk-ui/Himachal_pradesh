'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type InboxItem = {
  taskId: string;
  title: string;
  description?: string;
  clientName?: string;
  dueDate?: string;
  priority?: string;
  actionLabel?: string;
  actionHref?: string;
  group?: 'likely_inactive' | 'valant_import' | 'all_documents' | 'default';
  daysSinceActivity?: number;
};

const GROUP_META: Record<
  NonNullable<InboxItem['group']>,
  { label: string; inOverdueBadge: boolean }
> = {
  likely_inactive: {
    label: 'Overdue more than 180 days — likely inactive',
    inOverdueBadge: false,
  },
  valant_import: {
    label: 'Valant import — needs review',
    inOverdueBadge: false,
  },
  all_documents: {
    label: 'All documents',
    inOverdueBadge: false,
  },
  default: {
    label: 'Needs attention',
    inOverdueBadge: true,
  },
};

function inferGroup(item: InboxItem): NonNullable<InboxItem['group']> {
  if (item.group) return item.group;
  const hay = `${item.title} ${item.description || ''}`.toLowerCase();
  if (hay.includes('valant')) return 'valant_import';
  if (hay.includes('document') || hay.includes('file')) return 'all_documents';
  if ((item.daysSinceActivity ?? 0) >= 180 || hay.includes('180') || hay.includes('inactive')) {
    return 'likely_inactive';
  }
  return 'default';
}

export default function StaffInboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAllDocs, setShowAllDocs] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tasks')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load inbox');
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        const groups = Array.isArray(data.groups) ? data.groups : [];
        if (groups.length) {
          return groups.flatMap((g: { key: string; items: InboxItem[] }) =>
            (g.items || []).map((item) => ({ ...item, group: g.key as InboxItem['group'] }))
          );
        }
        return tasks;
      })
      .then((tasks) => {
        if (!cancelled) setItems(tasks);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load inbox');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, InboxItem[]> = {
      default: [],
      likely_inactive: [],
      valant_import: [],
      all_documents: [],
    };
    for (const item of items) {
      const g = inferGroup(item);
      map[g].push(item);
    }
    return map;
  }, [items]);

  const overdueBadgeCount = grouped.default.length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          Work that needs you. Client messages stay on the Messages page.
          {overdueBadgeCount > 0 ? (
            <span className="ml-2 text-xs font-semibold text-rose-700">
              {overdueBadgeCount} overdue
            </span>
          ) : null}
        </p>
      </div>
      {loading ? <p className="text-sm text-slate-500">Loading inbox…</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500">
          Inbox is empty.
        </div>
      ) : null}

      {(['default', 'likely_inactive', 'valant_import', 'all_documents'] as const).map((key) => {
        const rows = grouped[key];
        if (!rows.length && key !== 'all_documents') return null;
        if (key === 'all_documents' && !showAllDocs && !rows.length) {
          return (
            <section key={key} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showAllDocs}
                  onChange={(e) => setShowAllDocs(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                {GROUP_META.all_documents.label}
              </label>
            </section>
          );
        }
        if (key === 'all_documents' && !showAllDocs) {
          return (
            <section key={key} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showAllDocs}
                  onChange={(e) => setShowAllDocs(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                {GROUP_META.all_documents.label} ({rows.length})
              </label>
            </section>
          );
        }
        if (!rows.length) return null;
        return (
          <section key={key} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{GROUP_META[key].label}</h2>
              {key === 'likely_inactive' ? (
                <Link
                  href="/dashboard/clients?filter=discharge-review"
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  Discharge review
                </Link>
              ) : null}
            </div>
            <ul className="space-y-2">
              {rows.slice(0, 500).map((item) => (
                <li
                  key={item.taskId}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                      {item.clientName ? (
                        <p className="text-xs text-slate-500">{item.clientName}</p>
                      ) : null}
                      {item.description ? (
                        <p className="mt-1 text-sm text-slate-700">{item.description}</p>
                      ) : null}
                      {item.dueDate ? (
                        <p className="mt-1 text-xs text-slate-500">Due {item.dueDate}</p>
                      ) : null}
                    </div>
                    {item.actionHref ? (
                      <Link
                        href={item.actionHref}
                        className="shrink-0 text-sm font-semibold text-blue-600 hover:underline"
                      >
                        {item.actionLabel || 'Open'}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
