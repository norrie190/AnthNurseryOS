import { formatMoneyInput } from '../../lib/purchase-money';
import type { EquipmentDetailRecord } from './equipment-queries';
import { initialEquipmentFormValues, type EquipmentFormValues } from './equipment-form-state';

export function equipmentEditValues(equipment: EquipmentDetailRecord): EquipmentFormValues {
  const purchase = equipment.purchase;
  return {
    ...initialEquipmentFormValues,
    name: equipment.name,
    category: equipment.category,
    usesPower: String(equipment.usesPower),
    brand: equipment.brand ?? '',
    model: equipment.model ?? '',
    serialNumber: equipment.serialNumber ?? '',
    locationId: equipment.locationId ?? '',
    notes: equipment.notes ?? '',
    recordPurchase: purchase ? 'on' : '',
    ...(purchase
      ? {
          seller: purchase.seller ?? '',
          orderReference: purchase.orderReference ?? '',
          purchaseDate: purchase.purchaseDate?.toISOString().slice(0, 10) ?? '',
          currency: purchase.currency,
          equipmentPrice: formatMoneyInput(purchase.equipmentPriceMinor, purchase.currency),
          shippingCost: formatMoneyInput(purchase.shippingCostMinor, purchase.currency),
          otherCost: formatMoneyInput(purchase.otherCostMinor, purchase.currency),
        }
      : {}),
  };
}
