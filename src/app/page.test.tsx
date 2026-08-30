import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('shows the dashboard as the current nursery overview', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Nursery overview')).toBeInTheDocument();
    expect(screen.getByText(/daily view of the nursery, with useful totals/i)).toBeInTheDocument();
  });
});
