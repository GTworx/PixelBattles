/**
 * Draws a battle: terrain tiles, walls (the office wall auto-tiles), trees,
 * mountains and houses as z-sorted props, then each unit as a small formation
 * of office characters (mounted on horses, elephants, guns, ships or tanks by
 * unit type) under a banner in its side's colour.
 */
import {
  BATTLE_BANNER_TEXT_COLOR,
  BATTLE_CLASH_COLOR,
  BATTLE_LABEL_COLOR,
  BATTLE_LABEL_SHADOW_COLOR,
  BATTLE_MAX_SOLDIERS_PER_UNIT,
  BATTLE_MIN_SOLDIERS_PER_UNIT,
  BATTLE_PROJECTILE_FLIGHT_SEC,
  BATTLE_SELECTION_COLOR,
  BATTLE_WALL_COLOR,
  TYPE_FRAME_DURATION_SEC,
} from '../constants.js';
import { getCharacterSprite } from '../office/engine/characters.js';
import { mapOffset } from '../office/projection.js';
import { FLAG_H, getFlagSprite } from '../office/sprites/battleFlags.js';
import {
  ARROW_FLETCH_COLOR,
  ARROW_HEAD_COLOR,
  ARROW_SHAFT_COLOR,
  BANNER_POLE_COLOR,
  CANNON_SPRITE,
  CANNONBALL_COLOR,
  DUST_COLOR,
  ELEPHANT_SPRITE,
  FIRE_COLORS,
  FIRE_SMOKE_COLOR,
  getTerrainSprite,
  HORSE_SPRITE,
  HOUSE_SPRITE,
  MOUNTAIN_SPRITE,
  MUZZLE_FLASH_COLORS,
  RUIN_SPRITE,
  SHIP_SPRITE,
  SIEGE_SPRITE,
  SMOKE_COLOR,
  STONE_COLOR,
  TANK_SPRITE,
  terrainVariant,
  TREE_SPRITE,
} from '../office/sprites/battleSprites.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  SpriteData,
  TileType as TileTypeVal,
} from '../office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../office/types.js';
import { getWallInstances, hasWallSprites } from '../office/wallTiles.js';
import type { Fire } from './battleEffects.js';
import type { BattleState, SimUnit } from './battleEngine.js';
import { UNIT_STATS } from './battleRules.js';
import type { Facing, Scenario, SideId, UnitType } from './battleTypes.js';

const WALK_FRAME_SEC = 0.15;
/** Two character palettes per side, alternating through the ranks. */
const SIDE_PALETTES: Record<SideId, [number, number]> = { A: [0, 2], B: [3, 5] };
const FACING_TO_DIR: Record<Facing, Direction> = {
  down: Direction.DOWN,
  left: Direction.LEFT,
  right: Direction.RIGHT,
  up: Direction.UP,
};

const MOUNTED: ReadonlySet<UnitType> = new Set([
  'cavalry',
  'heavy_cavalry',
  'horse_archers',
  'chariots',
]);

export interface BattleView {
  zoom: number;
  panX: number;
  panY: number;
  selectedUnitId: string | null;
  hoveredUnitId: string | null;
  /** Wall-clock seconds, for animation frames. */
  time: number;
}

