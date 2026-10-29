export interface FdbSettings {
  enabled: boolean;
  configured: boolean;
  endpoint?: string;
  vendorName?: string;
  vendorPassword?: string;
  application: string;
  applicationVersion: string;
  practiceName?: string;
  station?: string;
  practiceUsername?: string;
  systemName?: string;
  apiVersion: string;
}

export interface DrugAllergyIngredient {
  rxNormId?: string;
  rxNormIdType?: string;
  firstDataBankMedId?: string;
}

export interface DrugAllergyGroup {
  groupId?: string;
  groupName?: string;
}

export interface DrugAllergyResult {
  rcopiaId?: string;
  ndcId?: string;
  rxNormId?: string;
  rxNormIdType?: string;
  firstDataBankMedId?: string;
  brandName?: string;
  genericName?: string;
  form?: string;
  strength?: string;
  schedule?: string;
  routeCode?: string;
  drugNameType?: string;
  legendStatus?: string;
  brandingSource?: string;
  ingredients: DrugAllergyIngredient[];
  allergyGroups: DrugAllergyGroup[];
}

export interface DrugAllergySearchResponse {
  drugs: DrugAllergyResult[];
  warnings: Array<{ code?: string; text: string }>;
}

export interface FdbRequestContext {
  requestMessageId: string;
  searchString: string;
  maximum?: number;
}
