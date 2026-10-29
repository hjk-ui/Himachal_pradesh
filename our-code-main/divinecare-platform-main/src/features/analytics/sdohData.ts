export type DomainKey = 'housing' | 'food' | 'transport' | 'safety' | 'financial' | 'social';
export type NeedLevel = 'none' | 'some' | 'significant';

export interface DomainResponse {
  domain: DomainKey;
  question: string;
  answer: string;
  needLevel: NeedLevel;
  resourcesMatched: string[];
}

export interface Screening {
  id: string;
  client: string;
  date: string;
  screener: string;
  overallNeed: NeedLevel;
  domains: DomainResponse[];
  notes: string;
}

export interface Resource {
  id: string;
  name: string;
  domain: DomainKey;
  cost: string;
  phone: string;
  hours: string;
  notes: string;
}

export const SDOH_RESOURCES_SEED: Resource[] = [];

export const SDOH_SCREENINGS_SEED: Screening[] = [];
