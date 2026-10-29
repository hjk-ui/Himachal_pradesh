'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, X } from 'lucide-react';

export interface TreatmentTeamMember {
  id: string;
  name: string;
  role: string;
  credentials?: string | null;
  primary?: boolean;
  isPrimary?: boolean;
  avatarColor?: string | null;
  color?: string | null;
  initials?: string | null;
  providerId?: string | null;
}

export interface ProviderRosterItem {
  id: string;
  name: string;
  role: string;
  initials?: string;
  avatarColor?: string;
  email?: string;
}

interface TreatmentTeamPanelProps {
  clientId: string;
  canManageTeam?: boolean;
  initialTeam?: TreatmentTeamMember[];
  onTeamUpdated?: (team: TreatmentTeamMember[]) => void;
}

export default function TreatmentTeamPanel({
  clientId,
  canManageTeam = true,
  initialTeam = [],
  onTeamUpdated,
}: TreatmentTeamPanelProps) {
  const [team, setTeam] = useState<TreatmentTeamMember[]>(initialTeam);
  const [roster, setRoster] = useState<ProviderRosterItem[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/treatment-team`);
      const data = await res.json();
      if (data.success && data.team) {
        setTeam(data.team);
        onTeamUpdated?.(data.team);
      }
    } catch (err) {
      console.error('Failed to load treatment team:', err);
    }
  }, [clientId, onTeamUpdated]);

  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/providers/roster');
      const data = await res.json();
      if (data.success && data.roster) {
        setRoster(data.roster);
      }
    } catch (err) {
      console.error('Failed to load provider roster:', err);
    }
  }, []);

  useEffect(() => {
    if (initialTeam.length > 0) {
      setTeam(initialTeam);
    } else {
      void loadTeam();
    }
    void loadRoster();
  }, [initialTeam, loadTeam, loadRoster]);

  const handleAddMember = async (provider: ProviderRosterItem) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/treatment-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          name: provider.name,
          role: provider.role,
          isPrimary: false,
          avatarColor: provider.avatarColor || '#5C2D91',
          initials: provider.initials,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to add team member');
      }

      await loadTeam();
      setShowAddMember(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error adding member');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (providerId: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/treatment-team?providerId=${encodeURIComponent(providerId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to remove team member');
      }

      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error removing member');
    } finally {
      setSaving(false);
    }
  };

  const unassignedRoster = roster.filter(
    (p) => !team.some((t) => (t.providerId || t.id) === p.id || t.name.toLowerCase() === p.name.toLowerCase())
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
            <Users size={14} className="text-purple-600" /> Treatment Team
          </h3>
        </div>
        {canManageTeam && (
          <button
            type="button"
            onClick={() => setShowAddMember((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] hover:text-[#4A2475] transition"
          >
            <UserPlus size={13} />
            + Add
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2.5 p-2 bg-rose-50 text-rose-700 rounded-lg text-xs border border-rose-200">
          {error}
        </div>
      )}

      {/* Add Member Dropdown/Drawer */}
      {showAddMember && (
        <div className="mb-3 p-2 bg-purple-50 rounded-xl border border-purple-100 animate-in fade-in">
          <div className="text-[11px] font-bold text-[#5C2D91] mb-1.5 px-1 flex items-center justify-between">
            <span>Select Provider to Add</span>
            <button
              type="button"
              onClick={() => setShowAddMember(false)}
              className="text-gray-500 hover:text-gray-600 font-bold text-sm leading-none"
            >
              &times;
            </button>
          </div>
          {unassignedRoster.length === 0 ? (
            <p className="text-xs text-gray-500 py-2 px-1 text-center italic">
              All available providers already assigned.
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {unassignedRoster.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => void handleAddMember(provider)}
                  disabled={saving}
                  className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-white text-left transition group disabled:opacity-50"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-xs"
                    style={{ background: provider.avatarColor || '#5C2D91' }}
                  >
                    {provider.initials || provider.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-[#5C2D91]">
                      {provider.name}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">{provider.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assigned Members List */}
      <div className="space-y-1.5">
        {team.map((member) => {
          const isPrimary = Boolean(member.primary || member.isPrimary);
          const initials =
            member.initials ||
            member.name
              .trim()
              .split(' ')
              .filter(Boolean)
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();

          const color = member.avatarColor || member.color || '#5C2D91';

          return (
            <div
              key={member.id}
              className="group flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs"
                  style={{ background: color }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{member.name}</p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <span>{member.role}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isPrimary && (
                  <span className="px-1.5 py-0 bg-purple-100 text-purple-700 rounded-full font-semibold border border-purple-200 text-[11px]">
                    Primary
                  </span>
                )}
                {!isPrimary && canManageTeam && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveMember(member.providerId || member.id)}
                    title={`Remove ${member.name}`}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 p-1 transition-opacity"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {team.length === 0 && (
          <p className="text-xs text-gray-500 py-3 text-center italic">
            No care team members assigned.
          </p>
        )}
      </div>
    </div>
  );
}
