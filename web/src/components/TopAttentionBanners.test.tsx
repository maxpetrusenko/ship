import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FleetGraphModalFeedItem } from '@ship/shared';
import { TopAttentionBanners } from './TopAttentionBanners';

function makeFleetGraphItem(overrides: Partial<FleetGraphModalFeedItem> = {}): FleetGraphModalFeedItem {
  return {
    alertId: 'alert-1',
    entityType: 'issue',
    entityId: 'issue-1',
    title: 'Stale issue: API rollout',
    signalType: 'stale_issue',
    severity: 'high',
    whatChanged: 'No updates in 6 days',
    whyThisMatters: 'Delivery risk is growing.',
    ownerLabel: null,
    nextDecision: null,
    explanation: null,
    reasoning: null,
    displayPriority: 10,
    isActionable: false,
    approval: null,
    createdAt: '2026-03-18T10:00:00Z',
    lastSurfacedAt: '2026-03-18T10:00:00Z',
    ...overrides,
  };
}

describe('TopAttentionBanners', () => {
  it('renders a single orange banner with the combined count when FleetGraph items exist', () => {
    render(
      <TopAttentionBanners
        accountabilityItemCount={2}
        accountabilityUrgency="overdue"
        fleetGraphItems={[makeFleetGraphItem()]}
        onAccountabilityClick={vi.fn()}
        onFleetGraphClick={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('3 items need attention.');
  });

  it('hides the FleetGraph banner when there are no FleetGraph items', () => {
    render(
      <TopAttentionBanners
        accountabilityItemCount={1}
        accountabilityUrgency="due_today"
        fleetGraphItems={[]}
        onAccountabilityClick={vi.fn()}
        onFleetGraphClick={vi.fn()}
      />,
    );

    expect(screen.getByText('1 accountability item is due today.')).toBeInTheDocument();
    expect(screen.queryByText(/FleetGraph finding/i)).not.toBeInTheDocument();
  });

  it('renders FleetGraph alone when accountability is empty', () => {
    render(
      <TopAttentionBanners
        accountabilityItemCount={0}
        accountabilityUrgency="overdue"
        fleetGraphItems={[makeFleetGraphItem({ alertId: 'alert-2', severity: 'medium' })]}
        onAccountabilityClick={vi.fn()}
        onFleetGraphClick={vi.fn()}
      />,
    );

    expect(screen.getByText('1 item needs attention.')).toBeInTheDocument();
    expect(screen.queryByText(/FleetGraph finding/i)).not.toBeInTheDocument();
  });

  it('uses the shared click handler when FleetGraph items are present', () => {
    const onFleetGraphClick = vi.fn();

    render(
      <TopAttentionBanners
        accountabilityItemCount={0}
        accountabilityUrgency="overdue"
        fleetGraphItems={[makeFleetGraphItem()]}
        onAccountabilityClick={vi.fn()}
        onFleetGraphClick={onFleetGraphClick}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onFleetGraphClick).toHaveBeenCalledTimes(1);
  });
});
