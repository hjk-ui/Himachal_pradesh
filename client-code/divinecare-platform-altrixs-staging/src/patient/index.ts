export {
  invitePatientForClient,
  syncPatientAccountEmail,
  type AppInviteResult,
} from '@/patient/application/invite/onboard-client';

export {
  sendAppointmentCreatedEmail,
  sendPatientInviteEmail,
  sendPatientEmailChangedNotification,
} from '@/patient/infrastructure/notifications/email';

export {
  sendAppointmentCreatedSms,
  sendPatientInviteSms,
} from '@/patient/infrastructure/notifications/sms';

export {
  ProxyAccessError,
  listClientPortalAccess,
  grantProxyAccess,
  verifyProxyAccess,
  revokeProxyAccess,
  setProxyAccessLevel,
  resendGuardianInvite,
  convertSelfLoginToGuardian,
  setMinorSelfConsent,
  setPortalItemVisibility,
  listPortalItems,
} from '@/patient/application/proxy/manage';
