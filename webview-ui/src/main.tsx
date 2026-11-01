import './index.css';
// Bundled by Vite into the SPA's own CSS — the standalone server must serve
// every asset itself (no CDN).
import '@xterm/xterm/css/xterm.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { isBrowserRuntime, isStaticSite } from './runtime';

async function main() {
  // browserMock loads the sprites in the browser when there is no server to
  // send them: Vite dev mode, and the static-site (Netlify) build. In
  // standalone server mode, assets are loaded server-side and sent over WebSocket.
  if (isBrowserRuntime && (import.meta.env.DEV || isStaticSite)) {
    const { initBrowserMock } = await import('./browserMock.js');
    await initBrowserMock();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main().catch(console.error);
