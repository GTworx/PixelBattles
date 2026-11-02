import { TOUCH_TAP_MAX_DURATION_MS } from '../constants.js';
import type { TouchPoint } from '../touch/touchPrimitives.js';
import { findTouch, withinTapSlop } from '../touch/touchPrimitives.js';

/**
 * Touch on the battle map, as a pure state machine (DOM-free, tested on the
 * Node runner); BattleCanvas feeds it native touch events and applies the
 * result. One finger pans, two fingers pinch-zoom about their midpoint (and
 * pan with it), a short still touch is a tap (= a click: select a unit).
 *
 * Touch points are in canvas CSS px (relative to the canvas's top-left);
 * the view is in device px, like the mouse path.
 */

export interface BattleViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface BattleTouchContext {
  view: BattleViewport;
  dpr: number;
  /** Canvas size in device px. */
  width: number;
  height: number;
  clampZoom: (zoom: number) => number;
}

interface Anchor {
  pan0X: number;
  pan0Y: number;
}

type OneFinger = {
  mode: 'tap' | 'pan';
  id: number;
  startX: number;
  startY: number;
  t0: number;
} & Anchor;

export type BattleTouchState =
  | { mode: 'idle' }
  | OneFinger
  | ({
      mode: 'pinch';
      a: number;
      b: number;
      midX: number;
      midY: number;
      dist: number;
      zoom0: number;
    } & Anchor);

export interface BattleTouchEvent {
  type: 'start' | 'move' | 'end' | 'cancel';
  /** Fingers still on the glass after this event. */
  touches: readonly TouchPoint[];
  /** Fingers this event is about. */
  changed: readonly TouchPoint[];
  t: number;
}

export interface BattleTouchStep {
  state: BattleTouchState;
  /** The new view, when the gesture moved the map. */
  view?: BattleViewport;
  /** A tap at this canvas point (device px). */
  tap?: { x: number; y: number };
}

export const initialBattleTouchState: BattleTouchState = { mode: 'idle' };

/**
 * Zoom to `next`, keeping the map point under `p` (device px) still. The
 * wheel and the pinch share it.
 */
export function zoomAbout(
  view: BattleViewport,
  p: { x: number; y: number },
  next: number,
  width: number,
  height: number,
): BattleViewport {
  const cx = p.x - width / 2 - view.panX;
  const cy = p.y - height / 2 - view.panY;
  return {
    zoom: next,
    panX: view.panX - cx * (next / view.zoom - 1),
    panY: view.panY - cy * (next / view.zoom - 1),
  };
}

function single(touch: TouchPoint, t: number, view: BattleViewport): OneFinger {
  return {
    mode: 'tap',
    id: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    t0: t,
    pan0X: view.panX,
    pan0Y: view.panY,
  };
}

function pinch(a: TouchPoint, b: TouchPoint, view: BattleViewport): BattleTouchState {
  return {
    mode: 'pinch',
    a: a.identifier,
    b: b.identifier,
    midX: (a.clientX + b.clientX) / 2,
    midY: (a.clientY + b.clientY) / 2,
    dist: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
    zoom0: view.zoom,
    pan0X: view.panX,
    pan0Y: view.panY,
  };
}

export function reduceBattleTouch(
  state: BattleTouchState,
  event: BattleTouchEvent,
  ctx: BattleTouchContext,
): BattleTouchStep {
  const { touches } = event;
  switch (event.type) {
    case 'start': {
      // A second finger turns any tap/pan into a pinch, measured from now.
      if (touches.length >= 2) return { state: pinch(touches[0], touches[1], ctx.view) };
      if (touches.length === 1) return { state: single(touches[0], event.t, ctx.view) };
      return { state };
    }

    case 'move': {
      if (state.mode === 'pinch') {
        const a = findTouch(touches, state.a);
        const b = findTouch(touches, state.b);
        if (!a || !b) return { state };
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const zoom = ctx.clampZoom(state.zoom0 * (dist / state.dist));
        // The map point under the starting midpoint follows the midpoint.
        const mx = ((a.clientX + b.clientX) / 2) * ctx.dpr;
        const my = ((a.clientY + b.clientY) / 2) * ctx.dpr;
        const rx = (state.midX * ctx.dpr - ctx.width / 2 - state.pan0X) / state.zoom0;
        const ry = (state.midY * ctx.dpr - ctx.height / 2 - state.pan0Y) / state.zoom0;
        return {
          state,
          view: {
            zoom,
            panX: mx - ctx.width / 2 - rx * zoom,
            panY: my - ctx.height / 2 - ry * zoom,
          },
        };
      }
      if (state.mode === 'idle') return { state };
      const t = findTouch(touches, state.id);
      if (!t) return { state };
      const dx = t.clientX - state.startX;
      const dy = t.clientY - state.startY;
      if (state.mode === 'tap' && withinTapSlop(dx, dy)) return { state };
      return {
        state: state.mode === 'pan' ? state : { ...state, mode: 'pan' },
        view: {
          zoom: ctx.view.zoom,
          panX: state.pan0X + dx * ctx.dpr,
          panY: state.pan0Y + dy * ctx.dpr,
        },
      };
    }

    case 'end': {
      if (state.mode === 'idle') return { state };
      if (touches.length === 0) {
        if (state.mode === 'tap' && event.t - state.t0 <= TOUCH_TAP_MAX_DURATION_MS) {
          const t = findTouch(event.changed, state.id);
          if (t) {
            return {
              state: initialBattleTouchState,
              tap: { x: t.clientX * ctx.dpr, y: t.clientY * ctx.dpr },
            };
          }
        }
        return { state: initialBattleTouchState };
      }
      // One pinch finger lifted: carry on as a pan from the one left (never
      // a tap — the gesture already moved the map).
      if (state.mode === 'pinch' && touches.length === 1) {
        return { state: { ...single(touches[0], event.t, ctx.view), mode: 'pan' } };
      }
      return { state };
    }

    case 'cancel':
      return { state: initialBattleTouchState };
  }
}
