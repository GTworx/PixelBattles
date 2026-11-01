/** The orders the simulation engine executes (battles/SCHEMA.md "Order actions"). */
export const ORDER_ACTIONS = [
  'move',
  'attack',
  'charge',
  'flank',
  'bombard',
  'hold',
  'retreat',
  'rout',
] as const;

/** Ollama structured-output schema: the model must answer with exactly this shape. */
export const CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    orders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unit: { type: 'string' },
          action: { type: 'string', enum: [...ORDER_ACTIONS] },
          target: { type: 'string' },
          to: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
        },
        required: ['unit', 'action'],
      },
    },
  },
  required: ['reply', 'orders'],
};

export interface ChatOrder {
  unit: string;
  action: (typeof ORDER_ACTIONS)[number];
  target?: string;
  to?: [number, number];
}

/** Tolerant parse: a model that ignores the schema still yields its prose. */
export function parseChatReply(content: string): { reply: string; orders: ChatOrder[] } {
  try {
    const parsed = JSON.parse(content) as { reply?: unknown; orders?: unknown };
    const orders = (Array.isArray(parsed.orders) ? parsed.orders : []).filter(
      (o): o is ChatOrder =>
        typeof o === 'object' &&
        o !== null &&
        typeof (o as ChatOrder).unit === 'string' &&
        (ORDER_ACTIONS as readonly string[]).includes((o as ChatOrder).action),
    );
    return { reply: typeof parsed.reply === 'string' ? parsed.reply : '', orders };
  } catch {
    return { reply: content.trim(), orders: [] };
  }
}

/**
 * The fixed part of the conversation: instructions, map and wiki. It must not
 * change between turns of one battle, so Ollama can reuse its processed prefix
 * instead of re-reading ~10k tokens on every question; the live state rides in
 * the user turn instead ({@link buildBattleUserTurn}).
 */
export function buildBattleSystemPrompt(scenario: Record<string, unknown>, wiki: string): string {
  const map = (scenario.map ?? {}) as { terrain?: string[]; labels?: unknown[]; scale?: string };
  const terrain = (map.terrain ?? []).map((row, r) => `${String(r).padStart(2, '0')} ${row}`);
  return [
    `You are the war-room for the ${String(scenario.title)} (${String(scenario.year)}) in the PixelBattles historical battle simulator.`,
    'The user is watching the battle on a 48×30 tile map and talks to you. They may ask questions about the battle, or give commands that change what the armies do — for either side.',
    '',
    'ANSWER WITH JSON ONLY: {"reply": string, "orders": Order[]}.',
    '- "reply": 1–4 sentences in the voice of a staff officer/chronicler. Answer questions from the wiki below; for commands, say what the troops do and the likely consequence. Stay historically grounded.',
    '- "orders": the commands for the engine. EMPTY when the user only asks a question.',
    'Order = {"unit": unitId, "action": one of move|attack|charge|flank|bombard|hold|retreat|rout, "target"?: enemy unitId, "to"?: [col,row]}.',
    '  move/retreat need "to"; attack/charge/bombard need "target"; flank needs both "target" and "to" (the waypoint to go round by).',
    '  Use ONLY unit ids from the CURRENT STATE sent with each message. "to" must be inside 0–47 columns, 0–29 rows, on passable terrain (not = M #).',
    '  Only units with status "active" can obey. A command for a whole side means one order per relevant unit.',
    '  bombard is for archers, horse_archers, artillery, siege and ships; charge suits cavalry, chariots, elephants and armor.',
    '',
    `MAP (${map.scale ?? ''}; row number then 48 columns, col 0 = left). Legend: . open  , fields  b sand  : road  ^ hills  T forest  s marsh  ~ river  c town  r ruins  g gate  = sea (impassable)  M mountains (impassable)  # wall (impassable)`,
    ...terrain,
    `Landmarks: ${JSON.stringify(map.labels ?? [])}`,
    `Sides: ${JSON.stringify(scenario.sides ?? [])}`,
    '',
    'BATTLE WIKI:',
    wiki,
  ].join('\n');
}

/** The user's message, prefixed with the simulation state it was sent from. */
export function buildBattleUserTurn(message: string, state: unknown): string {
  return [
    'CURRENT STATE OF THE SIMULATION (positions are [col,row]):',
    JSON.stringify(state ?? {}),
    '',
    'USER:',
    message,
  ].join('\n');
}
