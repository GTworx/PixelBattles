import {
  BATTLE_PHONE_LANDSCAPE_MAX_HEIGHT_PX,
  BATTLE_PHONE_LANDSCAPE_MAX_WIDTH_PX,
} from '../constants.js';

/**
 * Which layout the Battle Simulator uses. A pure decision over viewport
 * samples (Node-runner tested); useBattleLayout feeds it.
 *
 * - desktop:    top bar, map, and the side panel (phase + chat) beside it.
 *               Desktop browsers and the VS Code webview always get this.
 * - compact:    phone-sized (portrait, or a touch tablet): a wrapping
 *               toolbar, the map as the main page and the war-room chat as
 *               a second page a swipe away.
 * - fullscreen: a phone on its side: the map fills the screen, the toolbars
 *               shrink to a minimal overlay.
 */
export type BattleLayout = 'desktop' | 'compact' | 'fullscreen';

export interface BattleLayoutSample {
  /** Browser app (never the VS Code webview). */
  browser: boolean;
  /** MOBILE_MEDIA_QUERY matches (useIsMobile). */
  mobile: boolean;
  /** Viewport size in CSS px. */
  width: number;
  height: number;
}

export function battleLayout(sample: BattleLayoutSample): BattleLayout {
  if (!sample.browser) return 'desktop';
  const landscape = sample.width > sample.height;
  // A phone on its side: short, and either matched by the mobile breakpoint
  // or narrow enough that it can't be a desktop window.
  const phoneOnItsSide =
    landscape &&
    sample.height <= BATTLE_PHONE_LANDSCAPE_MAX_HEIGHT_PX &&
    (sample.mobile || sample.width <= BATTLE_PHONE_LANDSCAPE_MAX_WIDTH_PX);
  if (phoneOnItsSide) return 'fullscreen';
  return sample.mobile ? 'compact' : 'desktop';
}
