import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures/isolated-env";

async function waitForMyWeekContent(page: Page, text: string) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/dashboard/my-week");
        if (!response.ok()) return false;

        const data = (await response.json()) as {
          plan?: { items?: Array<{ text: string }> | null };
          retro?: { items?: Array<{ text: string }> | null };
        };

        const planMatch =
          data.plan?.items?.some((item) => item.text.includes(text)) ?? false;
        const retroMatch =
          data.retro?.items?.some((item) => item.text.includes(text)) ?? false;
        return planMatch || retroMatch;
      },
      { timeout: 15000 },
    )
    .toBe(true);
}

/**
 * Tests that /my-week reflects plan/retro edits after navigating back.
 *
 * Bug: /my-week could rehydrate stale TanStack Query cache after leaving a
 * weekly document, and the retro/plan saves themselves were still racing the
 * collaboration server's async DB persist.
 * Fix: the page drops cached my-week queries on unmount, and the test waits for
 * the live API payload to reflect the edit before navigating back.
 */

test.describe("My Week - stale data after editing plan/retro", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("dev@ship.local");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL("/login", { timeout: 5000 });
  });

  test("plan edits are visible on /my-week after navigating back", async ({
    page,
  }) => {
    // 1. Navigate to /my-week
    await page.goto("/my-week");
    await expect(page.getByRole("heading", { name: /^Week \d+$/ })).toBeVisible(
      { timeout: 10000 },
    );

    // 2. Create a plan (click the create button)
    await page
      .getByRole("button", { name: /create plan for this week/i })
      .click();

    // 3. Should navigate to the document editor
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 });

    // 4. Wait for the TipTap editor to be ready
    const editor = page.locator(".tiptap");
    await expect(editor).toBeVisible({ timeout: 10000 });

    // 5. Type a list item into the editor
    // Use "1. " prefix to create a numbered list (orderedList with listItem nodes)
    await editor.click();
    await page.keyboard.type("1. Ship the new dashboard feature");

    // 6. Wait for the collaboration server + DB state to reflect the edit
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 10000 });
    await waitForMyWeekContent(page, "Ship the new dashboard feature");

    // 7. Navigate back to /my-week using client-side navigation (Dashboard icon in rail)
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: /^Week \d+$/ })).toBeVisible(
      { timeout: 10000 },
    );

    // 8. Verify the plan content is visible on the my-week page
    // The my-week API reads from the `content` column which is updated by the
    // collaboration server's persistence layer (async from WebSocket edits)
    await expect(page.getByText("Ship the new dashboard feature")).toBeVisible({
      timeout: 15000,
    });
  });

  test("retro edits are visible on /my-week after navigating back", async ({
    page,
  }) => {
    test.setTimeout(90000);
    // 1. Navigate to /my-week
    await page.goto("/my-week");
    await expect(page.getByRole("heading", { name: /^Week \d+$/ })).toBeVisible(
      { timeout: 10000 },
    );

    // 2. Create a retro (click the main create button, not the nudge link)
    await page
      .getByRole("button", { name: /create retro for this week/i })
      .click();

    // 3. Should navigate to the document editor
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 });

    // 4. Wait for the TipTap editor to be ready
    const editor = page.locator(".tiptap");
    await expect(editor).toBeVisible({ timeout: 10000 });

    // 5. Type a list item into the editor
    await editor.click();
    await page.keyboard.type("1. Completed the API refactoring");

    // 6. Wait for the collaboration server + DB state to reflect the edit
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 10000 });
    await waitForMyWeekContent(page, "Completed the API refactoring");

    // 7. Navigate back to /my-week using client-side navigation
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: /^Week \d+$/ })).toBeVisible(
      { timeout: 10000 },
    );

    // 8. Verify the retro content is visible on the my-week page
    await expect(page.getByText("Completed the API refactoring")).toBeVisible({
      timeout: 15000,
    });
  });
});
