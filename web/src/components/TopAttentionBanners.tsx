import { AccountabilityBanner } from '@/components/AccountabilityBanner';
import type { FleetGraphModalFeedItem } from '@ship/shared';

interface TopAttentionBannersProps {
  accountabilityItemCount: number;
  accountabilityUrgency: 'overdue' | 'due_today';
  fleetGraphItems: FleetGraphModalFeedItem[];
  onAccountabilityClick: () => void;
  onFleetGraphClick: () => void;
  isCelebrating?: boolean;
}

function formatCombinedMessage(itemCount: number): string {
  return itemCount === 1
    ? '1 item needs attention.'
    : `${itemCount} items need attention.`;
}

export function TopAttentionBanners({
  accountabilityItemCount,
  accountabilityUrgency,
  fleetGraphItems,
  onAccountabilityClick,
  onFleetGraphClick,
  isCelebrating = false,
}: TopAttentionBannersProps) {
  const fleetGraphCount = fleetGraphItems.length;
  const totalCount = accountabilityItemCount + fleetGraphCount;
  const hasFleetGraphItems = fleetGraphCount > 0;

  return (
    <AccountabilityBanner
      itemCount={hasFleetGraphItems ? totalCount : accountabilityItemCount}
      onBannerClick={hasFleetGraphItems ? onFleetGraphClick : onAccountabilityClick}
      isCelebrating={isCelebrating}
      urgency={accountabilityItemCount > 0 ? accountabilityUrgency : 'due_today'}
      messageOverride={hasFleetGraphItems ? formatCombinedMessage(totalCount) : undefined}
    />
  );
}

export default TopAttentionBanners;
