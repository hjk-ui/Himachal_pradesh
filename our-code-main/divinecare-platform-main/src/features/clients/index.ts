export type {
  Client,
  ClientCheckIn,
  ClientProgressNote,
  EhrProgressNote,
  CreateClientInput,
  CreateCheckInInput,
  UpdateClientInsuranceInput,
  ClientStatus,
  TreatmentTeam,
  TreatmentTeamMember,
  StaffMember,
} from './types';
export {
  fetchClients,
  fetchClient,
  fetchClientNotes,
  fetchEhrProgressNotes,
  createClientNote,
  createClient,
  createClientCheckIn,
  updateClient,
  updateClientStatus,
  updateClientInsurance,
  updateClientTreatmentTeam,
  markClientHieQueried,
  uploadClientAvatar,
  removeClientAvatar,
  sendPortalInvite,
} from './api/clientsApi';
export { useClients } from './hooks/useClients';
export { ClientIntakeModal } from './components/ClientIntakeModal';
export { EditClientModal } from './components/EditClientModal';
