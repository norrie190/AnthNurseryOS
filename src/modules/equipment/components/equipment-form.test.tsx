import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { EquipmentForm } from './equipment-form';
import { createEquipmentAction, updateEquipmentAction } from '../equipment-actions';
import { initialEquipmentFormValues, type EquipmentFormState } from '../equipment-form-state';

vi.mock('../equipment-actions', () => ({
  createEquipmentAction: vi.fn(),
  updateEquipmentAction: vi.fn(),
}));
const props = { locations: [], currencies: ['GBP', 'EUR', 'JPY'] };
const edit = {
  equipmentId: 'item-id',
  reference: 'EQP-0001',
  expectedUpdatedAt: '2026-08-31T12:00:00.000Z',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createEquipmentAction).mockResolvedValue({
    message: 'Check your details.',
    fieldErrors: {},
  });
  vi.mocked(updateEquipmentAction).mockResolvedValue({
    message: 'Check your details.',
    fieldErrors: {},
  });
});
test('new form has an unselected power choice, category suggestions and no identity inputs', () => {
  const { container } = render(<EquipmentForm {...props} />);
  expect(screen.getByLabelText('Track electricity use for this equipment')).toHaveValue('');
  expect(screen.getByLabelText('Category')).toHaveValue('Other');
  expect(container.querySelector('datalist option[value="Grow Light"]')).toBeInTheDocument();
  expect(screen.getByText(/No usable Locations/)).toBeInTheDocument();
  expect(screen.getByText(/EQP reference will be assigned/)).toBeInTheDocument();
  for (const field of ['id', 'reference', 'createdAt', 'archivedAt'])
    expect(container.querySelector(`[name="${field}"]`)).toBeNull();
});
test.each(['true', 'false'])(
  'submits the explicit power %s selection and selected Location',
  async (usesPower) => {
    const user = userEvent.setup();
    render(<EquipmentForm {...props} locations={[{ id: 'location', label: 'Tent / Shelf' }]} />);
    await user.type(screen.getByLabelText('Name'), 'My fan');
    await user.selectOptions(
      screen.getByLabelText('Track electricity use for this equipment'),
      usesPower,
    );
    await user.selectOptions(screen.getByLabelText('Location'), 'location');
    await user.click(screen.getByRole('button', { name: 'Create Equipment' }));
    await waitFor(() => expect(createEquipmentAction).toHaveBeenCalledOnce());
    const data = vi.mocked(createEquipmentAction).mock.calls[0][1];
    expect(data.get('name')).toBe('My fan');
    expect(data.get('usesPower')).toBe(usesPower);
    expect(data.get('locationId')).toBe('location');
    expect(data.has('recordPurchase')).toBe(false);
  },
);
test.each(['Grow Light', 'Propagation Tools'])(
  'accepts category %s without inferring power',
  async (category) => {
    const user = userEvent.setup();
    render(<EquipmentForm {...props} />);
    await user.clear(screen.getByLabelText('Category'));
    await user.type(screen.getByLabelText('Category'), category);
    expect(screen.getByLabelText('Track electricity use for this equipment')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Create Equipment' }));
    await waitFor(() => expect(createEquipmentAction).toHaveBeenCalledOnce());
    expect(vi.mocked(createEquipmentAction).mock.calls[0][1].get('category')).toBe(category);
  },
);
test('shows optional purchase, allocated shipping guidance and retains all entries on validation failure', async () => {
  vi.mocked(createEquipmentAction).mockResolvedValue({
    message: 'Check the amount.',
    fieldErrors: { equipmentPrice: 'Use two decimal places.' },
  });
  const user = userEvent.setup();
  render(<EquipmentForm {...props} />);
  await user.type(screen.getByLabelText('Name'), 'My light');
  await user.click(screen.getByLabelText('Record purchase information'));
  await user.type(screen.getByLabelText('Seller'), 'Shop');
  await user.type(screen.getByLabelText('Equipment price (£)'), '125.555');
  await user.type(screen.getByLabelText('Allocated shipping cost (£)'), '0');
  expect(screen.getByText(/not necessarily the full shipping cost/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Create Equipment' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByLabelText('Name')).toHaveValue('My light');
  expect(screen.getByLabelText('Seller')).toHaveValue('Shop');
  expect(screen.getByLabelText('Equipment price (£)')).toHaveValue('125.555');
  expect(screen.getByLabelText('Equipment price (£)')).toHaveAttribute('aria-invalid', 'true');
  const data = vi.mocked(createEquipmentAction).mock.calls[0][1];
  expect(data.get('shippingCost')).toBe('0');
  expect(data.get('otherCost')).toBe('');
  await user.click(screen.getByRole('link', { name: /Equipment price: Use two/ }));
  expect(screen.getByLabelText('Equipment price (£)')).toHaveFocus();
});
test('pending form blocks duplicate submissions and disables controls', async () => {
  let finish!: (state: EquipmentFormState) => void;
  vi.mocked(createEquipmentAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<EquipmentForm {...props} />);
  const form = screen.getByRole('button', { name: 'Create Equipment' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Saving Equipment…' })).toBeDisabled();
  expect(screen.getByLabelText('Name')).toBeDisabled();
  expect(createEquipmentAction).toHaveBeenCalledOnce();
  await act(async () => finish({ message: 'Try again.', fieldErrors: {} }));
  expect(screen.getByRole('button', { name: 'Create Equipment' })).toBeEnabled();
});
test('edit retains initial token across rerenders and keeps stale inputs visible', async () => {
  vi.mocked(updateEquipmentAction).mockResolvedValue({
    message: 'Equipment has changed.',
    fieldErrors: {},
    stale: true,
  });
  const user = userEvent.setup();
  const { rerender } = render(
    <EquipmentForm
      {...props}
      edit={edit}
      initialValues={{ ...initialEquipmentFormValues, name: 'Old', usesPower: 'false' }}
    />,
  );
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'My edit');
  rerender(
    <EquipmentForm
      {...props}
      edit={{ ...edit, expectedUpdatedAt: '2026-08-31T13:00:00.000Z' }}
      initialValues={{ ...initialEquipmentFormValues, name: 'New server name', usesPower: 'true' }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(updateEquipmentAction).toHaveBeenCalledWith(
    edit.equipmentId,
    edit.expectedUpdatedAt,
    expect.any(Object),
    expect.any(FormData),
  );
  expect(screen.getByLabelText('Name')).toHaveValue('My edit');
  expect(screen.getByRole('link', { name: /View latest Equipment/ })).toHaveAttribute(
    'href',
    '/equipment/item-id',
  );
});
test('existing purchase cannot be removed and archived current Location can be preserved or cleared', async () => {
  const user = userEvent.setup();
  render(
    <EquipmentForm
      {...props}
      edit={edit}
      locations={[{ id: 'archived', label: 'Old shelf (archived, current Location)' }]}
      initialValues={{
        ...initialEquipmentFormValues,
        name: 'Fan',
        usesPower: 'true',
        locationId: 'archived',
        brand: 'Brand',
        recordPurchase: 'on',
        seller: 'Seller',
        equipmentPrice: '0.00',
      }}
    />,
  );
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Location')).toHaveValue('archived');
  expect(screen.getByLabelText('Equipment price (£)')).toHaveValue('0.00');
  await user.clear(screen.getByLabelText('Brand'));
  await user.clear(screen.getByLabelText('Seller'));
  await user.selectOptions(screen.getByLabelText('Location'), '');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(updateEquipmentAction).toHaveBeenCalledOnce());
  const data = vi.mocked(updateEquipmentAction).mock.calls[0][3];
  expect(data.get('recordPurchase')).toBe('on');
  expect(data.get('brand')).toBe('');
  expect(data.get('seller')).toBe('');
  expect(data.get('locationId')).toBe('');
});
