-- FleetGraph audit log: one row per graph run for observability
CREATE TABLE IF NOT EXISTS fleetgraph_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  branch TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  token_usage JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace-scoped chronological queries
CREATE INDEX IF NOT EXISTS idx_fleetgraph_audit_workspace
  ON fleetgraph_audit_log(workspace_id, created_at DESC);
