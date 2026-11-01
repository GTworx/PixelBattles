/**
 * Runtime detection, provider-agnostic
 *
 * Single source of truth for determining whether the webview is running
 * inside an IDE extension (VS Code, Cursor, Windsurf, etc.) or standalone
 * in a browser.
 */

declare function acquireVsCodeApi(): unknown;

type Runtime = 'vscode' | 'browser';
// Future: 'cursor' | 'windsurf' | 'electron' | etc.

const runtime: Runtime = typeof acquireVsCodeApi !== 'undefined' ? 'vscode' : 'browser';

export const isBrowserRuntime = runtime === 'browser';

/**
 * True only under the Playwright e2e harness, which sets `__PIXEL_BATTLES_E2E`
 * via `addInitScript` before any app code runs (so it's set in every frame,
 * including the VS Code webview iframe). Gates test-only diagnostics
 * (window.__pixelBattlesTestHooks message/sound logs, the addAgent wrapper) so
 * they never run, and never grow unbounded, in a real user's session.
 */
export const isE2E: boolean =
  typeof window !== 'undefined' &&
  (window as unknown as { __PIXEL_BATTLES_E2E?: boolean }).__PIXEL_BATTLES_E2E === true;

/**
 * Static-site build (`npm run build:static`, used for Netlify): the SPA is
 * served as plain files with no PixelBattles server behind it. Sprites are
 * decoded in the browser (browserMock), battles are fetched as static JSON,
 * and the battle chat talks to the user's own local Ollama directly.
 */
export const isStaticSite: boolean = import.meta.env.VITE_STATIC_SITE === '1';
