import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { writeAuditLog, auditMetaFromRequest } from '../services/auditService';

export type UserRole =
  | 'client'
  | 'therapist'
  | 'psychiatrist'
  | 'np'
  | 'medical_assistant'  // ADDED
  | 'crisis_responder'   // ADDED
  | 'prp_specialist'
  | 'case_manager'
  | 'peer_support'
  | 'physician'
  | 'medical_np'
  | 'practice_director'
  | 'office_manager'
  | 'billing_specialist'
  | 'hr_manager';

// Role hierarchy groups
export const PROVIDER_ROLES: UserRole[] = [
  'therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder'
];
export const PRESCRIBER_ROLES: UserRole[] = ['psychiatrist', 'np'];
export const ADMIN_ROLES: UserRole[] = ['practice_director', 'office_manager'];
export const STAFF_ROLES: UserRole[] = [
  ...PROVIDER_ROLES, ...ADMIN_ROLES, 'billing_specialist', 'hr_manager', 'medical_assistant'
];

// Require at least one of the specified roles. Returns 403 with audit log if denied.
export function requireRole(...allowedRoles: UserRole[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role as UserRole | undefined;

    if (!role || !allowedRoles.includes(role)) {
      await writeAuditLog({
        actorUid: req.user?.uid || 'anonymous',
        actorRole: (role as any) || 'unknown',
        action: 'DENIED',
        resourceType: 'user',
        resourceId: req.params.id || 'unknown',
        patientId: req.params.patientId || 'unknown',
        outcome: 'DENIED',
        details: { requiredRoles: allowedRoles, endpoint: req.path, method: req.method },
        ...auditMetaFromRequest(req),
      });

      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions for this resource' },
      });
    }

    next();
  };
}

// Shorthand guards
export const requireProvider = () => requireRole(...PROVIDER_ROLES);
export const requirePrescriber = () => requireRole(...PRESCRIBER_ROLES);
export const requireAdmin = () => requireRole(...ADMIN_ROLES);
export const requireStaff = () => requireRole(...STAFF_ROLES);
export const requireBilling = () => requireRole('billing_specialist', 'office_manager', 'practice_director');
export const requireHR = () => requireRole('hr_manager', 'practice_director');
