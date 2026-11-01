/**
 * Battle data + chat client. Two backends behind one API:
 * - standalone server: /api/battles routes, chat proxied by the server;
 * - static site (Netlify): battles are plain files next to the SPA, and the
 *   chat goes straight from the browser to the user's own Ollama — a hosted
 *   site can't reach a model running on the visitor's machine, the browser can.
 */
import type { ChatTurn } from '../../../core/src/battlePrompt.js';
import {
  buildBattleSystemPrompt,
  buildBattleUserTurn,
  ollamaChatBody,
  parseChatReply,
} from '../../../core/src/battlePrompt.js';
import {
  BATTLE_CHAT_HISTORY_MAX,
  BATTLE_OLLAMA_DEFAULT_MODEL,
  BATTLE_OLLAMA_DEFAULT_URL,
  BATTLE_OLLAMA_KEEP_ALIVE,
  BATTLE_OLLAMA_NUM_CTX,
  BATTLE_OLLAMA_SETTINGS_KEY,
  BATTLE_WIKI_PROMPT_MAX_CHARS,
} from '../constants.js';
import { isStaticSite } from '../runtime.js';
import { serverToken } from '../transport/serverToken.js';
import type { BattleSummary, Order, Scenario } from './battleTypes.js';

export type { ChatTurn };

export interface ChatResponse {
  reply: string;
  orders: Order[];
  model?: string;
}

/** Static-site files live next to index.html (Vite's base is './'). */
const STATIC_ROOT = './battles';

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function fetchBattles(): Promise<BattleSummary[]> {
  if (isStaticSite) {
    return (await json<{ battles: BattleSummary[] }>(await fetch(`${STATIC_ROOT}/catalog.json`)))
      .battles;
  }
  return (await json<{ battles: BattleSummary[] }>(await fetch('/api/battles'))).battles;
}

export async function fetchBattle(id: string): Promise<{ scenario: Scenario; wiki: string }> {
  if (isStaticSite) {
    const scenario = await json<Scenario>(
      await fetch(`${STATIC_ROOT}/scenarios/${encodeURIComponent(id)}.json`),
    );
    const wikiRes = await fetch(`${STATIC_ROOT}/${scenario.wiki}`);
    return { scenario, wiki: wikiRes.ok ? await wikiRes.text() : '' };
  }
  return json<{ scenario: Scenario; wiki: string }>(
    await fetch(`/api/battles/${encodeURIComponent(id)}`),
  );
}

// ── Ollama settings (static site) ───────────────────────────────

export interface OllamaSettings {
  url: string;
  model: string;
}

export function loadOllamaSettings(): OllamaSettings {
  const defaults = { url: BATTLE_OLLAMA_DEFAULT_URL, model: BATTLE_OLLAMA_DEFAULT_MODEL };
  try {
    const saved = JSON.parse(
      localStorage.getItem(BATTLE_OLLAMA_SETTINGS_KEY) ?? 'null',
    ) as Partial<OllamaSettings> | null;
    return { url: saved?.url || defaults.url, model: saved?.model || defaults.model };
  } catch {
    return defaults;
  }
}

export function saveOllamaSettings(s: OllamaSettings): void {
  try {
    localStorage.setItem(BATTLE_OLLAMA_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

/**
 * Where the chat can run: the standalone server needs its token; the static
 * site needs nothing up front (it reaches the visitor's local Ollama).
 */
export const chatAvailable = isStaticSite || serverToken !== null;

export interface ChatRequest {
  scenario: Scenario;
  wiki: string;
  message: string;
  history: ChatTurn[];
  state: unknown;
  signal?: AbortSignal;
}

export async function sendBattleChat(req: ChatRequest): Promise<ChatResponse> {
  return isStaticSite ? askLocalOllama(req) : askServer(req);
}

async function askServer({ scenario, message, history, state, signal }: ChatRequest) {
  const res = await fetch('/api/battles/chat', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
    },
    body: JSON.stringify({ battleId: scenario.id, message, history, state }),
  });
  return json<ChatResponse>(res);
}

async function askLocalOllama({
  scenario,
  wiki,
  message,
  history,
  state,
  signal,
}: ChatRequest): Promise<ChatResponse> {
  const { url, model } = loadOllamaSettings();
  const base = url.replace(/\/+$/, '');
  const body = ollamaChatBody({
    model,
    system: buildBattleSystemPrompt(
      scenario as unknown as Record<string, unknown>,
      wiki.slice(0, BATTLE_WIKI_PROMPT_MAX_CHARS),
    ),
    history: history.slice(-BATTLE_CHAT_HISTORY_MAX),
    userTurn: buildBattleUserTurn(message, state),
    numCtx: BATTLE_OLLAMA_NUM_CTX,
    keepAlive: BATTLE_OLLAMA_KEEP_ALIVE,
  });
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // A blocked cross-origin request surfaces as a bare network error.
    throw new Error(
      `Could not reach Ollama at ${base}. Make sure Ollama is running on this computer and allows ` +
        `this site: set the environment variable OLLAMA_ORIGINS=${window.location.origin} ` +
        `(or *), then restart Ollama. If your browser asks to allow access to local network ` +
        `devices, allow it.`,
      { cause: err },
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      res.status === 404
        ? `Ollama has no model "${model}". Pull it (ollama pull ${model}) or pick another in the chat settings.`
        : `Ollama returned ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return { ...(parseChatReply(data.message?.content ?? '') as ChatResponse), model };
}
