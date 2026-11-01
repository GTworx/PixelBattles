/**
 * Battle simulation engine — pure and DOM-free (Node-testable).
 *
 * Two modes:
 * - historical: phases play in order; units move by the scenario's orders and
 *   their strength/morale blend toward each phase's recorded `outcomes`, so the
 *   replay ends where the history books do.
 * - diverged: the moment the user changes anything from the chat, outcomes stop
 *   applying and the combat rules (battleRules.ts) decide. Units the user has
 *   commanded ignore the remaining scripted orders; the rest keep following the
 *   script where it still makes sense.
 */
import {
  BATTLE_CHARGE_BONUS_SEC,
  BATTLE_COMMAND_AURA_TILES,
  BATTLE_COMMAND_LOSS_MORALE,
  BATTLE_DECISIVE_RATIO,
  BATTLE_DESTROYED_FRACTION,
  BATTLE_FLANK_MULTIPLIER,
  BATTLE_FLASH_TTL_SEC,
  BATTLE_FLEE_SPEED_MULTIPLIER,
  BATTLE_HISTORICAL_ARRIVAL_FRACTION,
  BATTLE_LOG_MAX,
  BATTLE_MAX_OUTNUMBER,
  BATTLE_MELEE_RANGE_TILES,
  BATTLE_MELEE_RATE,
  BATTLE_MORALE_PER_LOSS,
  BATTLE_MORALE_RECOVERY_PER_SEC,
  BATTLE_MORALE_STRESS_PER_SEC,
  BATTLE_OVERTIME_SEC,
  BATTLE_PROJECTILE_FLIGHT_SEC,
  BATTLE_RANGED_RATE,
  BATTLE_REAR_MULTIPLIER,
  BATTLE_REPATH_SEC,
  BATTLE_ROUT_MORALE,
  BATTLE_SMOKE_TTL_SEC,
  BATTLE_SURROUNDED_DAMAGE_BONUS,
  BATTLE_VOLLEY_INTERVAL_SEC,
} from '../constants.js';
import type { Cue, Effect, Fire, Weapon } from './battleEffects.js';
import {
  ageEffects,
  isGunpowder,
  isHeavy,
  onHeavyImpact,
  onUnitDestroyed,
  seeded,
  seedSceneFires,
  weaponFor,
  yearOf,
} from './battleEffects.js';
import { canEnter, CHARGE_TYPES, RANGED_TYPES, terrainAt, UNIT_STATS } from './battleRules.js';
import type {
  Facing,
  Order,
  Scenario,
  ScenarioPhase,
  SideId,
  UnitStatus,
  UnitType,
} from './battleTypes.js';

const DEFAULT_MORALE = 70;
const FINAL_STATUSES: ReadonlySet<UnitStatus> = new Set(['destroyed', 'surrendered']);

export interface SimUnit {
  id: string;
  side: SideId;
  name: string;
  type: UnitType;
  commander?: string;
  strength: number;
  initialStrength: number;
  morale: number;
  initialMorale: number;
  status: UnitStatus;
  /** Tile coordinates of the unit's centre (fractional while moving). */
  x: number;
  y: number;
  facing: Facing;
  /** On the field (false before `enterPhase`, and after fleeing off the map). */
  visible: boolean;
  enterPhase: string | null;
  order: Order | null;
  path: Array<[number, number]>;
  repathTimer: number;
  /** Historical pacing: tiles/sec that lands the unit on time, overriding type speed. */
  paceSpeed: number | null;
  /** Enemy in close combat with this unit. */
  engagedWith: string | null;
  /** Enemy this unit is shooting at. */
  firingAt: string | null;
  volleyTimer: number;
  chargeTimer: number;
  /** The user commanded this unit: scripted orders no longer apply to it. */
  userControlled: boolean;
  moving: boolean;
  fleeTo: [number, number] | null;
}

export type BattleMode = 'historical' | 'diverged';

export type BattleEventKind = 'phase' | 'order' | 'status' | 'diverge' | 'end';

export interface BattleEvent {
  t: number;
  kind: BattleEventKind;
  text: string;
  side?: SideId;
}

export interface Projectile {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  age: number;
  side: SideId;
  weapon: Weapon;
}

