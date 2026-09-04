import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state';
import { StatusBadge } from './status-badge';
import { FormSection } from './form-section';
import { InlineNotice } from './inline-notice';

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

  it('preserves semantic form grouping and notice roles', () => {
    render(
      <FormSection title="Details" description={<p>Helpful context.</p>}>
        <label htmlFor="name">Name</label>
        <input id="name" />
      </FormSection>,
    );
    expect(screen.getByRole('group', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    const { rerender } = render(
      <InlineNotice variant="success" role="status">
        Saved.
      </InlineNotice>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    rerender(
      <InlineNotice variant="error" role="alert">
        Fix this.
      </InlineNotice>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Fix this.');
  });
});
