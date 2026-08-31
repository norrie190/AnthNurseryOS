export const equipmentFieldLabels = {
  name: 'Name',
  category: 'Category',
  brand: 'Brand',
  model: 'Model',
  serialNumber: 'Serial number',
  usesPower: 'Uses power',
  locationId: 'Location',
  notes: 'Notes',
  recordPurchase: 'Record purchase information',
  seller: 'Seller',
  orderReference: 'Order reference',
  purchaseDate: 'Purchase date',
  equipmentPrice: 'Equipment price',
  shippingCost: 'Allocated shipping cost',
  otherCost: 'Other cost',
  currency: 'Currency',
} as const;
export type EquipmentFormField = keyof typeof equipmentFieldLabels;
export type EquipmentFormValues = Record<EquipmentFormField, string>;
export type EquipmentFormState = {
  message: string;
  fieldErrors: Partial<Record<EquipmentFormField, string>>;
  stale?: boolean;
};
export const initialEquipmentFormState: EquipmentFormState = { message: '', fieldErrors: {} };
export const initialEquipmentFormValues: EquipmentFormValues = {
  name: '',
  category: 'Other',
  brand: '',
  model: '',
  serialNumber: '',
  usesPower: '',
  locationId: '',
  notes: '',
  recordPurchase: '',
  seller: '',
  orderReference: '',
  purchaseDate: '',
  equipmentPrice: '',
  shippingCost: '',
  otherCost: '',
  currency: 'GBP',
};
export type EquipmentLocationOption = { id: string; label: string };
