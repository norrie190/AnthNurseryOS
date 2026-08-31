import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  archivePlantAction,
  restorePlantAction,
} from '../../src/modules/plants/plant-archive-actions';
import {
  archivePlant,
  restorePlant,
  type PlantArchiveResult,
} from '../../src/modules/plants/plant-archive-service';
import { PlantError } from '../../src/modules/plants/plant-errors';

vi.mock('../../src/modules/plants/plant-archive-service', () => ({
  archivePlant: vi.fn(),
  restorePlant: vi.fn(),
}));
const id = randomUUID();
const token = '2026-08-31T10:00:00.000Z';
function confirmation() {
  const data = new FormData();
  data.set('confirmation', 'archive');
  return data;
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
test('requires explicit archive confirmation without calling the service', async () => {
  expect(await archivePlantAction(id, token, new FormData())).toEqual({
    success: false,
    message: 'Confirm that you want to archive this Plant.',
  });
  expect(archivePlant).not.toHaveBeenCalled();
});
test.each(['restore', '', 'true'])('rejects incorrect confirmation %s', async (value) => {
  const data = new FormData();
  data.set('confirmation', value);
  expect((await archivePlantAction(id, token, data)).success).toBe(false);
  expect(archivePlant).not.toHaveBeenCalled();
});
test('rejects duplicate confirmation values and uploaded files', async () => {
  const duplicate = confirmation();
  duplicate.append('confirmation', 'archive');
  const file = new FormData();
  file.set('confirmation', new File(['archive'], 'archive.txt'));
  for (const data of [duplicate, file])
    expect((await archivePlantAction(id, token, data)).success).toBe(false);
  expect(archivePlant).not.toHaveBeenCalled();
});
test.each(['id', 'reference', 'status', 'archivedAt', 'delete', 'expectedUpdatedAt'])(
  'rejects injected browser field %s',
  async (field) => {
    const data = confirmation();
    data.set(field, 'injected');
    expect((await archivePlantAction(id, token, data)).success).toBe(false);
    expect((await restorePlantAction(id, token, data)).success).toBe(false);
    expect(archivePlant).not.toHaveBeenCalled();
    expect(restorePlant).not.toHaveBeenCalled();
  },
);
for (const [action, operation, data] of [
  [archivePlantAction, archivePlant, confirmation],
  [restorePlantAction, restorePlant, () => new FormData()],
] as const) {
  test.each([true, false])(action.name + ' reports success (changed: %s)', async (changed) => {
    vi.mocked(operation).mockResolvedValue({ changed } as PlantArchiveResult);
    const result = await action(id, token, data());
    expect(result.success).toBe(true);
    expect(result.message).toContain(changed ? 'Plant' : 'already');
    expect(operation).toHaveBeenCalledWith(id, { expectedUpdatedAt: token });
  });
  test.each(['NOT_FOUND', 'STALE_UPDATE', 'VALIDATION_FAILED'] as const)(
    action.name + ' returns safe %s feedback',
    async (code) => {
      vi.mocked(operation).mockRejectedValue(new PlantError(code, 'Safe message'));
      expect(await action(id, token, data())).toEqual({
        success: false,
        message: 'Safe message',
        ...(code === 'STALE_UPDATE' ? { stale: true } : {}),
      });
    },
  );
  test.each([new Error('secret SQL'), new PlantError('CONFLICT', 'secret constraint')])(
    action.name + ' does not expose technical diagnostics',
    async (error) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(operation).mockRejectedValue(error);
      const result = await action(id, token, data());
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(log).toHaveBeenCalledWith(expect.any(String), error);
    },
  );
}