interface Drawable {
  zY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

// ── Static map layers (cached per scenario + zoom) ──────────────

interface MapCache {
  key: string;
  terrain: HTMLCanvasElement;
  props: FurnitureInstance[];
  maxStrength: number;
}
let mapCache: MapCache | null = null;

function buildMapCache(scenario: Scenario, zoom: number): MapCache {
  const { cols, rows, terrain } = scenario.map;
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_SIZE * zoom;
  canvas.height = rows * TILE_SIZE * zoom;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = terrain[r]?.[c] ?? '.';
      // Wall tiles draw a ground tile underneath; the wall sprite stands on it.
      const ground = ch === '#' ? 'r' : ch;
      const sprite = getTerrainSprite(ground, terrainVariant(c, r));
      ctx.drawImage(getCachedSprite(sprite, zoom), c * TILE_SIZE * zoom, r * TILE_SIZE * zoom);
    }
  }

  const props: FurnitureInstance[] = [];
  const prop = (sprite: SpriteData, c: number, r: number, dx = 0, dy = 0) => {
    const h = sprite.length;
    const w = sprite[0]?.length ?? TILE_SIZE;
    const x = c * TILE_SIZE + (TILE_SIZE - w) / 2 + dx;
    const y = (r + 1) * TILE_SIZE - h + dy;
    props.push({ sprite, x, y, zY: (r + 1) * TILE_SIZE + dy });
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = terrain[r]?.[c];
      const v = terrainVariant(c, r);
      if (ch === 'T') prop(TREE_SPRITE, c, r, v - 2, -2);
      else if (ch === 'M') prop(MOUNTAIN_SPRITE, c, r, 0, 0);
      else if (ch === 'c' && v < 2) prop(HOUSE_SPRITE, c, r, 0, -2);
      else if (ch === 'r' && v === 0) prop(RUIN_SPRITE, c, r, 0, -3);
    }
  }
  if (hasWallSprites()) {
    const tileMap: TileTypeVal[][] = terrain.map((row) =>
      [...row].map((ch) => (ch === '#' ? TileType.WALL : TileType.FLOOR_1)),
    );
    const colors = terrain.flatMap((row) =>
      [...row].map((ch) => (ch === '#' ? BATTLE_WALL_COLOR : null)),
    );
    props.push(...getWallInstances(tileMap, colors, cols));
  }
  const maxStrength = Math.max(1, ...scenario.units.map((u) => u.strength));
  return { key: `${scenario.id}:${zoom}`, terrain: canvas, props, maxStrength };
}

/** Floor/wall sprites reload with the office assets — rebuild after that. */
export function invalidateBattleMapCache(): void {
  mapCache = null;
}

// ── Frame ───────────────────────────────────────────────────────

export function renderBattle(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  state: BattleState,
  view: BattleView,
): { offsetX: number; offsetY: number } {
  const { scenario } = state;
  const { cols, rows } = scenario.map;
  const { zoom } = view;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const { offsetX, offsetY } = mapOffset(
    canvasWidth,
    canvasHeight,
    cols,
    rows,
    zoom,
    view.panX,
    view.panY,
  );

  const key = `${scenario.id}:${zoom}`;
  if (!mapCache || mapCache.key !== key) mapCache = buildMapCache(scenario, zoom);
  ctx.drawImage(mapCache.terrain, offsetX, offsetY);

  const sideColor: Record<SideId, string> = {
    A: scenario.sides[0].color,
    B: scenario.sides[1].color,
  };
  const sideFlag: Record<SideId, SpriteData> = {
    A: getFlagSprite(scenario.sides[0].flag, sideColor.A),
    B: getFlagSprite(scenario.sides[1].flag, sideColor.B),
  };

  // Ground markers under each unit (drawn flat, before anything stands up).
  for (const u of state.units) {
    if (!u.visible) continue;
    drawUnitBase(ctx, u, sideColor[u.side], offsetX, offsetY, zoom, u.id === view.selectedUnitId);
  }

  const drawables: Drawable[] = [];
  for (const f of mapCache.props) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = Math.round(offsetX + f.x * zoom);
    const fy = Math.round(offsetY + f.y * zoom);
    drawables.push({ zY: f.zY, draw: (c) => c.drawImage(cached, fx, fy) });
  }
  for (const u of state.units) {
    if (!u.visible) continue;
    pushUnitDrawables(
      drawables,
      u,
      mapCache.maxStrength,
      offsetX,
      offsetY,
      zoom,
      view.time,
      sideFlag[u.side],
    );
  }
  for (const fire of state.fires) {
    pushFireDrawable(drawables, fire, offsetX, offsetY, zoom, view.time);
  }
  drawables.sort((a, b) => a.zY - b.zY);
  for (const d of drawables) d.draw(ctx);

  drawClashes(ctx, state, offsetX, offsetY, zoom, view.time);
  drawProjectiles(ctx, state, offsetX, offsetY, zoom);
  drawEffects(ctx, state, offsetX, offsetY, zoom);
  drawMapLabels(ctx, scenario, offsetX, offsetY, zoom);
  for (const u of state.units) {
    if (!u.visible) continue;
    drawBanner(
      ctx,
      u,
      sideColor[u.side],
      sideFlag[u.side],
      offsetX,
      offsetY,
      zoom,
      u.id === view.hoveredUnitId,
    );
  }
  return { offsetX, offsetY };
}

function unitPx(u: SimUnit): { x: number; y: number } {
  return { x: (u.x + 0.5) * TILE_SIZE, y: (u.y + 0.5) * TILE_SIZE };
}