export interface BattleState {
  scenario: Scenario;
  terrain: string[];
  units: SimUnit[];
  byId: Map<string, SimUnit>;
  phaseIndex: number;
  phaseElapsed: number;
  elapsed: number;
  /** Seconds since the last phase ended (diverged battles run on). */
  overtime: number;
  mode: BattleMode;
  finished: boolean;
  winner: SideId | 'draw' | null;
  events: BattleEvent[];
  /** Strength/morale at the start of the current phase, for outcome blending. */
  phaseStart: Map<string, { strength: number; morale: number }>;
  projectiles: Projectile[];
  /** Which map edge each side retreats toward. */
  homeEdge: Record<SideId, Facing>;
  /** The battle's year (BCE negative): picks weapons and sounds. */
  year: number;
  /** Sound cues raised since the audio layer last drained them. */
  cues: Cue[];
  /** Muzzle flashes, smoke and dust. */
  effects: Effect[];
  fires: Fire[];
  /** Deterministic randomness for fires (replays look the same). */
  rand: () => number;
}

// ── Construction ────────────────────────────────────────────────

export function createBattle(scenario: Scenario): BattleState {
  const units: SimUnit[] = scenario.units.map((u) => ({
    id: u.id,
    side: u.side,
    name: u.name,
    type: u.type,
    commander: u.commander,
    strength: u.strength,
    initialStrength: u.strength,
    morale: u.morale ?? DEFAULT_MORALE,
    initialMorale: u.morale ?? DEFAULT_MORALE,
    status: 'active',
    x: u.col,
    y: u.row,
    facing: u.facing ?? 'down',
    visible: !u.enterPhase,
    enterPhase: u.enterPhase ?? null,
    order: null,
    path: [],
    repathTimer: 0,
    paceSpeed: null,
    engagedWith: null,
    firingAt: null,
    volleyTimer: 0,
    chargeTimer: 0,
    userControlled: false,
    moving: false,
    fleeTo: null,
  }));
  const state: BattleState = {
    scenario,
    terrain: scenario.map.terrain,
    units,
    byId: new Map(units.map((u) => [u.id, u])),
    phaseIndex: -1,
    phaseElapsed: 0,
    elapsed: 0,
    overtime: 0,
    mode: 'historical',
    finished: false,
    winner: null,
    events: [],
    phaseStart: new Map(),
    projectiles: [],
    homeEdge: computeHomeEdges(scenario),
    year: yearOf(scenario.year),
    cues: [],
    effects: [],
    fires: [],
    rand: seeded(scenario.id.length * 7919 + scenario.units.length),
  };
  seedSceneFires(state.terrain, state.year, state.fires);
  enterPhase(state, 0);
  return state;
}

/** Each side flees toward the map edge behind its starting position. */
function computeHomeEdges(scenario: Scenario): Record<SideId, Facing> {
  const centroid = (side: SideId) => {
    const us = scenario.units.filter((u) => u.side === side && !u.enterPhase);
    const pool = us.length ? us : scenario.units.filter((u) => u.side === side);
    const n = Math.max(pool.length, 1);
    return {
      x: pool.reduce((s, u) => s + u.col, 0) / n,
      y: pool.reduce((s, u) => s + u.row, 0) / n,
    };
  };
  const a = centroid('A');
  const b = centroid('B');
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? { A: 'left', B: 'right' } : { A: 'right', B: 'left' };
  }
  return dy < 0 ? { A: 'up', B: 'down' } : { A: 'down', B: 'up' };
}

export function currentPhase(state: BattleState): ScenarioPhase | null {
  return state.scenario.phases[state.phaseIndex] ?? null;
}

function log(state: BattleState, kind: BattleEventKind, text: string, side?: SideId): void {
  state.events.push({ t: state.elapsed, kind, text, side });
  if (state.events.length > BATTLE_LOG_MAX) state.events.shift();
}

function enterPhase(state: BattleState, index: number): void {
  const phase = state.scenario.phases[index];
  if (!phase) return;
  state.phaseIndex = index;
  state.phaseElapsed = 0;
  for (const u of state.units) {
    if (u.enterPhase === phase.id && u.status === 'active') {
      u.visible = true;
      u.enterPhase = null;
    }
  }
  state.phaseStart = new Map(
    state.units.map((u) => [u.id, { strength: u.strength, morale: u.morale }]),
  );
  log(state, 'phase', `${phase.time} — ${phase.title}: ${phase.narration}`);
  for (const order of phase.orders ?? []) {
    const u = state.byId.get(order.unit);
    if (!u || u.userControlled || u.status !== 'active') continue;
    if (state.mode === 'diverged' && !scriptedOrderStillValid(state, order)) continue;
    issueOrder(state, u, order, state.mode === 'historical' ? phase.durationSec : null);
  }
  raiseCalls(
    state,
    (phase.orders ?? []).map((o) => ({ order: o, side: state.byId.get(o.unit)?.side })),
  );
}

