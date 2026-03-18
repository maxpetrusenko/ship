import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Claude Context API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const ownerEmail = `claude-owner-${testRunId}@ship.local`
  const memberEmail = `claude-member-${testRunId}@ship.local`
  const testWorkspaceName = `Claude Context Test ${testRunId}`

  let ownerSessionCookie: string
  let memberSessionCookie: string
  let testWorkspaceId: string
  let ownerId: string
  let memberId: string

  const insertDocument = async (params: {
    documentType: string
    title: string
    createdBy: string
    visibility: 'workspace' | 'private'
    properties?: Record<string, unknown>
    content?: unknown
  }) => {
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility, properties, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        testWorkspaceId,
        params.documentType,
        params.title,
        params.createdBy,
        params.visibility,
        params.properties ? JSON.stringify(params.properties) : null,
        params.content ? JSON.stringify(params.content) : null,
      ]
    )
    return result.rows[0].id as string
  }

  const linkDocument = async (documentId: string, relatedId: string, relationshipType: 'project' | 'program' | 'sprint') => {
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, $3)`,
      [documentId, relatedId, relationshipType]
    )
  }

  beforeAll(async () => {
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    const ownerResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Claude Owner')
       RETURNING id`,
      [ownerEmail]
    )
    ownerId = ownerResult.rows[0].id

    const memberResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Claude Member')
       RETURNING id`,
      [memberEmail]
    )
    memberId = memberResult.rows[0].id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
      [testWorkspaceId, ownerId, memberId]
    )

    const ownerSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [ownerSessionId, ownerId, testWorkspaceId]
    )
    ownerSessionCookie = `session_id=${ownerSessionId}`

    const memberSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [memberSessionId, memberId, testWorkspaceId]
    )
    memberSessionCookie = `session_id=${memberSessionId}`
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [ownerId, memberId])
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1) OR related_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, memberId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1) OR related_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
  })

  it('returns 404 for hidden standup sprint roots', async () => {
    const sprintId = await insertDocument({
      documentType: 'sprint',
      title: 'Hidden Standup Sprint',
      createdBy: ownerId,
      visibility: 'private',
      properties: { sprint_number: 1, status: 'active', plan: 'Private plan' },
    })

    const response = await request(app)
      .get(`/api/claude/context?context_type=standup&sprint_id=${sprintId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(404)
  })

  it('filters hidden standup joins and keeps visible sprint root', async () => {
    const sprintId = await insertDocument({
      documentType: 'sprint',
      title: 'Visible Standup Sprint',
      createdBy: ownerId,
      visibility: 'workspace',
      properties: { sprint_number: 2, status: 'active', plan: 'Visible plan' },
    })
    const projectId = await insertDocument({
      documentType: 'project',
      title: 'Hidden Standup Project',
      createdBy: ownerId,
      visibility: 'private',
      properties: { plan: 'Private project plan', ice_impact: '1', ice_confidence: '2', ice_ease: '3', monetary_impact: '1000' },
    })
    const programId = await insertDocument({
      documentType: 'program',
      title: 'Hidden Standup Program',
      createdBy: ownerId,
      visibility: 'private',
      properties: { description: 'Private program', goals: 'Secret goals' },
    })
    const standupId = await insertDocument({
      documentType: 'standup',
      title: 'Hidden Standup',
      createdBy: ownerId,
      visibility: 'private',
      content: { type: 'doc', content: [] },
    })
    const issueId = await insertDocument({
      documentType: 'issue',
      title: 'Hidden Standup Issue',
      createdBy: ownerId,
      visibility: 'private',
      properties: { status: 'todo', priority: 'high' },
    })

    await linkDocument(sprintId, projectId, 'project')
    await linkDocument(projectId, programId, 'program')
    await linkDocument(standupId, sprintId, 'sprint')
    await linkDocument(issueId, sprintId, 'sprint')

    const response = await request(app)
      .get(`/api/claude/context?context_type=standup&sprint_id=${sprintId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(200)
    expect(response.body.context_type).toBe('standup')
    expect(response.body.project).toBeNull()
    expect(response.body.program).toBeNull()
    expect(response.body.recent_standups).toEqual([])
    expect(response.body.issues.stats.total).toBe(0)
    expect(response.body.issues.items).toEqual([])
  })

  it('hides private standup program ids behind the visible project join', async () => {
    const sprintId = await insertDocument({
      documentType: 'sprint',
      title: 'Program Leak Sprint',
      createdBy: ownerId,
      visibility: 'workspace',
      properties: { sprint_number: 3, status: 'active', plan: 'Visible sprint plan' },
    })
    const projectId = await insertDocument({
      documentType: 'project',
      title: 'Visible Program Leak Project',
      createdBy: ownerId,
      visibility: 'workspace',
      properties: { plan: 'Visible project plan', ice_impact: '2', ice_confidence: '2', ice_ease: '2', monetary_impact: '2000' },
    })
    const programId = await insertDocument({
      documentType: 'program',
      title: 'Hidden Leak Program',
      createdBy: ownerId,
      visibility: 'private',
      properties: { description: 'Hidden program', goals: 'Hidden goals' },
    })

    await linkDocument(sprintId, projectId, 'project')
    await linkDocument(projectId, programId, 'program')

    const response = await request(app)
      .get(`/api/claude/context?context_type=standup&sprint_id=${sprintId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(200)
    expect(response.body.project).toEqual(expect.objectContaining({ id: projectId, name: 'Visible Program Leak Project' }))
    expect(response.body.program).toBeNull()
  })

  it('returns 404 for hidden review sprint roots', async () => {
    const sprintId = await insertDocument({
      documentType: 'sprint',
      title: 'Hidden Review Sprint',
      createdBy: ownerId,
      visibility: 'private',
      properties: { sprint_number: 4, status: 'active', plan: 'Private review plan' },
    })

    const response = await request(app)
      .get(`/api/claude/context?context_type=review&sprint_id=${sprintId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(404)
  })

  it('filters hidden review joins and hides the existing review', async () => {
    const sprintId = await insertDocument({
      documentType: 'sprint',
      title: 'Visible Review Sprint',
      createdBy: ownerId,
      visibility: 'workspace',
      properties: { sprint_number: 5, status: 'active', plan: 'Visible review plan' },
    })
    const projectId = await insertDocument({
      documentType: 'project',
      title: 'Hidden Review Project',
      createdBy: ownerId,
      visibility: 'private',
      properties: { plan: 'Private review project', ice_impact: '1', ice_confidence: '1', ice_ease: '1', monetary_impact: '1000' },
    })
    const programId = await insertDocument({
      documentType: 'program',
      title: 'Hidden Review Program',
      createdBy: ownerId,
      visibility: 'private',
      properties: { description: 'Private review program', goals: 'Hidden goals' },
    })
    const standupId = await insertDocument({
      documentType: 'standup',
      title: 'Hidden Review Standup',
      createdBy: ownerId,
      visibility: 'private',
      content: { type: 'doc', content: [] },
    })
    const issueId = await insertDocument({
      documentType: 'issue',
      title: 'Hidden Review Issue',
      createdBy: ownerId,
      visibility: 'private',
      properties: { status: 'todo', priority: 'medium' },
    })
    const reviewId = await insertDocument({
      documentType: 'weekly_review',
      title: 'Hidden Weekly Review',
      createdBy: ownerId,
      visibility: 'private',
      content: { type: 'doc', content: [] },
      properties: { plan_validated: 'true', owner_id: ownerId },
    })

    await linkDocument(sprintId, projectId, 'project')
    await linkDocument(projectId, programId, 'program')
    await linkDocument(standupId, sprintId, 'sprint')
    await linkDocument(issueId, sprintId, 'sprint')
    await linkDocument(reviewId, sprintId, 'sprint')

    const response = await request(app)
      .get(`/api/claude/context?context_type=review&sprint_id=${sprintId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(200)
    expect(response.body.project).toBeNull()
    expect(response.body.program).toBeNull()
    expect(response.body.standups).toEqual([])
    expect(response.body.issues.stats.total).toBe(0)
    expect(response.body.existing_review).toBeNull()
  })

  it('returns 404 for hidden retro project roots', async () => {
    const projectId = await insertDocument({
      documentType: 'project',
      title: 'Hidden Retro Project',
      createdBy: ownerId,
      visibility: 'private',
      properties: { plan: 'Private retro plan', ice_impact: '1', ice_confidence: '1', ice_ease: '1', monetary_impact: '1000' },
    })

    const response = await request(app)
      .get(`/api/claude/context?context_type=retro&project_id=${projectId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(404)
  })

  it('filters hidden retro joins and hides the existing retro', async () => {
    const projectId = await insertDocument({
      documentType: 'project',
      title: 'Visible Retro Project',
      createdBy: ownerId,
      visibility: 'workspace',
      properties: { plan: 'Visible retro plan', ice_impact: '3', ice_confidence: '2', ice_ease: '1', monetary_impact: '3000', status: 'active' },
    })
    const programId = await insertDocument({
      documentType: 'program',
      title: 'Hidden Retro Program',
      createdBy: ownerId,
      visibility: 'private',
      properties: { description: 'Private retro program', goals: 'Hidden goals' },
    })
    const sprintId = await insertDocument({
      documentType: 'sprint',
      title: 'Hidden Retro Sprint',
      createdBy: ownerId,
      visibility: 'private',
      properties: { sprint_number: 6, status: 'done', plan: 'Private sprint plan' },
    })
    const standupId = await insertDocument({
      documentType: 'standup',
      title: 'Hidden Retro Standup',
      createdBy: ownerId,
      visibility: 'private',
      content: { type: 'doc', content: [] },
    })
    const issueId = await insertDocument({
      documentType: 'issue',
      title: 'Hidden Retro Issue',
      createdBy: ownerId,
      visibility: 'private',
      properties: { status: 'done', priority: 'low' },
    })
    const reviewId = await insertDocument({
      documentType: 'weekly_review',
      title: 'Hidden Retro Review',
      createdBy: ownerId,
      visibility: 'private',
      content: { type: 'doc', content: [] },
      properties: { plan_validated: 'false', owner_id: ownerId },
    })
    const retroId = await insertDocument({
      documentType: 'weekly_retro',
      title: 'Hidden Project Retro',
      createdBy: ownerId,
      visibility: 'private',
      content: { type: 'doc', content: [] },
      properties: { plan_validated: 'true' },
    })

    await linkDocument(projectId, programId, 'program')
    await linkDocument(sprintId, projectId, 'project')
    await linkDocument(standupId, sprintId, 'sprint')
    await linkDocument(issueId, projectId, 'project')
    await linkDocument(reviewId, sprintId, 'sprint')
    await linkDocument(retroId, projectId, 'project')

    const response = await request(app)
      .get(`/api/claude/context?context_type=retro&project_id=${projectId}`)
      .set('Cookie', memberSessionCookie)

    expect(response.status).toBe(200)
    expect(response.body.program).toBeNull()
    expect(response.body.weeks).toEqual([])
    expect(response.body.sprint_reviews).toEqual([])
    expect(response.body.recent_standups).toEqual([])
    expect(response.body.issues.stats.total).toBe(0)
    expect(response.body.existing_retro).toBeNull()
  })
})
