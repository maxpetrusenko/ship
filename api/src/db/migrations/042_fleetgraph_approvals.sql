-- FleetGraph approvals table: HITL gate decisions for consequential actions.
-- Tracks the full approval lifecycle per canonical spec:
-- pending -> approved/dismissed/snoozed -> executed/execution_failed/expired
CREATE TABLE IF NOT EXISTS fleetgraph_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL REFERENCES fleetgraph_alerts(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  checkpoint_id TEXT,
  action_type TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id UUID NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One pending approval per alert at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_approvals_pending
  ON fleetgraph_approvals(alert_id) WHERE status = 'pending';

-- Lookup by workspace + status for dashboard
CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_workspace
  ON fleetgraph_approvals(workspace_id, status);

-- Expire stale approvals (72h window)
CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_expires
  ON fleetgraph_approvals(expires_at) WHERE status = 'pending';