function scriptedOrderStillValid(state: BattleState, order: Order): boolean {
  if (!order.target) return true;
  const t = state.byId.get(order.target);
  return !!t && t.status === 'active';
}

// ── Orders ──────────────────────────────────────────────────────

/**
 * Point a unit at an order. `paceSec` (historical playback) makes the unit
 * arrive within the phase however far it has to go.
 */
export function issueOrder(
  state: BattleState,
  u: SimUnit,
  order: Order,
  paceSec: number | null,
): void {
  u.order = order;
  u.paceSpeed = null;
  u.chargeTimer = 0;
  u.engagedWith = null;
  u.firingAt = null;
  u.path = [];
  u.repathTimer = 0;

  switch (order.action) {
    case 'rout':
      breakUnit(state, u, 'routed', false);
      return;
    case 'hold':
      return;
    case 'move':
    case 'retreat':
    case 'flank':
      if (order.to) u.path = findPath(state, u, order.to[0], order.to[1]);
      break;
    case 'attack':
    case 'charge':
    case 'bombard': {
      const t = order.target ? state.byId.get(order.target) : undefined;
      if (t) u.path = findPath(state, u, Math.round(t.x), Math.round(t.y));
      break;
    }
  }
  if (paceSec !== null && u.path.length > 0) {
    const len = pathLength(u, u.path);
    const needed = len / (paceSec * BATTLE_HISTORICAL_ARRIVAL_FRACTION);
    u.paceSpeed = Math.max(needed, UNIT_STATS[u.type].speed * 0.5);
  }
}

export interface OrderResult {
  order: Order;
  accepted: boolean;
  reason?: string;
}

/**
 * Orders from the chat. Any accepted order diverges the battle from history:
 * recorded outcomes stop applying and the combat rules take over.
 */
export function applyUserOrders(state: BattleState, orders: Order[]): OrderResult[] {
  const results: OrderResult[] = [];
  for (const order of orders) {
    const u = state.byId.get(order.unit);
    const reject = (reason: string) => results.push({ order, accepted: false, reason });
    if (!u) {
      reject(`no unit "${order.unit}"`);
      continue;
    }
    if (u.status !== 'active') {
      reject(`${u.name} is ${u.status}`);
      continue;
    }
    if (!u.visible) {
      reject(`${u.name} has not reached the field yet`);
      continue;
    }
    if (['attack', 'charge', 'bombard', 'flank'].includes(order.action)) {
      const t = order.target ? state.byId.get(order.target) : undefined;
      if (!t || t.side === u.side || t.status !== 'active') {
        reject(`invalid target "${order.target ?? ''}"`);
        continue;
      }
    }
    if (['move', 'retreat', 'flank'].includes(order.action)) {
      const to = order.to;
      if (!to || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) {
        reject('missing destination');
        continue;
      }
      const clamped: [number, number] = [
        clampInt(to[0], 0, state.scenario.map.cols - 1),
        clampInt(to[1], 0, state.scenario.map.rows - 1),
      ];
      order.to = clamped;
    }
    if (state.mode === 'historical') {
      state.mode = 'diverged';
      log(state, 'diverge', 'History diverges — the combat rules now decide the outcome.');
    }
    u.userControlled = true;
    issueOrder(state, u, order, null);
    results.push({ order, accepted: true });
    log(state, 'order', describeOrder(state, order), u.side);
  }
  raiseCalls(
    state,
    results
      .filter((r) => r.accepted)
      .map((r) => ({ order: r.order, side: state.byId.get(r.order.unit)?.side })),
  );
  return results;
}

/** One bugle call per side per batch of orders: the charge if anyone attacks,
 *  the retreat if anyone falls back (a whole line advancing is one call). */
function raiseCalls(state: BattleState, orders: Array<{ order: Order; side?: SideId }>): void {
  for (const side of ['A', 'B'] as const) {
    const mine = orders.filter((o) => o.side === side).map((o) => o.order.action);
    if (mine.some((a) => a === 'attack' || a === 'charge' || a === 'flank')) {
      state.cues.push({ kind: 'call', call: 'attack', side });
    }
    if (mine.some((a) => a === 'retreat' || a === 'rout')) {
      state.cues.push({ kind: 'call', call: 'retreat', side });
    }
  }
}

