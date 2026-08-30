import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import PlantErrorPage from './error';

test('offers a safe retry for read failures', async () => {
  const reset = vi.fn();
  render(<PlantErrorPage reset={reset} />);
  expect(screen.getByRole('heading')).toHaveTextContent('We could not load this Plant page');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try loading again' }));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Back to Plants' })).toHaveAttribute('href', '/plants');
});