function drawUnitBase(
  ctx: CanvasRenderingContext2D,
  u: SimUnit,
  color: string,
  ox: number,
  oy: number,
  zoom: number,
  selected: boolean,
): void {
  const { x, y } = unitPx(u);
  const cx = ox + x * zoom;
  const cy = oy + (y + 4) * zoom;
  ctx.save();
  ctx.globalAlpha = u.status === 'active' ? 0.35 : 0.15;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 18 * zoom, 8 * zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = BATTLE_SELECTION_COLOR;
    ctx.lineWidth = Math.max(1, zoom);
    ctx.setLineDash([2 * zoom, 2 * zoom]);
    ctx.stroke();
  }
  ctx.restore();
}

/** Soldier slots around the unit centre: ranks perpendicular to its facing. */
function formation(n: number, facing: Facing): Array<{ dx: number; dy: number }> {
  const perRank = Math.min(4, n);
  const slots: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < n; i++) {
    const rank = Math.floor(i / perRank);
    const file = i % perRank;
    const inRank = Math.min(perRank, n - rank * perRank);
    const across = (file - (inRank - 1) / 2) * 10;
    const depth = rank * 8 - 4;
    const horizontal = facing === 'left' || facing === 'right';
    const sign = facing === 'down' || facing === 'right' ? -1 : 1;
    slots.push(
      horizontal ? { dx: depth * sign, dy: across * 0.8 } : { dx: across, dy: depth * sign },
    );
  }
  return slots;
}

function soldierCount(u: SimUnit, maxStrength: number): number {
  const span = BATTLE_MAX_SOLDIERS_PER_UNIT - BATTLE_MIN_SOLDIERS_PER_UNIT;
  const n = BATTLE_MIN_SOLDIERS_PER_UNIT + Math.round(span * Math.sqrt(u.strength / maxStrength));
  if (u.type === 'armor' || u.type === 'ships' || u.type === 'elephants')
    return Math.max(1, Math.ceil(n / 2));
  if (u.type === 'command') return 2;
  return n;
}

function pushUnitDrawables(
  out: Drawable[],
  u: SimUnit,
  maxStrength: number,
  ox: number,
  oy: number,
  zoom: number,
  time: number,
  flag: SpriteData,
): void {
  const { x: ux, y: uy } = unitPx(u);
  const fighting = u.status === 'active' && (!!u.engagedWith || !!u.firingAt);
  const moving = u.moving;
  const alpha = u.status === 'active' ? 1 : u.status === 'surrendered' ? 0.55 : 0.6;
  const mirror = u.facing === 'left';
  const slots = formation(soldierCount(u, maxStrength), u.facing);
  const [palA, palB] = SIDE_PALETTES[u.side];

  slots.forEach((slot, i) => {
    const px = ux + slot.dx;
    const py = uy + slot.dy;
    const zY = py + TILE_SIZE / 2;
    const vehicle = vehicleSprite(u.type);
    if (vehicle) {
      const cached = getCachedSprite(vehicle, zoom);
      const vx = Math.round(ox + px * zoom - cached.width / 2);
      const vy = Math.round(oy + (py + 4) * zoom - cached.height);
      out.push({ zY: zY - 0.1, draw: (c) => drawImage(c, cached, vx, vy, mirror, alpha) });
      if (u.type === 'armor' || u.type === 'ships') return; // crew hidden inside
    }
    const ch = soldier(u, i % 2 === 0 ? palA : palB, px, py, moving, fighting, time, i);
    const sprite = getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift));
    const cached = getCachedSprite(sprite, zoom);
    const lift =
      vehicle && (MOUNTED.has(u.type) || u.type === 'elephants')
        ? u.type === 'elephants'
          ? 9
          : 5
        : 0;
    const dx = Math.round(ox + px * zoom - cached.width / 2);
    const dy = Math.round(oy + (py - lift) * zoom - cached.height + 6 * zoom);
    out.push({ zY, draw: (c) => drawImage(c, cached, dx, dy, false, alpha) });
  });

  // The commander's standard: the side's flag flying from a tall pole.
  if (u.type === 'command' && u.status === 'active') {
    const poleX = Math.round(ox + (ux + 8) * zoom);
    const poleTop = Math.round(oy + (uy - 30) * zoom);
    const cached = getCachedSprite(flag, zoom);
    out.push({
      zY: uy + TILE_SIZE,
      draw: (c) => {
        c.fillStyle = BANNER_POLE_COLOR;
        c.fillRect(poleX, poleTop, zoom, 28 * zoom);
        drawWavingFlag(c, cached, poleX + zoom, poleTop, zoom, time);
      },
    });
  }
}

