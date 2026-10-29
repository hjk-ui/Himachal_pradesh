export {
  invitePatientForClient,
  syncPatientAccountEmail,
  type AppInviteResult,
} from '@/patient/application/invite/onboard-client';

export {
  sendAppointmentCreatedEmail,
  sendAppointmentDeclinedEmail,
  sendPatientInviteEmail,
  sendPatientEmailChangedNotification,
} from '@/patient/infrastructure/notifications/email';

export {
  sendAppointmentCreatedSms,
  sendAppointmentDeclinedSms,
  sendPatientInviteSms,
} from '@/patient/infrastructure/notifications/sms';
export {
  recordPatientNotification,
  listPatientNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  deletePatientNotification,
  type RecordNotificationInput,
  type ListNotificationsOptions,
} from '@/patient/application/notifications/service';

export { changePatientPassword } from '@/patient/application/auth/change-password';
