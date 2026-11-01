/**
 * Battle-map sprites: terrain tiles and battlefield props, in the same 16-px
 * SpriteData format the office uses, so they go through the same sprite cache
 * and renderer. Terrain tiles start from the office's floor patterns
 * (colorized like a painted floor) and get deterministic pixel detail on top.
 */
import type { ColorValue } from '../../components/ui/types.js';
import { getColorizedFloorSprite } from '../floorTiles.js';
import type { SpriteData } from '../types.js';

const T = 16;
const VARIANTS = 4;

interface TerrainLook {
  /** Floor pattern index (1-based, as in the office floor tiles). */
  pattern: number;
  color: ColorValue;
  /** Detail pixels sprinkled on top: [hex, density 0–1]. */
  speckles: Array<[string, number]>;
  /** Extra hand-placed detail drawn per variant. */
  detail?: (s: SpriteData, rand: () => number) => void;
}

const LOOKS: Record<string, TerrainLook> = {
  '.': {
    pattern: 1,
    color: { h: 95, s: 45, b: -5, c: 0 },
    speckles: [
      ['#5f8f3a', 0.08],
      ['#86b552', 0.06],
    ],
    detail: grassTufts,
  },
  ',': {
    pattern: 1,
    color: { h: 55, s: 50, b: 5, c: 0 },
    speckles: [['#a8923f', 0.05]],
    detail: furrows,
  },
  b: {
    pattern: 1,
    color: { h: 42, s: 45, b: 25, c: 0 },
    speckles: [
      ['#cdb47a', 0.08],
      ['#e6d4a0', 0.05],
    ],
  },
  ':': {
    pattern: 1,
    color: { h: 30, s: 30, b: 0, c: 0 },
    speckles: [
      ['#7d6a4f', 0.1],
      ['#9c8664', 0.08],
    ],
  },
  '^': {
    pattern: 1,
    color: { h: 80, s: 35, b: 5, c: 0 },
    speckles: [['#8a9a55', 0.08]],
    detail: hillContour,
  },
  T: {
    pattern: 1,
    color: { h: 110, s: 45, b: -25, c: 0 },
    speckles: [['#2f5a2a', 0.15]],
  },
  s: {
    pattern: 1,
    color: { h: 85, s: 30, b: -20, c: 0 },
    speckles: [
      ['#4a6b5c', 0.12],
      ['#6f8a4a', 0.08],
    ],
    detail: reeds,
  },
  '~': {
    pattern: 1,
    color: { h: 200, s: 55, b: -5, c: 0 },
    speckles: [['#7fb4d6', 0.05]],
    detail: ripples,
  },
  '=': {
    pattern: 1,
    color: { h: 215, s: 60, b: -20, c: 0 },
    speckles: [['#3d6a99', 0.06]],
    detail: waves,
  },
  M: {
    pattern: 1,
    color: { h: 30, s: 15, b: -15, c: 0 },
    speckles: [
      ['#6b6157', 0.12],
      ['#8a8075', 0.08],
    ],
  },
  c: {
    pattern: 6,
    color: { h: 25, s: 30, b: 0, c: 0 },
    speckles: [],
  },
  r: {
    pattern: 1,
    color: { h: 20, s: 8, b: -10, c: 0 },
    speckles: [
      ['#5c5650', 0.18],
      ['#8f8a84', 0.12],
      ['#3d3935', 0.06],
    ],
  },
  g: {
    pattern: 4,
    color: { h: 30, s: 25, b: -5, c: 0 },
    speckles: [],
  },
  '#': {
    pattern: 6,
    color: { h: 35, s: 12, b: -5, c: 0 },
    speckles: [],
  },
};

const terrainCache = new Map<string, SpriteData>();

/** Deterministic variant for a tile, so the map doesn't shimmer between frames. */
export function terrainVariant(col: number, row: number): number {
  return ((col * 73856093) ^ (row * 19349663)) & (VARIANTS - 1);
}

export function getTerrainSprite(ch: string, variant: number): SpriteData {
  const key = `${ch}:${variant}`;
  const cached = terrainCache.get(key);
  if (cached) return cached;
  const look = LOOKS[ch] ?? LOOKS['.'];
  const base = getColorizedFloorSprite(look.pattern, look.color);
  const sprite = base.map((row) => [...row]);
  const rand = seeded(ch.charCodeAt(0) * 131 + variant * 7919);
  for (const [hex, density] of look.speckles) {
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) if (rand() < density) sprite[y][x] = hex;
  }
  look.detail?.(sprite, rand);
  terrainCache.set(key, sprite);
  return sprite;
}

