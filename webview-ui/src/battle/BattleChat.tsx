import { useEffect, useRef, useState } from 'react';

import type { OllamaSettings } from './battleApi.js';
import type { BattleEventKind } from './battleEngine.js';
import type { SideId } from './battleTypes.js';

/** One line in the chronicle: battle narration and the chat, in time order. */
export interface FeedItem {
  id: number;
  kind: 'phase' | 'event' | 'user' | 'assistant' | 'error';
  text: string;
  side?: SideId;
  eventKind?: BattleEventKind;
  /** Order results under an assistant reply. */
  orders?: string[];
}

interface BattleChatProps {
  feed: FeedItem[];
  busy: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
  disabledReason?: string;
  suggestions: string[];
  /** Static site only: which local Ollama + model the browser should ask. */
  ollama?: { initial: OllamaSettings; onSave: (s: OllamaSettings) => void };
}

export function BattleChat({
  feed,
  busy,
  draft,
  onDraft,
  onSend,
  disabled,
  disabledReason,
  suggestions,
  ollama,
}: BattleChatProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length, busy]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center px-10 pt-6 text-xs text-text-muted">
        <span className="flex-1">Chronicle &amp; war-room chat</span>
        {ollama && <OllamaSettingsButton {...ollama} />}
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-10 py-6 flex flex-col gap-6 text-xs">
        {feed.map((item) => (
          <FeedLine key={item.id} item={item} />
        ))}
        {busy && <div className="text-text-muted">The war-room is deliberating…</div>}
      </div>
      {!disabled && feed.filter((f) => f.kind === 'user').length === 0 && (
        <div className="flex flex-wrap gap-4 px-10 pb-6">
          {suggestions.map((s) => (
            <button
              key={s}
              className="border-2 border-border bg-btn-bg px-6 py-2 text-2xs cursor-pointer hover:bg-btn-hover text-left"
              onClick={() => onSend(s)}
              disabled={busy}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-6 px-10 py-8 border-t-2 border-border"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && draft.trim()) onSend(draft.trim());
        }}
      >
        <textarea
          className="flex-1 bg-bg-dark border-2 border-border text-text px-6 py-4 text-xs resize-none font-pixel"
          rows={2}
          placeholder={
            disabled
              ? (disabledReason ?? 'Choose a battle first')
              : 'Ask about the battle, or give orders… (right-click the map to add a tile)'
          }
          value={draft}
          disabled={disabled}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!busy && draft.trim()) onSend(draft.trim());
            }
          }}
        />
        <button
          type="submit"
          className="border-2 border-accent bg-active-bg px-10 text-sm cursor-pointer disabled:opacity-40"
          disabled={disabled || busy || !draft.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function FeedLine({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case 'phase':
      return (
        <div className="border-l-2 border-accent pl-6 text-text">
          <span className="text-accent-bright">▸ </span>
          {item.text}
        </div>
      );
    case 'event':
      return (
        <div
          className="pl-8"
          style={{
            color:
              item.eventKind === 'diverge' || item.eventKind === 'end'
                ? 'var(--color-warning)'
                : 'var(--color-text-muted)',
          }}
        >
          {item.text}
        </div>
      );
    case 'user':
      return (
        <div className="self-end bg-active-bg border-2 border-accent px-6 py-4 max-w-[90%]">
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="bg-btn-bg border-2 border-border px-6 py-4 max-w-[95%]">
          <div>{item.text}</div>
          {item.orders && item.orders.length > 0 && (
            <div className="mt-4 text-text-muted">
              {item.orders.map((o, i) => (
                <div key={i}>{o}</div>
              ))}
            </div>
          )}
        </div>
      );
    case 'error':
      return <div style={{ color: 'var(--color-danger)' }}>⚠ {item.text}</div>;
  }
}

/** Where the static site's chat finds the model: the visitor's own Ollama. */
function OllamaSettingsButton({
  initial,
  onSave,
}: {
  initial: OllamaSettings;
  onSave: (s: OllamaSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(initial.url);
  const [model, setModel] = useState(initial.model);
  return (
    <span className="relative">
      <button
        className="bg-transparent border-0 text-text-muted cursor-pointer text-xs p-0 hover:text-text"
        onClick={() => setOpen((o) => !o)}
        title="Your own Ollama: used when this site has no hosted chat"
      >
        ⚙ Local Ollama
      </button>
      {open && (
        <form
          className="absolute right-0 top-20 z-10 w-[300px] bg-bg border-2 border-border p-8 flex flex-col gap-6 shadow-pixel"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ url: url.trim(), model: model.trim() });
            setOpen(false);
          }}
        >
          <label className="flex flex-col gap-2 text-2xs">
            Ollama URL (on this computer)
            <input
              className="bg-bg-dark border-2 border-border text-text px-4 py-2 text-xs font-pixel"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-2xs">
            Model
            <input
              className="bg-bg-dark border-2 border-border text-text px-4 py-2 text-xs font-pixel"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <div className="text-2xs text-text-muted">
            Ollama must allow this site: set OLLAMA_ORIGINS={window.location.origin} and restart it.
          </div>
          <button
            type="submit"
            className="border-2 border-accent bg-active-bg px-8 py-2 text-xs cursor-pointer self-end"
          >
            Save
          </button>
        </form>
      )}
    </span>
  );
}
