'use server';

import { z } from 'zod';
import { EnergyError } from './energy-errors';
import { energyIdSchema, parseEnergy } from './energy-input';
import {
  correctionReview,
  energyRows,
  exclusiveEnd,
  type EnergyActionResult,
  type EnergyContext,
} from './energy-browser';
import { getElectricityTariffHistory, getEquipmentPowerHistory } from './energy-queries';
import {
  recordEquipmentPowerPeriod,
  changeEquipmentPowerSettings,
  correctEquipmentPowerPeriod,
  voidEquipmentPowerPeriod,
} from './equipment-power-service';
import {
  recordElectricityTariff,
  changeElectricityTariff,
  correctElectricityTariff,
  voidElectricityTariff,
} from './electricity-tariff-service';

const contextSchema = z
  .strictObject({
    kind: z.enum(['power', 'tariff']),
    mode: z.enum(['record', 'change', 'correct', 'void']),
    equipmentId: energyIdSchema.optional(),
    periodId: energyIdSchema.optional(),
    token: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'power' && !value.equipmentId)
      ctx.addIssue({ code: 'custom', message: 'Choose Equipment.' });
    if ((value.mode === 'correct' || value.mode === 'void') && !value.periodId)
      ctx.addIssue({ code: 'custom', message: 'Choose a history record.' });
    const validToken =
      value.kind === 'power'
        ? z.iso.datetime({ precision: 3 }).safeParse(value.token).success
        : /^[a-f0-9]{64}$/.test(value.token);
    if (!validToken)
      ctx.addIssue({ code: 'custom', message: 'Reload the page to obtain the current version.' });
  });

export async function saveEnergyAction(
  context: EnergyContext,
  data: FormData,
): Promise<EnergyActionResult> {
  try {
    const c = parseEnergy(contextSchema, context);
    const allowed = new Set(
      c.mode === 'void'
        ? ['correctionReason', 'confirmVoid']
        : [
            ...(c.kind === 'power' ? ['powerWatts', 'hoursPerDay'] : ['unitRateMinorPerKwh']),
            'effectiveFrom',
            'notes',
            ...(c.mode !== 'change' ? ['lastDay'] : []),
            ...(c.mode === 'correct' ? ['correctionReason', 'confirmAdjacent'] : []),
          ],
    );
    const values: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      if (!allowed.has(key) || typeof value !== 'string' || Object.hasOwn(values, key))
        throw new EnergyError(
          'VALIDATION_FAILED',
          'The form contains unsupported or duplicate fields.',
        );
      values[key] = value;
    }
    if (c.mode === 'void') {
      if (values.confirmVoid !== 'yes')
        throw new EnergyError(
          'VALIDATION_FAILED',
          'Confirm that this record should be excluded from calculations.',
        );
      const input = { correctionReason: values.correctionReason };
      if (c.kind === 'power')
        await voidEquipmentPowerPeriod(c.equipmentId!, c.periodId!, {
          ...input,
          expectedUpdatedAt: c.token,
        });
      else await voidElectricityTariff(c.periodId!, { ...input, expectedTimelineToken: c.token });
    } else {
      let end: string | null | undefined;
      if (c.mode !== 'change') {
        try {
          end = exclusiveEnd(values.lastDay ?? '');
        } catch {
          throw new EnergyError('VALIDATION_FAILED', 'Check the last day.', {
            issues: [{ field: 'lastDay', message: 'Use a valid last day before 31 Dec 9999.' }],
          });
        }
      }
      const common = { effectiveFrom: values.effectiveFrom, notes: values.notes ?? null };
      const interval = { ...common, effectiveTo: end };
      let adjacentAdjustments;
      if (c.mode === 'correct') {
        const history =
          c.kind === 'power'
            ? energyRows((await getEquipmentPowerHistory(c.equipmentId!)).powerPeriods)
            : energyRows((await getElectricityTariffHistory()).tariffs);
        const current = history.find((row) => row.id === c.periodId);
        if (!current) throw new EnergyError('NOT_FOUND', 'This history record could not be found.');
        const review = correctionReview(history, current, common.effectiveFrom, end ?? null);
        if (review.adjustments.length && values.confirmAdjacent !== 'yes')
          throw new EnergyError(
            'CONFLICT',
            'Review and confirm the changes to adjacent periods before saving.',
          );
        adjacentAdjustments = review.adjustments;
      }
      if (c.kind === 'power') {
        const power = {
          powerWatts: values.powerWatts,
          hoursPerDay: values.hoursPerDay,
          expectedUpdatedAt: c.token,
        };
        if (c.mode === 'record')
          await recordEquipmentPowerPeriod(c.equipmentId!, { ...interval, ...power });
        else if (c.mode === 'change')
          await changeEquipmentPowerSettings(c.equipmentId!, { ...common, ...power });
        else
          await correctEquipmentPowerPeriod(c.equipmentId!, c.periodId!, {
            ...interval,
            ...power,
            correctionReason: values.correctionReason,
            adjacentAdjustments,
          });
      } else {
        const tariff = {
          unitRateMinorPerKwh: values.unitRateMinorPerKwh,
          expectedTimelineToken: c.token,
        };
        if (c.mode === 'record') await recordElectricityTariff({ ...interval, ...tariff });
        else if (c.mode === 'change') await changeElectricityTariff({ ...common, ...tariff });
        else
          await correctElectricityTariff(c.periodId!, {
            ...interval,
            ...tariff,
            correctionReason: values.correctionReason,
            adjacentAdjustments,
          });
      }
    }
    return {
      success: true,
      message:
        c.mode === 'void' ? 'Record voided. History has been retained.' : 'Energy history saved.',
    };
  } catch (error) {
    if (error instanceof EnergyError)
      return {
        success: false,
        message:
          error.code === 'STALE_UPDATE'
            ? 'This history changed while the form was open. Your values have been kept. Reload and review the latest history before trying again.'
            : error.message,
        stale: error.code === 'STALE_UPDATE',
        issues: error.issues,
      };
    console.error('Energy form save failed', error);
    return {
      success: false,
      message:
        'We could not confirm this save. Your values have been kept. Reload to check the history before trying again.',
    };
  }
}
