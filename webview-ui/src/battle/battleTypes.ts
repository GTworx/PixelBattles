/** Scenario shape — mirrors battles/SCHEMA.md "Scenario" (validated by scripts/validate-battles.mjs). */

export type SideId = 'A' | 'B';

export type UnitType =
  | 'infantry'
  | 'heavy_infantry'
  | 'light_infantry'
  | 'archers'
  | 'cavalry'
  | 'heavy_cavalry'
  | 'horse_archers'
  | 'chariots'
  | 'elephants'
  | 'artillery'
  | 'siege'
  | 'ships'
  | 'armor'
  | 'command';

export type OrderAction =
  'move' | 'attack' | 'charge' | 'flank' | 'bombard' | 'hold' | 'retreat' | 'rout';

export type UnitStatus = 'active' | 'routed' | 'destroyed' | 'surrendered' | 'withdrawn';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface ScenarioSide {
  id: SideId;
  name: string;
  commander: string;
  color: string;
  /** Flag sprite id (office/sprites/battleFlags.ts); a plain banner when absent. */
  flag?: string;
}

export interface ScenarioUnit {
  id: string;
  side: SideId;
  name: string;
  type: UnitType;
  strength: number;
  col: number;
  row: number;
  facing?: Facing;
  morale?: number;
  commander?: string;
  enterPhase?: string | null;
}

export interface Order {
  unit: string;
  action: OrderAction;
  target?: string;
  to?: [number, number];
}

export interface PhaseOutcome {
  unit: string;
  strength?: number;
  morale?: number;
  status?: UnitStatus;
}

export interface ScenarioPhase {
  id: string;
  title: string;
  time: string;
  durationSec: number;
  narration: string;
  orders?: Order[];
  outcomes?: PhaseOutcome[];
}

export interface MapLabel {
  text: string;
  col: number;
  row: number;
}

export interface Scenario {
  id: string;
  title: string;
  year: string;
  date?: string;
  location: string;
  wiki: string;
  summary: string;
  map: {
    cols: number;
    rows: number;
    scale?: string;
    north?: string;
    terrain: string[];
    labels?: MapLabel[];
  };
  sides: [ScenarioSide, ScenarioSide];
  victor: SideId | 'draw';
  units: ScenarioUnit[];
  phases: ScenarioPhase[];
  result: { summary: string; casualties?: Partial<Record<SideId, string>> };
  sources?: Array<{ title: string; url: string }>;
}

/** Catalog entry from GET /api/battles. */
export interface BattleSummary {
  id: string;
  title: string;
  year: string;
  location: string;
  summary: string;
  sides: ScenarioSide[];
  victor: SideId | 'draw';
}
