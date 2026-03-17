-- Add trace_url column to fleetgraph_audit_log for LangSmith trace links
ALTER TABLE fleetgraph_audit_log
  ADD COLUMN IF NOT EXISTS trace_url TEXT;
