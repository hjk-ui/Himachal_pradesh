/** Who manages the measurement type catalog. Page reads follow roleAccess for MEASUREMENT_TYPES_PATH. */
export const MEASUREMENT_TYPES_PATH = '/dashboard/admin/measurement-types';

/** Leadership edits (active toggle). Licensed clinicians read only. */
export const MEASUREMENT_TYPE_EDIT_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
