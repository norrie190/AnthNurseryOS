import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { AddPlantForm } from './add-plant-form';
import { createPlantAction } from '../plant-actions';
import type { PlantFormState } from '../plant-form-state';

vi.mock('../plant-actions', () => ({ createPlantAction: vi.fn() }));
const props = { parents: [], locations: [], currencies: ['GBP', 'EUR', 'JPY'] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createPlantAction).mockResolvedValue({ message: 'Check the form.', fieldErrors: {} });
});

test('works with no existing Plants or Locations and does not request identity fields', async () => {
  const user = userEvent.setup();
  render(<AddPlantForm {...props} />);
  expect(screen.getByText(/No Locations have been added/)).toBeInTheDocument();
  expect(
    screen
      .getAllByRole('radio', { name: 'Existing Plant' })
      .every((input) => (input as HTMLInputElement).disabled),
  ).toBe(true);
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('GROWING');
  expect(screen.getByText(/ANT reference will be assigned/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save Plant' }));
  await waitFor(() => expect(createPlantAction).toHaveBeenCalledOnce());
  const data = vi.mocked(createPlantAction).mock.calls[0][1];
  expect(data.get('name')).toBe('');
  expect(data.has('id')).toBe(false);
  expect(data.has('reference')).toBe(false);
  expect(data.has('recordPurchase')).toBe(false);
});

test('preserves entered values and focuses accessible errors after validation fails', async () => {
  vi.mocked(createPlantAction).mockResolvedValue({
    message: 'Check the highlighted fields.',
    fieldErrors: { plantPrice: 'Use at most two decimal places.' },
  });
  const user = userEvent.setup();
  render(<AddPlantForm {...props} />);
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'My real Plant');
  await user.click(screen.getByRole('checkbox', { name: 'Record purchase information' }));
  await user.type(screen.getByRole('textbox', { name: 'Plant price (GBP)' }), '125.555');
  await user.click(screen.getByRole('button', { name: 'Save Plant' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('My real Plant');
  expect(screen.getByRole('checkbox', { name: 'Record purchase information' })).toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveValue('125.555');
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByRole('link', { name: /Plant price: Use at most/ })).toHaveAttribute(
    'href',
    '#plant-plantPrice',
  );
  await user.click(screen.getByRole('link', { name: /Plant price: Use at most/ }));
  expect(screen.getByRole('textbox', { name: 'Plant price (GBP)' })).toHaveFocus();
});

test('keeps inactive parent text locally but submits only the active mode', async () => {
  const user = userEvent.setup();
  render(
    <AddPlantForm
      {...props}
      parents={[{ id: 'parent-id', label: 'ANT-0004 — HURC (Archived)' }]}
    />,
  );
  const seed = within(screen.getByRole('group', { name: 'Seed parent' }));
  await user.click(seed.getByRole('radio', { name: 'External name' }));
  await user.type(seed.getByRole('textbox', { name: 'External seed parent name' }), 'External');
  await user.click(seed.getByRole('radio', { name: 'Existing Plant' }));
  await user.selectOptions(
    seed.getByRole('combobox', { name: 'Existing seed parent' }),
    'parent-id',
  );
  await user.click(screen.getByRole('button', { name: 'Save Plant' }));
  await waitFor(() => expect(createPlantAction).toHaveBeenCalledOnce());
  const data = vi.mocked(createPlantAction).mock.calls[0][1];
  expect(data.get('seedParentPlantId')).toBe('parent-id');
  expect(data.has('seedParentName')).toBe(false);
  expect(seed.getByRole('radio', { name: 'Existing Plant' })).toBeChecked();
  await user.click(seed.getByRole('radio', { name: 'External name' }));
  expect(seed.getByRole('textbox', { name: 'External seed parent name' })).toHaveValue('External');
});

test('preserves purchase details when toggled off but omits them from submission', async () => {
  const user = userEvent.setup();
  render(<AddPlantForm {...props} />);
  await user.click(screen.getByRole('checkbox', { name: 'Record purchase information' }));
  await user.type(screen.getByRole('textbox', { name: 'Seller' }), 'Nursery');
  await user.click(screen.getByRole('checkbox', { name: 'Record purchase information' }));
  await user.click(screen.getByRole('button', { name: 'Save Plant' }));
  await waitFor(() => expect(createPlantAction).toHaveBeenCalledOnce());
  expect(vi.mocked(createPlantAction).mock.calls[0][1].has('seller')).toBe(false);
  await user.click(screen.getByRole('checkbox', { name: 'Record purchase information' }));
  expect(screen.getByRole('textbox', { name: 'Seller' })).toHaveValue('Nursery');
});

test('shows pending feedback and blocks ordinary repeated submissions', async () => {
  let complete!: (state: PlantFormState) => void;
  vi.mocked(createPlantAction).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const { container } = render(<AddPlantForm {...props} />);
  const form = container.querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Saving Plant…' })).toBeDisabled());
  expect(createPlantAction).toHaveBeenCalledOnce();
  expect(screen.getByRole('textbox', { name: /^Name/ })).toBeDisabled();
  await act(async () => complete({ message: 'A safe server error.', fieldErrors: {} }));
  expect(screen.getByRole('button', { name: 'Save Plant' })).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('A safe server error.');
});
