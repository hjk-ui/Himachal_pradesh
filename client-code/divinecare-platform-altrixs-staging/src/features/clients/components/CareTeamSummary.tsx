'use client';

import { useState } from 'react';
import {
  careTeamPersonLabel,
  careTeamPersonLine,
  formatSeenDate,
  type ClientCareTeam,
  type CareTeamPerson,
} from '@/lib/clients/careTeam';

/**
 * Care team on the client roster (cards, table rows, mobile rows) and the chart banner: the primary
 * clinician with their role, then other members as compact chips ("Therapist: Stephanie Walker"),
 * then every other provider who saw the client ("Prescriber · seen: Rajan Sood"). "+N more" expands
 * the full list inline (role and last seen) and the tooltip carries it too, so a client seen by more
 * than one provider lists all of them. A non-clinical assignee (an import that defaulted to the
 * importing admin) shows as Unassigned.
 */

const NON_CLINICAL_TITLE = 'Imported without a provider (assigned to a non-clinical account). Assign a clinician.';

function UnassignedLabel({ team }: { team: ClientCareTeam | null | undefined }) {
  return (
    <span
      className="font-semibold text-amber-700"
      title={team?.primaryStatus === 'non_clinical' ? NON_CLINICAL_TITLE : 'No primary clinician'}
    >
      Unassigned
    </span>
  );
}

function PrimaryLine({ team, className = '' }: { team: ClientCareTeam | null | undefined; className?: string }) {
  const p = team?.primary;
  return (
    <p className={`min-w-0 truncate ${className}`} title={p ? `Primary (${p.label}): ${p.name}` : undefined}>
      {p ? (
        <>
          <span className="font-semibold text-slate-800">{p.name}</span>
          <span className="text-slate-500"> · {p.label}</span>
        </>
      ) : (
        <UnassignedLabel team={team} />
      )}
    </p>
  );
}

function MemberChip({ m }: { m: CareTeamPerson }) {
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${
        m.seen ? 'bg-white text-slate-600 ring-slate-200' : 'bg-slate-100 text-slate-700 ring-slate-200'
      }`}
      title={careTeamPersonLine(m)}
    >
      <span className="shrink-0 font-semibold text-slate-500">{careTeamPersonLabel(m)}:</span>
      <span className="ml-1 min-w-0 truncate">{m.name}</span>
    </span>
  );
}

function MoreChip({ count, title, open, onToggle }: { count: number; title: string; open: boolean; onToggle: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      aria-expanded={open}
      className="inline-flex min-h-6 shrink-0 items-center rounded-md px-1 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      title={title}
    >
      {open ? 'Show less' : <>+{count} more</>}
    </button>
  );
}

/** Everyone (primary, team, seen by) with role and last seen; expands inline so it never overflows */
export function CareTeamFullList({ team, className = '' }: { team: ClientCareTeam; className?: string }) {
  return (
    <ul className={`min-w-0 space-y-0.5 text-[11px] text-slate-600 ${className}`} data-row-actions>
      {team.primary ? (
        <li className="break-words">
          <span className="font-semibold text-slate-500">Primary ({team.primary.label}):</span> {team.primary.name}
        </li>
      ) : null}
      {team.allMembers.map((m) => (
        <li key={`${m.id ?? ''}:${m.name}`} className="break-words">
          <span className="font-semibold text-slate-500">{careTeamPersonLabel(m)}:</span> {m.name}
          {m.seen && m.lastSeen ? <span className="text-slate-500"> · last seen {formatSeenDate(m.lastSeen)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * variant:
 *  - card: primary line + up to 3 member chips (+N more)
 *  - cell: table cell (narrow): primary line + 1 chip (+N more)
 *  - mobile: primary line + the first other member (+N more)
 */
export function CareTeamSummary({
  team,
  variant = 'card',
  className = '',
}: {
  team: ClientCareTeam | null | undefined;
  variant?: 'card' | 'cell' | 'mobile';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = variant === 'card' ? 3 : 1;
  const all = team?.allMembers ?? team?.members ?? [];
  const members = all.slice(0, shown);
  const more = Math.max(0, (team?.memberCount ?? 0) - members.length);
  return (
    <div className={`min-w-0 text-xs ${className}`}>
      <PrimaryLine team={team} />
      {members.length ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          {members.map((m) => (
            <MemberChip key={`${m.id ?? ''}:${m.name}`} m={m} />
          ))}
          <MoreChip count={more} title={team?.summary ?? ''} open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
      ) : null}
      {open && team ? <CareTeamFullList team={team} className="mt-1 rounded-md bg-slate-50 p-1.5 ring-1 ring-slate-200" /> : null}
    </div>
  );
}

/**
 * Chart banner field value: primary (role), then the team, then everyone who saw the client.
 * The first few on one line; "+N more" expands the full list inline (role and last seen).
 */
export function CareTeamInline({ team, fallbackName }: { team: ClientCareTeam | null | undefined; fallbackName?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!team) return <span className="truncate">{fallbackName ?? 'Unassigned'}</span>;
  const all = team.allMembers ?? team.members;
  const others = all.slice(0, 2);
  const more = Math.max(0, team.memberCount - others.length);
  if (open) {
    return (
      <span className="block min-w-0 whitespace-normal">
        <CareTeamFullList team={team} />
        <MoreChip count={more} title="" open onToggle={() => setOpen(false)} />
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1" title={team.summary || undefined}>
      <span className="min-w-0 truncate">
        {team.primary ? `${team.primary.name} (${team.primary.label})` : <UnassignedLabel team={team} />}
        {others.length ? (
          <span className="font-medium text-slate-500">
            {' · '}
            {others.map((m) => `${careTeamPersonLabel(m)}: ${m.name}`).join(' · ')}
          </span>
        ) : null}
      </span>
      <MoreChip count={more} title={team.summary} open={false} onToggle={() => setOpen(true)} />
    </span>
  );
}
