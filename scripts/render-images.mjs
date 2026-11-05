// Render public/apple-touch-icon.png and public/og-image.png with Playwright's Chromium.
// Usage: node scripts/render-images.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const font = readFileSync("node_modules/@fontsource/im-fell-english/files/im-fell-english-latin-400-normal.woff2").toString("base64");
const italic = readFileSync("node_modules/@fontsource/im-fell-english/files/im-fell-english-latin-400-italic.woff2").toString("base64");
const shield = (color, size) => `<svg width="${size}" height="${size * 72 / 64}" viewBox="0 0 64 72"><defs><clipPath id="c"><path d="M4 4h56v30c0 18-12 30-28 35C16 64 4 52 4 34z"/></clipPath></defs><g clip-path="url(#c)"><rect width="64" height="72" fill="#fff"/><path d="M70 -6 L82 6 L-6 94 L-18 82 Z" fill="${color}"/></g><path d="M4 4h56v30c0 18-12 30-28 35C16 64 4 52 4 34z" fill="none" stroke="#1d1f27" stroke-width="2.5"/></svg>`;
const css = `@font-face{font-family:Fell;src:url(data:font/woff2;base64,${font})}@font-face{font-family:Fell;font-style:italic;src:url(data:font/woff2;base64,${italic})}body{margin:0}`;

const browser = await chromium.launch();
const page = await browser.newPage();

await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(`<style>${css}</style><div style="width:180px;height:180px;background:#f3f4f6;display:grid;place-items:center">${shield("#a3122f", 120)}</div>`);
await page.screenshot({ path: "public/apple-touch-icon.png" });

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>${css}</style>
<div style="width:1200px;height:630px;background:#f3f4f6;display:flex;align-items:center;gap:64px;padding:0 96px;box-sizing:border-box;font-family:Fell">
  ${shield("#a3122f", 260)}
  <div>
    <div style="font-size:150px;line-height:1;color:#a3122f">Sinister</div>
    <div style="font-size:40px;font-style:italic;color:#5c6070;margin:16px 0 40px">Words you can type with one hand.</div>
    <div style="font-size:46px;color:#1d1f27;line-height:1.35">stewardesses<br>aftereffects<br>reverberated</div>
  </div>
</div>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "public/og-image.png" });
await browser.close();
