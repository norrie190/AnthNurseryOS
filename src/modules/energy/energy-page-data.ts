import 'server-only';
import { nurseryToday } from '../../lib/calendar-date';
import { energyRows } from './energy-browser';
import { getElectricityTariffHistory, getEquipmentPowerHistory } from './energy-queries';
import { equipmentEnergyView } from './energy-view';

export async function loadEquipmentEnergyView(equipmentId: string) {
  const [history, tariffHistory] = await Promise.all([
    getEquipmentPowerHistory(equipmentId),
    getElectricityTariffHistory(),
  ]);
  return equipmentEnergyView({
    equipmentId,
    usesPower: history.usesPower,
    token: history.updatedAt.toISOString(),
    rows: energyRows(history.powerPeriods),
    tariffs: energyRows(tariffHistory.tariffs),
    today: nurseryToday(),
  });
}
