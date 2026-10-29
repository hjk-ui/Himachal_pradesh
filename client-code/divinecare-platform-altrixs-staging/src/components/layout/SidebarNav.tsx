'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Star, UserRound } from 'lucide-react';
import {
  DEFAULT_COLLAPSED_GROUPS,
  findActiveNavItem,
  hrefPath,
  type NavItem,
  type NavSection,
} from './navConfig';
import { NavIcon } from './navIcons';
import { getCollapsedGroups, setCollapsedGroups, type RecentClient } from './navStorage';

type Props = {
  sections: NavSection[];
  pathname: string;
  collapsed: boolean;
  pinned: string[];
  recentClients: RecentClient[];
  onNavigate: () => void;
  onTogglePin: (href: string) => void;
};

/** Area / sub-group keys share one collapsed map: "Billing" or "Billing/Claims". */
function groupKey(area: string, group?: string) {
  return group ? `${area}/${group}` : area;
}

export function SidebarNav({
  sections,
  pathname,
  collapsed,
  pinned,
  recentClients,
  onNavigate,
  onTogglePin,
}: Props) {
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setCollapsedMap(getCollapsedGroups());
    setLoaded(true);
  }, []);

  const active = findActiveNavItem(pathname, sections);
  const activeHref = active?.item.href;
  const activeAreaKey = active ? active.section.label : null;
  const activeGroupKey = active?.item.group ? groupKey(active.section.label, active.item.group) : null;

  // Navigating into a collapsed area / group re-opens it so the current page is visible.
  useEffect(() => {
    if (!loaded) return;
    setCollapsedMap((prev) => {
      const keys = [activeAreaKey, activeGroupKey].filter((k): k is string => Boolean(k));
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of keys) next[k] = false;
      setCollapsedGroups(next);
      return next;
    });
  }, [loaded, activeAreaKey, activeGroupKey]);

  const isCollapsed = (key: string) => {
    if (key in collapsedMap) return collapsedMap[key];
    if (key === activeAreaKey || key === activeGroupKey) return false;
    return DEFAULT_COLLAPSED_GROUPS.has(key);
  };

  const toggle = (key: string) => {
    const next = { ...collapsedMap, [key]: !isCollapsed(key) };
    setCollapsedMap(next);
    setCollapsedGroups(next);
  };

  const pinnedItems = useMemo(() => {
    const byHref = new Map<string, NavItem>();
    for (const s of sections) for (const i of s.items) if (!byHref.has(i.href)) byHref.set(i.href, i);
    return pinned.map((h) => byHref.get(h)).filter((i): i is NavItem => Boolean(i));
  }, [pinned, sections]);

  const canSeeClients = sections.some((s) => s.items.some((i) => hrefPath(i.href) === '/dashboard/clients'));

  const renderItem = (item: NavItem, opts: { indent?: boolean; keyPrefix?: string } = {}) => {
    const isActive = activeHref === item.href;
    const isPinned = pinned.includes(item.href);
    return (
      <li key={`${opts.keyPrefix ?? ''}${item.href}`} className="group/item relative">
        <Link
          href={item.href}
          onClick={onNavigate}
          title={item.label}
          aria-current={isActive ? 'page' : undefined}
          className={`group relative flex min-h-10 items-center rounded-lg text-[13px] font-medium transition
            ${collapsed ? 'justify-center px-2 py-2' : `gap-2.5 py-2 pr-8 ${opts.indent ? 'pl-5' : 'pl-3'}`}
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141C34]
            ${
              isActive
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-white/10'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition
              ${isActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-200'}`}
          >
            <NavIcon name={item.icon} />
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge ? (
                <span
                  className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold
                    ${isActive ? 'bg-blue-600/10 text-blue-700' : 'bg-blue-600 text-white'}`}
                >
                  {item.badge}
                </span>
              ) : null}
            </>
          )}
          {/* Collapsed rail: the label is visually hidden, so screen readers get it (and the count) here */}
          {collapsed && <span className="sr-only">{item.label}</span>}
          {collapsed && item.badge ? (
            <>
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#D4A017]" aria-hidden />
              <span className="sr-only">{`, ${item.badge} new`}</span>
            </>
          ) : null}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={() => onTogglePin(item.href)}
            aria-pressed={isPinned}
            aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label} to sidebar`}
            title={isPinned ? 'Unpin' : 'Pin to sidebar'}
            className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition
              focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70
              ${isPinned ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100 [@media(hover:none)]:hidden'}
              ${isActive ? 'text-blue-600 hover:bg-blue-600/10' : 'text-slate-400 hover:bg-white/10 hover:text-[#D4A017]'}`}
          >
            <Star size={14} className={isPinned ? 'fill-[#D4A017] text-[#D4A017]' : ''} aria-hidden />
          </button>
        )}
      </li>
    );
  };

  const heading = (label: string, key: string, small?: boolean) =>
    collapsed ? null : (
      <button
        type="button"
        onClick={() => toggle(key)}
        aria-expanded={!isCollapsed(key)}
        className={`flex min-h-9 w-full items-center gap-1 rounded-md px-3 text-left transition lg:min-h-0 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60
          ${
            small
              ? 'mt-1 py-1.5 text-[11px] font-semibold text-slate-400'
              : 'mb-1 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300/80'
          }`}
      >
        <span className="flex-1 truncate">{label}</span>
        {isCollapsed(key) ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
      </button>
    );

  return (
    <>
      {pinnedItems.length > 0 && (
        <div>
          {!collapsed && (
            <p className="mb-1 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#D4A017]">Pinned</p>
          )}
          <ul className="space-y-0.5">{pinnedItems.map((item) => renderItem(item, { keyPrefix: 'pin:' }))}</ul>
        </div>
      )}

      {canSeeClients && recentClients.length > 0 && !collapsed && (
        <div>
          <p className="mb-1 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300/80">
            Recent clients
          </p>
          <ul className="space-y-0.5">
            {recentClients.map((c) => {
              const href = `/dashboard/clients/${encodeURIComponent(c.id)}`;
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={c.id}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    title={c.name}
                    className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition
                      ${isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                  >
                    <UserRound size={16} className="shrink-0 text-slate-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.mrn ? <span className="shrink-0 font-mono text-[11px] text-slate-300">{c.mrn}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sections.map((section) => {
        const areaKey = groupKey(section.label);
        const areaClosed = !collapsed && isCollapsed(areaKey);
        const top = section.items.filter((i) => !i.group);
        const groups: { name: string; items: NavItem[]; firstIndex: number }[] = [];
        section.items.forEach((item, index) => {
          if (!item.group) return;
          const g = groups.find((x) => x.name === item.group);
          if (g) g.items.push(item);
          else groups.push({ name: item.group, items: [item], firstIndex: index });
        });
        // Keep the config order: interleave top-level links and sub-groups by first position.
        const blocks: ({ kind: 'item'; item: NavItem; at: number } | { kind: 'group'; name: string; items: NavItem[]; at: number })[] = [
          ...top.map((item) => ({ kind: 'item' as const, item, at: section.items.indexOf(item) })),
          ...groups.map((g) => ({ kind: 'group' as const, name: g.name, items: g.items, at: g.firstIndex })),
        ].sort((a, b) => a.at - b.at);

        return (
          <div key={section.label}>
            {heading(section.label, areaKey)}
            {!areaClosed && (
              <ul className="space-y-0.5">
                {blocks.map((block) => {
                  if (block.kind === 'item') return renderItem(block.item);
                  const key = groupKey(section.label, block.name);
                  const closed = !collapsed && isCollapsed(key);
                  // Collapsed rail: show sub-group links flat (no headings fit).
                  if (collapsed) return block.items.map((item) => renderItem(item));
                  return (
                    <li key={`group:${key}`}>
                      {heading(block.name, key, true)}
                      {!closed && <ul className="space-y-0.5">{block.items.map((item) => renderItem(item, { indent: true }))}</ul>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
