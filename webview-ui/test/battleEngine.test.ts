/**
 * Battle engine tests, run against every scenario in battles/scenarios/.
 *
 * Covers:
 *   - historical playback ends with the recorded victor and the final outcomes
 *   - user orders diverge the battle and the combat rules reach a result
 *   - invalid orders from the chat are rejected, not applied
 *   - pathfinding never routes land units through sea, mountains or walls
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { meleeSoundFor, onHeavyImpact, weaponFor, yearOf } from '../src/battle/battleEffects.js';
import {
  applyUserOrders,
  createBattle,
  findPath,
  sidePower,
  stepBattle,
} from '../src/battle/battleEngine.js';
import { canEnter } from '../src/battle/battleRules.js';
import type { Scenario } from '../src/battle/battleTypes.js';
import { FLAG_H, FLAG_W, FLAGS } from '../src/office/sprites/battleFlags.js';

const scenarioDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'battles',
  'scenarios',
);
const scenarios: Scenario[] = fs.existsSync(scenarioDir)
  ? fs
      .readdirSync(scenarioDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(scenarioDir, f), 'utf-8')) as Scenario)
  : [];

const DT = 1 / 30;
const MAX_SIM_SEC = 600;

function runToEnd(state: ReturnType<typeof createBattle>): void {
  for (let t = 0; t < MAX_SIM_SEC && !state.finished; t += DT) stepBattle(state, DT);
}

test('at least one scenario is present', () => {
  assert.ok(scenarios.length > 0, `no scenarios in ${scenarioDir}`);
});

for (const scenario of scenarios) {
  test(`${scenario.id}: historical playback ends as recorded`, () => {
    const state = createBattle(scenario);
    runToEnd(state);
    assert.equal(state.finished, true, 'battle should finish');
    assert.equal(state.mode, 'historical');
    assert.equal(state.winner, scenario.victor);
    // Every unit with a recorded outcome ends at it.
    const last = new Map<string, { strength?: number; status?: string }>();
    for (const p of scenario.phases)
      for (const oc of p.outcomes ?? []) last.set(oc.unit, { ...last.get(oc.unit), ...oc });
    for (const [id, oc] of last) {
      const u = state.byId.get(id)!;
      if (oc.strength !== undefined && oc.status !== 'destroyed') {
        assert.ok(
          Math.abs(u.strength - oc.strength) < 1,
          `${id} strength ${u.strength} ≠ ${oc.strength}`,
        );
      }
      if (oc.status && oc.status !== 'active') assert.equal(u.status, oc.status, `${id} status`);
    }
  });

  test(`${scenario.id}: a what-if order diverges and the rules decide`, () => {
    const state = createBattle(scenario);
    // Let deployment play out, then throw the losing side's strongest unit at
    // the nearest enemy.
    for (let t = 0; t < scenario.phases[0].durationSec + 1; t += DT) stepBattle(state, DT);
    const loser = scenario.victor === 'A' ? 'B' : 'A';
    const mine = state.units
      .filter((u) => u.side === loser && u.visible && u.status === 'active' && u.type !== 'ships')
      .sort((a, b) => b.strength - a.strength)[0];
    const enemy = state.units
      .filter((u) => u.side !== loser && u.visible && u.status === 'active' && u.type !== 'ships')
      .sort(
        (a, b) => Math.hypot(a.x - mine.x, a.y - mine.y) - Math.hypot(b.x - mine.x, b.y - mine.y),
      )[0];
    const [result] = applyUserOrders(state, [
      { unit: mine.id, action: 'attack', target: enemy.id },
    ]);
    assert.equal(result.accepted, true, result.reason ?? '');
    assert.equal(state.mode, 'diverged');
    runToEnd(state);
    assert.equal(state.finished, true, 'diverged battle should reach a result');
    assert.ok(state.winner === 'A' || state.winner === 'B' || state.winner === 'draw');
    assert.ok(sidePower(state, 'A') >= 0 && sidePower(state, 'B') >= 0);
  });

  test(`${scenario.id}: land paths avoid impassable terrain`, () => {
    const state = createBattle(scenario);
    for (const u of state.units.filter((x) => x.type !== 'ships')) {
      const path = findPath(
        state,
        u,
        scenario.map.cols - 1 - Math.round(u.x),
        scenario.map.rows - 1 - Math.round(u.y),
      );
      for (const [c, r] of path)
        assert.ok(canEnter(state.terrain, c, r, false), `${u.id} path enters (${c},${r})`);
    }
  });
}

test('chat orders for unknown units, friendly targets or routed units are rejected', () => {
  const scenario = scenarios[0];
  const state = createBattle(scenario);
  const a = state.units.find((u) => u.side === 'A' && u.visible)!;
  const a2 = state.units.find((u) => u.side === 'A' && u.visible && u.id !== a.id)!;
  const results = applyUserOrders(state, [
    { unit: 'no-such-unit', action: 'hold' },
    { unit: a.id, action: 'attack', target: a2.id },
    { unit: a.id, action: 'move' },
  ]);
  assert.deepEqual(
    results.map((r) => r.accepted),
    [false, false, false],
  );
  assert.equal(state.mode, 'historical', 'rejected orders must not diverge history');
});

test('every flag a scenario names exists and is a full 16×10 sprite', () => {
  for (const s of scenarios) {
    for (const side of s.sides) {
      if (!side.flag) continue;
      const flag = FLAGS[side.flag];
      assert.ok(flag, `${s.id} side ${side.id}: unknown flag "${side.flag}"`);
      assert.equal(flag.length, FLAG_H);
      for (const row of flag) {
        assert.equal(row.length, FLAG_W);
        assert.ok(
          row.every((px) => px !== ''),
          `${side.flag} has a transparent pixel`,
        );
      }
    }
  }
});

test('historical playback sounds the charge and raises volley cues', () => {
  const kinds = new Set<string>();
  for (const s of scenarios) {
    const state = createBattle(s);
    for (let t = 0; t < MAX_SIM_SEC && !state.finished; t += DT) {
      stepBattle(state, DT);
      for (const c of state.cues.splice(0))
        kinds.add(c.kind === 'call' ? `call:${c.call}` : c.kind);
    }
  }
  assert.ok(kinds.has('call:attack'), 'no charge call anywhere');
  assert.ok(kinds.has('call:retreat'), 'no retreat call anywhere');
  assert.ok(kinds.has('shot'), 'no volleys anywhere');
});

test('weapons and melee sounds follow the era', () => {
  assert.equal(weaponFor('archers', -490), 'bow');
  assert.equal(weaponFor('siege', -331), 'catapult');
  assert.equal(weaponFor('siege', 1453), 'cannon');
  assert.equal(weaponFor('ships', 1453), 'cannon');
  assert.equal(weaponFor('light_infantry', 1815), 'musket');
  assert.equal(weaponFor('light_infantry', 1942), 'rifle');
  assert.equal(meleeSoundFor(1066), 'swords');
  assert.equal(meleeSoundFor(1815), 'muskets');
  assert.equal(meleeSoundFor(1942), 'gunfire');
  assert.equal(yearOf('490 BCE'), -490);
  assert.equal(yearOf('1942–1943 CE'), 1942);
});

test('a modern city battle starts burning; an ancient plain does not', () => {
  const stalingrad = scenarios.find((s) => s.id === 'stalingrad');
  const marathon = scenarios.find((s) => s.id === 'marathon');
  if (stalingrad)
    assert.ok(createBattle(stalingrad).fires.length > 0, 'Stalingrad ruins should burn');
  if (marathon) assert.equal(createBattle(marathon).fires.length, 0);
});

test('heavy shot landing on a town can set it alight, never past the cap', () => {
  const fires: Parameters<typeof onHeavyImpact>[0] = [];
  const effects: Parameters<typeof onHeavyImpact>[1] = [];
  const always = () => 0;
  for (let i = 0; i < 200; i++) onHeavyImpact(fires, effects, ['cccccccccc'], i % 10, 0, always);
  assert.ok(fires.length > 0);
  assert.ok(fires.length <= 10, 'one fire per tile');
  assert.equal(effects.length, 200);
});
