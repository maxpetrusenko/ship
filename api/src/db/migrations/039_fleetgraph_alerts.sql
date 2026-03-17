-- FleetGraph alerts table: deduplicated, snoozable alert state
CREATE TABLE IF NOT EXISTS fleetgraph_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  summary TEXT NOT NULL,
  recommendation TEXT NOT NULL DEFAULT '',
  citations JSONB NOT NULL DEFAULT '[]',
  owner_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  snoozed_until TIMESTAMPTZ,
  last_surfaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique active alert per fingerprint per workspace (allows re-create after dismiss)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_alerts_fingerprint
  ON fleetgraph_alerts(workspace_id, fingerprint) WHERE status = 'active';

-- Fast lookup by entity (issue detail page, sprint board)
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_entity
  ON fleetgraph_alerts(entity_type, entity_id);

-- Dashboard queries: all active alerts for a workspace
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_status
  ON fleetgraph_alerts(status, workspace_id);
