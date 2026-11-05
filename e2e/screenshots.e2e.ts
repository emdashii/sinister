/** Writes docs/screenshots/: phone and desktop widths, light and dark, both hands. */
import { test } from "@playwright/test";

const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 860 } };
const PAGES = {
  sinister: "/?f=c~00015568-n&f=t~45~lives%20in%20water",
  dexter: "/?hand=right&f=t~45~food%20and%20drink",
};

for (const [hand, url] of Object.entries(PAGES))
  for (const [size, viewport] of Object.entries(VIEWPORTS))
    for (const scheme of ["light", "dark"] as const)
      test(`screenshot ${hand} ${size} ${scheme}`, async ({ browser }) => {
        const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: size === "phone" ? 2 : 1, hasTouch: size === "phone" });
        const page = await context.newPage();
        await page.goto(url);
        await page.waitForFunction(() => document.querySelectorAll("#words li").length > 0 && !document.querySelector(".chip.pending"), null, { timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `docs/screenshots/${hand}-${size}-${scheme}.png` });
        await context.close();
      });
