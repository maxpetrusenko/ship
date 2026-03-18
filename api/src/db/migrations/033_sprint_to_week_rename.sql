-- Rename sprint-related document types to week terminology
-- Part of Sprint → Week rename refactor

-- Rename document_type enum values.
-- Some databases already include weekly_* labels via schema.sql, so handle mixed states.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'document_type'::regtype AND enumlabel = 'sprint_plan'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'document_type'::regtype AND enumlabel = 'weekly_plan'
    ) THEN
      UPDATE documents
      SET document_type = 'weekly_plan'::document_type
      WHERE document_type = 'sprint_plan'::document_type;
    ELSE
      ALTER TYPE document_type RENAME VALUE 'sprint_plan' TO 'weekly_plan';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'document_type'::regtype AND enumlabel = 'sprint_retro'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'document_type'::regtype AND enumlabel = 'weekly_retro'
    ) THEN
      UPDATE documents
      SET document_type = 'weekly_retro'::document_type
      WHERE document_type = 'sprint_retro'::document_type;
    ELSE
      ALTER TYPE document_type RENAME VALUE 'sprint_retro' TO 'weekly_retro';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'document_type'::regtype AND enumlabel = 'sprint_review'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'document_type'::regtype AND enumlabel = 'weekly_review'
    ) THEN
      UPDATE documents
      SET document_type = 'weekly_review'::document_type
      WHERE document_type = 'sprint_review'::document_type;
    ELSE
      ALTER TYPE document_type RENAME VALUE 'sprint_review' TO 'weekly_review';
    END IF;
  END IF;
END
$$;

-- Note: We keep 'sprint' as a document_type because it represents the sprint document itself.
-- The terminology change is "Sprint 3" → "Week of Jan 27" in UI, but the underlying
-- document concept remains valid. The sprint document stores sprint_number and owner_id
-- for derived 7-day windows.

-- Update accountability_type values in issue properties
-- Sprint-related accountability types become week-related
UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"weekly_plan"')
WHERE properties->>'accountability_type' = 'sprint_plan';

UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"weekly_review"')
WHERE properties->>'accountability_type' = 'sprint_review';

UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"week_start"')
WHERE properties->>'accountability_type' = 'sprint_start';

UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"week_issues"')
WHERE properties->>'accountability_type' = 'sprint_issues';