function vehicleSprite(type: UnitType): SpriteData | null {
  if (MOUNTED.has(type)) return HORSE_SPRITE;
  switch (type) {
    case 'elephants':
      return ELEPHANT_SPRITE;
    case 'artillery':
      return CANNON_SPRITE;
    case 'siege':
      return SIEGE_SPRITE;
    case 'ships':
      return SHIP_SPRITE;
    case 'armor':
      return TANK_SPRITE;
    default:
      return null;
  }
}

/** A throwaway Character for the office sprite picker (walk / "typing" = fighting). */
function soldier(
  u: SimUnit,
  palette: number,
  x: number,
  y: number,
  moving: boolean,
  fighting: boolean,
  time: number,
  i: number,
): Character {
  const state = moving ? CharacterState.WALK : fighting ? CharacterState.TYPE : CharacterState.IDLE;
  const frame = moving
    ? Math.floor(time / WALK_FRAME_SEC + i) % 4
    : Math.floor(time / TYPE_FRAME_DURATION_SEC + i) % 2;
  return {
    id: 0,
    state,
    dir: FACING_TO_DIR[u.facing],
    x,
    y,
    tileCol: 0,
    tileRow: 0,
    path: [],
    moveProgress: 0,
    currentTool: UNIT_STATS[u.type].ranged > 0 && u.firingAt ? 'Read' : null,
    palette,
    hueShift: 0,
    frame,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 0,
    isActive: true,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: 0,
  };
}

function drawImage(
  c: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  mirror: boolean,
  alpha: number,
): void {
  if (!mirror && alpha === 1) {
    c.drawImage(img, x, y);
    return;
  }
  c.save();
  c.globalAlpha = alpha;
  if (mirror) {
    c.translate(x + img.width, y);
    c.scale(-1, 1);
    c.drawImage(img, 0, 0);
  } else {
    c.drawImage(img, x, y);
  }
  c.restore();
}

function drawClashes(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  ox: number,
  oy: number,
  zoom: number,
  time: number,
): void {
  ctx.fillStyle = BATTLE_CLASH_COLOR;
  for (const u of state.units) {
    if (!u.visible || u.status !== 'active' || !u.engagedWith) continue;
    const e = state.byId.get(u.engagedWith);
    if (!e || u.id > e.id) continue; // one spark burst per pair
    const mx = ((u.x + e.x) / 2 + 0.5) * TILE_SIZE;
    const my = ((u.y + e.y) / 2 + 0.5) * TILE_SIZE - 6;
    for (let k = 0; k < 5; k++) {
      const phase = time * 9 + k * 1.7 + mx;
      if (Math.sin(phase) < 0.2) continue;
      const sx = mx + Math.sin(phase * 1.3) * 6;
      const sy = my + Math.cos(phase * 0.9) * 5;
      ctx.fillRect(Math.round(ox + sx * zoom), Math.round(oy + sy * zoom), zoom, zoom);
    }
  }
}

/** Flags ripple: each column of the sprite bobs on a travelling sine. */
function drawWavingFlag(
  c: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  scale: number,
  time: number,
): void {
  const cols = img.width / scale;
  for (let i = 0; i < cols; i++) {
    const dy = Math.round(Math.sin(time * 5 - i * 0.7) * (i / cols) * 1.5) * scale;
    c.drawImage(img, i * scale, 0, scale, img.height, x + i * scale, y + dy, scale, img.height);
  }
}

