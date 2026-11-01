/**
 * Combat rules tables: what each unit type and terrain does in the engine.
 * Pure data (DOM-free) so the engine stays Node-testable.
 */
import type { UnitType } from './battleTypes.js';

export interface UnitStats {
  /** Close-combat power multiplier. */
  melee: number;
  /** Damage resistance multiplier. */
  defense: number;
  /** Tiles per second on open ground. */
  speed: number;
  /** Ranged power multiplier (0 = no ranged attack). */
  ranged: number;
  /** Ranged reach in tiles. */
  range: number;
  /** Impact multiplier during the first seconds of a charge. */
  charge: number;
  /** Short code shown on the unit's banner. */
  code: string;
  /** Plain-English label. */
  label: string;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  infantry: {
    melee: 1.0,
    defense: 1.0,
    speed: 1.0,
    ranged: 0,
    range: 0,
    charge: 1.2,
    code: 'INF',
    label: 'Infantry',
  },
  heavy_infantry: {
    melee: 1.3,
    defense: 1.4,
    speed: 0.8,
    ranged: 0,
    range: 0,
    charge: 1.3,
    code: 'HVY',
    label: 'Heavy infantry',
  },
  light_infantry: {
    melee: 0.8,
    defense: 0.8,
    speed: 1.3,
    ranged: 0.4,
    range: 3,
    charge: 1.1,
    code: 'LT',
    label: 'Light infantry',
  },
  archers: {
    melee: 0.5,
    defense: 0.7,
    speed: 1.0,
    ranged: 1.0,
    range: 5,
    charge: 1.0,
    code: 'ARC',
    label: 'Archers',
  },
  cavalry: {
    melee: 1.2,
    defense: 0.9,
    speed: 2.2,
    ranged: 0,
    range: 0,
    charge: 2.0,
    code: 'CAV',
    label: 'Cavalry',
  },
  heavy_cavalry: {
    melee: 1.6,
    defense: 1.1,
    speed: 1.8,
    ranged: 0,
    range: 0,
    charge: 2.5,
    code: 'HCV',
    label: 'Heavy cavalry',
  },
  horse_archers: {
    melee: 0.6,
    defense: 0.8,
    speed: 2.4,
    ranged: 0.9,
    range: 4,
    charge: 1.2,
    code: 'HA',
    label: 'Horse archers',
  },
  chariots: {
    melee: 1.2,
    defense: 0.6,
    speed: 2.2,
    ranged: 0,
    range: 0,
    charge: 2.5,
    code: 'CHR',
    label: 'Chariots',
  },
  elephants: {
    melee: 1.8,
    defense: 1.2,
    speed: 1.2,
    ranged: 0,
    range: 0,
    charge: 2.2,
    code: 'ELE',
    label: 'War elephants',
  },
  artillery: {
    melee: 0.3,
    defense: 0.6,
    speed: 0.6,
    ranged: 1.6,
    range: 8,
    charge: 1.0,
    code: 'ART',
    label: 'Artillery',
  },
  siege: {
    melee: 0.2,
    defense: 0.5,
    speed: 0.4,
    ranged: 1.8,
    range: 6,
    charge: 1.0,
    code: 'SGE',
    label: 'Siege engines',
  },
  ships: {
    melee: 0.8,
    defense: 1.0,
    speed: 1.2,
    ranged: 1.0,
    range: 4,
    charge: 1.0,
    code: 'SHP',
    label: 'Ships',
  },
  armor: {
    melee: 2.0,
    defense: 1.8,
    speed: 1.6,
    ranged: 1.2,
    range: 3,
    charge: 1.5,
    code: 'ARM',
    label: 'Armour',
  },
  command: {
    melee: 0.6,
    defense: 1.0,
    speed: 1.5,
    ranged: 0,
    range: 0,
    charge: 1.0,
    code: 'CMD',
    label: 'Command',
  },
};

export interface TerrainProps {
  passable: boolean;
  /** Movement multiplier (1 = open ground). */
  speed: number;
  /** Defender's damage-resistance multiplier when standing here. */
  defense: number;
  label: string;
}

export const TERRAIN: Record<string, TerrainProps> = {
  '.': { passable: true, speed: 1.0, defense: 1.0, label: 'open ground' },
  ',': { passable: true, speed: 0.9, defense: 1.0, label: 'fields' },
  b: { passable: true, speed: 0.85, defense: 0.95, label: 'sand' },
  ':': { passable: true, speed: 1.3, defense: 0.9, label: 'road' },
  '^': { passable: true, speed: 0.6, defense: 1.5, label: 'hills' },
  T: { passable: true, speed: 0.55, defense: 1.4, label: 'forest' },
  s: { passable: true, speed: 0.35, defense: 0.85, label: 'marsh' },
  '~': { passable: true, speed: 0.35, defense: 0.8, label: 'river' },
  c: { passable: true, speed: 0.7, defense: 1.6, label: 'town' },
  r: { passable: true, speed: 0.5, defense: 1.8, label: 'ruins' },
  g: { passable: true, speed: 0.8, defense: 1.3, label: 'gate' },
  '=': { passable: false, speed: 1.0, defense: 1.0, label: 'sea' },
  M: { passable: false, speed: 0, defense: 1, label: 'mountains' },
  '#': { passable: false, speed: 0, defense: 1, label: 'wall' },
};

const UNKNOWN_TERRAIN = TERRAIN['.'];

export function terrainAt(terrain: string[], col: number, row: number): TerrainProps {
  return TERRAIN[terrain[row]?.[col] ?? '.'] ?? UNKNOWN_TERRAIN;
}

/** Ships move on water (sea, rivers); everything else on passable land. */
export function canEnter(terrain: string[], col: number, row: number, naval: boolean): boolean {
  const ch = terrain[row]?.[col];
  if (ch === undefined) return false;
  if (naval) return ch === '=' || ch === '~';
  return TERRAIN[ch]?.passable ?? true;
}

export const RANGED_TYPES: ReadonlySet<UnitType> = new Set([
  'archers',
  'horse_archers',
  'artillery',
  'siege',
  'ships',
  'armor',
  'light_infantry',
]);

export const CHARGE_TYPES: ReadonlySet<UnitType> = new Set([
  'cavalry',
  'heavy_cavalry',
  'chariots',
  'elephants',
  'armor',
]);
