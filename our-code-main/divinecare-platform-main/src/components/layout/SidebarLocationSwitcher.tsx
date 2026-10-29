'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown, Building2, Check, MapPin, ChevronRight } from 'lucide-react';
import { useLocation } from '@/context/LocationContext';
import { useAuth } from '@/features/auth';

export function SidebarLocationSwitcher() {
  const { activeLocationId, activeLocation, setActiveLocationId, locations, isAllLocations } = useLocation();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const roleUpper = (user?.role || '').toUpperCase();
  const isDirector =
    roleUpper === 'PRACTICE_DIRECTOR' ||
    roleUpper === 'ADMIN' ||
    roleUpper === 'SUPER_ADMIN' ||
    roleUpper === 'DIRECTOR';

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative px-3 py-2" ref={dropdownRef}>
      {/* Switcher Button */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left bg-white/5 hover:bg-white/10 transition-all border border-white/10 group cursor-pointer"
        aria-label="Switch Practice Location"
      >
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 transition-transform group-hover:scale-105 shadow-sm text-white"
          style={{ backgroundColor: activeLocation ? activeLocation.brandColor : '#334155' }}
        >
          {activeLocation ? activeLocation.shortCode : 'ALL'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-bold truncate">
            {activeLocation ? activeLocation.name : 'All Locations'}
          </p>
          <p className="text-[10px] text-slate-400 truncate">
            {activeLocation ? activeLocation.specialtyType : 'Practice-Wide Rollup'}
          </p>
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-3 right-3 mt-1.5 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50 py-1 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3.5 py-2 border-b border-slate-800">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <MapPin size={11} className="text-indigo-400" /> MD Behavioral Health
            </p>
          </div>

          {/* All Locations Option */}
          <button
            type="button"
            onClick={() => {
              setActiveLocationId('all');
              setIsOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/5 transition-colors text-left cursor-pointer ${
              isAllLocations ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-200'
            }`}
          >
            <div className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-white text-[10px] font-black">
              ALL
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">All Locations</p>
              <p className="text-[10px] text-slate-400 truncate">Combined clinical & billing view</p>
            </div>
            {isAllLocations && <Check size={14} className="text-indigo-400" />}
          </button>

          <div className="border-t border-slate-800/80 my-1" />

          {/* 4 Practice Locations */}
          {locations.map((loc) => {
            const isSelected = activeLocationId === loc.id;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => {
                  setActiveLocationId(loc.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/5 transition-colors text-left cursor-pointer ${
                  isSelected ? 'bg-white/10' : 'text-slate-200'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0"
                  style={{ backgroundColor: loc.brandColor }}
                >
                  {loc.shortCode}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-white truncate">{loc.name}</p>
                    {loc.isFlagship && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-semibold">
                        Flagship
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">{loc.address}</p>
                </div>
                {isSelected && <Check size={14} style={{ color: loc.brandColor }} />}
              </button>
            );
          })}

          {/* Director Quick Link to Practice Overview */}
          {isDirector && (
            <>
              <div className="border-t border-slate-800 my-1" />
              <Link
                href="/dashboard/enterprise"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:bg-white/5 transition-colors"
              >
                <Building2 size={13} /> Practice Overview & Census
                <ChevronRight size={13} className="ml-auto text-slate-500" />
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