export function describeOrder(state: BattleState, order: Order): string {
  const u = state.byId.get(order.unit);
  const t = order.target ? state.byId.get(order.target) : undefined;
  const who = u?.name ?? order.unit;
  switch (order.action) {
    case 'move':
      return `${who} marches to (${order.to?.join(', ')}).`;
    case 'retreat':
      return `${who} falls back to (${order.to?.join(', ')}).`;
    case 'attack':
      return `${who} attacks ${t?.name ?? order.target}.`;
    case 'charge':
      return `${who} charges ${t?.name ?? order.target}!`;
    case 'flank':
      return `${who} swings round by (${order.to?.join(', ')}) to hit ${t?.name ?? order.target}.`;
    case 'bombard':
      return `${who} opens fire on ${t?.name ?? order.target}.`;
    case 'hold':
      return `${who} holds its ground.`;
    case 'rout':
      return `${who} breaks and flees.`;
  }
}

// ── Pathfinding ─────────────────────────────────────────────────

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** BFS (8-way) from the unit's tile to the nearest reachable tile to (gc, gr). */
export function findPath(
  state: BattleState,
  u: SimUnit,
  gc: number,
  gr: number,
): Array<[number, number]> {
  const { cols, rows } = state.scenario.map;
  const naval = u.type === 'ships';
  const sc = clampInt(Math.round(u.x), 0, cols - 1);
  const sr = clampInt(Math.round(u.y), 0, rows - 1);
  const goalC = clampInt(gc, 0, cols - 1);
  const goalR = clampInt(gr, 0, rows - 1);
  const prev = new Int32Array(cols * rows).fill(-1);
  const start = sr * cols + sc;
  prev[start] = start;
  const queue = [start];
  let best = start;
  let bestDist = dist2(sc, sr, goalC, goalR);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    const d = dist2(cc, cr, goalC, goalR);
    if (d < bestDist) {
      best = cur;
      bestDist = d;
      if (d === 0) break;
    }
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (prev[ni] !== -1) continue;
      if (!canEnter(state.terrain, nc, nr, naval)) continue;
      // No corner-cutting between two impassable tiles.
      if (dc !== 0 && dr !== 0) {
        if (
          !canEnter(state.terrain, cc + dc, cr, naval) &&
          !canEnter(state.terrain, cc, cr + dr, naval)
        )
          continue;
      }
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  const path: Array<[number, number]> = [];
  for (let cur = best; cur !== start; cur = prev[cur]) {
    const c = cur % cols;
    path.push([c, (cur - c) / cols]);
  }
  path.reverse();
  return path;
}

function pathLength(u: SimUnit, path: Array<[number, number]>): number {
  let len = 0;
  let px = u.x;
  let py = u.y;
  for (const [c, r] of path) {
    len += Math.hypot(c - px, r - py);
    px = c;
    py = r;
  }
  return len;
}

// ── Simulation step ─────────────────────────────────────────────

