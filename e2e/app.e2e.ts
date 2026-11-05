/**
 * Browser checks against the production build (`bun run build`, then `bun run e2e`).
 */
import { expect, test, type Page } from "@playwright/test";

const BIRD = "01505702-n";

async function words(page: Page): Promise<string[]> {
  await page.waitForFunction(() => !document.querySelector(".chip.pending"), null, { timeout: 120_000 });
  return page.locator("#words li").allTextContents();
}

test("a shared Dexter link opens as Dexter", async ({ page }) => {
  await page.goto("/?hand=right");
  await expect(page.locator("#wordmark")).toHaveText("Dexter");
  await expect(page).toHaveTitle(/^Dexter/);
  await expect(page.locator("html")).toHaveAttribute("data-hand", "right");
  await expect(page.locator("#favicon")).toHaveAttribute("href", "/icon-dexter.svg");
  await page.click("#more");
  expect(await words(page)).toEqual(expect.arrayContaining(["lollipop", "monopoly"]));
});

test("switching hands swaps the identity and the URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#wordmark")).toHaveText("Sinister");
  await page.getByRole("radio", { name: "Right hand" }).click();
  await expect(page.locator("#wordmark")).toHaveText("Dexter");
  await expect(page).toHaveURL(/hand=right/);
  await expect(page.locator("#tagline")).toContainText("right hand");
  await page.goBack();
  await expect(page.locator("#wordmark")).toHaveText("Sinister");
});

test("the name explains itself on hover, focus and tap", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await page.goto("/");
  const note = page.locator("#etymology");
  await expect(note).toBeHidden();
  await page.hover("#wordmark");
  await expect(note).toBeVisible();
  await expect(note).toContainText("Latin for left and right");
  await page.mouse.move(0, 0);
  await expect(note).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.locator("#wordmark")).toBeFocused();
  await expect(note).toBeVisible();
  await page.locator("#wordmark").blur();
  await page.tap("#wordmark");
  await expect(note).toBeVisible();
  await expect(page.locator("#wordmark")).toHaveAttribute("aria-expanded", "true");
  await context.close();
});

test("custom keys: tapping a key changes the set and the URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "T", exact: true }).click();
  await expect(page).toHaveURL(/keys=abcdefgqrsvwxz/);
  const list = await words(page);
  expect(list.every((w) => /^[abcdefgqrsvwxz]+$/i.test(w))).toBe(true);
});

test("filters keep working with the network off after the first load", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  // Use each filter once while online.
  await page.goto(`/?f=c~${BIRD}&f=t~45~sounds%20scary`);
  await words(page);
  await page.goto(`/?f=t~45~things%20in%20a%20kitchen`);
  const online = await words(page);
  expect(online.length).toBeGreaterThan(0);

  await context.setOffline(true);
  // A fresh category and a fresh description, both offline.
  await page.goto(`/?f=t~45~things%20in%20a%20kitchen&f=t~0~wood`);
  const offlineText = await words(page);
  expect(offlineText.length).toBeGreaterThan(0);
  expect(await page.locator(".chip.error").count()).toBe(0);
  await page.goto(`/?f=c~${BIRD}`);
  const birds = await words(page);
  expect(birds).toContain("egret");
  await page.click("#add-category");
  await page.fill("#category-search", "wading");
  await expect(page.locator("#category-list li button").first()).toContainText("wading bird");
  await context.setOffline(false);
});
