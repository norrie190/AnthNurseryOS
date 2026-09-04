import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state';
import { StatusBadge } from './status-badge';

describe('shared visual primitives', () => {
  it('keeps status meaning in accessible text while applying a semantic variant', () => {
    render(<StatusBadge variant="success">Growing</StatusBadge>);

    expect(screen.getByText('Growing')).toBeInTheDocument();
  });

  it('supports a simple empty state with an optional action', () => {
    render(<EmptyState title="No Plants" description="Add your first Plant." />);

    expect(screen.getByRole('heading', { name: 'No Plants' })).toBeInTheDocument();
    expect(screen.getByText('Add your first Plant.')).toBeInTheDocument();
  });
});
