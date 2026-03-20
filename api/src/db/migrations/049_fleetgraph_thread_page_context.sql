-- Persist the full latest page context on FleetGraph chat threads so
-- follow-up turns can rehydrate it when the client omits pageContext.

ALTER TABLE fleetgraph_chat_threads
  ADD COLUMN IF NOT EXISTS last_page_context JSONB;
