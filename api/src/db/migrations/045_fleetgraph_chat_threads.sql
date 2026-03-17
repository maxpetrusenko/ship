-- FleetGraph persistent chat threads and messages.
-- Replaces the in-memory conversation Map with restart-safe DB storage.

CREATE TABLE IF NOT EXISTS fleetgraph_chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  last_page_route TEXT,
  last_page_surface TEXT,
  last_page_document_id TEXT,
  last_page_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: one active thread per user+workspace
CREATE INDEX IF NOT EXISTS idx_fleetgraph_chat_threads_active
  ON fleetgraph_chat_threads (workspace_id, user_id, status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS fleetgraph_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES fleetgraph_chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  assessment JSONB,
  debug JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chronological message retrieval per thread
CREATE INDEX IF NOT EXISTS idx_fleetgraph_chat_messages_thread
  ON fleetgraph_chat_messages (thread_id, created_at);
