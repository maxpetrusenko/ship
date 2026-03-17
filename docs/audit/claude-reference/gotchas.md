# Ship Codebase Gotchas

Things that might trip you up when working on Ship. Each gotcha includes specific file:line references.

## 1. Cascade Deletes

Deleting parent documents cascades to children. This is intentional but can surprise you.

**Affected tables:**
- `documents.parent_id` - deleting a parent wiki deletes all child pages
- `document_associations` - deleting either document removes the association
- `workspace_memberships` - deleting workspace or user removes membership

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/api/src/db/schema.sql:103` - `parent_id UUID REFERENCES documents(id) ON DELETE CASCADE`
- `/Users/jonesshaw/Documents/code/ship/api/src/db/migrations/020_document_associations.sql:17-18` - Both `document_id` and `related_id` cascade

**Risk:** Deleting a project document does NOT cascade to issues (uses `ON DELETE SET NULL` at schema.sql:108), but deleting a parent wiki page DOES delete all children.

## 2. Session Timeout (NIST Compliance)

Sessions have **two** independent timeouts - missing either one logs users out.

| Timeout | Duration | Trigger |
|---------|----------|---------|
| Inactivity | 15 minutes | No API calls or activity |
| Absolute | 12 hours | Since session creation |

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/shared/src/constants.ts:28` - `SESSION_TIMEOUT_MS = 15 * 60 * 1000`
- `/Users/jonesshaw/Documents/code/ship/shared/src/constants.ts:31` - `ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000`
- `/Users/jonesshaw/Documents/code/ship/api/src/middleware/auth.ts:154-169` - Both timeouts checked
- `/Users/jonesshaw/Documents/code/ship/api/src/collaboration/index.ts:446-452` - WebSocket connections also enforce these

**Gotcha:** The collaboration WebSocket enforces the same timeouts. Long-idle editing sessions will disconnect.

## 3. Document Associations - Dual System

Documents use BOTH direct columns AND a junction table for associations. This is a migration in progress.

**Old system (columns):**
```sql
-- api/src/db/schema.sql:107-109
program_id UUID REFERENCES documents(id)
project_id UUID REFERENCES documents(id)
-- Note: sprint_id was dropped by migration 027
```

**New system (junction table):**
```sql
-- api/src/db/migrations/020_document_associations.sql
document_associations(document_id, related_id, relationship_type)
```

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/api/src/db/migrations/021_migrate_associations.sql` - Migrates data from columns to junction
- `/Users/jonesshaw/Documents/code/ship/api/src/db/seed.ts:532-564` - Seed data writes to BOTH systems

**Gotcha:** When creating associations, you may need to write to both systems. The old columns are kept for rollback safety (see migration 021, line 67).

## 4. Error Response Inconsistency

Newer routes use structured `{ success, data, error }` format. Older routes use plain `{ error: string }`.

**New format (auth, admin, workspaces, invites):**
```typescript
// api/src/routes/auth.ts:22-28
res.status(400).json({
  success: false,
  error: {
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'Email and password are required',
  },
});
```

**Old format (standups, team, search):**
```typescript
// api/src/routes/standups.ts:45
res.status(404).json({ error: 'Workspace not found' });

// api/src/routes/team.ts:189
res.status(500).json({ error: 'Internal server error' });
```

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/shared/src/types/api.ts:2-12` - Canonical `ApiResponse` type
- Routes using old format: `standups.ts`, `team.ts`, `search.ts`
- Routes using new format: `auth.ts`, `admin.ts`, `workspaces.ts`, `invites.ts`, `api-tokens.ts`

**Gotcha:** Frontend error handling must check for both `error.message` (new) and plain `error` string (old).

## 5. Empty Tests Pass Silently

Tests with only TODO comments pass with no warning. This is a major footgun.

**Bad (silently passes):**
```typescript
test('my test', async ({ page }) => {
  // TODO: implement this
});
```

**Good (properly skipped):**
```typescript
test.fixme('my test', async ({ page }) => {
  // TODO: implement this
});
```

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/scripts/check-empty-tests.sh` - Pre-commit hook catches these
- `/Users/jonesshaw/Documents/code/ship/.husky/pre-commit:1-3` - Hook runs on every commit

**Gotcha:** The pre-commit hook only catches empty tests at commit time. During development, you won't see failures.

## 6. E2E Test Output Explosion

Never run `pnpm test:e2e` directly. It outputs 600+ test results that crash Claude Code.

**Instead:** Use the `/e2e-test-runner` skill which:
- Runs tests in background
- Polls `test-results/summary.json` for progress
- Supports `--last-failed` for iterative fixing

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/.claude/CLAUDE.md:55-58` - Documents this requirement

## 7. Yjs State - Binary Buffer Manipulation

`yjs_state` is stored as `BYTEA` (binary). Converting incorrectly corrupts collaborative state.

