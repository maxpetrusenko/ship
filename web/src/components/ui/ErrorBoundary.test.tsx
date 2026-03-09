import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function CrashingChild(): JSX.Element {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('announces the default fallback as an alert', () => {
    // Risk mitigated: section crashes must be announced to assistive tech instead of silently replacing content.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <CrashingChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
  });

  it('lets the user retry after a render crash', () => {
    // Risk mitigated: a transient render failure should provide a recoverable path instead of a dead-end UI.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldCrash = true;

    function SometimesCrashes(): JSX.Element {
      if (shouldCrash) {
        throw new Error('boom');
      }
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <SometimesCrashes />
      </ErrorBoundary>
    );

    shouldCrash = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});
