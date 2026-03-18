-- Persist per-message FleetGraph chat metadata needed after refresh.

ALTER TABLE fleetgraph_chat_messages
  ADD COLUMN IF NOT EXISTS alert_id UUID REFERENCES fleetgraph_alerts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trace_url TEXT;
