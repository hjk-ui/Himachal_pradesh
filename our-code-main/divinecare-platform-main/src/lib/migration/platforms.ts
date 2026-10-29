/**
 * Re-export platform catalog from fieldMaps (single source of truth).
 */
export {
  PLATFORMS,
  type PlatformId,
  type PlatformMeta,
} from '@/lib/migration/fieldMaps';

export type MigrationPlatform = {
  id: string;
  label: string;
  color: string;
  note: string;
  popular?: boolean;
  exportHint: string;
};
