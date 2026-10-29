import { canPrescribe as hasPrescribingPermission, type StaffRole } from '@/types/roles';

export interface PrescribingUserLike {
  role?: StaffRole | string | null;
  baseRole?: StaffRole | string | null;
  rolePreview?: boolean;
}

export interface PrescribingUiState {
  /** True if the user's current preview/active role can prescribe in the UI */
  canPrescribe: boolean;
  /** True if user is in admin role-preview mode */
  isRolePreview: boolean;
  /** True if an admin is previewing a prescriber role (PSYCHIATRIST or NP) */
  isPrescribingPreview: boolean;
  /** True if live DrFirst gateway launch is permitted */
  canLaunchGateway: boolean;
  /** True if clinical prescription entry / mobile sync is permitted */
  canCreatePrescription: boolean;
  /** UI presentation mode */
  panelMode: 'preview' | 'prescriber' | 'read-only';
}

export function getPrescribingUiState(user: PrescribingUserLike | null | undefined): PrescribingUiState {
  const canPrescribe = Boolean(user?.role && hasPrescribingPermission(user.role));
  const isRolePreview = Boolean(
    user?.rolePreview ||
    (user?.baseRole === 'ADMIN' && user?.role !== 'ADMIN')
  );
  const isPrescribingPreview = isRolePreview && canPrescribe;
  const canLaunchGateway = canPrescribe && !isRolePreview;
  const canCreatePrescription = canPrescribe;
  const panelMode = isPrescribingPreview
    ? 'preview'
    : canPrescribe
      ? 'prescriber'
      : 'read-only';

  return {
    canPrescribe,
    isRolePreview,
    isPrescribingPreview,
    canLaunchGateway,
    canCreatePrescription,
    panelMode,
  };
}