export function stepBattle(state: BattleState, dt: number): void {
  if (state.finished || dt <= 0) return;
  state.elapsed += dt;

  for (const p of state.projectiles) {
    p.age += dt;
    if (p.age >= BATTLE_PROJECTILE_FLIGHT_SEC && isHeavy(p.weapon)) {
      onHeavyImpact(state.fires, state.effects, state.terrain, p.toX, p.toY, state.rand);
      state.cues.push({ kind: 'impact', weapon: p.weapon, x: p.toX });
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.age < BATTLE_PROJECTILE_FLIGHT_SEC);
  ageEffects(state.effects, state.fires, dt);

  for (const u of state.units) updateUnit(state, u, dt);
  resolveContacts(state, dt);
  if (state.mode === 'diverged') applyCombat(state, dt);
  else blendOutcomes(state);

  const phase = currentPhase(state);
  if (phase && state.phaseIndex < state.scenario.phases.length) {
    state.phaseElapsed += dt;
    if (state.phaseElapsed >= phase.durationSec) endPhase(state, phase);
  } else {
    state.overtime += dt;
  }
  checkVictory(state);
}

function updateUnit(state: BattleState, u: SimUnit, dt: number): void {
  u.moving = false;
  if (!u.visible) return;
  if (u.status === 'routed' || u.status === 'withdrawn') {
    flee(state, u, dt);
    return;
  }
  if (u.status !== 'active') return;
  if (u.chargeTimer > 0) u.chargeTimer = Math.max(0, u.chargeTimer - dt);

  const order = u.order;
  if (!order) return;
  const target = order.target ? state.byId.get(order.target) : undefined;
  const targetAlive = !!target && target.visible && target.status === 'active';

  // Flank: walk the waypoint first, then turn into an attack.
  if (order.action === 'flank' && u.path.length === 0 && order.target) {
    u.order = {
      unit: u.id,
      action: CHARGE_TYPES.has(u.type) ? 'charge' : 'attack',
      target: order.target,
    };
    return;
  }

  if (order.action === 'attack' || order.action === 'charge' || order.action === 'bombard') {
    if (!targetAlive || !target) {
      u.order = { unit: u.id, action: 'hold' };
      u.path = [];
      return;
    }
    const d = Math.hypot(target.x - u.x, target.y - u.y);
    const stats = UNIT_STATS[u.type];
    const shooting =
      (order.action === 'bombard' || RANGED_TYPES.has(u.type)) &&
      stats.range > 0 &&
      stats.ranged > 0;
    if (shooting && d <= stats.range && order.action === 'bombard') {
      u.path = [];
      u.firingAt = target.id;
      face(u, target.x - u.x, target.y - u.y);
      return;
    }
    if (d <= BATTLE_MELEE_RANGE_TILES) {
      if (u.engagedWith !== target.id && order.action === 'charge') {
        u.chargeTimer = BATTLE_CHARGE_BONUS_SEC;
      }
      u.engagedWith = target.id;
      u.path = [];
      face(u, target.x - u.x, target.y - u.y);
      return;
    }
    u.repathTimer -= dt;
    if (u.repathTimer <= 0 || u.path.length === 0) {
      u.repathTimer = BATTLE_REPATH_SEC;
      u.path = findPath(state, u, Math.round(target.x), Math.round(target.y));
    }
  }

  if (u.engagedWith && order.action !== 'retreat') return; // pinned in melee
  followPath(state, u, dt, order.action === 'charge' ? 1.25 : 1);
  if (u.path.length === 0 && (order.action === 'move' || order.action === 'retreat')) {
    u.order = { unit: u.id, action: 'hold' };
    u.paceSpeed = null;
  }
}

function followPath(state: BattleState, u: SimUnit, dt: number, speedMul: number): void {
  if (u.path.length === 0) return;
  const tile = terrainAt(state.terrain, Math.round(u.x), Math.round(u.y));
  const base = u.paceSpeed ?? UNIT_STATS[u.type].speed * (u.type === 'ships' ? 1 : tile.speed);
  let budget = base * speedMul * dt;
  while (budget > 0 && u.path.length > 0) {
    const [nc, nr] = u.path[0];
    const dx = nc - u.x;
    const dy = nr - u.y;
    const d = Math.hypot(dx, dy);
    face(u, dx, dy);
    if (d <= budget) {
      u.x = nc;
      u.y = nr;
      u.path.shift();
      budget -= d;
    } else {
      u.x += (dx / d) * budget;
      u.y += (dy / d) * budget;
      budget = 0;
    }
    u.moving = true;
  }
}

function flee(state: BattleState, u: SimUnit, dt: number): void {
  if (!u.fleeTo) u.fleeTo = fleeTarget(state, u);
  if (u.path.length === 0) u.path = findPath(state, u, u.fleeTo[0], u.fleeTo[1]);
  u.paceSpeed = UNIT_STATS[u.type].speed * BATTLE_FLEE_SPEED_MULTIPLIER;
  followPath(state, u, dt, 1);
  if (u.path.length === 0) u.visible = false; // gone off the field
}

function fleeTarget(state: BattleState, u: SimUnit): [number, number] {
  const { cols, rows } = state.scenario.map;
  const c = clampInt(Math.round(u.x), 0, cols - 1);
  const r = clampInt(Math.round(u.y), 0, rows - 1);
  switch (state.homeEdge[u.side]) {
    case 'up':
      return [c, 0];
    case 'down':
      return [c, rows - 1];
    case 'left':
      return [0, r];
    case 'right':
      return [cols - 1, r];
  }
}

function face(u: SimUnit, dx: number, dy: number): void {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  if (Math.abs(dx) > Math.abs(dy)) u.facing = dx > 0 ? 'right' : 'left';
  else u.facing = dy > 0 ? 'down' : 'up';
}

/** Units that touch an enemy fight it, whatever their order (a unit marching
 *  past an enemy is caught; a holding unit defends itself). */
function resolveContacts(state: BattleState, dt: number): void {
  const active = state.units.filter((u) => u.visible && u.status === 'active');
  for (const u of active) {
    const cur = u.engagedWith ? state.byId.get(u.engagedWith) : undefined;
    if (
      cur &&
      (!cur.visible ||
        cur.status !== 'active' ||
        Math.hypot(cur.x - u.x, cur.y - u.y) > BATTLE_MELEE_RANGE_TILES * 1.5)
    ) {
      u.engagedWith = null;
    }
    if (u.firingAt) {
      const t = state.byId.get(u.firingAt);
      const range = UNIT_STATS[u.type].range;
      if (
        !t ||
        !t.visible ||
        t.status !== 'active' ||
        Math.hypot(t.x - u.x, t.y - u.y) > range + 0.5
      )
        u.firingAt = null;
    }
    if (u.engagedWith || u.order?.action === 'retreat') continue;
    let nearest: SimUnit | null = null;
    let nd = BATTLE_MELEE_RANGE_TILES;
    for (const e of active) {
      if (e.side === u.side) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d <= nd) {
        nd = d;
        nearest = e;
      }
    }
    if (nearest) {
      u.engagedWith = nearest.id;
      face(u, nearest.x - u.x, nearest.y - u.y);
    }
  }
  // Volleys are visual in both modes.
  for (const u of active) {
    if (!u.firingAt) continue;
    u.volleyTimer -= dt;
    if (u.volleyTimer <= 0) {
      u.volleyTimer = BATTLE_VOLLEY_INTERVAL_SEC;
      const t = state.byId.get(u.firingAt);
      if (t) {
        const weapon = weaponFor(u.type, state.year);
        state.projectiles.push({
          fromX: u.x,
          fromY: u.y,
          toX: t.x,
          toY: t.y,
          age: 0,
          side: u.side,
          weapon,
        });
        state.cues.push({ kind: 'shot', weapon, x: u.x });
        if (isGunpowder(weapon)) {
          state.effects.push(
            { kind: 'flash', x: u.x, y: u.y, age: 0, ttl: BATTLE_FLASH_TTL_SEC },
            { kind: 'smoke', x: u.x, y: u.y, age: 0, ttl: BATTLE_SMOKE_TTL_SEC },
          );
        }
      }
    }
  }
}

