import { test, expect } from '@playwright/test'

test.describe('CollabBoard Demo Recording', () => {
  test('Full demo flow', async ({ page }) => {
    // Demo starts at login
    await page.goto('https://mvp-1-collab-board.web.app')
    await page.waitForTimeout(2000)

    // Show login page
    await expect(page.locator('text=Sign in with Google')).toBeVisible()
    await page.waitForTimeout(2000)

    // Note: In real demo, user would sign in here
    // For automated demo, we navigate to board (will show login prompt)
    await page.goto('https://mvp-1-collab-board.web.app/b/mvp-demo-board')
    await page.waitForTimeout(2000)

    // After auth in real flow, board loads
    // For demo, we document what would be shown
  })
})

test.describe('Demo Script (Manual)', () => {
  test.skip(true, 'Manual demo following this script')

  test('Demo Script', async () => {
    /*
    DEMO SCRIPT (3-5 minutes):

    [0:00-0:30] INTRO
    - Show deployed URL: https://mvp-1-collab-board.web.app
    - "This is CollabBoard AI - a real-time collaborative whiteboard"
    - "Built in 1 week for Gauntlet Cohort G4"

    [0:30-1:00] AUTH + BOARD
    - Sign in with Google OAuth
    - Board loads with infinite canvas
    - Show presence strip (current user)

    [1:00-2:00] OBJECT CREATION
    - Click "Add Sticky" - creates yellow sticky note
    - Double-click to edit text
    - Click "Add Rectangle" - creates blue shape
    - Drag objects around (smooth movement)
    - Show Delete button and keyboard shortcuts

    [2:00-2:45] REALTIME SYNC
    - Open second browser (incognito)
    - Sign in as different user
    - Show both cursors visible
    - Create object in Tab A - appears in Tab B
    - Move object in Tab A - syncs to Tab B

    [2:45-3:30] AI COMMANDS
    - Type "create a SWOT template" in AI panel
    - Press Enter
    - Show 4-quadrant SWOT layout created
    - Type "arrange in grid"
    - Show sticky notes rearranged

    [3:30-4:00] ARCHITECTURE
    - Show GitHub repo
    - Mention: React + Konva + Firebase
    - Show PRD, MVP docs
    - Show e2e tests passing

    [4:00-4:30] WRAP UP
    - Summary: 6+ AI commands, multiplayer, realtime sync
    - Demo video URL in submission
    - Tag @GauntletAI
    */
  })
})
