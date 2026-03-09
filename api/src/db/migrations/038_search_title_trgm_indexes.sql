CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_documents_person_title_search
  ON documents USING GIN (LOWER(title) gin_trgm_ops)
  WHERE document_type = 'person' AND archived_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_title_search
  ON documents USING GIN (LOWER(title) gin_trgm_ops)
  WHERE document_type IN ('wiki', 'issue', 'project', 'program') AND deleted_at IS NULL;
