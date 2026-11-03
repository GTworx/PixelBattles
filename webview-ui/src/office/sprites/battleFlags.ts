/**
 * Pixel-art flags (16×10 SpriteData) for the sides in the battle scenarios.
 * A scenario side names one with `"flag": "<id>"`; a side without one flies a
 * plain banner in its colour.
 *
 * Pre-modern "flags" are the standards and emblems the sources associate with
 * each army (the Achaemenid falcon, the Vergina sun, the Roman eagle, the
 * Wessex wyvern…), simplified to 16 px. The 1453 Ottoman crescent is the
 * recognisable later emblem, and the German side at Stalingrad flies the
 * Wehrmacht's Balkenkreuz rather than the swastika flag.
 */
import type { SpriteData } from '../types.js';

export const FLAG_W = 16;
export const FLAG_H = 10;

function art(rows: string[], palette: Record<string, string>): SpriteData {
  return rows.map((r) => [...r].map((ch) => palette[ch] ?? ''));
}

function grid(fill: (x: number, y: number) => string): SpriteData {
  return Array.from({ length: FLAG_H }, (_, y) =>
    Array.from({ length: FLAG_W }, (_, x) => fill(x, y)),
  );
}

const GOLD = '#e3b22c';
const WHITE = '#f4f1e8';
const RED = '#b3202a';
const BLUE = '#203e9a';

