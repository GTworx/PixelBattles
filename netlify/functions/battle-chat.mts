/**
 * Netlify Function: the Battle Simulator's war-room chat on the hosted site.
 *
 * Answers POST /api/battles/chat — the same route the standalone server
 * serves — by asking Ollama Cloud with the site's OLLAMA_API_KEY, which stays
 * here on the server and never reaches the browser.
 *
 * It only speaks for the battles in this repo: the war-room prompt (map, wiki,
 * order schema) is built here from the battle id, message sizes and the reply
 * length are capped, and requests must come from this site — the endpoint is
 * public, so it must not be a general-purpose proxy for the key.
 *
 * The reply is streamed (Ollama's NDJSON passed straight through) so a slow
 * model can't run into the function time limit before the first byte.
 *
 * Environment (Netlify → Site configuration → Environment variables):
 *   OLLAMA_API_KEY  required — an ollama.com API key
 *   OLLAMA_MODEL    optional — cloud model name (default gpt-oss:120b)
 *   OLLAMA_HOST     optional — API base (default https://ollama.com)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ChatTurn } from '../../core/src/battlePrompt.js';
import {
  buildBattleSystemPrompt,
  buildBattleUserTurn,
  ollamaChatBody,
} from '../../core/src/battlePrompt.js';

const DEFAULT_HOST = 'https://ollama.com';
/** Ollama Cloud has no Qwen today; gpt-oss is the model its docs use. */
const DEFAULT_MODEL = 'gpt-oss:120b';
const MESSAGE_MAX_CHARS = 2000;
const HISTORY_MAX = 12;
const WIKI_MAX_CHARS = 16_000;
const STATE_MAX_CHARS = 20_000;
const NUM_CTX = 16_384;
/** A war-room reply is a few sentences plus a handful of orders. */
const MAX_REPLY_TOKENS = 700;
const SLUG = /^[a-z0-9-]+$/;

interface ChatBody {
  battleId?: unknown;
  message?: unknown;
  history?: unknown;
  state?: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** battles/ is bundled with the function (netlify.toml included_files). */
function battlesDir(): string | null {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const candidates = [
    path.join(process.cwd(), 'battles'),
    path.resolve(here, '..', '..', 'battles'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'scenarios'))) ?? null;
}

/** Same-site only: a browser always sends Origin on a cross-site POST. */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin navigations/tools without Origin
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]
    .filter((u): u is string => !!u)
    .map((u) => new URL(u).origin);
  // Local `netlify dev` / testing.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return allowed.length === 0 || allowed.includes(origin);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!originAllowed(req)) return json(403, { error: 'Requests must come from this site.' });

  const key = process.env.OLLAMA_API_KEY;
  if (!key) {
    // The page falls back to the visitor's own local Ollama on this status.
    return json(503, { error: 'OLLAMA_API_KEY is not set on this site.', code: 'no-key' });
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const battleId = typeof body.battleId === 'string' ? body.battleId : '';
  const message = typeof body.message === 'string' ? body.message.slice(0, MESSAGE_MAX_CHARS) : '';
  if (!SLUG.test(battleId)) return json(404, { error: 'unknown battle' });
  if (!message.trim()) return json(400, { error: 'empty message' });

  const dir = battlesDir();
  if (!dir) return json(500, { error: 'battle data is missing from the function bundle' });
  let scenario: Record<string, unknown>;
  try {
    scenario = JSON.parse(
      fs.readFileSync(path.join(dir, 'scenarios', `${battleId}.json`), 'utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return json(404, { error: 'unknown battle' });
  }
  let wiki = '';
  const rel = typeof scenario.wiki === 'string' ? scenario.wiki : '';
  const wikiFile = path.resolve(dir, rel);
  if (rel && wikiFile.startsWith(path.resolve(dir) + path.sep)) {
    try {
      wiki = fs.readFileSync(wikiFile, 'utf-8').slice(0, WIKI_MAX_CHARS);
    } catch {
      /* the chat still works from the map and state alone */
    }
  }

  const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (t): t is ChatTurn =>
        typeof t === 'object' &&
        t !== null &&
        ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
        typeof (t as ChatTurn).content === 'string',
    )
    .slice(-HISTORY_MAX)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MESSAGE_MAX_CHARS) }));
  // The live state is the client's snapshot; cap it so it can't carry a novel.
  const state =
    JSON.stringify(body.state ?? {}).length <= STATE_MAX_CHARS
      ? (body.state ?? {})
      : { note: 'state omitted: too large' };

  const host = (process.env.OLLAMA_HOST ?? DEFAULT_HOST).replace(/\/+$/, '');
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  const request = ollamaChatBody({
    model,
    system: buildBattleSystemPrompt(scenario, wiki),
    history,
    userTurn: buildBattleUserTurn(message, state),
    numCtx: NUM_CTX,
    keepAlive: '30m',
  });
  // Stream, and cap the reply length (cost and time).
  request.stream = true;
  (request.options as Record<string, unknown>).num_predict = MAX_REPLY_TOKENS;

  let upstream: Response;
  try {
    upstream = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(request),
    });
  } catch (err) {
    return json(502, { error: `Could not reach ${host}: ${(err as Error).message}` });
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    const hint =
      upstream.status === 401 || upstream.status === 403
        ? ' — check OLLAMA_API_KEY.'
        : upstream.status === 404
          ? ` — model "${model}" is not available; set OLLAMA_MODEL to one listed at ollama.com/search?c=cloud.`
          : '';
    return json(502, {
      error: `Ollama Cloud returned ${upstream.status}${hint} ${text.slice(0, 200)}`,
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Battle-Model': model,
    },
  });
}

/** Netlify Functions 2.0: serve on the same route as the standalone server. */
export const config = { path: '/api/battles/chat' };
