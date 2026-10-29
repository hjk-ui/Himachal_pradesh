'use client';

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

export interface PracticeLocation {
  id: string;
  name: string;
  shortCode: string;
  brandColor: string;
  bgColor: string;
  borderColor: string;
  address: string;
  locationNpi: string;
  isFlagship: boolean;
  specialtyType: string;
}

export const PRACTICE_LOCATIONS: PracticeLocation[] = [
  {
    id: 'bowie',
    name: 'Bowie',
    shortCode: 'BW',
    brandColor: '#4F46E5',
    bgColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    address: 'Bowie, MD (Flagship)',
    locationNpi: '1457893211',
    isFlagship: true,
    specialtyType: 'Full Outpatient & PRP',
  },
  {
    id: 'ss',
    name: 'Silver Spring',
    shortCode: 'SS',
    brandColor: '#059669',
    bgColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    address: 'Silver Spring, MD',
    locationNpi: '1457893212',
    isFlagship: false,
    specialtyType: 'Behavioral + Medical',
  },
  {
    id: 'lex',
    name: 'Lexington Park',
    shortCode: 'LP',
    brandColor: '#D97706',
    bgColor: '#FFFBEB',
    borderColor: '#FDE68A',
    address: 'Lexington Park, MD',
    locationNpi: '1457893214',
    isFlagship: false,
    specialtyType: 'Outpatient & Peer Support',
  },
  {
    id: 'balt',
    name: 'Baltimore',
    shortCode: 'BA',
    brandColor: '#0E7490',
    bgColor: '#ECFEFF',
    borderColor: '#A5F3FC',
    address: 'Baltimore, MD',
    locationNpi: '1457893213',
    isFlagship: false,
    specialtyType: 'Community & Crisis',
  },
];

interface LocationContextType {
  activeLocationId: string; // 'all' or location id ('bowie' | 'ss' | 'lex' | 'balt')
  activeLocation: PracticeLocation | null; // null when 'all'
  setActiveLocationId: (id: string) => void;
  locations: PracticeLocation[];
  isAllLocations: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);
const STORAGE_KEY = 'altrixs_active_location';

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [activeLocationId, setLocationState] = useState<string>('all');
  const [locations, setLocations] = useState<PracticeLocation[]>(PRACTICE_LOCATIONS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === 'all' || PRACTICE_LOCATIONS.some((l) => l.id === saved))) {
        setLocationState(saved);
      }
    } catch {
      /* ignore storage fallback */
    }

    // Optional fetch to sync any dynamic location updates from PostgreSQL
    fetch('/api/locations')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          const mapped: PracticeLocation[] = data.data.map((row: any) => ({
            id: row.id,
            name: row.name,
            shortCode: row.shortCode || row.short_code || row.name.slice(0, 2).toUpperCase(),
            brandColor: row.brandColor || row.brand_color || '#4F46E5',
            bgColor: row.bgColor || row.bg_color || '#EEF2FF',
            borderColor: row.borderColor || row.border_color || '#C7D2FE',
            address: `${row.city || row.name}, MD`,
            locationNpi: row.locationNpi || row.location_npi || '',
            isFlagship: Boolean(row.isFlagship || row.is_flagship),
            specialtyType: row.specialtyType || row.specialty_type || 'Clinical Outpatient',
          }));
          setLocations(mapped);
        }
      })
      .catch(() => {});
  }, []);

  const setActiveLocationId = (id: string) => {
    setLocationState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const activeLocation = useMemo(() => {
    return activeLocationId === 'all'
      ? null
      : locations.find((l) => l.id === activeLocationId) ?? null;
  }, [activeLocationId, locations]);

  const isAllLocations = activeLocationId === 'all';

  return (
    <LocationContext.Provider
      value={{
        activeLocationId,
        activeLocation,
        setActiveLocationId,
        locations,
        isAllLocations,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) {
    // Graceful fallback if rendered outside provider
    return {
      activeLocationId: 'all',
      activeLocation: null,
      setActiveLocationId: () => {},
      locations: PRACTICE_LOCATIONS,
      isAllLocations: true,
    };
  }
  return context;
}