/** Call when floor tiles reload: terrain is derived from them. */
export function clearTerrainCache(): void {
  terrainCache.clear();
}

// ── Terrain detail painters ────────────────────────────────────

function grassTufts(s: SpriteData, rand: () => number): void {
  for (let i = 0; i < 3; i++) {
    const x = 1 + Math.floor(rand() * 13);
    const y = 2 + Math.floor(rand() * 12);
    s[y][x] = '#4e7a2f';
    s[y - 1][x] = '#6a9a3e';
  }
}

function furrows(s: SpriteData): void {
  for (const y of [3, 7, 11, 15])
    for (let x = 0; x < T; x++) if ((x + y) % 3 !== 0) s[y][x] = '#9a8a3a';
}

function hillContour(s: SpriteData, rand: () => number): void {
  const cx = 4 + Math.floor(rand() * 8);
  for (let x = -4; x <= 4; x++) {
    const y = 9 + Math.round((x * x) / 5);
    if (s[y]?.[cx + x] !== undefined) s[y][cx + x] = '#6e7d3f';
    if (s[y - 1]?.[cx + x] !== undefined && Math.abs(x) < 3) s[y - 1][cx + x] = '#b3c27a';
  }
}

function reeds(s: SpriteData, rand: () => number): void {
  for (let i = 0; i < 4; i++) {
    const x = 1 + Math.floor(rand() * 14);
    const y = 4 + Math.floor(rand() * 10);
    s[y][x] = '#3e5a2a';
    s[y - 1][x] = '#3e5a2a';
    s[y - 2][x] = '#7a6a3a';
  }
}

function ripples(s: SpriteData, rand: () => number): void {
  for (let i = 0; i < 2; i++) {
    const x = Math.floor(rand() * 12);
    const y = 2 + Math.floor(rand() * 12);
    for (let k = 0; k < 4; k++) s[y][x + k] = '#a8d4ec';
  }
}

function waves(s: SpriteData, rand: () => number): void {
  for (let i = 0; i < 2; i++) {
    const x = Math.floor(rand() * 11);
    const y = 2 + Math.floor(rand() * 12);
    s[y][x + 1] = '#6f9fd0';
    s[y][x + 2] = '#6f9fd0';
    s[y - 1][x + 3] = '#9cc3e8';
    s[y][x + 4] = '#6f9fd0';
  }
}

// ── Props ───────────────────────────────────────────────────────

/** Turn a string picture into SpriteData. `.` = transparent. */
function art(rows: string[], palette: Record<string, string>): SpriteData {
  return rows.map((r) => [...r].map((ch) => (ch === '.' ? '' : (palette[ch] ?? ''))));
}

export const MOUNTAIN_SPRITE = art(
  [
    '................',
    '.......ww.......',
    '......wwwd......',
    '.....wwwddd.....',
    '....gwwdddd.....',
    '....ggggddddd...',
    '...gggggdddddd..',
    '...ggggggddddd..',
    '..gggggggdddddd.',
    '..ggggggggddddd.',
    '.gggggggggdddddd',
    '.ggggggggggddddd',
    'ggggggggggggdddd',
    'kkkkkkkkkkkkkkkk',
  ],
  { w: '#eef2f5', g: '#8c8278', d: '#655c54', k: '#4a433d' },
);

export const TREE_SPRITE = art(
  [
    '......gg........',
    '....ggGggg......',
    '...gGGgggGg.....',
    '..ggGgggggGg....',
    '..gggggGgggg....',
    '.ggGggggggGgg...',
    '.gggggGgggggg...',
    '..ggggggggGg....',
    '...ggggggggg....',
    '.....bbb........',
    '.....bb.........',
    '.....bb.........',
  ],
  { g: '#2f6b2a', G: '#4f9a3c', b: '#5c3e23' },
);

