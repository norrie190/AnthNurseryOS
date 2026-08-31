// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import {
  createEquipment,
  updateEquipment,
  archiveEquipment,
  restoreEquipment,
} from './equipment-service';
import { createEquipmentAction, updateEquipmentAction } from './equipment-actions';
import { archiveEquipmentAction, restoreEquipmentAction } from './equipment-archive-actions';
import { parseEquipmentCreateForm, parseEquipmentEditForm } from './equipment-form-data';
import { initialEquipmentFormState } from './equipment-form-state';
import { EquipmentError } from './equipment-errors';
import { parseCreateEquipmentInput } from './equipment-input';

vi.mock('server-only', () => ({}));
vi.mock('./equipment-service', () => ({
  createEquipment: vi.fn(),
  updateEquipment: vi.fn(),
  archiveEquipment: vi.fn(),
  restoreEquipment: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
const id = 'ba576170-0776-4f0e-90d9-353cc6518611';
const token = '2026-08-31T12:00:00.000Z';
const redirected = new Error('Redirect signal');
function data(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redirect).mockImplementation(() => {
    throw redirected;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test.each(['true', 'false'])(
  'creates with explicit power %s and redirects by internal UUID',
  async (usesPower) => {
    vi.mocked(createEquipment).mockResolvedValue({ id } as Awaited<
      ReturnType<typeof createEquipment>
    >);
    await expect(
      createEquipmentAction(initialEquipmentFormState, data({ name: 'Light', usesPower })),
    ).rejects.toBe(redirected);
    expect(createEquipment).toHaveBeenCalledWith({
      name: 'Light',
      usesPower: usesPower === 'true',
    });
    expect(redirect).toHaveBeenCalledWith(`/equipment/${id}`);
  },
);
test.each(['', 'on', 'yes', '0'])('does not coerce invalid power choice %s', async (usesPower) => {
  const result = await createEquipmentAction(
    initialEquipmentFormState,
    data({ name: 'Light', usesPower }),
  );
  expect(result.fieldErrors.usesPower).toBe('Choose Yes or No.');
  expect(createEquipment).not.toHaveBeenCalled();
});
test.each([
  ['125', 12500],
  ['125.50', 12550],
  ['0', 0],
  ['0.00', 0],
  ['', null],
])('converts GBP %s exactly', (value, expected) => {
  expect(
    parseEquipmentCreateForm(
      data({
        name: 'Light',
        usesPower: 'true',
        recordPurchase: 'on',
        currency: 'GBP',
        equipmentPrice: value,
      }),
    ),
  ).toMatchObject({ success: true, input: { purchase: { equipmentPriceMinor: expected } } });
});
test.each([
  ['JPY', '12', 12],
  ['KWD', '1.125', 1125],
])('uses runtime precision for %s', (currency, value, expected) => {
  expect(
    parseEquipmentCreateForm(
      data({
        name: 'Light',
        usesPower: 'false',
        recordPurchase: 'on',
        currency,
        equipmentPrice: value,
      }),
    ),
  ).toMatchObject({ success: true, input: { purchase: { equipmentPriceMinor: expected } } });
});
test.each(['-1', '1.001', '1e2', '£12', '1,000', 'Infinity'])(
  'rejects invalid decimal %s before service',
  async (equipmentPrice) => {
    const result = await createEquipmentAction(
      initialEquipmentFormState,
      data({
        name: 'Light',
        usesPower: 'true',
        recordPurchase: 'on',
        currency: 'GBP',
        equipmentPrice,
      }),
    );
    expect(result.fieldErrors.equipmentPrice).toBeTruthy();
    expect(createEquipment).not.toHaveBeenCalled();
  },
);
test('reads all purchase fields and preserves allocated shipping independently', () => {
  expect(
    parseEquipmentCreateForm(
      data({
        name: 'Fan',
        usesPower: 'true',
        category: 'Extraction Fan',
        locationId: id,
        recordPurchase: 'on',
        seller: 'Seller',
        orderReference: 'Order',
        purchaseDate: '2026-08-13',
        currency: 'gbp',
        equipmentPrice: '50',
        shippingCost: '2.50',
        otherCost: '',
      }),
    ),
  ).toEqual({
    success: true,
    input: {
      name: 'Fan',
      usesPower: true,
      category: 'Extraction Fan',
      locationId: id,
      purchase: {
        seller: 'Seller',
        orderReference: 'Order',
        purchaseDate: '2026-08-13',
        currency: 'GBP',
        equipmentPriceMinor: 5000,
        shippingCostMinor: 250,
        otherCostMinor: null,
      },
    },
  });
});
test('omitted edit fields stay omitted; empty nullable text is normalised by the service', () => {
  expect(parseEquipmentEditForm(data({ name: 'New' }), token)).toEqual({
    success: true,
    input: { name: 'New', expectedUpdatedAt: token },
  });
  expect(
    parseEquipmentEditForm(
      data({
        locationId: '',
        brand: '',
        recordPurchase: 'on',
        purchaseDate: '',
        shippingCost: '',
        otherCost: '0',
        currency: 'GBP',
      }),
      token,
    ),
  ).toMatchObject({
    success: true,
    input: {
      locationId: null,
      brand: '',
      purchase: { purchaseDate: null, shippingCostMinor: null, otherCostMinor: 0 },
    },
  });
});
test('unchecked purchase is untouched; an explicit empty section creates an unknown purchase', () => {
  expect(
    parseEquipmentEditForm(data({ seller: 'Inactive', equipmentPrice: 'bad' }), token),
  ).toEqual({ success: true, input: { expectedUpdatedAt: token } });
  expect(parseEquipmentEditForm(data({ recordPurchase: 'on' }), token)).toEqual({
    success: true,
    input: { expectedUpdatedAt: token, purchase: {} },
  });
});
test('does not assume currency for a partial money patch', () => {
  expect(
    parseEquipmentEditForm(data({ recordPurchase: 'on', equipmentPrice: '10' }), token),
  ).toMatchObject({ success: false, state: { fieldErrors: { currency: expect.any(String) } } });
});
test.each([
  'id',
  'reference',
  'createdAt',
  'archivedAt',
  'purchase',
  'location',
  'expectedUpdatedAt',
])('rejects browser injection %s', async (key) => {
  const result = await createEquipmentAction(
    initialEquipmentFormState,
    data({ name: 'A', usesPower: 'true', [key]: 'bad' }),
  );
  expect(result.message).toContain('unsupported');
  expect(createEquipment).not.toHaveBeenCalled();
});
test('rejects duplicate values and file fields; ignores Next metadata', () => {
  const duplicate = data({ name: 'A', usesPower: 'true' });
  duplicate.append('name', 'B');
  expect(parseEquipmentCreateForm(duplicate)).toMatchObject({ success: false });
  const file = data({ name: 'A', usesPower: 'true' });
  file.set('notes', new Blob(['hello']), 'note.txt');
  expect(parseEquipmentCreateForm(file)).toMatchObject({ success: false });
  expect(
    parseEquipmentCreateForm(data({ name: 'A', usesPower: 'true', $ACTION_ID_x: 'framework' })),
  ).toEqual({ success: true, input: { name: 'A', usesPower: true } });
});
test('delegates category normalisation and custom names to Equipment validation', () => {
  for (const [category, expected] of [
    ['grow light', 'Grow Light'],
    ['Propagation Tools', 'Propagation Tools'],
  ]) {
    const parsed = parseEquipmentCreateForm(data({ name: 'Item', usesPower: 'false', category }));
    if (!parsed.success) throw new Error('Expected parse success');
    expect(parseCreateEquipmentInput(parsed.input)).toMatchObject({
      category: expected,
      usesPower: false,
    });
  }
});
test('maps service field errors to form fields', async () => {
  vi.mocked(createEquipment).mockRejectedValue(
    new EquipmentError('VALIDATION_FAILED', 'Check details.', {
      issues: [
        { field: 'purchase.equipmentPriceMinor', message: 'Amount too large.' },
        { field: 'locationId', message: 'Unavailable.' },
      ],
    }),
  );
  expect(
    await createEquipmentAction(initialEquipmentFormState, data({ name: 'A', usesPower: 'true' })),
  ).toMatchObject({
    fieldErrors: { equipmentPrice: 'Amount too large.', locationId: 'Unavailable.' },
  });
});
test('update forwards the bound original token and redirects after success', async () => {
  vi.mocked(updateEquipment).mockResolvedValue({ id } as Awaited<
    ReturnType<typeof updateEquipment>
  >);
  await expect(
    updateEquipmentAction(id, token, initialEquipmentFormState, data({ notes: '' })),
  ).rejects.toBe(redirected);
  expect(updateEquipment).toHaveBeenCalledWith(id, { expectedUpdatedAt: token, notes: '' });
  expect(redirect).toHaveBeenCalledWith(`/equipment/${id}`);
});
test('stale update is returned safely without redirect or retry', async () => {
  vi.mocked(updateEquipment).mockRejectedValue(
    new EquipmentError('STALE_UPDATE', 'Review the latest details.'),
  );
  expect(
    await updateEquipmentAction(id, token, initialEquipmentFormState, data({ name: 'New' })),
  ).toMatchObject({ stale: true, message: 'Review the latest details.' });
  expect(updateEquipment).toHaveBeenCalledOnce();
  expect(redirect).not.toHaveBeenCalled();
});
test.each([
  new Error('secret database detail'),
  new EquipmentError('CONFLICT', 'secret database detail'),
])('hides unexpected and conflict diagnostics', async (error) => {
  vi.mocked(createEquipment).mockRejectedValue(error);
  vi.mocked(updateEquipment).mockRejectedValue(error);
  const results = [
    await createEquipmentAction(initialEquipmentFormState, data({ name: 'A', usesPower: 'true' })),
    await updateEquipmentAction(id, token, initialEquipmentFormState, data({ name: 'B' })),
  ];
  for (const result of results) {
    expect(result.message).not.toContain('secret');
    expect(result.message).toContain('could not confirm');
  }
});
test('archive requires a single explicit confirmation', async () => {
  expect((await archiveEquipmentAction(id, token, data())).success).toBe(false);
  const duplicate = data({ confirmation: 'archive' });
  duplicate.append('confirmation', 'archive');
  expect((await archiveEquipmentAction(id, token, duplicate)).success).toBe(false);
  expect(
    (await archiveEquipmentAction(id, token, data({ confirmation: 'archive', reference: 'EQP' })))
      .success,
  ).toBe(false);
  expect(archiveEquipment).not.toHaveBeenCalled();
});
test.each([true, false])('archive/restore report changed=%s safely', async (changed) => {
  vi.mocked(archiveEquipment).mockResolvedValue({ changed } as Awaited<
    ReturnType<typeof archiveEquipment>
  >);
  vi.mocked(restoreEquipment).mockResolvedValue({ changed } as Awaited<
    ReturnType<typeof restoreEquipment>
  >);
  expect(await archiveEquipmentAction(id, token, data({ confirmation: 'archive' }))).toMatchObject({
    success: true,
  });
  expect(await restoreEquipmentAction(id, token, data())).toMatchObject({ success: true });
  expect(archiveEquipment).toHaveBeenCalledWith(id, { expectedUpdatedAt: token });
  expect(restoreEquipment).toHaveBeenCalledWith(id, { expectedUpdatedAt: token });
});
test('archive handles stale/not found/infrastructure errors and rejects restore extra fields', async () => {
  for (const code of ['STALE_UPDATE', 'NOT_FOUND'] as const) {
    vi.mocked(archiveEquipment).mockRejectedValue(new EquipmentError(code, 'Safe message'));
    expect(
      await archiveEquipmentAction(id, token, data({ confirmation: 'archive' })),
    ).toMatchObject({ success: false, message: 'Safe message' });
  }
  vi.mocked(restoreEquipment).mockRejectedValue(new Error('secret'));
  expect((await restoreEquipmentAction(id, token, data())).message).not.toContain('secret');
  expect((await restoreEquipmentAction(id, token, data({ archivedAt: '' }))).success).toBe(false);
});
