-- Add entity scope columns to chat threads for entity-scoped conversations.

ALTER TABLE fleetgraph_chat_threads
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT;

-- Rebuild active thread index to include entity scope
DROP INDEX IF EXISTS idx_fleetgraph_chat_threads_active;
CREATE INDEX idx_fleetgraph_chat_threads_active
  ON fleetgraph_chat_threads (workspace_id, user_id, entity_type, entity_id, status)
  WHERE status = 'active';
