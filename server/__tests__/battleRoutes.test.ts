import Fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildBattleSystemPrompt,
  buildBattleUserTurn,
  parseChatReply,
} from '../../core/src/battlePrompt.js';
import { registerBattleRoutes, resolveBattlesDir } from '../src/battles/battleRoutes.js';

const TOKEN = 'test-token';

let tmp: string;

function writeScenario(id: string, year: string, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(tmp, 'battles', 'scenarios', `${id}.json`),
    JSON.stringify({ id, title: `Battle of ${id}`, year, wiki: `wiki/battles/${id}.md`, ...extra }),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-battles-'));
  fs.mkdirSync(path.join(tmp, 'battles', 'scenarios'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'battles', 'wiki', 'battles'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'dist', 'webview'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function app() {
  const a = Fastify();
  registerBattleRoutes(a, { battlesDir: path.join(tmp, 'battles'), token: TOKEN });
  await a.ready();
  return a;
}

describe('resolveBattlesDir', () => {
  it('prefers the checkout battles/ next to dist/', () => {
    expect(resolveBattlesDir(path.join(tmp, 'dist', 'webview'))).toBe(path.join(tmp, 'battles'));
  });

  it('falls back to the copy bundled in dist/', () => {
    fs.rmSync(path.join(tmp, 'battles'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'dist', 'battles', 'scenarios'), { recursive: true });
    expect(resolveBattlesDir(path.join(tmp, 'dist', 'webview'))).toBe(
      path.join(tmp, 'dist', 'battles'),
    );
  });

  it('is null without a static dir or a scenarios folder', () => {
    expect(resolveBattlesDir(undefined)).toBeNull();
    fs.rmSync(path.join(tmp, 'battles'), { recursive: true });
    expect(resolveBattlesDir(path.join(tmp, 'dist', 'webview'))).toBeNull();
  });
});

describe('battle routes', () => {
  it('lists battles chronologically, BCE before CE', async () => {
    writeScenario('waterloo', '1815 CE');
    writeScenario('cannae', '216 BCE');
    writeScenario('marathon', '490 BCE');
    const res = await (await app()).inject({ method: 'GET', url: '/api/battles' });
    expect(res.statusCode).toBe(200);
    expect(res.json().battles.map((b: { id: string }) => b.id)).toEqual([
      'marathon',
      'cannae',
      'waterloo',
    ]);
  });

  it('serves a scenario with its wiki page', async () => {
    writeScenario('cannae', '216 BCE');
    fs.writeFileSync(path.join(tmp, 'battles', 'wiki', 'battles', 'cannae.md'), '# Cannae');
    const res = await (await app()).inject({ method: 'GET', url: '/api/battles/cannae' });
    expect(res.statusCode).toBe(200);
    expect(res.json().wiki).toBe('# Cannae');
  });

  it('rejects ids that are not slugs (no path traversal)', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/battles/..%2F..%2Fsecret' });
    expect(res.statusCode).toBe(404);
  });

  it('never reads a wiki page outside the battles folder', async () => {
    fs.writeFileSync(path.join(tmp, 'secret.md'), 'top secret');
    writeScenario('evil', '1 CE', { wiki: '../secret.md' });
    const res = await (await app()).inject({ method: 'GET', url: '/api/battles/evil' });
    expect(res.json().wiki).toBe('');
  });

  it('refuses the chat without the server token', async () => {
    writeScenario('cannae', '216 BCE');
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/battles/chat',
      payload: { battleId: 'cannae', message: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty chat message before calling the model', async () => {
    writeScenario('cannae', '216 BCE');
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/battles/chat',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { battleId: 'cannae', message: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('parseChatReply', () => {
  it('keeps valid orders and drops malformed ones', () => {
    const out = parseChatReply(
      JSON.stringify({
        reply: 'The cavalry wheels left.',
        orders: [
          { unit: 'car-numidians', action: 'charge', target: 'rom-cav-left' },
          { unit: 'x', action: 'teleport' },
          { action: 'hold' },
          'nonsense',
        ],
      }),
    );
    expect(out.reply).toBe('The cavalry wheels left.');
    expect(out.orders).toEqual([
      { unit: 'car-numidians', action: 'charge', target: 'rom-cav-left' },
    ]);
  });

  it('falls back to prose when the model ignores the JSON format', () => {
    expect(parseChatReply('  Hannibal smiles.  ')).toEqual({
      reply: 'Hannibal smiles.',
      orders: [],
    });
  });
});

describe('battle prompt', () => {
  it('puts the map and wiki in a system prompt that does not depend on the live state', () => {
    const scenario = {
      title: 'Battle of Cannae',
      year: '216 BCE',
      map: { terrain: ['..~', '.T.'] },
    };
    const prompt = buildBattleSystemPrompt(scenario, 'WIKI TEXT');
    expect(prompt).toContain('00 ..~');
    expect(prompt).toContain('01 .T.');
    expect(prompt).toContain('WIKI TEXT');
    // Stable across turns, so Ollama can reuse the processed prefix.
    expect(buildBattleSystemPrompt(scenario, 'WIKI TEXT')).toBe(prompt);
  });

  it('sends the live state with the user turn', () => {
    const turn = buildBattleUserTurn('Charge!', { units: [{ id: 'rom-centre' }] });
    expect(turn).toContain('rom-centre');
    expect(turn.endsWith('Charge!')).toBe(true);
  });
});
