export const initialPlantFormValues = {
  name: '',
  status: 'GROWING',
  locationId: '',
  notes: '',
  seedParentMode: 'unknown',
  seedParentPlantId: '',
  seedParentName: '',
  pollenParentMode: 'unknown',
  pollenParentPlantId: '',
  pollenParentName: '',
  recordPurchase: '',
  seller: '',
  orderReference: '',
  purchaseDate: '',
  plantPrice: '',
  shippingCost: '',
  otherCost: '',
  currency: 'GBP',
};

export type PlantFormValues = typeof initialPlantFormValues;
export type PlantFormField = keyof PlantFormValues;
export type PlantFormState = {
  message: string;
  fieldErrors: Partial<Record<PlantFormField, string>>;
  stale?: boolean;
};
export const initialPlantFormState: PlantFormState = { message: '', fieldErrors: {} };

export type PlantSelectOption = { id: string; label: string };

export const plantStatusLabels = {
  GROWING: 'Growing',
  QUARANTINE: 'Quarantine',
  SOLD: 'Sold',
  DECEASED: 'Deceased',
} as const;

export const plantFieldLabels: Record<PlantFormField, string> = {
  name: 'Name',
  status: 'Status',
  locationId: 'Location',
  notes: 'Notes',
  seedParentMode: 'Seed parent choice',
  seedParentPlantId: 'Existing seed parent',
  seedParentName: 'External seed parent name',
  pollenParentMode: 'Pollen parent choice',
  pollenParentPlantId: 'Existing pollen parent',
  pollenParentName: 'External pollen parent name',
  recordPurchase: 'Record purchase information',
  seller: 'Seller',
  orderReference: 'Order reference',
  purchaseDate: 'Purchase date',
  plantPrice: 'Plant price',
  shippingCost: 'Shipping cost',
  otherCost: 'Other cost',
  currency: 'Currency',
};
