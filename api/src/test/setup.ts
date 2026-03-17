import { beforeAll, afterAll } from 'vitest'
import { pool } from '../db/client.js'

// Test setup for API integration tests
// This runs before all tests in each test file

beforeAll(async () => {
  // Ensure test environment
  process.env.NODE_ENV = 'test'

  // Guard: refuse to truncate the dev database (tests must use a _test suffix db)
  const dbUrl = process.env.DATABASE_URL || ''
  const dbName = dbUrl.split('/').pop()?.split('?')[0] || ''
  if (dbName && !dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to TRUNCATE non-test database "${dbName}". ` +
      `Set DATABASE_URL to a _test database (e.g. ${dbName}_test) or run: pnpm test`
    )
  }

  // Clean up test data from previous runs to prevent duplicate key errors
  // Use TRUNCATE CASCADE which is faster and bypasses row-level triggers
  // (audit_logs has AU-9 compliance triggers preventing DELETE)
  await pool.query(`TRUNCATE TABLE
    workspace_invites, sessions, files, document_links, document_history,
    comments, document_associations, document_snapshots, sprint_iterations,
    issue_iterations, documents, audit_logs, workspace_memberships,
    users, workspaces
    CASCADE`)
})

afterAll(async () => {
  // Close pool only at the very end - vitest handles this via globalTeardown
})