export const HOUSE_SPRITE = art(
  [
    '................',
    '......rrrr......',
    '....rrrrrrrr....',
    '..rrrrrrrrrrrr..',
    '.RRRRRRRRRRRRRR.',
    '..wwwwwwwwwwww..',
    '..wwkkwwwwkkww..',
    '..wwkkwwwwkkww..',
    '..wwwwwddwwwww..',
    '..wwwwwddwwwww..',
    '..sssssssssssss.',
  ],
  { r: '#b5533a', R: '#7d3424', w: '#e3d3b4', k: '#3a3a5c', d: '#6b4423', s: '#5a5048' },
);

export const RUIN_SPRITE = art(
  [
    '................',
    '..w.............',
    '..ww.....w......',
    '..wwk....ww.....',
    '..wwk...www.....',
    '.wwwww.wwwkw....',
    '.wkwww.wwwww.w..',
    'ssssssssssssssss',
  ],
  { w: '#9a948c', k: '#3a3633', s: '#5c5650' },
);

export const HORSE_SPRITE = art(
  [
    '.............hh.',
    '............hhhm',
    '...........hhh..',
    '..hhhhhhhhhhh...',
    '.thhhhhhhhhhh...',
    't.hhhhhhhhhh....',
    '..h.h....h.h....',
    '..h.h....h.h....',
    '..k.k....k.k....',
  ],
  { h: '#7a4f2e', m: '#3b2617', t: '#3b2617', k: '#2a1c10' },
);

export const ELEPHANT_SPRITE = art(
  [
    '..........ggg...',
    '....gggggggggg..',
    '...gggggggggggg.',
    '..ggggggggggggge',
    '..gggggggggggg.g',
    '..ggggggggggg..g',
    '..ggggggggggg..g',
    '..gg.gg..gg.gg..',
    '..gg.gg..gg.gg..',
    '..kk.kk..kk.kk..',
  ],
  { g: '#8a8a8f', e: '#efe8d8', k: '#4d4d52' },
);

export const CANNON_SPRITE = art(
  [
    '..........kkkk',
    '.......kkkkkkk',
    '....kkkkkkk...',
    '..bbkkkkb.....',
    '.bwwbbbwwb....',
    '.bwkwbbwkwb...',
    '..bwb..bwb....',
  ],
  { k: '#2b2b30', b: '#6b4423', w: '#8a6a43' },
);

export const SIEGE_SPRITE = art(
  [
    '.............k..',
    '............kk..',
    '...........bb...',
    '..........bb....',
    '.........bb.....',
    '..bbbbbbbbbbbb..',
    '..b..b....b..b..',
    '.wbw.......wbw..',
    '..w.........w...',
  ],
  { b: '#7a5230', k: '#4a4a4a', w: '#3d2a18' },
);

export const SHIP_SPRITE = art(
  [
    '.......w........',
    '.......wSS......',
    '.......wSSS.....',
    '.......wSSSS....',
    '.......wSSSSS...',
    '.......w........',
    'bbbbbbbbbbbbbbbb',
    '.bbbbbbbbbbbbbb.',
    '..bbbbbbbbbbbb..',
  ],
  { w: '#4a3420', S: '#efe6d0', b: '#6b4423' },
);

export const TANK_SPRITE = art(
  [
    '.........kkkkkkk',
    '.....oooooo.....',
    '....oooooooo....',
    '.oooooooooooooo.',
    'oOOOOOOOOOOOOOOo',
    'kwkwkwkwkwkwkwkk',
    '.kkkkkkkkkkkkkk.',
  ],
  { o: '#5b6b3a', O: '#45522b', k: '#262a1c', w: '#6b6b5a' },
);

export const BANNER_POLE_COLOR = '#3b2617';

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

// ── Effect colours (projectiles, gunsmoke, fire) ────────────────
export const ARROW_SHAFT_COLOR = '#6b4a2b';
export const ARROW_HEAD_COLOR = '#3a3a40';
export const ARROW_FLETCH_COLOR = '#e8e2d0';
export const STONE_COLOR = '#8a8580';
export const CANNONBALL_COLOR = '#1c1c20';
export const MUZZLE_FLASH_COLORS = ['#fff3b0', '#ffb43c'] as const;
export const SMOKE_COLOR = '#d8d4cc';
export const DUST_COLOR = '#9c8a6a';
/** Flame colours from the base up: deep red → orange → yellow. */
export const FIRE_COLORS = ['#b3261e', '#f26b1d', '#ffb732', '#ffe28a'] as const;
export const FIRE_SMOKE_COLOR = '#4a4642';
