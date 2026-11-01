#!/usr/bin/env node
// Validates battles/scenarios/*.json against the scenario rules in battles/SCHEMA.md.
// Usage: node scripts/validate-battles.mjs [slug ...]   (no args = every scenario)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'battles');
const scenarioDir = path.join(root, 'scenarios');

const COLS = 48;
const ROWS = 30;
const TERRAIN = new Set(['.', ',', 'b', ':', '^', 'T', 's', '~', 'c', 'r', 'g', '=', 'M', '#']);
const IMPASSABLE = new Set(['=', 'M', '#']);
const UNIT_TYPES = new Set([
  'infantry',
  'heavy_infantry',
  'light_infantry',
  'archers',
  'cavalry',
  'heavy_cavalry',
  'horse_archers',
  'chariots',
  'elephants',
  'artillery',
  'siege',
  'ships',
  'armor',
  'command',
]);
const ACTIONS = new Set([
  'move',
  'attack',
  'charge',
  'flank',
  'bombard',
  'hold',
  'retreat',
  'rout',
]);
const STATUSES = new Set(['active', 'routed', 'destroyed', 'surrendered', 'withdrawn']);
const FACINGS = new Set(['up', 'down', 'left', 'right']);

function validate(file) {
  const errors = [];
  const err = (m) => errors.push(m);
  let s;
  try {
    s = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [`invalid JSON: ${e.message}`];
  }
  const slug = path.basename(file, '.json');
  if (s.id !== slug) err(`id "${s.id}" must equal file slug "${slug}"`);
  for (const k of ['title', 'year', 'location', 'wiki', 'summary']) {
    if (typeof s[k] !== 'string' || !s[k]) err(`missing string field "${k}"`);
  }
  if (s.wiki && !fs.existsSync(path.join(root, s.wiki))) err(`wiki page not found: ${s.wiki}`);

  const m = s.map ?? {};
  if (m.cols !== COLS || m.rows !== ROWS) err(`map must be ${COLS}×${ROWS}`);
  const terrain = Array.isArray(m.terrain) ? m.terrain : [];
  if (terrain.length !== ROWS) err(`map.terrain must have ${ROWS} rows, has ${terrain.length}`);
  terrain.forEach((row, r) => {
    if (typeof row !== 'string' || row.length !== COLS)
      err(`terrain row ${r} must be ${COLS} chars, is ${row?.length}`);
    else for (const ch of row) if (!TERRAIN.has(ch)) err(`terrain row ${r}: unknown char "${ch}"`);
  });
  const tileAt = (c, r) => terrain[r]?.[c];
  const inBounds = (c, r) =>
    Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < COLS && r < ROWS;
  for (const l of m.labels ?? []) {
    if (typeof l.text !== 'string' || !inBounds(l.col, l.row))
      err(`bad label ${JSON.stringify(l)}`);
  }

  const sides = Array.isArray(s.sides) ? s.sides : [];
  if (sides.length !== 2) err('exactly two sides required');
  const sideIds = new Set(sides.map((x) => x.id));
  for (const x of sides) {
    if (!['A', 'B'].includes(x.id)) err(`side id must be A or B, got ${x.id}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(x.color ?? '')) err(`side ${x.id}: color must be #RRGGBB`);
    if (!x.name || !x.commander) err(`side ${x.id}: name and commander required`);
    if (x.flag !== undefined && !/^[a-z0-9-]+$/.test(x.flag))
      err(`side ${x.id}: flag must be a flag id`);
  }
  if (!sideIds.has(s.victor) && s.victor !== 'draw') err(`victor must be a side id or "draw"`);

  const phases = Array.isArray(s.phases) ? s.phases : [];
  const phaseIds = new Set(phases.map((p) => p.id));
  if (phases.length < 5) err('at least 5 phases required');

  const units = Array.isArray(s.units) ? s.units : [];
  if (units.length < 6) err('at least 6 units required');
  const unitIds = new Set();
  const unitSide = new Map();
  for (const u of units) {
    const tag = `unit ${u.id}`;
    if (!/^[a-z0-9-]+$/.test(u.id ?? '')) err(`${tag}: id must be kebab-case`);
    if (unitIds.has(u.id)) err(`${tag}: duplicate id`);
    unitIds.add(u.id);
    unitSide.set(u.id, u.side);
    if (!sideIds.has(u.side)) err(`${tag}: unknown side ${u.side}`);
    if (!UNIT_TYPES.has(u.type)) err(`${tag}: unknown type ${u.type}`);
    if (!(Number.isFinite(u.strength) && u.strength > 0)) err(`${tag}: strength must be > 0`);
    if (!u.name) err(`${tag}: name required`);
    if (u.facing && !FACINGS.has(u.facing)) err(`${tag}: bad facing ${u.facing}`);
    if (u.morale !== undefined && !(u.morale >= 0 && u.morale <= 100)) err(`${tag}: morale 0–100`);
    if (u.enterPhase && !phaseIds.has(u.enterPhase))
      err(`${tag}: unknown enterPhase ${u.enterPhase}`);
    if (!inBounds(u.col, u.row)) err(`${tag}: start tile out of bounds`);
    else {
      const t = tileAt(u.col, u.row);
      const naval = u.type === 'ships';
      if (naval ? t !== '=' && t !== '~' : IMPASSABLE.has(t))
        err(`${tag}: starts on ${naval ? 'land' : 'impassable'} tile "${t}" at ${u.col},${u.row}`);
    }
  }

  for (const p of phases) {
    const tag = `phase ${p.id}`;
    if (!p.id || !p.title || !p.time || !p.narration)
      err(`${tag}: id, title, time, narration required`);
    if (!(p.durationSec >= 4 && p.durationSec <= 15)) err(`${tag}: durationSec must be 4–15`);
    for (const o of p.orders ?? []) {
      const otag = `${tag} order ${o.unit}/${o.action}`;
      if (!unitIds.has(o.unit)) err(`${otag}: unknown unit`);
      if (!ACTIONS.has(o.action)) err(`${otag}: unknown action`);
      if (['move', 'retreat', 'flank'].includes(o.action)) {
        if (!Array.isArray(o.to) || !inBounds(o.to[0], o.to[1]))
          err(`${otag}: "to" must be an in-bounds [col,row]`);
      }
      if (['attack', 'charge', 'flank', 'bombard'].includes(o.action)) {
        if (!unitIds.has(o.target)) err(`${otag}: unknown target ${o.target}`);
        else if (unitSide.get(o.target) === unitSide.get(o.unit))
          err(`${otag}: target is on the same side`);
      }
    }
    for (const oc of p.outcomes ?? []) {
      const otag = `${tag} outcome ${oc.unit}`;
      if (!unitIds.has(oc.unit)) err(`${otag}: unknown unit`);
      if (oc.status && !STATUSES.has(oc.status)) err(`${otag}: unknown status ${oc.status}`);
      if (oc.strength !== undefined && !(oc.strength >= 0)) err(`${otag}: strength must be ≥ 0`);
    }
  }

  if (!s.result?.summary) err('result.summary required');
  if (!Array.isArray(s.sources) || s.sources.length < 2) err('at least 2 sources required');
  return errors;
}

const only = process.argv.slice(2);
const files = fs.existsSync(scenarioDir)
  ? fs.readdirSync(scenarioDir).filter((f) => f.endsWith('.json'))
  : [];
const targets = only.length ? files.filter((f) => only.includes(path.basename(f, '.json'))) : files;
let failed = 0;
for (const f of targets) {
  const errors = validate(path.join(scenarioDir, f));
  if (errors.length) {
    failed++;
    console.log(`✘ ${f}`);
    for (const e of errors.slice(0, 40)) console.log(`   - ${e}`);
  } else console.log(`✓ ${f}`);
}
if (!targets.length) console.log('No scenarios found.');
process.exit(failed ? 1 : 0);