// ── Historical blending ─────────────────────────────────────────

function blendOutcomes(state: BattleState): void {
  const phase = currentPhase(state);
  if (!phase?.outcomes) return;
  const p = Math.min(1, state.phaseElapsed / phase.durationSec);
  for (const oc of phase.outcomes) {
    const u = state.byId.get(oc.unit);
    const start = state.phaseStart.get(oc.unit);
    if (!u || !start) continue;
    if (oc.strength !== undefined) u.strength = lerp(start.strength, oc.strength, p);
    if (oc.morale !== undefined) u.morale = lerp(start.morale, oc.morale, p);
  }
}

function endPhase(state: BattleState, phase: ScenarioPhase): void {
  if (state.mode === 'historical') {
    for (const oc of phase.outcomes ?? []) {
      const u = state.byId.get(oc.unit);
      if (!u) continue;
      if (oc.strength !== undefined) u.strength = oc.strength;
      if (oc.morale !== undefined) u.morale = oc.morale;
      if (oc.status && oc.status !== 'active' && u.status === 'active') {
        breakUnit(state, u, oc.status, false);
      } else if (oc.status && oc.status !== u.status && FINAL_STATUSES.has(oc.status)) {
        // A unit that broke earlier can still be recorded as cut down or
        // taken prisoner later (routed → destroyed / surrendered).
        u.status = oc.status;
        if (oc.status === 'destroyed') {
          u.visible = false;
          u.strength = 0;
        }
      }
    }
  }
  const next = state.phaseIndex + 1;
  if (next < state.scenario.phases.length) {
    enterPhase(state, next);
  } else {
    state.phaseIndex = state.scenario.phases.length; // past the last phase
    if (state.mode === 'historical') finish(state, state.scenario.victor);
  }
}

// ── Combat rules (diverged mode) ────────────────────────────────

