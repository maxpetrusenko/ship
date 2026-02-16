import { test, expect } from '@playwright/test'

const APP_URL = 'https://mvp-1-collab-board.web.app'

test.describe('CollabBoard Demo Recording', () => {
  test('Demo recording - requires auth', async ({ page }) => {
    // Scene 1: Landing
    await page.goto(APP_URL)
    await expect(page.locator('text=Sign in with Google')).toBeVisible()
    await page.waitForTimeout(3000)

    // Note: In real demo, user would sign in
    // This recording shows the flow up to auth

    // Scene 2: Board routing
    await page.goto(`${APP_URL}/b/mvp-demo-board`)
    await page.waitForTimeout(2000)
  })
})

// Instructions for manual recording with avatar:
/*
MANUAL DEMO RECORDING INSTRUCTIONS:

1. RECORD SCREEN FIRST (no audio):
   - Open https://mvp-1-collab-board.web.app
   - Use QuickTime, OBS, or Playwright video recording
   - Record at 1920x1080
   - Follow DEMO_SCRIPT.md cues
   - Move mouse smoothly, pause on each UI element
   - Save as: collabboard-demo-screen.mp4

2. UPLOAD TO HEYGEN:
   - Go to https://heygen.com
   - Upload screen recording
   - Copy DEMO_SCRIPT.md as avatar script
   - Generate avatar video
   - Auto-edit removes silence/filler

3. EXPORT:
   - Download final MP4
   - Upload to YouTube/Vimeo
   - Add URL to SUBMISSION_PACKAGE.md

ALTERNATIVE: Synthesia
1. Start with script in DEMO_SCRIPT.md
2. Generate avatar video first
3. Record screen clips to match
4. Combine in video editor
*/