export const FLAGS: Record<string, SpriteData> = {
  athens: art(
    [
      'wwwwwwwwwwwwwwww',
      'wwwwwowwwwowwwww',
      'wwwwwoooooowwwww',
      'wwwwoyyooyyowwww',
      'wwwwooyooyoowwww',
      'wwwwoooooooowwww',
      'wwwwwoooooowgwww',
      'wwwwwwoooowggwww',
      'wwwwwwowwowgwwww',
      'wwwwwwwwwwwwwwww',
    ],
    { w: WHITE, o: '#6b4a2b', y: GOLD, g: '#5f7d22' },
  ),
  persia: art(
    [
      'rrrrrrrrrrrrrrrr',
      'rrrrrrryyrrrrrrr',
      'ryyrrrryyrrrryyr',
      'ryyyyrryyrryyyyr',
      'rryyyyyyyyyyyyrr',
      'rrrryyyyyyyyrrrr',
      'rrrrrryyyyrrrrrr',
      'rrrrryyrryyrrrrr',
      'rrrrrrrrrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
    ],
    { r: '#8b1a1a', y: GOLD },
  ),
  'greek-lambda': art(
    [
      'rrrrrrrrrrrrrrrr',
      'rrrrrrrwwrrrrrrr',
      'rrrrrrwwwwrrrrrr',
      'rrrrrrwwrwwrrrrr',
      'rrrrrwwrrrwwrrrr',
      'rrrrrwwrrrwwrrrr',
      'rrrrwwrrrrrwwrrr',
      'rrrrwwrrrrrwwrrr',
      'rrrwwrrrrrrrwwrr',
      'rrrrrrrrrrrrrrrr',
    ],
    { r: RED, w: WHITE },
  ),
  macedon: art(
    [
      'rrrrrrrrrrrrrrrr',
      'rrrrrrryrrrrrrrr',
      'rrrryrryrryrrrrr',
      'rrrrryyyyyrrrrrr',
      'rryyyyyyyyyyyrrr',
      'rrrrryyyyyrrrrrr',
      'rrrryrryrryrrrrr',
      'rrrrrrryrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
    ],
    { r: '#9b1b30', y: GOLD },
  ),
  carthage: art(
    [
      'pppppppppppppppp',
      'pppppppyyppppppp',
      'ppppppyyyypppppp',
      'pppppppyyppppppp',
      'pppyyyyyyyyyyppp',
      'pppppppyyppppppp',
      'ppppppyyyypppppp',
      'pppppyyyyyyppppp',
      'ppppyyyyyyyypppp',
      'pppppppppppppppp',
    ],
    { p: '#5b2a86', y: GOLD },
  ),
  rome: art(
    [
      'yyyyyyyyyyyyyyyy',
      'yrrrrrrrrrrrrrry',
      'yrrrrrryyrrrrrry',
      'yryyrrryyrrryyry',
      'yrryyyyyyyyyyrry',
      'yrrrryyyyyyrrrry',
      'yrrrrryyyyrrrrry',
      'yrrrrryrryrrrrry',
      'yrrrrrrrrrrrrrry',
      'yyyyyyyyyyyyyyyy',
    ],
    { r: '#a01818', y: GOLD },
  ),
  wessex: art(
    [
      'yyyyyyyyyyyyyyyy',
      'yyyyyyyyyyrryyyy',
      'yyyyyyyyyrrrryyy',
      'yyrrryyyrrryyyyy',
      'yyyrrrrrrrryyyyy',
      'yyyyrrrrrrrrryyy',
      'yyyyrrrrrryyrryy',
      'yyyyryyyyryyyyyy',
      'yyyrryyyrryyyyyy',
      'yyyyyyyyyyyyyyyy',
    ],
    { y: GOLD, r: RED },
  ),
  normandy: art(
    [
      'rrrrrrrrrrrrrrrr',
      'rryyrrrrrrrrrrrr',
      'rryyyyyyyyyyyrrr',
      'rrrryyyyyyyyyyrr',
      'rrrryrryrrryryrr',
      'rryyrrrrrrrrrrrr',
      'rryyyyyyyyyyyrrr',
      'rrrryyyyyyyyyyrr',
      'rrrryrryrrryryrr',
      'rrrrrrrrrrrrrrrr',
    ],
    { r: RED, y: GOLD },
  ),
  seljuk: art(
    [
      'tttttttttttttttt',
      'tttttyyyyytttttt',
      'ttttyttwttyttttt',
      'tttyttwtttttyttt',
      'tyywwwwwwwwwwwwy',
      'tttyttwtttttyttt',
      'ttttyttwttyttttt',
      'tttttyyyyytttttt',
      'tttttttttttttttt',
      'tttttttttttttttt',
    ],
    { t: '#1f6f6f', y: GOLD, w: WHITE },
  ),
  'byzantine-labarum': grid((x, y) => {
    // Chi-Rho on imperial purple, gold border.
    if (x === 0 || y === 0 || x === FLAG_W - 1 || y === FLAG_H - 1) return GOLD;
    const rhoStem = x === 7 && y >= 1 && y <= 8;
    const rhoBowl = y === 1 || y === 4 ? x >= 7 && x <= 10 : x === 10 && y > 1 && y < 4;
    const dx = x - 7.5;
    const dy = y - 5;
    const chi =
      y >= 2 && y <= 8 && (Math.abs(dx - dy * 1.3) < 0.75 || Math.abs(dx + dy * 1.3) < 0.75);
    return rhoStem || rhoBowl || chi ? GOLD : '#5a1f6e';
  }),
  palaiologan: art(
    [
      'rrrrrrryyrrrrrrr',
      'ryyrrrryyrrrryyr',
      'ryrrrrryyrrrrryr',
      'ryyrrrryyrrrryyr',
      'yyyyyyyyyyyyyyyy',
      'yyyyyyyyyyyyyyyy',
      'ryyrrrryyrrrryyr',
      'ryrrrrryyrrrrryr',
      'ryyrrrryyrrrryyr',
      'rrrrrrryyrrrrrrr',
    ],
    { r: RED, y: GOLD },
  ),
  'england-royal': art(
    [
      'bbbbbbbbrrrrrrrr',
      'bybbybbbryyyyyrr',
      'bbbbbbbbrrrrrrrr',
      'bbybbybbryyyyyrr',
      'bbbbbbbbrrrrrrrr',
      'rrrrrrrrbbbbbbbb',
      'ryyyyyrrbybbybbb',
      'rrrrrrrrbbbbbbbb',
      'ryyyyyrrbbybbybb',
      'rrrrrrrrbbbbbbbb',
    ],
    { b: BLUE, r: RED, y: GOLD },
  ),
  'france-ancient': art(
    [
      'bbbbbbbbbbbbbbbb',
      'bbybbbbybbbbybbb',
      'byyybbyyybbyyybb',
      'bbybbbbybbbbybbb',
      'bbbbbbbbbbbbbbbb',
      'bbbbybbbbybbbbyb',
      'bbbyyybbyyybbyyy',
      'bbbbybbbbybbbbyb',
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbbbb',
    ],
    { b: BLUE, y: GOLD },
  ),
  ottoman: art(
    [
      'rrrrrrrrrrrrrrrr',
      'rrrrrwwwrrrrrrrr',
      'rrrrwwrrrrrrrrrr',
      'rrrwwrrrrrrwrrrr',
      'rrrwwrrrrrwwwrrr',
      'rrrwwrrrrrrwrrrr',
      'rrrwwrrrrrrrrrrr',
      'rrrrwwrrrrrrrrrr',
      'rrrrrwwwrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
    ],
    { r: '#c8102e', w: WHITE },
  ),
  // The ragged red saltire the Habsburg fleets flew; Doria commanded the Holy
  // League for Charles V.
  'burgundy-cross': art(
    [
      'rrwwwwwwwwwwwwrr',
      'wrrrwwwwwwwwrrrw',
      'wwrrrwrwwwwrrrww',
      'wwwwrrrwwrrrwwww',
      'wwwwwrrrrrrwwwww',
      'wwwwwrrrrrrwwwww',
      'wwwwrrrwwrrrwwww',
      'wwrrrwwwwrwrrrww',
      'wrrrwwwwwwwwrrrw',
      'rrwwwwwwwwwwwwrr',
    ],
    { r: RED, w: WHITE },
  ),
  soviet: art(
    [
      'rryrrrrrrrrrrrrr',
      'ryyyrrrrrrrrrrrr',
      'rryrrrrrrrrrrrrr',
      'ryyryrrrrrrrrrrr',
      'ryrrryrrrrrrrrrr',
      'ryyyyrrrrrrrrrrr',
      'rrryyrrrrrrrrrrr',
      'rryrryrrrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
      'rrrrrrrrrrrrrrrr',
    ],
    { r: '#c4161c', y: '#f2c12e' },
  ),
  'france-tricolor': grid((x) => (x < 5 ? BLUE : x < 11 ? WHITE : RED)),
  'union-flag': grid((x, y) => {
    // St George's cross over St Patrick's saltire over St Andrew's saltire.
    const cx = Math.abs(x - 7.5);
    const cy = Math.abs(y - 4.5);
    if (cx < 1.1 || cy < 1.1) return RED;
    if (cx < 2 || cy < 1.7) return WHITE;
    const d = Math.abs(x * (FLAG_H / FLAG_W) - y);
    const e = Math.abs(x * (FLAG_H / FLAG_W) - (FLAG_H - 1 - y));
    if (d < 0.5 || e < 0.5) return RED;
    if (d < 1.1 || e < 1.1) return WHITE;
    return '#1f2f6b';
  }),
  // A coalition has no flag of its own: the 1914 Entente postcard emblem of the
  // allied colours quartered — France, Britain, Russia and Italy.
  entente: art(
    [
      'bbbwwrrrwuurruuw',
      'bbbwwrrruwwrrwwu',
      'bbbwwrrrrrrrrrrr',
      'bbbwwrrruwwrrwwu',
      'bbbwwrrrwuurruuw',
      'wwwwwwwwgggwwrrr',
      'wwwwwwwwgggwwrrr',
      'bbbbbbbbgggwwrrr',
      'rrrrrrrrgggwwrrr',
      'rrrrrrrrgggwwrrr',
    ],
    { b: BLUE, w: WHITE, r: RED, u: '#1f2f6b', g: '#1f8a3a' },
  ),
  // The Kaiserreich's black-white-red, which the Central Powers' leading army
  // fought under in 1914–1918.
  'german-imperial': grid((_x, y) => (y < 3 ? '#141414' : y < 7 ? WHITE : RED)),
  'german-cross': grid((x, y) => {
    const cx = Math.abs(x - 7.5);
    const cy = Math.abs(y - 4.5);
    if ((cx < 1 && cy < 4) || (cy < 1 && cx < 5)) return '#141414';
    if ((cx < 2 && cy < 5) || (cy < 2 && cx < 6)) return WHITE;
    return '#6f7462';
  }),
};

const plainCache = new Map<string, SpriteData>();

/** The side's flag, or a plain banner in its colour. */
export function getFlagSprite(flagId: string | undefined, color: string): SpriteData {
  if (flagId && FLAGS[flagId]) return FLAGS[flagId];
  let plain = plainCache.get(color);
  if (!plain) {
    plain = grid(() => color);
    plainCache.set(color, plain);
  }
  return plain;
}