function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const px = (wx: number, wy: number, color: string, size = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(ox + wx * zoom), Math.round(oy + wy * zoom), size * zoom, size * zoom);
  };
  for (const p of state.projectiles) {
    // Bullets are too fast to see: the flash and the smoke show them.
    if (p.weapon === 'musket' || p.weapon === 'rifle') continue;
    const t = Math.min(1, p.age / BATTLE_PROJECTILE_FLIGHT_SEC);
    const arcH =
      p.weapon === 'catapult' ? 30 : p.weapon === 'cannon' ? 5 : p.weapon === 'javelin' ? 12 : 18;
    const dxw = (p.toX - p.fromX) * TILE_SIZE;
    const dyw = (p.toY - p.fromY) * TILE_SIZE;
    const pos = (tt: number) => ({
      x: p.fromX * TILE_SIZE + TILE_SIZE / 2 + dxw * tt,
      y: p.fromY * TILE_SIZE + TILE_SIZE / 2 + dyw * tt - 10 - Math.sin(tt * Math.PI) * arcH,
    });
    const at = pos(t);
    if (p.weapon === 'cannon') {
      px(at.x, at.y, CANNONBALL_COLOR, 2);
      continue;
    }
    if (p.weapon === 'catapult') {
      px(at.x - 1, at.y - 1, STONE_COLOR, 3);
      continue;
    }
    // Arrows (a small flight of them per volley) and javelins, drawn along
    // their direction of travel: head first, fletching at the tail.
    const ahead = pos(Math.min(1, t + 0.04));
    const len = Math.hypot(ahead.x - at.x, ahead.y - at.y) || 1;
    const ux = (ahead.x - at.x) / len;
    const uy = (ahead.y - at.y) / len;
    const shafts = p.weapon === 'bow' ? 3 : 1;
    const shaftLen = p.weapon === 'javelin' ? 7 : 5;
    for (let k = 0; k < shafts; k++) {
      const offX = (k - 1) * 3;
      const offY = ((k * 7) % 3) - 1;
      for (let i = 0; i < shaftLen; i++) {
        const color =
          i === 0 ? ARROW_HEAD_COLOR : i === shaftLen - 1 ? ARROW_FLETCH_COLOR : ARROW_SHAFT_COLOR;
        px(at.x + offX - ux * i, at.y + offY - uy * i, color);
      }
    }
  }
}

