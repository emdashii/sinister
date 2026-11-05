/**
 * Runs the semantic-filter spike (spike/spike.ts) in Chromium, once at full speed and
 * once with the CPU slowed 4x as a stand-in for a mid-range phone, and writes the
 * numbers to docs/adr/spike-results.json.
 */
import { test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

test("spike: precomputed vs on-demand vectors", async ({ browser }) => {
  const results: Record<string, unknown> = {};
  for (const [name, rate] of [["desktop", 1], ["cpu4x", 4]] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    // Embed a sample on demand and project the full candidate set from the measured rate.
    await page.goto(`http://localhost:4174/spike/?q=${encodeURIComponent("sounds scary")}&max=${rate === 1 ? 600 : 200}`);
    await page.waitForFunction(() => (window as unknown as { spikeResult?: unknown }).spikeResult, null, { timeout: 290_000 });
    results[name] = await page.evaluate(() => (window as unknown as { spikeResult: unknown }).spikeResult);
    console.log(name, JSON.stringify(results[name]));
    await context.close();
  }
  mkdirSync("docs/adr", { recursive: true });
  writeFileSync("docs/adr/spike-results.json", JSON.stringify(results, null, 2) + "\n");
});
