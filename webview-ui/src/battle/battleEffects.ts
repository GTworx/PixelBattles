/**
 * Battlefield effects: what weapons each era fights with, the sound cues the
 * engine raises for the audio layer, and the short-lived visual effects (muzzle
 * flash, smoke, fires) the renderer draws. Pure and DOM-free like the engine.
 */
import {
  BATTLE_FIRE_FROM_DESTROYED_CHANCE,
  BATTLE_FIRE_FROM_IMPACT_CHANCE,
  BATTLE_FIRE_MAX,
  BATTLE_FIRE_TTL_MAX_SEC,
  BATTLE_FIRE_TTL_MIN_SEC,
  BATTLE_SMOKE_TTL_SEC,
} from '../constants.js';
import type { SideId, UnitType } from './battleTypes.js';

/** What a unit shoots with — picks both the sound and the projectile drawn. */
export type Weapon = 'bow' | 'javelin' | 'catapult' | 'cannon' | 'musket' | 'rifle';

/** What close combat sounds like in this era. */
export type MeleeSound = 'swords' | 'muskets' | 'gunfire';

export type Cue =
  /** A bugle/horn call: the charge, or the retreat. */
  | { kind: 'call'; call: 'attack' | 'retreat'; side: SideId }
  /** A volley leaves a unit at column x. */
  | { kind: 'shot'; weapon: Weapon; x: number }
  /** A heavy projectile lands at column x. */
  | { kind: 'impact'; weapon: Weapon; x: number };

export interface Effect {
  kind: 'flash' | 'smoke' | 'dust';
  /** Tile coordinates (fractional). */
  x: number;
  y: number;
  age: number;
  ttl: number;
}

export interface Fire {
  x: number;
  y: number;
  age: number;
  /** Seconds it burns; Infinity for fires that are part of the scene. */
  ttl: number;
  /** Per-fire animation offset so flames don't flicker in step. */
  seed: number;
}

/** "490 BCE" → -490, "1942–1943 CE" → 1942. */
export function yearOf(label: string): number {
  const n = parseInt(/(\d+)/.exec(label)?.[1] ?? '0', 10);
  return /BCE|BC/i.test(label) ? -n : n;
}

export function weaponFor(type: UnitType, year: number): Weapon {
  switch (type) {
    case 'archers':
      return year < 1600 ? 'bow' : 'musket';
    case 'horse_archers':
      return 'bow';
    case 'artillery':
    case 'siege':
      return year < 1300 ? 'catapult' : 'cannon';
    case 'ships':
      return year < 1400 ? 'bow' : 'cannon';
    case 'armor':
      return 'cannon';
    case 'light_infantry':
      return year < 1500 ? 'javelin' : year < 1900 ? 'musket' : 'rifle';
    default:
      return year < 1500 ? 'bow' : year < 1900 ? 'musket' : 'rifle';
  }
}

export function meleeSoundFor(year: number): MeleeSound {
  return year < 1700 ? 'swords' : year < 1900 ? 'muskets' : 'gunfire';
}

/** Gunpowder weapons flash and leave smoke where they fire. */
export function isGunpowder(w: Weapon): boolean {
  return w === 'cannon' || w === 'musket' || w === 'rifle';
}

/** Heavy shot lands with a crash (and may start a fire). */
export function isHeavy(w: Weapon): boolean {
  return w === 'cannon' || w === 'catapult';
}

/** Terrain that catches fire, and how readily (0–1). */
const FLAMMABLE: Record<string, number> = { c: 1, T: 0.8, ',': 0.6, r: 0.7, g: 0.5, '.': 0.25 };

export function flammability(terrain: string[], col: number, row: number): number {
  return FLAMMABLE[terrain[row]?.[col] ?? ''] ?? 0;
}

export function spawnFire(
  fires: Fire[],
  x: number,
  y: number,
  rand: () => number,
  ttl?: number,
): void {
  if (fires.length >= BATTLE_FIRE_MAX) return;
  // Don't stack fires on one tile.
  if (fires.some((f) => Math.abs(f.x - x) < 0.6 && Math.abs(f.y - y) < 0.6)) return;
  fires.push({
    x,
    y,
    age: 0,
    ttl:
      ttl ?? BATTLE_FIRE_TTL_MIN_SEC + rand() * (BATTLE_FIRE_TTL_MAX_SEC - BATTLE_FIRE_TTL_MIN_SEC),
    seed: rand() * 10,
  });
}

/** A shell or stone landing: dust, maybe a fire where the ground will burn. */
export function onHeavyImpact(
  fires: Fire[],
  effects: Effect[],
  terrain: string[],
  x: number,
  y: number,
  rand: () => number,
): void {
  effects.push({ kind: 'dust', x, y, age: 0, ttl: BATTLE_SMOKE_TTL_SEC });
  const chance =
    BATTLE_FIRE_FROM_IMPACT_CHANCE * flammability(terrain, Math.round(x), Math.round(y));
  if (rand() < chance) spawnFire(fires, x, y, rand);
}

/** Where a unit was wiped out, wreckage burns (wagons, buildings, vehicles). */
export function onUnitDestroyed(fires: Fire[], x: number, y: number, rand: () => number): void {
  if (rand() < BATTLE_FIRE_FROM_DESTROYED_CHANCE) spawnFire(fires, x, y, rand);
}

/** A modern city under siege is already burning: seed fires in its ruins. */
export function seedSceneFires(terrain: string[], year: number, fires: Fire[]): void {
  if (year < 1900) return;
  const rand = seeded(year);
  for (let r = 0; r < terrain.length; r++) {
    for (let c = 0; c < terrain[r].length; c++) {
      if (terrain[r][c] === 'r' && rand() < 0.12) spawnFire(fires, c, r, rand, Infinity);
    }
  }
}

export function ageEffects(effects: Effect[], fires: Fire[], dt: number): void {
  for (const e of effects) e.age += dt;
  for (let i = effects.length - 1; i >= 0; i--)
    if (effects[i].age >= effects[i].ttl) effects.splice(i, 1);
  for (const f of fires) f.age += dt;
  for (let i = fires.length - 1; i >= 0; i--) if (fires[i].age >= fires[i].ttl) fires.splice(i, 1);
}

/** Small deterministic PRNG (xorshift), so fires and tests are reproducible. */
export function seeded(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