/** Muzzle flashes, gunsmoke drifting up, and dust where heavy shot lands. */
function drawEffects(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  ox: number,
  oy: number,
  zoom: number,
): void {
  for (const e of state.effects) {
    const k = e.age / e.ttl;
    const cx = ox + (e.x + 0.5) * TILE_SIZE * zoom;
    const cy = oy + (e.y + 0.5) * TILE_SIZE * zoom;
    ctx.save();
    if (e.kind === 'flash') {
      ctx.fillStyle = MUZZLE_FLASH_COLORS[k < 0.5 ? 0 : 1];
      ctx.fillRect(Math.round(cx - 2 * zoom), Math.round(cy - 10 * zoom), 4 * zoom, 3 * zoom);
    } else {
      const smoke = e.kind === 'smoke';
      ctx.globalAlpha = (1 - k) * (smoke ? 0.55 : 0.5);
      ctx.fillStyle = smoke ? SMOKE_COLOR : DUST_COLOR;
      const r = (3 + k * (smoke ? 9 : 7)) * zoom;
      const rise = (smoke ? 8 + k * 14 : 2 + k * 4) * zoom;
      ctx.beginPath();
      ctx.arc(cx, cy - rise, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** A burning tile: flickering pixel flames with an ember and a smoke wisp. */
function pushFireDrawable(
  out: Drawable[],
  fire: Fire,
  ox: number,
  oy: number,
  zoom: number,
  time: number,
): void {
  const baseX = (fire.x + 0.5) * TILE_SIZE;
  const baseY = (fire.y + 0.5) * TILE_SIZE + 5;
  // A fire dying down shrinks over its last few seconds.
  const fade = Number.isFinite(fire.ttl) ? Math.min(1, (fire.ttl - fire.age) / 4) : 1;
  out.push({
    zY: baseY + 1,
    draw: (c) => {
      const px = (wx: number, wy: number, color: string) => {
        c.fillStyle = color;
        c.fillRect(Math.round(ox + wx * zoom), Math.round(oy + wy * zoom), zoom, zoom);
      };
      for (let i = 0; i < 7; i++) {
        const flicker = Math.sin(time * 11 + fire.seed + i * 1.9) * 2;
        const h = Math.max(1, Math.round((3 + flicker + (3 - Math.abs(i - 3))) * fade));
        for (let j = 0; j < h; j++) {
          const band = Math.min(FIRE_COLORS.length - 1, Math.floor((j / h) * FIRE_COLORS.length));
          px(baseX - 3 + i, baseY - j, FIRE_COLORS[band]);
        }
      }
      const e = (time * 3 + fire.seed) % 1;
      px(baseX + Math.sin(fire.seed + time) * 3, baseY - 8 - e * 8, FIRE_COLORS[2]);
      c.save();
      c.globalAlpha = 0.35 * fade;
      c.fillStyle = FIRE_SMOKE_COLOR;
      const sk = (time * 0.6 + fire.seed) % 1;
      c.beginPath();
      c.arc(
        ox + (baseX + sk * 4) * zoom,
        oy + (baseY - 12 - sk * 14) * zoom,
        (2 + sk * 4) * zoom,
        0,
        Math.PI * 2,
      );
      c.fill();
      c.restore();
    },
  });
}

function drawMapLabels(
  ctx: CanvasRenderingContext2D,
  scenario: Scenario,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const size = Math.max(10, Math.round(7 * zoom));
  ctx.font = `${size}px 'FS Pixel Sans'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of scenario.map.labels ?? []) {
    const x = Math.round(ox + (l.col + 0.5) * TILE_SIZE * zoom);
    const y = Math.round(oy + (l.row + 0.5) * TILE_SIZE * zoom);
    ctx.fillStyle = BATTLE_LABEL_SHADOW_COLOR;
    ctx.fillText(l.text, x + Math.max(1, zoom / 2), y + Math.max(1, zoom / 2));
    ctx.fillStyle = BATTLE_LABEL_COLOR;
    ctx.fillText(l.text, x, y);
  }
}

function drawBanner(
  ctx: CanvasRenderingContext2D,
  u: SimUnit,
  color: string,
  flag: SpriteData,
  ox: number,
  oy: number,
  zoom: number,
  hovered: boolean,
): void {
  const { x, y } = unitPx(u);
  const strength = formatStrength(u.strength);
  const text =
    u.status === 'active' ? `${UNIT_STATS[u.type].code} ${strength}` : u.status.toUpperCase();
  const size = Math.max(9, Math.round(6 * zoom));
  ctx.font = `${size}px 'FS Pixel Sans'`;
  const w = Math.ceil(ctx.measureText(text).width) + 4 * Math.max(1, Math.round(zoom / 2));
  const h = size + 2 * Math.max(1, Math.round(zoom / 2));
  // The side's flag flies to the left of the banner.
  const flagScale = Math.max(1, Math.round(h / FLAG_H));
  const flagImg = getCachedSprite(flag, flagScale);
  const gap = Math.max(1, Math.round(zoom / 2));
  const bx = Math.round(ox + x * zoom - (w - flagImg.width - gap) / 2);
  const by = Math.round(oy + (y - 34) * zoom - h);
  ctx.save();
  ctx.globalAlpha = u.status === 'active' ? 1 : 0.7;
  ctx.drawImage(flagImg, bx - flagImg.width - gap, by + Math.round((h - flagImg.height) / 2));
  ctx.globalAlpha = u.status === 'active' ? 1 : 0.7;
  ctx.fillStyle = color;
  ctx.fillRect(bx, by, w, h);
  // Morale bar along the banner's foot.
  if (u.status === 'active') {
    ctx.fillStyle = BATTLE_BANNER_TEXT_COLOR;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(
      bx,
      by + h,
      Math.round((w * Math.max(0, Math.min(100, u.morale))) / 100),
      Math.max(1, Math.round(zoom / 2)),
    );
    ctx.globalAlpha = 1;
  }
  if (hovered) {
    ctx.strokeStyle = BATTLE_SELECTION_COLOR;
    ctx.lineWidth = Math.max(1, Math.round(zoom / 2));
    ctx.strokeRect(bx, by, w, h);
  }
  ctx.fillStyle = BATTLE_BANNER_TEXT_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
  ctx.restore();
}

export function formatStrength(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/** Unit under a canvas point (device px), for click / hover. */
export function unitAt(
  state: BattleState,
  px: number,
  py: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): SimUnit | null {
  const wx = (px - offsetX) / zoom / TILE_SIZE - 0.5;
  const wy = (py - offsetY) / zoom / TILE_SIZE - 0.5;
  let best: SimUnit | null = null;
  let bd = 1.4;
  for (const u of state.units) {
    if (!u.visible) continue;
    // The sprites stand above the unit's tile: favour clicks slightly above it.
    const d = Math.hypot(u.x - wx, u.y - 0.6 - wy);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

/** Tile under a canvas point, or null off the map. */
export function tileAt(
  state: BattleState,
  px: number,
  py: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): [number, number] | null {
  const c = Math.floor((px - offsetX) / zoom / TILE_SIZE);
  const r = Math.floor((py - offsetY) / zoom / TILE_SIZE);
  if (c < 0 || r < 0 || c >= state.scenario.map.cols || r >= state.scenario.map.rows) return null;
  return [c, r];
}
