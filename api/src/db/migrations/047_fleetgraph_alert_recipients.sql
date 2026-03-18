-- FleetGraph alert recipients: per-user notification state (read, dismiss, snooze).
-- Decouples notification lifecycle from global alert status.

CREATE TABLE fleetgraph_alert_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES fleetgraph_alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (alert_id, user_id)
);

-- Partial index: fast lookup for unread, visible recipients per user
CREATE INDEX idx_fleetgraph_alert_recipients_unread
  ON fleetgraph_alert_recipients (user_id, read_at)
  WHERE dismissed_at IS NULL AND snoozed_until IS NULL;
