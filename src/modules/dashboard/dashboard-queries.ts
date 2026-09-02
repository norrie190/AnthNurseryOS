import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { dateToSql, nurseryToday, sqlToDate } from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import {
  buildDashboardSummary,
  type DashboardCurrentTariff,
  type DashboardEquipmentInput,
  type DashboardPlantInput,
  type DashboardRecentEquipment,
  type DashboardRecentPlant,
  type DashboardSummary,
} from './dashboard-summary';

const purchaseSelect = {
  currency: true,
  shippingCostMinor: true,
  otherCostMinor: true,
} as const;

const primaryPhotoSelect = {
  where: { isPrimary: true },
  orderBy: { id: 'asc' },
  take: 1,
  select: { id: true, derivativeRevision: true },
} as const;

function covering(on: string) {
  const date = dateToSql(on);
  return {
    voidedAt: null,
    effectiveFrom: { lte: date },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
  };
}

export async function getDashboardSummary(on = nurseryToday()): Promise<DashboardSummary> {
  return getPrisma().$transaction(
    async (tx) => {
      const plants = await tx.plant.findMany({
        select: {
          status: true,
          archivedAt: true,
          purchase: {
            select: {
              ...purchaseSelect,
              plantPriceMinor: true,
            },
          },
        },
      });
      const equipment = await tx.equipment.findMany({
        select: {
          usesPower: true,
          archivedAt: true,
          purchase: {
            select: {
              ...purchaseSelect,
              equipmentPriceMinor: true,
            },
          },
          powerPeriods: {
            where: covering(on),
            orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
            take: 1,
            select: {
              id: true,
              effectiveFrom: true,
              effectiveTo: true,
              powerWatts: true,
              hoursPerDay: true,
            },
          },
        },
      });
      const tariff = await tx.electricityTariff.findFirst({
        where: covering(on),
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          currency: true,
          unitRateMinorPerKwh: true,
          effectiveFrom: true,
        },
      });
      const recentPlants = await tx.plant.findMany({
        where: { archivedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 4,
        select: {
          id: true,
          reference: true,
          name: true,
          createdAt: true,
          photos: primaryPhotoSelect,
        },
      });
      const recentEquipment = await tx.equipment.findMany({
        where: { archivedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 4,
        select: {
          id: true,
          reference: true,
          name: true,
          createdAt: true,
          photos: primaryPhotoSelect,
        },
      });

      const plantInputs: DashboardPlantInput[] = plants.map((plant) => ({
        status: plant.status,
        archivedAt: plant.archivedAt,
        purchase: plant.purchase
          ? {
              currency: plant.purchase.currency,
              itemPriceMinor: plant.purchase.plantPriceMinor,
              shippingCostMinor: plant.purchase.shippingCostMinor,
              otherCostMinor: plant.purchase.otherCostMinor,
            }
          : null,
      }));
      const equipmentInputs: DashboardEquipmentInput[] = equipment.map((item) => {
        const power = item.powerPeriods[0];
        return {
          usesPower: item.usesPower,
          archivedAt: item.archivedAt,
          purchase: item.purchase
            ? {
                currency: item.purchase.currency,
                itemPriceMinor: item.purchase.equipmentPriceMinor,
                shippingCostMinor: item.purchase.shippingCostMinor,
                otherCostMinor: item.purchase.otherCostMinor,
              }
            : null,
          currentPowerPeriod: power
            ? {
                id: power.id,
                effectiveFrom: sqlToDate(power.effectiveFrom),
                effectiveTo: power.effectiveTo ? sqlToDate(power.effectiveTo) : null,
                powerWatts: power.powerWatts.toFixed(2),
                hoursPerDay: power.hoursPerDay.toFixed(2),
                voidedAt: null,
              }
            : null,
        };
      });
      const currentTariff: DashboardCurrentTariff | null = tariff
        ? {
            id: tariff.id,
            currency: tariff.currency,
            unitRateMinorPerKwh: tariff.unitRateMinorPerKwh.toFixed(5),
            effectiveFrom: sqlToDate(tariff.effectiveFrom),
          }
        : null;
      const recentPlantInputs: DashboardRecentPlant[] = recentPlants.map((plant) => ({
        id: plant.id,
        reference: plant.reference,
        name: plant.name,
        displayName: plant.name || 'Unnamed Plant',
        createdAt: plant.createdAt,
        primaryPhoto: plant.photos[0] ?? null,
      }));
      const recentEquipmentInputs: DashboardRecentEquipment[] = recentEquipment.map((item) => ({
        id: item.id,
        reference: item.reference,
        name: item.name,
        createdAt: item.createdAt,
        primaryPhoto: item.photos[0] ?? null,
      }));

      return buildDashboardSummary({
        plants: plantInputs,
        equipment: equipmentInputs,
        currentTariff,
        recentPlants: recentPlantInputs,
        recentEquipment: recentEquipmentInputs,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
