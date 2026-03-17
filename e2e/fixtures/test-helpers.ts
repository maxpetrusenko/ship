/**
 * Reusable test helpers for flaky-resistant E2E test patterns.
 *
 * These helpers encapsulate retry logic for common interactions that
 * fail under parallel test load due to timing issues.
 */
import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Trigger the TipTap mention autocomplete popup by typing '@' in the editor.
 *
 * Under parallel load, the '@' keystroke may not trigger the mention popup
 * on the first attempt — the editor may not be focused, the mention extension
 * may not be initialized, or the keystroke may be swallowed. This helper
 * retries by re-clicking the editor, clearing content, and retyping '@'
 * until the popup appears.
 *
 * @param page - The Playwright page (or second page in multi-context tests)
 * @param editor - Locator for the .ProseMirror editor element
 * @returns Locator for the mention popup listbox (already confirmed visible)
 *
 * @example
 * const editor = page.locator('.ProseMirror')
 * await triggerMentionPopup(page, editor)
 * await page.keyboard.type('Document Name')
 * const option = page.locator('[role="option"]').filter({ hasText: 'Document Name' })
 * await option.click()
 */
export async function triggerMentionPopup(
  page: Page,
  editor: Locator,
): Promise<Locator> {
  const mentionPopup = page.locator('[role="listbox"]');
  await expect(async () => {
    await editor.click();
    await expect(editor).toBeFocused({ timeout: 3000 });
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    await page.keyboard.type("@");
    await expect(mentionPopup).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000, intervals: [1000, 2000, 3000, 4000, 5000] });
  return mentionPopup;
}

/**
 * Hover over an element and verify an assertion, with retry.
 *
 * Under parallel load, Playwright's hover() may not trigger the expected
 * React state update (e.g., onMouseEnter setting focus or revealing a checkbox).
 * This can happen when the DOM shifts due to late-loading data, or when the
 * hover event fires on a stale element reference. This helper retries the
 * hover + assertion until it succeeds.
 *
 * @param target - The element to hover over
 * @param assertion - An async function containing the expect assertion to verify after hover
 *
 * @example
 * // Verify focus ring appears on hover
 * await hoverWithRetry(rows.nth(2), async () => {
 *   await expect(rows.nth(2)).toHaveAttribute('data-focused', 'true', { timeout: 3000 })
 * })
 *
 * // Verify checkbox becomes visible on hover
 * await hoverWithRetry(firstRow, async () => {
 *   await expect(checkboxContainer).toHaveCSS('opacity', '1', { timeout: 3000 })
 * })
 */
export async function hoverWithRetry(
  target: Locator,
  assertion: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    await target.hover();
    await assertion();
  }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
}

/**
 * Wait for a data table row to be visible before interacting.
 *
 * Under parallel load, tables may render incrementally — the first few rows
 * appear, then more data arrives causing re-renders that shift row positions.
 * Interacting with rows during this unstable period causes hover/click to
 * target the wrong element. This helper retries until the first row stays
 * visible.
 *
 * @param page - The Playwright page
 * @param tableSelector - CSS selector for the table body rows (default: 'table tbody tr')
 *
 * @example
 * await waitForTableData(page)
 * // Table is now stable — safe to hover, click, or count rows
 * const rows = page.locator('tbody tr')
 * await hoverWithRetry(rows.first(), async () => { ... })
 */
export async function waitForTableData(
  page: Page,
  tableSelector = "table tbody tr",
): Promise<void> {
  const firstRow = page.locator(tableSelector).first();
  await expect(async () => {
    await expect(firstRow).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 15000, intervals: [250, 500, 1000, 2000] });
}

/**
 * Wait for a ProseMirror editor to mount and become interactive.
 *
 * Document creation/navigation can resolve before the editor is hydrated.
 * Under load, the editor appears a bit later than the route change, so tests
 * should wait on the actual editor node rather than guessing with sleeps.
 */
export async function waitForDocumentEditor(
  page: Page,
  editorSelector = ".ProseMirror",
): Promise<Locator> {
  const editor = page.locator(editorSelector).first();
  await expect(async () => {
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor).toHaveAttribute("contenteditable", "true", {
      timeout: 2000,
    });
  }).toPass({ timeout: 30000, intervals: [500, 1000, 2000, 3000] });
  return editor;
}
