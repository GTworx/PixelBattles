/** HTTP client for the server's Battle Simulator routes (standalone only). */
import { serverToken } from '../transport/serverToken.js';
import type { BattleSummary, Order, Scenario } from './battleTypes.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  orders: Order[];
  model?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function fetchBattles(): Promise<BattleSummary[]> {
  const res = await fetch('/api/battles');
  return (await json<{ battles: BattleSummary[] }>(res)).battles;
}

export async function fetchBattle(id: string): Promise<{ scenario: Scenario; wiki: string }> {
  const res = await fetch(`/api/battles/${encodeURIComponent(id)}`);
  return json<{ scenario: Scenario; wiki: string }>(res);
}

/** The chat needs the server token (it spends local GPU time). */
export const chatAvailable = serverToken !== null;

export async function sendBattleChat(
  battleId: string,
  message: string,
  history: ChatTurn[],
  state: unknown,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch('/api/battles/chat', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
    },
    body: JSON.stringify({ battleId, message, history, state }),
  });
  return json<ChatResponse>(res);
}
