export type LocationRecord = {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  timezone: string;
  active: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  staffCount?: number;
};

export type OrganizationRecord = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  locations: LocationRecord[];
};

export type CreateLocationInput = {
  name: string;
  code?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  timezone?: string;
  isPrimary?: boolean;
  active?: boolean;
};

export type UpdateLocationInput = Partial<CreateLocationInput>;
