import { useEffect, useState } from 'react';

import { useIsMobile } from '../hooks/useIsMobile.js';
import { isBrowserRuntime } from '../runtime.js';
import type { BattleLayout } from './battleLayout.js';
import { battleLayout } from './battleLayout.js';

const sample = (mobile: boolean): BattleLayout =>
  battleLayout({
    browser: isBrowserRuntime,
    mobile,
    width: window.innerWidth,
    height: window.innerHeight,
  });

/**
 * The Battle Simulator's layout (battleLayout.ts decides), live: rotating
 * the phone or resizing the window across a threshold re-renders. The
 * orientation media query catches a rotation even where the resize event
 * lags it; the resize listener catches the thresholds within one.
 */
export function useBattleLayout(): BattleLayout {
  const mobile = useIsMobile();
  const [layout, setLayout] = useState(() => sample(mobile));

  useEffect(() => {
    const update = () => setLayout(sample(mobile));
    update();
    if (!isBrowserRuntime) return;
    const orientation = window.matchMedia('(orientation: landscape)');
    orientation.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      orientation.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [mobile]);

  return layout;
}