**Correct pattern:**
```typescript
// api/src/collaboration/index.ts:129-131
await pool.query(
  `UPDATE documents SET yjs_state = $1, properties = $2, updated_at = now() WHERE id = $3`,
  [Buffer.from(state), JSON.stringify(updatedProps), docId]
);
```

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/api/src/db/schema.sql:99-100` - Column definition
- `/Users/jonesshaw/Documents/code/ship/api/src/collaboration/index.ts:318-320` - Loading from DB
- `/Users/jonesshaw/Documents/code/ship/api/src/routes/documents.ts:405-407` - Setting to NULL clears state

**Gotcha:** When updating `content` via REST API, `yjs_state` is set to NULL (line 407). This forces the collaboration server to regenerate state from the new content.

## 8. Worktree Ports

Multiple worktrees need different ports to run simultaneously.

**Port allocation:**
- API base: 3000, Web base: 5173
- Script finds first available port starting from base
- Worktree-init calculates offset from branch name hash

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/scripts/dev.sh:65-92` - Port finding logic
- `/Users/jonesshaw/Documents/code/ship/scripts/worktree-init.sh:17-27` - Deterministic port offset from branch name

**Gotcha:** If you manually start servers, check which ports are in use first. The dev script handles this automatically.

## 9. Migration System - Never Modify schema.sql

Schema changes for existing tables MUST go in migration files, not schema.sql.

**Migration files location:**
```
api/src/db/migrations/
├── 001_properties_jsonb.sql
├── 002_person_membership_decoupling.sql
├── ...
└── 022_sprint_project_associations.sql
```

**Key locations:**
- `/Users/jonesshaw/Documents/code/ship/api/src/db/migrate.ts:46` - Creates `schema_migrations` tracking table
- `/Users/jonesshaw/Documents/code/ship/api/src/db/migrate.ts:53` - Queries applied migrations
- `/Users/jonesshaw/Documents/code/ship/api/src/db/migrate.ts:76-91` - Runs each migration in transaction

**Gotcha:** `schema.sql` is only for initial database creation. Modifying it doesn't affect existing databases.

## 10. Type Locations - Some Types in Route Files

Not all types are in `shared/src/types/`. Some domain types are defined locally in route files.

**Types in route files:**
- `/Users/jonesshaw/Documents/code/ship/api/src/routes/issues.ts:105` - `interface BelongsToEntry`
- `/Users/jonesshaw/Documents/code/ship/api/src/routes/dashboard.ts:11-21` - `Urgency` type, `WorkItem` interface
- `/Users/jonesshaw/Documents/code/ship/api/src/routes/caia-auth.ts:381` - `interface PendingInvite`
- `/Users/jonesshaw/Documents/code/ship/api/src/routes/claude.ts:21-43` - Multiple stat interfaces

**Types in shared:**
- `/Users/jonesshaw/Documents/code/ship/shared/src/types/api.ts` - `ApiResponse`, `ApiError`, `PaginationParams`
- `/Users/jonesshaw/Documents/code/ship/shared/src/types/document.ts` - Document types
- `/Users/jonesshaw/Documents/code/ship/shared/src/types/user.ts` - User types
- `/Users/jonesshaw/Documents/code/ship/shared/src/types/workspace.ts` - Workspace types

**Gotcha:** When adding types, decide: if used by both API and web, put in `shared/`. If API-only and route-specific, local definition is acceptable.

## 11. Properties Flattening - Must Include New Fields Everywhere

When a new field is stored in `properties` JSONB and flattened to top-level in API responses, it must be added in **all** response sites. Missing any one causes the frontend to receive `undefined` for that field.

**Required locations for a new flattened property (e.g., `emoji`):**
1. `updateDocumentSchema` Zod schema (so PATCH accepts it)
2. `topLevelProps` extraction in PATCH handler (so it gets written to `properties`)
3. GET list response flattening (`result.rows.map`)
4. GET single-document response flattening
5. PATCH response flattening
6. Convert/undo-convert response flattening
7. Frontend document tab transformers (e.g., `ProjectDetailsTab`, `ProgramOverviewTab`)

**Key locations:**
- `api/src/routes/documents.ts:51-91` - `updateDocumentSchema`
- `api/src/routes/documents.ts:689-720` - `topLevelProps` extraction
- `api/src/routes/documents.ts:134-147` - List response flattening
- `api/src/routes/documents.ts:326-363` - Single doc response flattening
- `api/src/routes/documents.ts:1068-1094` - PATCH response flattening

**Gotcha (fixed 2026-03-17):** `emoji` was accepted by the projects API (`/api/projects/:id`) but not by the documents API (`/api/documents/:id`). The frontend `ProjectDetailsTab` routed updates through documents API, which rejected `emoji` with 400. Fix: added `emoji` to all six required locations above, plus fixed `ProjectDetailsTab` which hardcoded `emoji: null` instead of passing through `document.emoji`.

---

## Quick Reference

| Gotcha | Risk Level | Prevention |
|--------|------------|------------|
| Cascade deletes | High | Check foreign key constraints before delete |
| Session timeout | Medium | Test with time manipulation, use `useSessionTimeout` hook |
| Dual associations | Medium | Check both column and junction table when debugging |
| Error formats | Low | Use type guards to handle both formats |
| Empty tests | High | Always use `test.fixme()` for stubs |
| E2E output | High | Use `/e2e-test-runner` skill only |
| Yjs corruption | High | Use `Buffer.from()`, never string cast |
| Port conflicts | Low | Use `pnpm dev` which handles this |
| Schema.sql edits | High | Create migration file instead |
| Type locations | Low | Check route file if not in shared/ |
| Properties flattening | High | Add field to all 6 response sites + Zod schema |
