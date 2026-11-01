#!/usr/bin/env node
// Builds the Battle Simulator as a static site (Netlify): no PixelBattles server.
//   1. the webview SPA, built with VITE_STATIC_SITE=1 (sprites decoded in the
//      browser, chat straight to the visitor's own Ollama);
//   2. battles/ copied next to it, plus battles/catalog.json (what the
//      server's GET /api/battles returns), so the selector has its list.
// Output: dist/webview — the folder netlify.toml publishes.
// Usage: node scripts/build-static-site.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'webview');
const battlesSrc = path.join(root, 'battles');
const battlesOut = path.join(out, 'battles');

execSync('npm run build --workspace webview-ui', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_STATIC_SITE: '1' },
});

fs.rmSync(battlesOut, { recursive: true, force: true });
fs.cpSync(battlesSrc, battlesOut, { recursive: true });

/** "490 BCE" → -490, "1942–1943 CE" → 1942 (same order as the server's catalog). */
const yearValue = (label) => {
  const n = parseInt(/(\d+)/.exec(String(label))?.[1] ?? '0', 10);
  return /BCE|BC/i.test(String(label)) ? -n : n;
};
const scenarioDir = path.join(battlesSrc, 'scenarios');
const battles = fs
  .readdirSync(scenarioDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(scenarioDir, f), 'utf8')))
  .map(({ id, title, year, location, summary, sides, victor }) => ({
    id,
    title,
    year,
    location,
    summary,
    sides,
    victor,
  }))
  .sort((a, b) => yearValue(a.year) - yearValue(b.year));
fs.writeFileSync(path.join(battlesOut, 'catalog.json'), JSON.stringify({ battles }, null, 2));

console.log(`✓ Static site in dist/webview (${battles.length} battles)`);
