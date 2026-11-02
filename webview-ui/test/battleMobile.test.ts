import { describe, expect, it } from 'vitest';

import { battleLayout } from '../src/battle/battleLayout.js';
import type {
  BattleTouchContext,
  BattleTouchEvent,
  BattleTouchState,
  BattleViewport,
} from '../src/battle/battleTouch.js';
import {
  initialBattleTouchState,
  reduceBattleTouch,
  zoomAbout,
} from '../src/battle/battleTouch.js';
import { TOUCH_TAP_MAX_DURATION_MS, TOUCH_TAP_MAX_MOVE_PX } from '../src/constants.js';

describe('battleLayout', () => {
  const browser = { browser: true, mobile: false };

  it('keeps desktop for desktop windows and the VS Code webview', () => {
    expect(battleLayout({ ...browser, width: 1440, height: 900 })).toBe('desktop');
    // A short desktop window is not a phone on its side.
    expect(battleLayout({ ...browser, width: 1400, height: 450 })).toBe('desktop');
    // VS Code: never mobile, whatever the panel size.
    expect(battleLayout({ browser: false, mobile: true, width: 812, height: 375 })).toBe('desktop');
  });

  it('uses the compact layout on a phone in portrait', () => {
    expect(battleLayout({ browser: true, mobile: true, width: 375, height: 812 })).toBe('compact');
  });

  it('goes full screen on a phone on its side', () => {
    expect(battleLayout({ browser: true, mobile: true, width: 812, height: 375 })).toBe(
      'fullscreen',
    );
    // The widest phones exceed the mobile breakpoint's width but are short.
    expect(battleLayout({ browser: true, mobile: true, width: 932, height: 430 })).toBe(
      'fullscreen',
    );
    // A narrow, short window without a touch pointer still counts.
    expect(battleLayout({ ...browser, width: 812, height: 375 })).toBe('fullscreen');
  });

  it('keeps a touch tablet on its side in the compact layout', () => {
    expect(battleLayout({ browser: true, mobile: true, width: 1024, height: 768 })).toBe('compact');
  });
});

describe('reduceBattleTouch', () => {
  const view: BattleViewport = { zoom: 2, panX: 0, panY: 0 };
  const ctx = (v: BattleViewport = view): BattleTouchContext => ({
    view: v,
    dpr: 2,
    width: 800,
    height: 600,
    clampZoom: (z) => Math.max(0.5, Math.min(10, z)),
  });
  const pt = (identifier: number, clientX: number, clientY: number) => ({
    identifier,
    clientX,
    clientY,
  });

  function run(events: BattleTouchEvent[], v: BattleViewport = view) {
    let state: BattleTouchState = initialBattleTouchState;
    let current = v;
    const taps: Array<{ x: number; y: number }> = [];
    for (const e of events) {
      const step = reduceBattleTouch(state, e, ctx(current));
      state = step.state;
      if (step.view) current = step.view;
      if (step.tap) taps.push(step.tap);
    }
    return { state, view: current, taps };
  }

  it('turns a short still touch into a tap at device px', () => {
    const r = run([
      { type: 'start', touches: [pt(1, 100, 50)], changed: [pt(1, 100, 50)], t: 0 },
      { type: 'move', touches: [pt(1, 102, 51)], changed: [pt(1, 102, 51)], t: 50 },
      { type: 'end', touches: [], changed: [pt(1, 102, 51)], t: 100 },
    ]);
    expect(r.taps).toEqual([{ x: 204, y: 102 }]);
    expect(r.view).toEqual(view);
    expect(r.state.mode).toBe('idle');
  });

  it('is no tap when held too long', () => {
    const r = run([
      { type: 'start', touches: [pt(1, 100, 50)], changed: [pt(1, 100, 50)], t: 0 },
      { type: 'end', touches: [], changed: [pt(1, 100, 50)], t: TOUCH_TAP_MAX_DURATION_MS + 1 },
    ]);
    expect(r.taps).toEqual([]);
  });

  it('pans past the tap slop, in device px, and never taps', () => {
    const far = 100 + TOUCH_TAP_MAX_MOVE_PX + 20;
    const r = run([
      { type: 'start', touches: [pt(1, 100, 50)], changed: [pt(1, 100, 50)], t: 0 },
      { type: 'move', touches: [pt(1, far, 50)], changed: [pt(1, far, 50)], t: 30 },
      { type: 'end', touches: [], changed: [pt(1, far, 50)], t: 60 },
    ]);
    expect(r.view).toEqual({ zoom: 2, panX: (far - 100) * 2, panY: 0 });
    expect(r.taps).toEqual([]);
  });

  it('pinch zooms about the midpoint, keeping that map point still', () => {
    const r = run([
      { type: 'start', touches: [pt(1, 100, 100)], changed: [pt(1, 100, 100)], t: 0 },
      {
        type: 'start',
        touches: [pt(1, 100, 100), pt(2, 200, 100)],
        changed: [pt(2, 200, 100)],
        t: 10,
      },
      // Fingers spread to twice the distance around the same midpoint.
      {
        type: 'move',
        touches: [pt(1, 50, 100), pt(2, 250, 100)],
        changed: [pt(1, 50, 100), pt(2, 250, 100)],
        t: 40,
      },
    ]);
    expect(r.view.zoom).toBe(4);
    // Same as zooming about the midpoint (150, 100) css = (300, 200) device.
    expect(r.view).toEqual(zoomAbout(view, { x: 300, y: 200 }, 4, 800, 600));
  });

  it('clamps the pinch zoom', () => {
    const r = run([
      {
        type: 'start',
        touches: [pt(1, 100, 100), pt(2, 110, 100)],
        changed: [pt(1, 100, 100), pt(2, 110, 100)],
        t: 0,
      },
      {
        type: 'move',
        touches: [pt(1, 0, 100), pt(2, 400, 100)],
        changed: [pt(1, 0, 100), pt(2, 400, 100)],
        t: 30,
      },
    ]);
    expect(r.view.zoom).toBe(10);
  });

  it('continues as a pan from the finger left after a pinch, and does not tap', () => {
    const r = run([
      {
        type: 'start',
        touches: [pt(1, 100, 100), pt(2, 200, 100)],
        changed: [pt(1, 100, 100), pt(2, 200, 100)],
        t: 0,
      },
      { type: 'end', touches: [pt(1, 100, 100)], changed: [pt(2, 200, 100)], t: 20 },
      { type: 'move', touches: [pt(1, 110, 100)], changed: [pt(1, 110, 100)], t: 30 },
      { type: 'end', touches: [], changed: [pt(1, 110, 100)], t: 40 },
    ]);
    expect(r.view.panX).toBe(20);
    expect(r.taps).toEqual([]);
  });

  it('drops the gesture on cancel (an edge swipe claimed the touch)', () => {
    const r = run([
      { type: 'start', touches: [pt(1, 100, 50)], changed: [pt(1, 100, 50)], t: 0 },
      { type: 'cancel', touches: [], changed: [pt(1, 100, 50)], t: 20 },
      { type: 'end', touches: [], changed: [pt(1, 100, 50)], t: 40 },
    ]);
    expect(r.taps).toEqual([]);
    expect(r.state.mode).toBe('idle');
  });
});
