/** Exact UI copy for the Homebase connector. Read-only: nothing is ever written back to Homebase. */

export const HOMEBASE_TABS = [
  'Connection',
  'Locations',
  'Roster match',
  'Hours',
  'Payroll reconciliation',
] as const;

export type HomebaseTab = (typeof HOMEBASE_TABS)[number];

export const HOMEBASE_COPY = {
  title: 'Homebase',
  connected: 'Connected (read-only)',
  notConnected: 'Not connected',
  syncNow: 'Sync now',
  syncing: 'Syncing…',
  /** Empty states shown when Homebase is not connected or returns nothing. Never replaced with sample rows. */
  emptyLocations: 'No locations yet',
  emptyRoster: 'No employees yet',
  emptyHours: 'No hours yet',
  emptyPayroll: 'No payroll hours yet',
  notConnectedHelp:
    'Set HOMEBASE_API_KEY and HOMEBASE_ORGANIZATION_ID on the server to connect. Altrixs only reads from Homebase.',
  neverSynced: 'Never synced',
} as const;
