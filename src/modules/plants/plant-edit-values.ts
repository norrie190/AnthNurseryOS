import type { PlantDetailRecord } from './plant-queries';
import { initialPlantFormValues, type PlantFormValues } from './plant-form-state';
import { formatMoneyInput } from './plant-money';

export function plantEditValues(plant: PlantDetailRecord): PlantFormValues {
  const values: PlantFormValues = {
    ...initialPlantFormValues,
    name: plant.name ?? '',
    status: plant.status,
    locationId: plant.locationId ?? '',
    notes: plant.notes ?? '',
  };
  for (const role of ['seed', 'pollen'] as const) {
    const id = plant.parentage?.[`${role}ParentPlantId`];
    const name = plant.parentage?.[`${role}ParentName`];
    values[`${role}ParentMode`] = id ? 'existing' : name ? 'external' : 'unknown';
    values[`${role}ParentPlantId`] = id ?? '';
    values[`${role}ParentName`] = name ?? '';
  }
  const purchase = plant.purchase;
  if (purchase) {
    Object.assign(values, {
      recordPurchase: 'on',
      seller: purchase.seller ?? '',
      orderReference: purchase.orderReference ?? '',
      purchaseDate: purchase.purchaseDate?.toISOString().slice(0, 10) ?? '',
      currency: purchase.currency,
      plantPrice: formatMoneyInput(purchase.plantPriceMinor, purchase.currency),
      shippingCost: formatMoneyInput(purchase.shippingCostMinor, purchase.currency),
      otherCost: formatMoneyInput(purchase.otherCostMinor, purchase.currency),
    });
  }
  return values;
}
