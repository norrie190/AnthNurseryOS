import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { archiveEquipmentAction, restoreEquipmentAction } from '../equipment-archive-actions';
import { EquipmentArchiveControls } from './equipment-archive-controls';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../equipment-archive-actions', () => ({
  archiveEquipmentAction: vi.fn(),
  restoreEquipmentAction: vi.fn(),
}));
const props = {
  equipmentId: 'a8e64bb0-47ef-4a99-963c-aef88aed09ea',
  reference: 'EQP-0001',
  archived: false,
  expectedUpdatedAt: '2026-08-31T12:00:00.000Z',
};
beforeEach(() => vi.resetAllMocks());

test('requires explicit confirmation and lets Cancel return focus without a write', async () => {
  const user = userEvent.setup();
  render(<EquipmentArchiveControls {...props} />);
  expect(screen.queryByRole('button', { name: 'Restore Equipment' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive Equipment' }));
  expect(screen.getByRole('group', { name: 'Archive EQP-0001?' })).toBeInTheDocument();
  expect(screen.getByText(/This does not delete the Equipment/)).toHaveTextContent(
    /historical data stays intact.*restore it later/,
  );
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(archiveEquipmentAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Archive Equipment' })).toHaveFocus();
  expect(archiveEquipmentAction).not.toHaveBeenCalled();
});

test('confirms archive, reports success and refreshes the saved detail state', async () => {
  const user = userEvent.setup();
  vi.mocked(archiveEquipmentAction).mockResolvedValue({
    success: true,
    message: 'Equipment archived. Its details are preserved.',
  });
  const { rerender } = render(<EquipmentArchiveControls {...props} />);
  await user.click(screen.getByRole('button', { name: 'Archive Equipment' }));
  await user.click(screen.getByRole('button', { name: 'Confirm Archive' }));
  expect(archiveEquipmentAction).toHaveBeenCalledOnce();
  const [id, timestamp, data] = vi.mocked(archiveEquipmentAction).mock.calls[0];
  expect(id).toBe(props.equipmentId);
  expect(timestamp).toBe(props.expectedUpdatedAt);
  expect([...data.entries()]).toEqual([['confirmation', 'archive']]);
  expect(await screen.findByRole('status')).toHaveTextContent('Equipment archived.');
  expect(refresh).toHaveBeenCalledOnce();
  rerender(
    <EquipmentArchiveControls {...props} archived expectedUpdatedAt="2026-08-31T12:00:01.000Z" />,
  );
  expect(screen.getByRole('button', { name: 'Restore Equipment' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveFocus();
});

test('shows pending archive state and blocks ordinary duplicate submission', async () => {
  const user = userEvent.setup();
  let finish!: (value: { success: boolean; message: string }) => void;
  vi.mocked(archiveEquipmentAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<EquipmentArchiveControls {...props} />);
  await user.click(screen.getByRole('button', { name: 'Archive Equipment' }));
  const form = screen.getByRole('button', { name: 'Confirm Archive' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Archiving Equipment…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(archiveEquipmentAction).toHaveBeenCalledOnce();
  await act(async () => finish({ success: true, message: 'Equipment archived.' }));
});

test('restores without an archive warning, with pending and success feedback', async () => {
  const user = userEvent.setup();
  let finish!: (value: { success: boolean; message: string }) => void;
  vi.mocked(restoreEquipmentAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<EquipmentArchiveControls {...props} archived />);
  expect(
    screen.getByText(/Its details and historical relationships remain available/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Restore Equipment' }));
  expect(screen.getByRole('button', { name: 'Restoring Equipment…' })).toBeDisabled();
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(archiveEquipmentAction).not.toHaveBeenCalled();
  expect(restoreEquipmentAction).toHaveBeenCalledWith(
    props.equipmentId,
    props.expectedUpdatedAt,
    expect.any(FormData),
  );
  await act(async () =>
    finish({ success: true, message: 'Equipment restored. It is back in your active collection.' }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('Equipment restored.');
  expect(refresh).toHaveBeenCalledOnce();
});

test('retains a stale confirmation and its original token instead of silently retrying', async () => {
  const user = userEvent.setup();
  vi.mocked(archiveEquipmentAction).mockResolvedValue({
    success: false,
    message: 'This Equipment has changed.',
    stale: true,
  });
  const { rerender } = render(<EquipmentArchiveControls {...props} />);
  await user.click(screen.getByRole('button', { name: 'Archive Equipment' }));
  rerender(<EquipmentArchiveControls {...props} expectedUpdatedAt="2026-08-31T12:00:02.000Z" />);
  await user.click(screen.getByRole('button', { name: 'Confirm Archive' }));
  expect(archiveEquipmentAction).toHaveBeenCalledWith(
    props.equipmentId,
    props.expectedUpdatedAt,
    expect.any(FormData),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('This Equipment has changed.');
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Reload Equipment details' })).toHaveAttribute(
    'href',
    `/equipment/${props.equipmentId}`,
  );
  expect(screen.getByRole('group')).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
});

test('does not expose technical details when the action transport fails', async () => {
  const user = userEvent.setup();
  vi.mocked(restoreEquipmentAction).mockRejectedValue(new Error('private connection secret'));
  render(<EquipmentArchiveControls {...props} archived />);
  await user.click(screen.getByRole('button', { name: 'Restore Equipment' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Reload the Equipment details'),
  );
  expect(screen.queryByText(/private connection/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Equipment' })).toBeEnabled();
  expect(refresh).not.toHaveBeenCalled();
});