function applyCombat(state: BattleState, dt: number): void {
  const losses = new Map<string, number>();
  /** Stress weight per unit: 1 per enemy in contact or shooting, more from behind. */
  const stress = new Map<string, number>();
  const addLoss = (id: string, n: number) => losses.set(id, (losses.get(id) ?? 0) + n);
  const addStress = (id: string, n: number) => stress.set(id, (stress.get(id) ?? 0) + n);

  // How many enemies are in close combat with each unit: a surrounded unit is
  // hit harder and breaks sooner (Cannae is the whole point).
  const meleeAttackers = new Map<string, number>();
  for (const u of state.units) {
    if (u.visible && u.status === 'active' && u.engagedWith) {
      meleeAttackers.set(u.engagedWith, (meleeAttackers.get(u.engagedWith) ?? 0) + 1);
    }
  }

  for (const u of state.units) {
    if (!u.visible || u.status !== 'active') continue;
    const stats = UNIT_STATS[u.type];
    const moraleFactor = 0.5 + u.morale / 200;
    const melee = u.engagedWith ? state.byId.get(u.engagedWith) : undefined;
    if (melee && melee.status === 'active') {
      const charge = u.chargeTimer > 0 ? stats.charge : 1;
      const angle = angleMultiplier(u, melee);
      const pressed =
        1 + BATTLE_SURROUNDED_DAMAGE_BONUS * ((meleeAttackers.get(melee.id) ?? 1) - 1);
      const dmg =
        (effective(u, melee) *
          stats.melee *
          BATTLE_MELEE_RATE *
          dt *
          moraleFactor *
          charge *
          angle *
          pressed) /
        defenseOf(state, melee);
      addLoss(melee.id, dmg);
      addStress(melee.id, angle);
    }
    const shot = u.firingAt ? state.byId.get(u.firingAt) : undefined;
    if (shot && shot.status === 'active' && !melee) {
      const dmg =
        (effective(u, shot) * stats.ranged * BATTLE_RANGED_RATE * dt * moraleFactor) /
        defenseOf(state, shot);
      addLoss(shot.id, dmg);
      addStress(shot.id, 1);
    }
  }

  for (const u of state.units) {
    if (!u.visible || u.status !== 'active') continue;
    const loss = Math.min(u.strength, losses.get(u.id) ?? 0);
    if (loss > 0) {
      const frac = loss / Math.max(u.strength, 1);
      u.strength -= loss;
      u.morale -= frac * BATTLE_MORALE_PER_LOSS;
    }
    const pressure = stress.get(u.id) ?? 0;
    if (pressure > 0) {
      u.morale -= BATTLE_MORALE_STRESS_PER_SEC * pressure * dt;
    } else if (u.morale < u.initialMorale) {
      const aura = hasCommandAura(state, u) ? 2 : 1;
      u.morale = Math.min(u.initialMorale, u.morale + BATTLE_MORALE_RECOVERY_PER_SEC * aura * dt);
    }
    u.morale = Math.max(0, u.morale);
    if (u.strength <= u.initialStrength * BATTLE_DESTROYED_FRACTION) {
      breakUnit(state, u, 'destroyed', true);
    } else if (u.morale <= BATTLE_ROUT_MORALE) {
      breakUnit(state, u, 'routed', true);
    }
  }
}

/** Frontage: a huge army can't bring every man to bear on a small one. */
function effective(attacker: SimUnit, defender: SimUnit): number {
  return Math.min(attacker.strength, defender.strength * BATTLE_MAX_OUTNUMBER);
}

function defenseOf(state: BattleState, u: SimUnit): number {
  const tile = terrainAt(state.terrain, Math.round(u.x), Math.round(u.y));
  const aura = hasCommandAura(state, u) ? 1.1 : 1;
  return UNIT_STATS[u.type].defense * (u.type === 'ships' ? 1 : tile.defense) * aura;
}

/** Hitting a unit from where it is not facing hurts more. */
function angleMultiplier(attacker: SimUnit, defender: SimUnit): number {
  const dx = attacker.x - defender.x;
  const dy = attacker.y - defender.y;
  const [fx, fy] = facingVector(defender.facing);
  const len = Math.hypot(dx, dy) || 1;
  const dot = (dx * fx + dy * fy) / len;
  if (dot < -0.5) return BATTLE_REAR_MULTIPLIER;
  if (dot < 0.5) return BATTLE_FLANK_MULTIPLIER;
  return 1;
}

function facingVector(f: Facing): [number, number] {
  switch (f) {
    case 'up':
      return [0, -1];
    case 'down':
      return [0, 1];
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
  }
}

