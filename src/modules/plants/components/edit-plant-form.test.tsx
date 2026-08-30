import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { EditPlantForm } from './edit-plant-form';
import { updatePlantAction } from '../plant-actions';
import { initialPlantFormValues, type PlantFormState } from '../plant-form-state';

vi.mock('../plant-actions', () => ({ updatePlantAction: vi.fn() }));
const props = {
  plantId: 'plant-id',
  reference: 'ANT-0001',
  expectedUpdatedAt: '2026-08-30T12:00:00.000Z',
  parents: [{ id: 'parent-id', label: 'ANT-0002 — Parent (Archived)' }],
  locations: [{ id: 'location-id', label: 'Top Shelf (archived, current Location)' }],
  currencies: ['GBP', 'EUR'],
  initialValues: {
    ...initialPlantFormValues,
    name: 'Original',
    status: 'QUARANTINE',
    locationId: 'location-id',
    notes: 'Notes',
    seedParentMode: 'existing',
    seedParentPlantId: 'parent-id',
    pollenParentMode: 'external',
    pollenParentName: 'External',
    recordPurchase: 'on',
    seller: 'Seller',
    orderReference: 'ORDER',
    purchaseDate: '2026-08-13',
    plantPrice: '50.00',
    shippingCost: '',
    otherCost: '0.00',
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updatePlantAction).mockResolvedValue({
    message: 'Check your details.',
    fieldErrors: {},
  });
});
test('prefills the fields, keeps identity immutable and does not offer purchase deletion', () => {
  const { container } = render(<EditPlantForm {...props} />);
  expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Original');
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('QUARANTINE');
  expect(screen.getByRole('combobox', { name: /Location/ })).toHaveValue('location-id');
  expect(screen.getByRole('option', { name: /archived, current Location/ })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Notes (optional)' })).toHaveValue('Notes');
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveValue('50.00');
  expect(screen.getByRole('textbox', { name: 'Shipping cost (GBP)' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Other cost (GBP)' })).toHaveValue('0.00');
  expect(screen.getByLabelText('Purchase date')).toHaveValue('2026-08-13');
  expect(
    screen.queryByRole('checkbox', { name: 'Record purchase information' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/reference ANT-0001 will stay/)).toBeInTheDocument();
  expect(
    container.querySelector('[name="id"], [name="reference"], [name="archivedAt"]'),
  ).toBeNull();
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/plants/plant-id');
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
});
test('can record a purchase when none exists and works without parent/Location options', async () => {
  const user = userEvent.setup();
  render(
    <EditPlantForm {...props} parents={[]} locations={[]} initialValues={initialPlantFormValues} />,
  );
  expect(screen.getByText(/No Locations have been added/)).toBeInTheDocument();
  expect(
    screen
      .getAllByRole('radio', { name: 'Existing Plant' })
      .every((radio) => (radio as HTMLInputElement).disabled),
  ).toBe(true);
  await user.click(screen.getByRole('checkbox', { name: 'Record purchase information' }));
  await user.type(screen.getByRole('textbox', { name: 'Plant price (GBP)' }), '125.50');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(updatePlantAction).toHaveBeenCalledOnce());
  const [id, token, , data] = vi.mocked(updatePlantAction).mock.calls[0];
  expect(id).toBe(props.plantId);
  expect(token).toBe(props.expectedUpdatedAt);
  expect(data.get('plantPrice')).toBe('125.50');
  expect(data.get('recordPurchase')).toBe('on');
});
test('parent mode changes submit only active controls and allow intentional clearing', async () => {
  const user = userEvent.setup();
  render(<EditPlantForm {...props} />);
  const seed = within(screen.getByRole('group', { name: 'Seed parent' }));
  await user.click(seed.getByRole('radio', { name: 'External name' }));
  await user.type(seed.getByRole('textbox', { name: 'External seed parent name' }), 'Replacement');
  await user.click(
    within(screen.getByRole('group', { name: 'Pollen parent' })).getByRole('radio', {
      name: 'Unknown',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(updatePlantAction).toHaveBeenCalledOnce());
  const data = vi.mocked(updatePlantAction).mock.calls[0][3];
  expect(data.get('seedParentName')).toBe('Replacement');
  expect(data.has('seedParentPlantId')).toBe(false);
  expect(data.get('pollenParentMode')).toBe('unknown');
  expect(data.has('pollenParentName')).toBe(false);
});
test('retains edited values and focuses field errors after validation fails', async () => {
  vi.mocked(updatePlantAction).mockResolvedValue({
    message: 'Check the amount.',
    fieldErrors: { plantPrice: 'Too many decimal places.' },
  });
  const user = userEvent.setup();
  render(<EditPlantForm {...props} />);
  await user.clear(screen.getByRole('textbox', { name: /^Name/ }));
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Edited name');
  await user.clear(screen.getByRole('textbox', { name: 'Plant price (GBP)' }));
  await user.type(screen.getByRole('textbox', { name: 'Plant price (GBP)' }), '50.555');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Edited name');
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveValue('50.555');
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await user.click(screen.getByRole('link', { name: /Plant price: Too many/ }));
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveFocus();
});
test('a stale edit retains values and its original token even if server props refresh', async () => {
  vi.mocked(updatePlantAction).mockResolvedValue({
    message: 'Review the latest details.',
    fieldErrors: {},
    stale: true,
  });
  const user = userEvent.setup();
  const { rerender } = render(<EditPlantForm {...props} />);
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), ' changed');
  rerender(
    <EditPlantForm
      {...props}
      expectedUpdatedAt="2026-08-30T12:00:01.000Z"
      initialValues={{ ...props.initialValues, name: 'Other tab' }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Original changed');
  expect(vi.mocked(updatePlantAction).mock.calls[0][1]).toBe(props.expectedUpdatedAt);
  expect(screen.getByRole('link', { name: /View latest Plant details/ })).toHaveAttribute(
    'target',
    '_blank',
  );
  expect(updatePlantAction).toHaveBeenCalledOnce();
});
test('shows a saving state and prevents ordinary duplicate submissions', async () => {
  let complete!: (state: PlantFormState) => void;
  vi.mocked(updatePlantAction).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const { container } = render(<EditPlantForm {...props} />);
  fireEvent.submit(container.querySelector('form')!);
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Saving Changes…' })).toBeDisabled(),
  );
  expect(updatePlantAction).toHaveBeenCalledOnce();
  expect(screen.getByRole('textbox', { name: /^Name/ })).toBeDisabled();
  await act(async () => complete({ message: 'Could not confirm the save.', fieldErrors: {} }));
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm');
});
