import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { archivePlantAction, restorePlantAction } from '../plant-archive-actions';
import { PlantArchiveControls } from './plant-archive-controls';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../plant-archive-actions', () => ({
  archivePlantAction: vi.fn(),
  restorePlantAction: vi.fn(),
}));
const props = {
  plantId: 'a8e64bb0-47ef-4a99-963c-aef88aed09ea',
  reference: 'ANT-0001',
  archived: false,
  expectedUpdatedAt: '2026-08-31T12:00:00.000Z',
};
beforeEach(() => vi.resetAllMocks());

test('requires explicit confirmation and lets Cancel return focus without a write', async () => {
  const user = userEvent.setup();
  render(<PlantArchiveControls {...props} />);
  expect(screen.queryByRole('button', { name: 'Restore Plant' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Archive Plant' }));
  expect(screen.getByRole('group', { name: 'Archive ANT-0001?' })).toBeInTheDocument();
  expect(screen.getByText(/This does not delete the Plant/)).toHaveTextContent(
    /historical data stays intact.*status stays the same.*restore it later/,
  );
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(archivePlantAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Archive Plant' })).toHaveFocus();
  expect(archivePlantAction).not.toHaveBeenCalled();
});

test('confirms archive, reports success and refreshes the saved detail state', async () => {
  const user = userEvent.setup();
  vi.mocked(archivePlantAction).mockResolvedValue({
    success: true,
    message: 'Plant archived. Its details are preserved.',
  });
  const { rerender } = render(<PlantArchiveControls {...props} />);
  await user.click(screen.getByRole('button', { name: 'Archive Plant' }));
  await user.click(screen.getByRole('button', { name: 'Confirm Archive' }));
  expect(archivePlantAction).toHaveBeenCalledOnce();
  const [id, timestamp, data] = vi.mocked(archivePlantAction).mock.calls[0];
  expect(id).toBe(props.plantId);
  expect(timestamp).toBe(props.expectedUpdatedAt);
  expect([...data.entries()]).toEqual([['confirmation', 'archive']]);
  expect(await screen.findByRole('status')).toHaveTextContent('Plant archived.');
  expect(refresh).toHaveBeenCalledOnce();
  rerender(
    <PlantArchiveControls {...props} archived expectedUpdatedAt="2026-08-31T12:00:01.000Z" />,
  );
  expect(screen.getByRole('button', { name: 'Restore Plant' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveFocus();
});

test('shows pending archive state and blocks ordinary duplicate submission', async () => {
  const user = userEvent.setup();
  let finish!: (value: { success: boolean; message: string }) => void;
  vi.mocked(archivePlantAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PlantArchiveControls {...props} />);
  await user.click(screen.getByRole('button', { name: 'Archive Plant' }));
  const form = screen.getByRole('button', { name: 'Confirm Archive' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Archiving Plant…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(archivePlantAction).toHaveBeenCalledOnce();
  await act(async () => finish({ success: true, message: 'Plant archived.' }));
});

test('restores without an archive warning, with pending and success feedback', async () => {
  const user = userEvent.setup();
  let finish!: (value: { success: boolean; message: string }) => void;
  vi.mocked(restorePlantAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PlantArchiveControls {...props} archived />);
  expect(
    screen.getByText(/Its details and historical relationships remain available/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Restore Plant' }));
  expect(screen.getByRole('button', { name: 'Restoring Plant…' })).toBeDisabled();
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(archivePlantAction).not.toHaveBeenCalled();
  expect(restorePlantAction).toHaveBeenCalledWith(
    props.plantId,
    props.expectedUpdatedAt,
    expect.any(FormData),
  );
  await act(async () =>
    finish({ success: true, message: 'Plant restored. It is back in your active collection.' }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('Plant restored.');
  expect(refresh).toHaveBeenCalledOnce();
});

test('retains a stale confirmation and its original token instead of silently retrying', async () => {
  const user = userEvent.setup();
  vi.mocked(archivePlantAction).mockResolvedValue({
    success: false,
    message: 'This Plant has changed.',
    stale: true,
  });
  const { rerender } = render(<PlantArchiveControls {...props} />);
  await user.click(screen.getByRole('button', { name: 'Archive Plant' }));
  rerender(<PlantArchiveControls {...props} expectedUpdatedAt="2026-08-31T12:00:02.000Z" />);
  await user.click(screen.getByRole('button', { name: 'Confirm Archive' }));
  expect(archivePlantAction).toHaveBeenCalledWith(
    props.plantId,
    props.expectedUpdatedAt,
    expect.any(FormData),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('This Plant has changed.');
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Reload Plant details' })).toHaveAttribute(
    'href',
    `/plants/${props.plantId}`,
  );
  expect(screen.getByRole('group')).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
});

test('does not expose technical details when the action transport fails', async () => {
  const user = userEvent.setup();
  vi.mocked(restorePlantAction).mockRejectedValue(new Error('private connection secret'));
  render(<PlantArchiveControls {...props} archived />);
  await user.click(screen.getByRole('button', { name: 'Restore Plant' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Reload the Plant details'),
  );
  expect(screen.queryByText(/private connection/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Plant' })).toBeEnabled();
  expect(refresh).not.toHaveBeenCalled();
});
