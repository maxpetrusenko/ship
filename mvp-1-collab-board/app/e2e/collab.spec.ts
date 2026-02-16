import { test, expect } from '@playwright/test'

const APP_URL = 'https://mvp-1-collab-board.web.app'

test.describe('CollabBoard MVP E2E', () => {
  test('loads login page', async ({ page }) => {
    await page.goto(APP_URL)
    await expect(page.locator('text=Sign in with Google')).toBeVisible()
  })

  test('board URL routing redirects to login when unauthed', async ({ page }) => {
    await page.goto(`${APP_URL}/b/test-board-123`)
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('text=Sign in with Google')).toBeVisible()
  })

  test('app title and meta elements present', async ({ page }) => {
    await page.goto(APP_URL)
    await expect(page).toHaveTitle(/app/)
  })

  test('root path loads', async ({ page }) => {
    await page.goto(APP_URL)
    // Root should load (redirects to /b/{boardId} or /login via client routing)
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('CollabBoard Authenticated (Manual)', () => {
  // These tests require manual auth - skip by default
  test.skip(true, 'Run with authenticated session')

  test('board loads with canvas', async ({ page }) => {
    await page.goto(`${APP_URL}/b/mvp-demo-board`)
    await expect(page.locator('.board-stage')).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(expect.any(Number))
  })

  test('create buttons exist', async ({ page }) => {
    await page.goto(`${APP_URL}/b/mvp-demo-board`)
    await expect(page.locator('button:has-text("Add Sticky")')).toBeVisible()
    await expect(page.locator('button:has-text("Add Rectangle")')).toBeVisible()
  })

  test('AI panel exists', async ({ page }) => {
    await page.goto(`${APP_URL}/b/mvp-demo-board`)
    await expect(page.locator('.ai-panel')).toBeVisible()
    await expect(page.locator('.ai-input')).toBeVisible()
  })

  test('presence strip visible', async ({ page }) => {
    await page.goto(`${APP_URL}/b/mvp-demo-board`)
    await expect(page.locator('.presence-strip')).toBeVisible()
  })
})
