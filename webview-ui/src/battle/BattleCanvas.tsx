import { useEffect, useRef } from 'react';

import {
  BATTLE_FIT_MARGIN,
  BATTLE_MAX_ZOOM,
  BATTLE_MIN_ZOOM,
  BATTLE_RENDER_MAX_ZOOM,
  BATTLE_ZOOM_STEP,
} from '../constants.js';
import { startGameLoop } from '../office/engine/gameLoop.js';
import { TILE_SIZE } from '../office/types.js';
import type { BattleState } from './battleEngine.js';
import { stepBattle } from './battleEngine.js';
import { renderBattle, tileAt, unitAt } from './battleRenderer.js';

interface BattleCanvasProps {
  /** Mutable battle state; the loop steps and draws it every frame. */
  stateRef: { current: BattleState | null };
  playingRef: { current: boolean };
  speedRef: { current: number };
  selectedUnitId: string | null;
  onSelectUnit: (id: string | null) => void;
  /** Right-click on the map: a tile, for "move here" style chat commands. */
  onPickTile?: (tile: [number, number]) => void;
  /** Fired a few times a second so React panels can refresh. */
  onTick: () => void;
  /** Every frame after the step (the sound layer listens here). */
  onFrame?: (state: BattleState, dt: number, playing: boolean) => void;
}

const TICK_INTERVAL_SEC = 0.2;

function clampZoom(z: number): number {
  return Math.max(BATTLE_MIN_ZOOM, Math.min(BATTLE_MAX_ZOOM, z));
}

export function BattleCanvas({
  stateRef,
  playingRef,
  speedRef,
  selectedUnitId,
  onSelectUnit,
  onPickTile,
  onTick,
  onFrame,
}: BattleCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 2, panX: 0, panY: 0, fitted: '' });
  const hovered = useRef<string | null>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const offsets = useRef({ offsetX: 0, offsetY: 0 });
  const selectedRef = useRef(selectedUnitId);
  selectedRef.current = selectedUnitId;
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;

  // Size the canvas to its container in device pixels, and fit the map when
  // a new battle loads.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      view.current.fitted = '';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let tickAcc = 0;
    let time = 0;
    return startGameLoop(canvas, {
      update: (dt) => {
        time += dt;
        const state = stateRef.current;
        if (state && playingRef.current) stepBattle(state, dt * speedRef.current);
        if (state) frameRef.current?.(state, dt * speedRef.current, playingRef.current);
        tickAcc += dt;
        if (tickAcc >= TICK_INTERVAL_SEC) {
          tickAcc = 0;
          tickRef.current();
        }
      },
      render: (ctx) => {
        const state = stateRef.current;
        if (!state) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
        const v = view.current;
        const { cols, rows } = state.scenario.map;
        const worldW = cols * TILE_SIZE;
        const worldH = rows * TILE_SIZE;
        if (v.fitted !== state.scenario.id) {
          const fit = Math.min(canvas.width / worldW, canvas.height / worldH) * BATTLE_FIT_MARGIN;
          v.zoom = clampZoom(fit);
          v.panX = 0;
          v.panY = 0;
          v.fitted = state.scenario.id;
        }
        // Draw at a whole-number zoom (pixel-exact sprites), then scale that
        // picture to the display zoom nearest-neighbour: any zoom stays crisp.
        const rz = Math.min(BATTLE_RENDER_MAX_ZOOM, Math.max(1, Math.ceil(v.zoom)));
        const off = (offscreen.current ??= document.createElement('canvas'));
        if (off.width !== worldW * rz || off.height !== worldH * rz) {
          off.width = worldW * rz;
          off.height = worldH * rz;
        }
        const octx = off.getContext('2d')!;
        octx.imageSmoothingEnabled = false;
        renderBattle(octx, off.width, off.height, state, {
          zoom: rz,
          panX: 0,
          panY: 0,
          selectedUnitId: selectedRef.current,
          hoveredUnitId: hovered.current,
          time,
        });
        const dw = Math.round(worldW * v.zoom);
        const dh = Math.round(worldH * v.zoom);
        const ox = Math.floor((canvas.width - dw) / 2 + v.panX);
        const oy = Math.floor((canvas.height - dh) / 2 + v.panY);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, ox, oy, dw, dh);
        offsets.current = { offsetX: ox, offsetY: oy };
      },
    });
  }, [stateRef, playingRef, speedRef]);

  // Mouse: click selects a unit, drag pans, wheel zooms, right-click picks a tile.
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(
    null,
  );
  const toCanvas = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ imageRendering: 'pixelated', cursor: hovered.current ? 'pointer' : 'grab' }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            panX: view.current.panX,
            panY: view.current.panY,
            moved: false,
          };
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          const dpr = window.devicePixelRatio || 1;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
            view.current.panX = d.panX + dx * dpr;
            view.current.panY = d.panY + dy * dpr;
            return;
          }
          const state = stateRef.current;
          if (!state) return;
          const p = toCanvas(e);
          const u = unitAt(
            state,
            p.x,
            p.y,
            offsets.current.offsetX,
            offsets.current.offsetY,
            view.current.zoom,
          );
          hovered.current = u?.id ?? null;
          e.currentTarget.style.cursor = u ? 'pointer' : 'grab';
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          const state = stateRef.current;
          if (!state) return;
          const p = toCanvas(e);
          const u = unitAt(
            state,
            p.x,
            p.y,
            offsets.current.offsetX,
            offsets.current.offsetY,
            view.current.zoom,
          );
          onSelectUnit(u?.id ?? null);
        }}
        onMouseLeave={() => {
          drag.current = null;
          hovered.current = null;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const state = stateRef.current;
          if (!state || !onPickTile) return;
          const p = toCanvas(e);
          const t = tileAt(
            state,
            p.x,
            p.y,
            offsets.current.offsetX,
            offsets.current.offsetY,
            view.current.zoom,
          );
          if (t) onPickTile(t);
        }}
        onWheel={(e) => {
          const v = view.current;
          const next = clampZoom(
            e.deltaY < 0 ? v.zoom * BATTLE_ZOOM_STEP : v.zoom / BATTLE_ZOOM_STEP,
          );
          if (next === v.zoom) return;
          // Keep the map point under the cursor fixed while zooming.
          const p = toCanvas(e);
          const canvas = canvasRef.current!;
          const cx = p.x - canvas.width / 2 - v.panX;
          const cy = p.y - canvas.height / 2 - v.panY;
          v.panX -= cx * (next / v.zoom - 1);
          v.panY -= cy * (next / v.zoom - 1);
          v.zoom = next;
        }}
      />
    </div>
  );
}
