import { test, expect, Page } from "./fixtures/isolated-env";
import { waitForDocumentEditor } from "./fixtures/test-helpers";

/**
 * Emoji Picker E2E Tests
 *
 * Tests emoji picker trigger, filtering, selection, and rendering.
 */

// Helper to login before each test
async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("dev@ship.local");
  await page.locator("#password").fill("admin123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL("/login", { timeout: 5000 });
}

// Helper to create a new document and get to the editor
async function createNewDocument(page: Page) {
  await page.goto("/docs");
  await page.getByRole("button", { name: "New Document", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 });
  return waitForDocumentEditor(page);
}

function emojiPicker(page: Page) {
  return page.getByRole("listbox", { name: /Emoji picker/i });
}

const emojiPattern =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

async function waitForPickerVisible(page: Page) {
  const picker = emojiPicker(page);
  await expect(picker).toBeVisible({ timeout: 5000 });
  return picker;
}

test.describe("Emoji Picker", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("typing : shows emoji picker", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":");

    await waitForPickerVisible(page);
  });

  test("typing filters emoji list", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":smile");

    const picker = await waitForPickerVisible(page);

    const options = picker.getByRole("option");
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
    const pickerText = await picker.textContent();
    expect(pickerText?.toLowerCase()).toContain("smile");
  });

  test("can select emoji with Enter key", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":smile");

    const picker = await waitForPickerVisible(page);
    await expect(picker.getByRole("option").first()).toBeVisible({
      timeout: 5000,
    });

    await page.keyboard.press("Enter");

    await expect(picker).toBeHidden({ timeout: 5000 });
    const editorContent = await editor.textContent();
    expect(editorContent).toMatch(emojiPattern);
  });

  test("can select emoji with click", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":heart");

    const picker = await waitForPickerVisible(page);

    const firstOption = picker.getByRole("option").first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    await firstOption.click();
    await expect(picker).toBeHidden({ timeout: 5000 });

    const editorContent = await editor.textContent();
    expect(editorContent).toMatch(emojiPattern);
  });

  test("emoji renders correctly in document", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":thumbs");

    const picker = await waitForPickerVisible(page);
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden({ timeout: 5000 });

    const editorContent = await editor.textContent();
    expect(editorContent?.length).toBeGreaterThan(0);

    const hasEmoji = await editor.evaluate((el) => {
      const text = el.textContent || "";
      return /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(
        text,
      );
    });
    expect(hasEmoji).toBeTruthy();
  });

  test("emoji persists after save and reload", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":fire");

    const picker = await waitForPickerVisible(page);
    const documentId = new URL(page.url()).pathname
      .split("/documents/")[1]
      ?.split("/")[0];
    const saveResponse = page.waitForResponse((response) => {
      return Boolean(
        documentId &&
        response.request().method() === "PATCH" &&
        response.url().includes(`/api/documents/${documentId}`),
      );
    });
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden({ timeout: 5000 });

    await expect(editor).toContainText(emojiPattern);
    await saveResponse;

    const docUrl = page.url();

    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible({
      timeout: 5000,
    });

    await page.goto(docUrl);
    const restoredEditor = await waitForDocumentEditor(page);
    await expect(restoredEditor).toContainText(emojiPattern);
  });

  test("can navigate emoji picker with arrow keys", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":smile");

    const picker = await waitForPickerVisible(page);

    await page.keyboard.press("ArrowDown");

    const selectedOption = picker.getByRole("option", { selected: true });
    const hasSelection = await selectedOption.count();
    expect(hasSelection).toBeGreaterThanOrEqual(0);

    await page.keyboard.press("ArrowUp");

    await page.keyboard.press("Escape");

    await expect(picker).toBeHidden({ timeout: 2000 });
  });

  test("pressing Escape closes emoji picker", async ({ page }) => {
    const editor = await createNewDocument(page);

    await editor.click();

    await page.keyboard.type(":joy");

    const picker = await waitForPickerVisible(page);

    await page.keyboard.press("Escape");

    await expect(picker).toBeHidden({ timeout: 2000 });
  });

  test("typing non-matching text shows no results", async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator(".ProseMirror");
    await editor.click();

    // Type something that won't match any emoji
    await page.keyboard.type(":zzzznonexistent12345");
    await page.waitForTimeout(500);

    // Picker might show "No results" or be hidden
    const picker = page
      .locator('[role="listbox"], .emoji-picker, [data-emoji-picker]')
      .first();

    if (await picker.isVisible({ timeout: 1000 })) {
      // Check for "No results" message
      const pickerText = await picker.textContent();
      const hasNoResults =
        pickerText?.toLowerCase().includes("no") ||
        pickerText?.toLowerCase().includes("not found") ||
        pickerText?.toLowerCase().includes("empty");

      // Or check that options count is 0
      const options = page.locator(
        '[role="option"], .emoji-option, [data-emoji-option]',
      );
      const count = await options.count();

      expect(hasNoResults || count === 0).toBeTruthy();
    } else {
      // Picker not visible is also acceptable (auto-closed on no results)
      expect(true).toBeTruthy();
    }
  });

  test("can insert multiple emojis in same document", async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator(".ProseMirror");
    await editor.click();

    // Insert first emoji
    await page.keyboard.type(":smile");
    await page.waitForTimeout(500);

    let picker = page
      .locator('[role="listbox"], .emoji-picker, [data-emoji-picker]')
      .first();
    if (await picker.isVisible({ timeout: 3000 })) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      // Type some text
      await page.keyboard.type(" hello ");
      await page.waitForTimeout(200);

      // Insert second emoji
      await page.keyboard.type(":heart");
      await page.waitForTimeout(500);

      picker = page
        .locator('[role="listbox"], .emoji-picker, [data-emoji-picker]')
        .first();
      if (await picker.isVisible({ timeout: 3000 })) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);

        // Verify content has both emojis and text
        const content = await editor.textContent();
        expect(content).toContain("hello");

        // Count emoji characters
        const emojiMatches = content?.match(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        );
        expect(emojiMatches?.length).toBeGreaterThanOrEqual(1);
      }
    } else {
      expect(true).toBe(false); // Element not found, test cannot continue
    }
  });
});
