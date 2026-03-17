import { test, expect } from "./fixtures/isolated-env";
import { waitForTableData } from "./fixtures/test-helpers";

test.describe("Context Menus - Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("dev@ship.local");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL("/login", { timeout: 5000 });
  });

  test.describe("Wiki Documents", () => {
    test("three-dot menu opens context menu", async ({ page }) => {
      // Navigate to docs to ensure sidebar shows wiki documents
      await page.goto("/docs");

      const firstDoc = page.getByTestId("doc-item").first();

      await expect(firstDoc).toBeVisible({ timeout: 5000 });
      await firstDoc.hover();

      const menuButton = firstDoc.locator(
        'button[aria-label="Document actions"]',
      );
      await expect(menuButton).toBeVisible({ timeout: 3000 });
      await menuButton.click();

      const contextMenu = page.getByRole("menu", { name: "Context menu" });
      await expect(contextMenu).toBeVisible({ timeout: 3000 });
    });

    test("right-click opens context menu", async ({ page }) => {
      await page.goto("/docs");

      const firstDoc = page.getByTestId("doc-item").first();

      await expect(firstDoc).toBeVisible({ timeout: 5000 });
      await firstDoc.click({ button: "right" });

      const contextMenu = page.getByRole("menu", { name: "Context menu" });
      await expect(contextMenu).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe("Programs", () => {
    test("right-click on program row opens context menu", async ({ page }) => {
      await page.goto("/programs");
      await waitForTableData(page);

      const firstRow = page.locator("tbody tr").first();
      await expect(firstRow).toBeVisible({ timeout: 5000 });
      await firstRow.click({ button: "right" });

      const contextMenu = page.getByRole("menu", { name: "Context menu" });
      await expect(contextMenu).toBeVisible({ timeout: 3000 });
      await expect(contextMenu.getByText(/archive/i)).toBeVisible();
    });
  });

  test.describe("Issues Sidebar", () => {
    test("right-click on issue row opens context menu", async ({ page }) => {
      await page.goto("/issues");

      await page.getByRole("button", { name: "List view" }).click();
      await waitForTableData(page, '[aria-label="Issues list"] tbody tr');

      const firstRow = page
        .locator('[aria-label="Issues list"] tbody tr')
        .first();
      await expect(firstRow).toBeVisible({ timeout: 10000 });
      await firstRow.click({ button: "right" });

      const contextMenu = page.getByRole("menu", { name: "Context menu" });
      await expect(contextMenu).toBeVisible({ timeout: 3000 });
      await expect(
        contextMenu.getByRole("menuitem", { name: "Change Status" }),
      ).toBeVisible();
    });
  });
});

test.describe("Context Menus - Team Directory", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("dev@ship.local");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL("/login", { timeout: 5000 });
  });

  test("right-click on team member shows context menu", async ({ page }) => {
    await page.goto("/team/directory");
    await waitForTableData(page);

    const memberRow = page.locator("tbody tr").first();
    await expect(memberRow).toBeVisible({ timeout: 5000 });
    await memberRow.click({ button: "right" });

    const contextMenu = page.getByRole("menu", { name: "Context menu" });
    await expect(contextMenu).toBeVisible({ timeout: 3000 });
    await expect(contextMenu.getByText(/view profile/i)).toBeVisible();
  });
});

test.describe("Context Menus - Kanban Board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("dev@ship.local");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL("/login", { timeout: 5000 });
  });

  test("right-click on kanban card shows context menu", async ({ page }) => {
    await page.goto("/issues");

    await page.getByRole("button", { name: "Kanban view" }).click();
    const card = page.locator('[data-issue][role="button"]').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click({ button: "right" });

    const contextMenu = page.getByRole("menu", { name: "Context menu" });
    await expect(contextMenu).toBeVisible({ timeout: 3000 });
  });

  test("three-dot menu on kanban card opens context menu", async ({ page }) => {
    await page.goto("/issues");

    await page.getByRole("button", { name: "Kanban view" }).click();
    const card = page.locator('[data-issue][role="button"]').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.hover();

    const menuButton = card.getByRole("button", {
      name: /more actions for issue/i,
    });
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();

    const contextMenu = page.getByRole("menu", { name: "Context menu" });
    await expect(contextMenu).toBeVisible({ timeout: 3000 });
  });
});
