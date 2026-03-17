-- FleetGraph entity digest cache: skip re-analysis when entity unchanged
CREATE TABLE IF NOT EXISTS fleetgraph_entity_digests (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  digest TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, entity_type, entity_id)
);
