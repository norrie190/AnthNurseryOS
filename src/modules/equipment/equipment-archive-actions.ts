'use server';

import { archiveEquipment, restoreEquipment } from './equipment-service';
import { EquipmentError } from './equipment-errors';

export type EquipmentArchiveActionResult = { success: boolean; message: string; stale?: boolean };

export async function archiveEquipmentAction(
  equipmentId: string,
  expectedUpdatedAt: string,
  formData: FormData,
): Promise<EquipmentArchiveActionResult> {
  return changeArchiveAction(equipmentId, expectedUpdatedAt, formData, true);
}

export async function restoreEquipmentAction(
  equipmentId: string,
  expectedUpdatedAt: string,
  formData: FormData,
): Promise<EquipmentArchiveActionResult> {
  return changeArchiveAction(equipmentId, expectedUpdatedAt, formData, false);
}

async function changeArchiveAction(
  equipmentId: string,
  expectedUpdatedAt: string,
  formData: FormData,
  archived: boolean,
): Promise<EquipmentArchiveActionResult> {
  if (!(formData instanceof FormData)) {
    return {
      success: false,
      message: 'The Equipment request was invalid. Reload its detail page and try again.',
    };
  }
  for (const key of formData.keys()) {
    if (!key.startsWith('$ACTION_') && !(archived && key === 'confirmation')) {
      return {
        success: false,
        message:
          'The request contained unsupported fields. Reload the Equipment details and try again.',
      };
    }
  }
  if (archived) {
    const confirmation = formData.getAll('confirmation');
    if (confirmation.length !== 1 || confirmation[0] !== 'archive') {
      return { success: false, message: 'Confirm that you want to archive this Equipment.' };
    }
  }
  try {
    const result = await (archived ? archiveEquipment : restoreEquipment)(equipmentId, {
      expectedUpdatedAt,
    });
    return {
      success: true,
      message: archived
        ? result.changed
          ? 'Equipment archived. Its details are preserved and it can be restored later.'
          : 'This Equipment is already archived. Its original archive date has been kept.'
        : result.changed
          ? 'Equipment restored. It is back in your active collection.'
          : 'This Equipment is already in your active collection.',
    };
  } catch (error) {
    if (error instanceof EquipmentError && error.code !== 'CONFLICT') {
      return {
        success: false,
        message: error.message,
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      };
    }
    console.error('Equipment archive/restore failed', error);
    return {
      success: false,
      message:
        'We could not confirm the archive state was changed. Reload the Equipment details to check before trying again.',
    };
  }
}
