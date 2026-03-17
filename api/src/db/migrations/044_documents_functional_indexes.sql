-- Broaden JSONB query support for high-traffic document lookups.
-- Guard empty strings so casts stay valid during index builds.

CREATE INDEX IF NOT EXISTS idx_documents_issue_assignee_id
  ON documents (((properties->>'assignee_id')::uuid))
  WHERE document_type = 'issue'
    AND properties ? 'assignee_id'
    AND properties->>'assignee_id' <> '';

CREATE INDEX IF NOT EXISTS idx_documents_project_owner_id
  ON documents (((properties->>'owner_id')::uuid))
  WHERE document_type = 'project'
    AND properties ? 'owner_id'
    AND properties->>'owner_id' <> '';

CREATE INDEX IF NOT EXISTS idx_documents_sprint_owner_id
  ON documents (((properties->>'owner_id')::uuid))
  WHERE document_type = 'sprint'
    AND properties ? 'owner_id'
    AND properties->>'owner_id' <> '';

CREATE INDEX IF NOT EXISTS idx_documents_sprint_number
  ON documents (((properties->>'sprint_number')::int))
  WHERE document_type = 'sprint'
    AND properties ? 'sprint_number'
    AND properties->>'sprint_number' <> '';

CREATE INDEX IF NOT EXISTS idx_documents_sprint_project_id
  ON documents (((properties->>'project_id')::uuid))
  WHERE document_type = 'sprint'
    AND properties ? 'project_id'
    AND properties->>'project_id' <> '';
