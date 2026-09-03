'use server';

import { revalidatePath } from 'next/cache';
import {
  changeInflorescenceStatus,
  correctInflorescence,
  createInflorescence,
  voidInflorescence,
} from './inflorescence-service';
import {
  changePollinationAttemptStatus,
  correctPollinationAttempt,
  createPollinationAttempt,
  voidPollinationAttempt,
} from './pollination-service';
import {
  closeSeedBatch,
  correctSeedBatch,
  recordSeedBatchGermination,
  recordSeedBatchHarvest,
  recordSeedBatchSowing,
  voidSeedBatch,
} from './seed-batch-service';
import { BreedingError } from './breeding-errors';

export type BreedingActionState = {
  success: boolean;
  message: string;
  fieldErrors: Record<string, string>;
  stale?: boolean;
};
export const initialBreedingActionState: BreedingActionState = {
  success: false,
  message: '',
  fieldErrors: {},
};

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === 'string' ? item : '';
}
function optional(valueToRead: string): string | undefined {
  return valueToRead.trim() || undefined;
}
function optionalNumber(valueToRead: string): number | undefined {
  return valueToRead.trim() ? Number(valueToRead) : undefined;
}
function fields(error: BreedingError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [issue.field.replace(/^input\./, ''), issue.message]),
  );
}
async function run(
  plantId: string,
  operation: () => Promise<unknown>,
  success: string,
): Promise<BreedingActionState> {
  try {
    await operation();
    revalidatePath(`/plants/${plantId}`);
    return { success: true, message: success, fieldErrors: {} };
  } catch (error) {
    if (error instanceof BreedingError) {
      return {
        success: false,
        message:
          error.code === 'STALE_UPDATE'
            ? 'This record changed while the form was open. Review the refreshed history before trying again.'
            : error.message,
        fieldErrors: fields(error),
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      };
    }
    console.error('Breeding action failed', error);
    return {
      success: false,
      message:
        'We could not confirm this breeding change. Reload the Plant details before trying again.',
      fieldErrors: {},
    };
  }
}

export async function createInflorescenceAction(
  plantId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      createInflorescence(plantId, {
        emergedOn: optional(value(formData, 'emergedOn')),
        openedOn: optional(value(formData, 'openedOn')),
        notes: optional(value(formData, 'notes')),
      }),
    'Inflorescence recorded.',
  );
}
export async function changeInflorescenceStatusAction(
  plantId: string,
  inflorescenceId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      changeInflorescenceStatus(inflorescenceId, {
        status: value(formData, 'status') as never,
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Inflorescence status updated.',
  );
}
export async function correctInflorescenceAction(
  plantId: string,
  inflorescenceId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      correctInflorescence(inflorescenceId, {
        emergedOn: optional(value(formData, 'emergedOn')),
        openedOn: optional(value(formData, 'openedOn')),
        notes: optional(value(formData, 'notes')),
        status: optional(value(formData, 'status')) as never,
        correctionReason: value(formData, 'correctionReason'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Inflorescence correction saved.',
  );
}
export async function voidInflorescenceAction(
  plantId: string,
  inflorescenceId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      voidInflorescence(inflorescenceId, {
        correctionReason: value(formData, 'correctionReason'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Inflorescence voided. It remains in history.',
  );
}

function pollenSource(formData: FormData) {
  const mode = value(formData, 'pollenSourceMode');
  if (mode === 'INTERNAL')
    return {
      mode: 'INTERNAL' as const,
      pollenParentPlantId: value(formData, 'pollenParentPlantId'),
    };
  if (mode === 'EXTERNAL')
    return {
      mode: 'EXTERNAL' as const,
      pollenParentName: value(formData, 'pollenParentName'),
      pollenBreeder: optional(value(formData, 'pollenBreeder')),
      pollenCultivar: optional(value(formData, 'pollenCultivar')),
    };
  return { mode: 'UNKNOWN' as const };
}
export async function createPollinationAttemptAction(
  plantId: string,
  inflorescenceId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      createPollinationAttempt(inflorescenceId, {
        pollinatedOn: value(formData, 'pollinatedOn'),
        pollenSource: pollenSource(formData),
        notes: optional(value(formData, 'notes')),
      }),
    'Pollination recorded.',
  );
}
export async function changePollinationAttemptStatusAction(
  plantId: string,
  attemptId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      changePollinationAttemptStatus(attemptId, {
        status: value(formData, 'status') as never,
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Pollination status updated.',
  );
}
export async function correctPollinationAttemptAction(
  plantId: string,
  attemptId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      correctPollinationAttempt(attemptId, {
        pollinatedOn: optional(value(formData, 'pollinatedOn')),
        pollenSource: formData.has('pollenSourceMode') ? pollenSource(formData) : undefined,
        notes: optional(value(formData, 'notes')),
        status: optional(value(formData, 'status')) as never,
        correctionReason: value(formData, 'correctionReason'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Pollination correction saved.',
  );
}
export async function voidPollinationAttemptAction(
  plantId: string,
  attemptId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      voidPollinationAttempt(attemptId, {
        correctionReason: value(formData, 'correctionReason'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Pollination voided. It remains in history.',
  );
}

export async function recordSeedBatchHarvestAction(
  plantId: string,
  attemptId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      recordSeedBatchHarvest(attemptId, {
        harvestedOn: value(formData, 'harvestedOn'),
        seedCount: optionalNumber(value(formData, 'seedCount')),
        notes: optional(value(formData, 'notes')),
        expectedPollinationUpdatedAt: value(formData, 'expectedPollinationUpdatedAt'),
      }),
    'Seed harvest recorded.',
  );
}
export async function recordSeedBatchSowingAction(
  plantId: string,
  batchId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      recordSeedBatchSowing(batchId, {
        sownOn: value(formData, 'sownOn'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Sowing recorded.',
  );
}
export async function recordSeedBatchGerminationAction(
  plantId: string,
  batchId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      recordSeedBatchGermination(batchId, {
        germinatedCount: Number(value(formData, 'germinatedCount')),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'Germination progress updated.',
  );
}
export async function closeSeedBatchAction(
  plantId: string,
  batchId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      closeSeedBatch(batchId, {
        status: value(formData, 'status') as never,
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'SeedBatch outcome recorded.',
  );
}
export async function correctSeedBatchAction(
  plantId: string,
  batchId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      correctSeedBatch(batchId, {
        harvestedOn: optional(value(formData, 'harvestedOn')),
        sownOn: optional(value(formData, 'sownOn')),
        seedCount: optionalNumber(value(formData, 'seedCount')),
        germinatedCount: optionalNumber(value(formData, 'germinatedCount')),
        notes: optional(value(formData, 'notes')),
        status: optional(value(formData, 'status')) as never,
        correctionReason: value(formData, 'correctionReason'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'SeedBatch correction saved.',
  );
}
export async function voidSeedBatchAction(
  plantId: string,
  batchId: string,
  _previous: BreedingActionState,
  formData: FormData,
) {
  return run(
    plantId,
    () =>
      voidSeedBatch(batchId, {
        correctionReason: value(formData, 'correctionReason'),
        expectedUpdatedAt: value(formData, 'expectedUpdatedAt'),
      }),
    'SeedBatch voided. It remains in history.',
  );
}
