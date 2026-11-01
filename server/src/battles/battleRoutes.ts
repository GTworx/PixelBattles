import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import type { ChatTurn } from '../../../core/src/battlePrompt.js';
import {
  buildBattleSystemPrompt,
  buildBattleUserTurn,
  ollamaChatBody,
  parseChatReply,
} from '../../../core/src/battlePrompt.js';
import {
  BATTLE_CHAT_HISTORY_MAX,
  BATTLE_CHAT_MESSAGE_MAX_CHARS,
  BATTLE_CHAT_TIMEOUT_MS,
  BATTLE_OLLAMA_KEEP_ALIVE,
  BATTLE_OLLAMA_NUM_CTX,
  BATTLE_WIKI_PROMPT_MAX_CHARS,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
} from '../constants.js';
import { bearerTokenValid } from '../wsAuth.js';

/** Where the battle wiki lives. The repo checkout's `battles/` wins over the
 *  copy bundled into dist/, so wiki edits show up without a rebuild. */
export function resolveBattlesDir(staticDir: string | undefined): string | null {
  if (!staticDir) return null;
  const distRoot = path.dirname(staticDir);
  const candidates = [path.join(path.dirname(distRoot), 'battles'), path.join(distRoot, 'battles')];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'scenarios'))) ?? null;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

interface ChatBody {
  battleId: string;
  message: string;
  history?: ChatTurn[];
  /** Compact snapshot of the simulation the client is showing. */
  state?: unknown;
}

function readScenario(battlesDir: string, id: string): Record<string, unknown> | null {
  if (!SLUG_PATTERN.test(id)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(battlesDir, 'scenarios', `${id}.json`), 'utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readWiki(battlesDir: string, scenario: Record<string, unknown>): string {
  const rel = typeof scenario.wiki === 'string' ? scenario.wiki : '';
  const file = path.resolve(battlesDir, rel);
  // Never read outside the battles folder, whatever the scenario says.
  if (!rel || !file.startsWith(path.resolve(battlesDir) + path.sep)) return '';
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Battle Simulator API (standalone only):
 *   GET  /api/battles            catalog for the selector
 *   GET  /api/battles/:id        scenario + its wiki page
 *   POST /api/battles/chat       ask the local LLM; returns { reply, orders }
 * Reads are open like the office itself; the chat spends local GPU time, so it
 * takes the same server token that makes a /ws session privileged.
 */
export function registerBattleRoutes(
  app: FastifyInstance,
  opts: { battlesDir: string; token: string },
): void {
  const { battlesDir, token } = opts;

  app.get('/api/battles', async () => {
    const dir = path.join(battlesDir, 'scenarios');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const battles = files
      .map((f) => readScenario(battlesDir, path.basename(f, '.json')))
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({
        id: s.id,
        title: s.title,
        year: s.year,
        location: s.location,
        summary: s.summary,
        sides: s.sides,
        victor: s.victor,
      }));
    battles.sort((a, b) => yearValue(String(a.year)) - yearValue(String(b.year)));
    return { battles };
  });

  app.get<{ Params: { id: string } }>('/api/battles/:id', async (request, reply) => {
    const scenario = readScenario(battlesDir, request.params.id);
    if (!scenario) return reply.code(404).send({ error: 'unknown battle' });
    return { scenario, wiki: readWiki(battlesDir, scenario) };
  });

  app.post<{ Body: ChatBody }>('/api/battles/chat', async (request, reply) => {
    if (!bearerTokenValid(request.headers.authorization, token)) {
      return reply.code(401).send({ error: 'Open the app from the tokened URL to use the chat.' });
    }
    const body = request.body ?? ({} as ChatBody);
    const scenario = readScenario(battlesDir, String(body.battleId ?? ''));
    if (!scenario) return reply.code(404).send({ error: 'unknown battle' });
    const message = String(body.message ?? '').slice(0, BATTLE_CHAT_MESSAGE_MAX_CHARS);
    if (!message.trim()) return reply.code(400).send({ error: 'empty message' });

    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .slice(-BATTLE_CHAT_HISTORY_MAX)
      .map((t) => ({ role: t.role, content: t.content.slice(0, BATTLE_CHAT_MESSAGE_MAX_CHARS) }));

    const system = buildBattleSystemPrompt(
      scenario,
      readWiki(battlesDir, scenario).slice(0, BATTLE_WIKI_PROMPT_MAX_CHARS),
    );
    const ollamaUrl = process.env['PIXEL_BATTLES_OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;
    const model = process.env['PIXEL_BATTLES_OLLAMA_MODEL'] ?? DEFAULT_OLLAMA_MODEL;

    try {
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(BATTLE_CHAT_TIMEOUT_MS),
        body: JSON.stringify(
          ollamaChatBody({
            model,
            system,
            history,
            userTurn: buildBattleUserTurn(message, body.state),
            numCtx: BATTLE_OLLAMA_NUM_CTX,
            // Keep the model resident between questions: reloading a 27B model
            // costs ~15 s on every chat after Ollama's default 5 min idle unload.
            keepAlive: BATTLE_OLLAMA_KEEP_ALIVE,
          }),
        ),
      });
      if (!res.ok) {
        const text = await res.text();
        return reply
          .code(502)
          .send({ error: `Ollama returned ${res.status}: ${text.slice(0, 300)}` });
      }
      const data = (await res.json()) as { message?: { content?: string } };
      return { ...parseChatReply(data.message?.content ?? ''), model };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[PixelBattles] Battle chat failed: ${reason}`);
      return reply
        .code(502)
        .send({ error: `Could not reach Ollama at ${ollamaUrl} (${reason}). Is it running?` });
    }
  });
}

/** "490 BCE" → -490, "1942–1943 CE" → 1942: sorts the selector chronologically. */
function yearValue(year: string): number {
  const n = parseInt(
    year
      .replace(/[^0-9]/g, ' ')
      .trim()
      .split(/\s+/)[0] ?? '0',
    10,
  );
  return /BCE|BC/i.test(year) ? -n : n;
}