function hasCommandAura(state: BattleState, u: SimUnit): boolean {
  return state.units.some(
    (c) =>
      c.type === 'command' &&
      c.side === u.side &&
      c.id !== u.id &&
      c.visible &&
      c.status === 'active' &&
      Math.hypot(c.x - u.x, c.y - u.y) <= BATTLE_COMMAND_AURA_TILES,
  );
}

function breakUnit(state: BattleState, u: SimUnit, status: UnitStatus, announce: boolean): void {
  if (u.status !== 'active') return;
  u.status = status;
  u.engagedWith = null;
  u.firingAt = null;
  u.path = [];
  u.order = null;
  u.fleeTo = null;
  for (const other of state.units) {
    if (other.engagedWith === u.id) other.engagedWith = null;
    if (other.firingAt === u.id) other.firingAt = null;
  }
  if (status === 'destroyed') {
    u.visible = false;
    u.strength = 0;
    onUnitDestroyed(state.fires, u.x, u.y, state.rand);
  }
  if (status === 'routed' || status === 'withdrawn') {
    state.cues.push({ kind: 'call', call: 'retreat', side: u.side });
  }
  if (
    u.type === 'command' &&
    (status === 'routed' || status === 'destroyed' || status === 'surrendered')
  ) {
    for (const f of state.units) {
      if (f.side === u.side && f.status === 'active')
        f.morale = Math.max(0, f.morale - BATTLE_COMMAND_LOSS_MORALE);
    }
  }
  const verb: Record<UnitStatus, string> = {
    active: 'rallies',
    routed: 'breaks and flees',
    destroyed: 'is destroyed',
    surrendered: 'surrenders',
    withdrawn: 'withdraws from the field',
  };
  if (announce || state.mode === 'historical')
    log(state, 'status', `${u.name} ${verb[status]}.`, u.side);
}

// ── Victory ─────────────────────────────────────────────────────

function sideAlive(state: BattleState, side: SideId): boolean {
  return state.units.some(
    (u) => u.side === side && u.status === 'active' && (u.visible || u.enterPhase !== null),
  );
}

export function sidePower(state: BattleState, side: SideId): number {
  return state.units
    .filter((u) => u.side === side && u.status === 'active' && u.visible)
    .reduce((s, u) => s + u.strength * (u.morale / 100), 0);
}

function checkVictory(state: BattleState): void {
  if (state.finished || state.mode !== 'diverged') return;
  const a = sideAlive(state, 'A');
  const b = sideAlive(state, 'B');
  if (!a || !b) {
    finish(state, a ? 'A' : b ? 'B' : 'draw');
    return;
  }
  if (state.phaseIndex >= state.scenario.phases.length && state.overtime >= BATTLE_OVERTIME_SEC) {
    const pa = sidePower(state, 'A');
    const pb = sidePower(state, 'B');
    finish(
      state,
      pa > pb * BATTLE_DECISIVE_RATIO ? 'A' : pb > pa * BATTLE_DECISIVE_RATIO ? 'B' : 'draw',
    );
  }
}

function finish(state: BattleState, winner: SideId | 'draw'): void {
  state.finished = true;
  state.winner = winner;
  const name = winner === 'draw' ? null : state.scenario.sides.find((s) => s.id === winner)?.name;
  if (state.mode === 'historical') {
    log(state, 'end', `${state.scenario.result.summary}`);
  } else {
    const hist =
      state.scenario.victor === winner
        ? 'the same result as history'
        : 'a different result from history';
    log(
      state,
      'end',
      name ? `${name} carries the field — ${hist}.` : `The battle ends indecisively — ${hist}.`,
    );
  }
}

// ── Chat snapshot ───────────────────────────────────────────────

/** Compact state for the LLM: who is where, how strong, doing what. */
export function snapshotForChat(state: BattleState): unknown {
  const phase = currentPhase(state);
  return {
    phase: phase
      ? {
          number: state.phaseIndex + 1,
          of: state.scenario.phases.length,
          title: phase.title,
          time: phase.time,
        }
      : { finished: state.finished, winner: state.winner },
    mode: state.mode,
    units: state.units
      .filter((u) => u.visible || u.enterPhase !== null)
      .map((u) => ({
        id: u.id,
        side: u.side,
        name: u.name,
        type: u.type,
        strength: Math.round(u.strength),
        morale: Math.round(u.morale),
        status: u.visible ? u.status : 'not yet arrived',
        pos: [Math.round(u.x), Math.round(u.y)],
        order: u.order ? `${u.order.action}${u.order.target ? ' ' + u.order.target : ''}` : 'none',
      })),
  };
}

// ── Utilities ───────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}
