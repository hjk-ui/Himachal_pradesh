export { LocationsPanel } from './components/LocationsPanel';
export { useLocations } from './hooks/useLocations';
export {
  fetchOrganization,
  fetchLocations,
  createLocation,
  updateLocation,
  deactivateLocation,
} from './api/locationsApi';
export type {
  LocationRecord,
  OrganizationRecord,
  CreateLocationInput,
  UpdateLocationInput,
} from './types';
