#!/usr/bin/env node
// Renders scripts/og-image.html to webview-ui/public/og-image.png — the image
// chat apps and social sites show when a PixelBattles link is shared.
// Uses the installed Google Chrome, falling back to Playwright's Chromium
// (`npx playwright install chromium`).
// Usage: node scripts/generate-og-image.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'scripts', 'og-image.html');
const out = path.join(root, 'webview-ui', 'public', 'og-image.png');

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  // networkidle: the character sprites are CSS backgrounds, not <img>s.
  await page.goto(pathToFileURL(template).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`✓ ${path.relative(root, out)}`);
