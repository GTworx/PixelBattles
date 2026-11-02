import { SPLASH_MIN_VISIBLE_MS, SPLASH_REMOVE_FALLBACK_MS } from './constants.js';
import { isE2E } from './runtime.js';

/**
 * Fades out and removes the opening splash (#splash in index.html) once the
 * app is ready. Idempotent. The e2e harness gets it removed at once, so no
 * test has to wait out the animation.
 */
export function dismissSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.state) return;
  if (isE2E) {
    splash.remove();
    return;
  }
  const shownAt = Number(splash.dataset.shownAt) || 0;
  splash.dataset.state = 'waiting';
  const remove = () => splash.remove();
  setTimeout(
    () => {
      splash.dataset.state = 'leaving';
      splash.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, SPLASH_REMOVE_FALLBACK_MS);
    },
    Math.max(0, shownAt + SPLASH_MIN_VISIBLE_MS - performance.now()),
  );
}
