'use server';

import { archivePlant, restorePlant } from './plant-archive-service';
import { PlantError } from './plant-errors';

export type PlantArchiveActionResult = { success: boolean; message: string; stale?: boolean };

export async function archivePlantAction(
  plantId: string,
  expectedUpdatedAt: string,
  formData: FormData,
): Promise<PlantArchiveActionResult> {
  return changeArchiveAction(plantId, expectedUpdatedAt, formData, true);
}

export async function restorePlantAction(
  plantId: string,
  expectedUpdatedAt: string,
  formData: FormData,
): Promise<PlantArchiveActionResult> {
  return changeArchiveAction(plantId, expectedUpdatedAt, formData, false);
}

async function changeArchiveAction(
  plantId: string,
  expectedUpdatedAt: string,
  formData: FormData,
  archived: boolean,
): Promise<PlantArchiveActionResult> {
  if (!(formData instanceof FormData)) {
    return {
      success: false,
      message: 'The Plant request was invalid. Reload its detail page and try again.',
    };
  }
  for (const key of formData.keys()) {
    if (!key.startsWith('$ACTION_') && !(archived && key === 'confirmation')) {
      return {
        success: false,
        message:
          'The request contained unsupported fields. Reload the Plant details and try again.',
      };
    }
  }
  if (archived) {
    const confirmation = formData.getAll('confirmation');
    if (confirmation.length !== 1 || confirmation[0] !== 'archive') {
      return { success: false, message: 'Confirm that you want to archive this Plant.' };
    }
  }
  try {
    const result = await (archived ? archivePlant : restorePlant)(plantId, { expectedUpdatedAt });
    return {
      success: true,
      message: archived
        ? result.changed
          ? 'Plant archived. Its details are preserved and it can be restored later.'
          : 'This Plant is already archived. Its original archive date has been kept.'
        : result.changed
          ? 'Plant restored. It is back in your active collection.'
          : 'This Plant is already in your active collection.',
    };
  } catch (error) {
    if (error instanceof PlantError && error.code !== 'CONFLICT') {
      return {
        success: false,
        message: error.message,
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      };
    }
    console.error('Plant archive/restore failed', error);
    return {
      success: false,
      message:
        'We could not confirm the archive state was changed. Reload the Plant details to check before trying again.',
    };
  }
}
