import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BATTLE_MOBILE_PHASE_BAR_PX,
  BATTLE_MOBILE_TOUCH_TARGET_PX,
  BATTLE_SPEEDS,
  BATTLE_VIEW_Z_INDEX,
} from '../constants.js';
import { useKeyboardViewport } from '../hooks/useKeyboardViewport.js';
import { TRACK_TRANSITION, trackTransform, useEdgeSwipe } from '../mobile/useEdgeSwipe.js';
import { isStaticSite } from '../runtime.js';
import type { ChatTurn } from './battleApi.js';
import {
  chatAvailable,
  fetchBattle,
  fetchBattles,
  loadOllamaSettings,
  saveOllamaSettings,
  sendBattleChat,
} from './battleApi.js';
import { BattleAudio } from './battleAudio.js';
import { BattleCanvas } from './BattleCanvas.js';
import { BattleChat, type FeedItem } from './BattleChat.js';
import type { BattleState } from './battleEngine.js';
import {
  applyUserOrders,
  createBattle,
  currentPhase,
  describeOrder,
  sidePower,
  snapshotForChat,
  stepBattle,
} from './battleEngine.js';
import { formatStrength } from './battleRenderer.js';
import { UNIT_STATS } from './battleRules.js';
import { BattleSelector } from './BattleSelector.js';
import type { BattleSummary, Scenario } from './battleTypes.js';
import { FlagIcon } from './FlagIcon.js';
import { useBattleLayout } from './useBattleLayout.js';

interface BattleViewProps {
  /** Switch to the agent office; absent where there is none (static site). */
  onOpenOffice?: () => void;
  /** Office assets (character sprites, floors, walls) have loaded. */
  assetsReady: boolean;
}

/** Step used when fast-forwarding to a phase. */
const SEEK_STEP_SEC = 0.1;
let feedSeq = 0;

export function BattleView({ onOpenOffice, assetsReady }: BattleViewProps) {
  const [battles, setBattles] = useState<BattleSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  /** The battle's wiki page: grounds the chat when the browser asks Ollama itself. */
  const wikiRef = useRef('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [, setTick] = useState(0);

  const stateRef = useRef<BattleState | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const seenEvents = useRef(0);
  const history = useRef<ChatTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<BattleAudio | null>(null);
  const audio = () => (audioRef.current ??= new BattleAudio());
  const [muted, setMuted] = useState(() => audio().isMuted);
  useEffect(() => () => audioRef.current?.dispose(), []);

  const push = useCallback((item: Omit<FeedItem, 'id'>) => {
    setFeed((f) => [...f, { ...item, id: ++feedSeq }]);
  }, []);

  /** Move new engine events (phase narration, routs, the result) into the feed. */
  const drainEvents = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;
    const fresh = state.events.slice(seenEvents.current);
    seenEvents.current = state.events.length;
    if (fresh.length === 0) return;
    setFeed((f) => [
      ...f,
      ...fresh.map((e) => ({
        id: ++feedSeq,
        kind: e.kind === 'phase' ? ('phase' as const) : ('event' as const),
        text: e.text,
        side: e.side,
        eventKind: e.kind,
      })),
    ]);
    if (state.finished) setPlaying(false);
  }, []);

  // Catalog
  useEffect(() => {
    fetchBattles()
      .then((list) => {
        setBattles(list);
        if (list.length === 0) setLoadError('No battles found in battles/scenarios/.');
        else setSelectorOpen(true);
      })
      .catch((err: Error) => setLoadError(`Could not load battles: ${err.message}`));
  }, []);

  const start = useCallback(
    (s: Scenario) => {
      abortRef.current?.abort();
      stateRef.current = createBattle(s);
      seenEvents.current = 0;
      history.current = [];
      setFeed([]);
      setSelectedUnitId(null);
      setPlaying(false);
      setChatBusy(false);
      drainEvents();
    },
    [drainEvents],
  );

  const openBattle = useCallback(
    (id: string) => {
      setSelectorOpen(false);
      fetchBattle(id)
        .then(({ scenario: s, wiki }) => {
          wikiRef.current = wiki;
          setScenario(s);
          start(s);
        })
        .catch((err: Error) => setLoadError(`Could not load battle: ${err.message}`));
    },
    [start],
  );

  /** Replay from the start to the beginning of phase `index` (historical). */
  const seekPhase = useCallback(
    (index: number) => {
      if (!scenario) return;
      const state = createBattle(scenario);
      let guard = 0;
      while (state.phaseIndex < index && !state.finished && guard++ < 100_000) {
        stepBattle(state, SEEK_STEP_SEC);
      }
      state.cues.length = 0; // a fast-forward is silent
      stateRef.current = state;
      seenEvents.current = 0;
      history.current = [];
      setFeed([]);
      drainEvents();
      setTick((t) => t + 1);
    },
    [scenario, drainEvents],
  );

  /** Play/pause from a user gesture: that gesture is what lets audio start,
   *  and the band strikes up when a battle starts from its deployment. */
  const togglePlay = useCallback(() => {
    const state = stateRef.current;
    if (!state || !scenario) return;
    audio().unlock();
    if (state.finished) {
      start(scenario);
      audio().playBand(stateRef.current?.year ?? 0);
      setPlaying(true);
      return;
    }
    if (!playingRef.current && state.elapsed === 0) audio().playBand(state.year);
    setPlaying((p) => !p);
  }, [scenario, start]);
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  // Space toggles playback (unless typing in the chat).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' && stateRef.current) {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sendChat = useCallback(
    async (text: string) => {
      const state = stateRef.current;
      if (!state || !scenario || !text.trim() || chatBusy) return;
      audio().unlock(); // the Send click is a gesture: let the trumpets sound
      push({ kind: 'user', text });
      setDraft('');
      setChatBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await sendBattleChat({
          scenario,
          wiki: wikiRef.current,
          message: text,
          history: history.current,
          state: snapshotForChat(state),
          signal: controller.signal,
        });
        if (stateRef.current !== state) return; // battle changed meanwhile
        history.current.push(
          { role: 'user', content: text },
          { role: 'assistant', content: res.reply },
        );
        const results = res.orders.length ? applyUserOrders(state, res.orders) : [];
        push({
          kind: 'assistant',
          text: res.reply || '(no reply)',
          orders: results.map((r) =>
            r.accepted
              ? `✓ ${describeOrder(state, r.order)}`
              : `✗ ${r.order.unit} ${r.order.action}: ${r.reason}`,
          ),
        });
        drainEvents();
        if (results.some((r) => r.accepted) && !state.finished) setPlaying(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError')
          push({ kind: 'error', text: (err as Error).message });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setChatBusy(false);
        }
      }
    },
    [scenario, chatBusy, push, drainEvents],
  );

  // ── Phones (battleLayout.ts): compact = map and chat as two swipeable
  // pages; fullscreen = a phone on its side, the map edge to edge.
  const layout = useBattleLayout();
  const [page, setPage] = useState<'map' | 'chat'>('map');
  const togglePage = useCallback(() => setPage((p) => (p === 'map' ? 'chat' : 'map')), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // The office shell's edge swipe, reused as is: the map plays its 'office'
  // page and the chat its 'terminal' page. The map's right edge (or the
  // chat's left edge) arms it, so it never fights the canvas's pan/pinch:
  // a claimed swipe cancels the canvas's touch.
  useEdgeSwipe(
    shellRef,
    trackRef,
    layout === 'compact' ? (page === 'map' ? 'terminal' : 'office') : null,
    togglePage,
  );
  const keyboard = useKeyboardViewport(layout === 'compact');
  // Fullscreen API: a bonus where it exists (not iOS Safari for non-video
  // elements — there the full-bleed layout alone has to do), entered only
  // from a tap, and left when the phone turns back upright.
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    if (layout !== 'fullscreen' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [layout]);

  const state = stateRef.current;
  const phase = state ? currentPhase(state) : null;
  const selectedUnit = state && selectedUnitId ? (state.byId.get(selectedUnitId) ?? null) : null;
  const powers = useMemo(
    () => (state ? { A: sidePower(state, 'A'), B: sidePower(state, 'B') } : null),
    // Recomputed on every tick re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, state?.elapsed],
  );

  const compact = layout === 'compact';
  const fullscreen = layout === 'fullscreen';
  const mobile = layout !== 'desktop';
  /** Phones: every control at least a fingertip tall. */
  const touchTarget = mobile ? { minHeight: BATTLE_MOBILE_TOUCH_TARGET_PX } : undefined;

  const selectorButton = (
    <button
      className={`border-2 border-accent bg-active-bg px-10 py-2 text-sm cursor-pointer hover:bg-btn-hover ${compact ? 'flex-1 min-w-0 truncate text-left' : ''}`}
      style={touchTarget}
      onClick={() => setSelectorOpen(true)}
      title="Choose a battle"
    >
      {scenario ? `${scenario.title} · ${scenario.year}` : 'Choose a battle'} ▾
    </button>
  );
  const playButton = state && (
    <button
      className="border-2 border-transparent bg-btn-bg px-10 py-2 text-sm cursor-pointer hover:bg-btn-hover"
      style={touchTarget}
      onClick={togglePlay}
      title="Play / pause (Space)"
    >
      {state.finished ? '⟲ Replay' : playing ? '❚❚ Pause' : '▶ Simulate'}
    </button>
  );
  const toggleMute = () => {
    audio().unlock();
    audio().setMuted(!muted);
    setMuted(!muted);
  };
  const muteButton = (
    <button
      className="border-2 border-transparent bg-btn-bg px-8 py-2 text-sm cursor-pointer hover:bg-btn-hover"
      style={touchTarget}
      onClick={toggleMute}
      title={muted ? 'Turn the battle sounds on' : 'Mute the battle sounds'}
      aria-pressed={!muted}
    >
      {/* Phones: the icon alone, the toolbar is short of room. */}
      {mobile ? (muted ? '🔇' : '🔊') : muted ? '🔇 Muted' : '🔊 Sound'}
    </button>
  );
  const officeButton = onOpenOffice && (
    <button
      className="border-2 border-transparent bg-btn-bg px-10 py-2 text-sm cursor-pointer hover:bg-btn-hover"
      style={touchTarget}
      onClick={onOpenOffice}
      title="Open the Claude agent office"
    >
      {compact ? 'Office' : 'Agent office'}
    </button>
  );

  const phaseHeader = scenario && state && (
    <div className="px-10 py-8 border-b-2 border-border">
      <div className="text-xs text-text-muted">
        {phase
          ? `Phase ${state.phaseIndex + 1}/${scenario.phases.length} · ${phase.time}`
          : state.finished
            ? 'Battle over'
            : 'Overtime'}
      </div>
      <div className="text-base">{phase?.title ?? scenario.title}</div>
      <PhaseTimeline
        scenario={scenario}
        state={state}
        onSeek={(i) => seekPhase(i)}
        barHeight={compact ? BATTLE_MOBILE_PHASE_BAR_PX : undefined}
      />
    </div>
  );

  const mapArea = (
    <div className="relative flex-1 min-w-0 min-h-0">
      {!assetsReady && <Centered>Loading sprites…</Centered>}
      {loadError && <Centered>{loadError}</Centered>}
      {assetsReady && (
        <BattleCanvas
          stateRef={stateRef}
          playingRef={playingRef}
          speedRef={speedRef}
          selectedUnitId={selectedUnitId}
          onSelectUnit={setSelectedUnitId}
          onPickTile={(t) =>
            setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}(${t[0]}, ${t[1]})`)
          }
          onTick={() => {
            drainEvents();
            setTick((t) => t + 1);
          }}
          onFrame={(s, dt, isPlaying) => audioRef.current?.update(s, dt, isPlaying)}
        />
      )}
      {scenario && state && <SideLegend scenario={scenario} powers={powers} mobile={mobile} />}
      {state?.finished && scenario && (
        <ResultBanner state={state} scenario={scenario} onReplay={togglePlay} mobile={mobile} />
      )}
      {selectedUnit && scenario && (
        <div
          className={`absolute bg-bg border-2 border-border px-10 py-8 text-xs shadow-pixel ${mobile ? 'battle-safe-left battle-safe-bottom max-w-[min(340px,calc(100%-20px))]' : 'left-10 bottom-10 max-w-[340px]'}`}
        >
          <div
            className="text-sm"
            style={{ color: scenario.sides.find((s) => s.id === selectedUnit.side)?.color }}
          >
            {selectedUnit.name}
          </div>
          <div className="text-text-muted">
            {UNIT_STATS[selectedUnit.type].label} · {formatStrength(selectedUnit.strength)} men ·
            morale {Math.round(selectedUnit.morale)}
          </div>
          <div className="text-text-muted">
            {selectedUnit.status} · {selectedUnit.order ? selectedUnit.order.action : 'no orders'} ·
            tile ({Math.round(selectedUnit.x)}, {Math.round(selectedUnit.y)})
          </div>
          {selectedUnit.commander && (
            <div className="text-text-muted">Led by {selectedUnit.commander}</div>
          )}
          {!fullscreen && (
            <button
              className="mt-4 text-accent-bright cursor-pointer bg-transparent border-0 p-0 text-xs"
              style={touchTarget}
              onClick={() => {
                setDraft((d) => `${d}${d ? ' ' : ''}${selectedUnit.id} `);
                if (compact) setPage('chat');
              }}
            >
              + mention in chat
            </button>
          )}
        </div>
      )}
      {fullscreen && scenario && state && (
        // The full-screen battle's only chrome: the phase and the playback
        // controls, top right clear of the legend and the notch.
        <div className="absolute battle-safe-top battle-safe-right flex items-center gap-4">
          <span className="bg-bg border-2 border-border px-6 py-2 text-xs whitespace-nowrap">
            {phase ? `Phase ${state.phaseIndex + 1}/${scenario.phases.length}` : 'Battle over'}
          </span>
          {playButton}
          {muteButton}
          {canFullscreen && (
            <button
              className="border-2 border-transparent bg-btn-bg px-8 py-2 text-sm cursor-pointer hover:bg-btn-hover"
              style={touchTarget}
              onClick={toggleFullscreen}
              title="Full screen"
            >
              ⛶
            </button>
          )}
        </div>
      )}
    </div>
  );

  const chat = (
    <BattleChat
      feed={feed}
      busy={chatBusy}
      draft={draft}
      onDraft={setDraft}
      onSend={(t) => void sendChat(t)}
      ollama={
        isStaticSite ? { initial: loadOllamaSettings(), onSave: saveOllamaSettings } : undefined
      }
      disabled={!scenario || !chatAvailable}
      disabledReason={
        !chatAvailable
          ? 'Open the app from the tokened URL the server printed to chat with the battle.'
          : undefined
      }
      touch={mobile}
      suggestions={
        scenario
          ? [
              'What is happening right now?',
              `Why did ${scenario.sides.find((s) => s.id === scenario.victor)?.name ?? 'the victor'} win?`,
              'Order the cavalry to charge the enemy flank',
              'What if the losing side retreated to high ground?',
            ]
          : []
      }
    />
  );

  const selector = selectorOpen && battles && (
    <BattleSelector
      battles={battles}
      currentId={scenario?.id ?? null}
      onPick={openBattle}
      onClose={scenario ? () => setSelectorOpen(false) : undefined}
      singleColumn={mobile}
    />
  );

  if (fullscreen) {
    return (
      <div
        ref={rootRef}
        className="fixed inset-0 flex bg-bg-dark text-text font-pixel"
        style={{ zIndex: BATTLE_VIEW_Z_INDEX }}
      >
        {mapArea}
        {selector}
      </div>
    );
  }

  if (compact) {
    return (
      <div
        ref={rootRef}
        className="fixed inset-0 flex flex-col bg-bg-dark text-text font-pixel battle-safe-pad"
        // iOS keeps the keyboard-covered area in the layout viewport: clamp
        // to the visible part so the chat input stays above the keys.
        style={{
          zIndex: BATTLE_VIEW_Z_INDEX,
          ...(keyboard.clampHeight !== null
            ? { bottom: 'auto', height: keyboard.clampHeight }
            : {}),
        }}
      >
        {/* ── Toolbar: battle + page toggle, then playback ── */}
        <div className="flex flex-col gap-4 px-8 py-6 border-b-2 border-border bg-bg">
          <div className="flex items-center gap-4 min-w-0">
            <span className="text-lg text-accent-bright">⚔</span>
            {selectorButton}
            {scenario && state && muteButton}
            {officeButton}
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {scenario && state && (
              <>
                {playButton}
                <button
                  className="border-2 border-transparent bg-btn-bg px-8 py-2 text-sm cursor-pointer hover:bg-btn-hover"
                  style={touchTarget}
                  onClick={() => start(scenario)}
                  title="Restart from the historical deployment"
                >
                  ⟲
                </button>
                <SpeedButtons speed={speed} onSpeed={setSpeed} style={touchTarget} />
                <ModeBadge mode={state.mode} />
              </>
            )}
            <span className="flex-1" />
            <button
              className="border-2 border-accent bg-active-bg px-8 py-2 text-sm cursor-pointer hover:bg-btn-hover"
              style={touchTarget}
              onClick={togglePage}
              title={page === 'map' ? 'Open the war-room chat' : 'Back to the map'}
            >
              {page === 'map' ? '💬 War room' : '🗺 Map'}
            </button>
          </div>
        </div>

        {/* ── Pages: the map, and the chat a swipe (or the toggle) away ── */}
        <div ref={shellRef} className="relative flex-1 min-h-0 overflow-hidden">
          {/* Both pages always laid out side by side at 200% width (never
              display:none), so the canvas keeps its size while hidden. */}
          <div
            ref={trackRef}
            className="absolute top-0 bottom-0 left-0 flex w-[200%]"
            style={{
              transform: trackTransform(page === 'chat' ? 'terminal' : 'office'),
              transition: TRACK_TRANSITION,
            }}
          >
            <div className="w-1/2 h-full flex flex-col overflow-hidden">
              {mapArea}
              {phaseHeader && <div className="border-t-2 border-border bg-bg">{phaseHeader}</div>}
            </div>
            <div className="w-1/2 h-full flex flex-col overflow-hidden bg-bg">{chat}</div>
          </div>
        </div>
        {selector}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 flex flex-col bg-bg-dark text-text font-pixel"
      style={{ zIndex: BATTLE_VIEW_Z_INDEX }}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center gap-8 px-10 py-6 border-b-2 border-border bg-bg flex-wrap">
        <span className="text-lg text-accent-bright">⚔ PixelBattles</span>
        {selectorButton}
        {scenario && state && (
          <>
            {playButton}
            <button
              className="border-2 border-transparent bg-btn-bg px-8 py-2 text-sm cursor-pointer hover:bg-btn-hover"
              onClick={() => start(scenario)}
              title="Restart from the historical deployment"
            >
              ⟲ Restart
            </button>
            <SpeedButtons speed={speed} onSpeed={setSpeed} />
            <ModeBadge mode={state.mode} />
            {muteButton}
          </>
        )}
        <span className="flex-1" />
        {officeButton}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {mapArea}

        {/* ── Side panel: phase + chronicle/chat ── */}
        <div className="w-[400px] flex flex-col border-l-2 border-border bg-bg min-h-0">
          {phaseHeader}
          {chat}
        </div>
      </div>

      {selector}
    </div>
  );
}

function SpeedButtons({
  speed,
  onSpeed,
  style,
}: {
  speed: number;
  onSpeed: (s: number) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div className="flex">
      {BATTLE_SPEEDS.map((s) => (
        <button
          key={s}
          className={`border-2 px-6 py-2 text-xs cursor-pointer ${speed === s ? 'border-accent bg-active-bg' : 'border-transparent bg-btn-bg hover:bg-btn-hover'}`}
          style={style}
          onClick={() => onSpeed(s)}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}

function ModeBadge({ mode }: { mode: BattleState['mode'] }) {
  const color = mode === 'historical' ? 'var(--color-status-success)' : 'var(--color-warning)';
  return (
    <span
      className="px-8 py-2 text-xs border-2"
      style={{ borderColor: color, color }}
      title={
        mode === 'historical'
          ? 'Following the historical record'
          : 'You changed the battle: the combat rules decide now'
      }
    >
      {mode === 'historical' ? 'HISTORICAL' : 'WHAT-IF'}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-text-muted p-20 text-center">
      {children}
    </div>
  );
}

function SideLegend({
  scenario,
  powers,
  mobile,
}: {
  scenario: Scenario;
  powers: { A: number; B: number } | null;
  /** Phones: inset from the notch (equal to left-10/top-10 elsewhere). */
  mobile: boolean;
}) {
  return (
    <div
      className={`absolute flex flex-col gap-4 text-xs pointer-events-none ${mobile ? 'battle-safe-left battle-safe-top' : 'left-10 top-10'}`}
    >
      {scenario.sides.map((s) => (
        <div key={s.id} className="flex items-center gap-6 bg-bg px-8 py-4 border-2 border-border">
          <FlagIcon side={s} scale={2} />
          <span className="whitespace-nowrap">{s.name}</span>
          {/* Commander lists can be long: only where there's room beside the map. */}
          <span className="text-text-muted hidden 2xl:inline">— {s.commander}</span>
          {powers && (
            <span className="text-text-muted whitespace-nowrap">
              · {formatStrength(powers[s.id])}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function PhaseTimeline({
  scenario,
  state,
  onSeek,
  barHeight,
}: {
  scenario: Scenario;
  state: BattleState;
  onSeek: (i: number) => void;
  /** Phones: taller bars, so a phase is a fingertip target. */
  barHeight?: number;
}) {
  return (
    <div className="flex gap-2 mt-6">
      {scenario.phases.map((p, i) => {
        const done = i < state.phaseIndex || state.finished;
        const current = i === state.phaseIndex && !state.finished;
        return (
          <button
            key={p.id}
            title={`${p.time} — ${p.title}${state.mode === 'diverged' ? ' (jumping restarts the historical replay)' : ''}`}
            onClick={() => onSeek(i)}
            className="flex-1 h-10 border-0 p-0 cursor-pointer"
            style={{
              height: barHeight,
              background: current
                ? 'var(--color-accent-bright)'
                : done
                  ? 'var(--color-accent)'
                  : 'var(--color-btn-bg)',
            }}
          />
        );
      })}
    </div>
  );
}

function ResultBanner({
  state,
  scenario,
  onReplay,
  mobile,
}: {
  state: BattleState;
  scenario: Scenario;
  onReplay: () => void;
  /** Phones: as wide as the map allows rather than half of it. */
  mobile: boolean;
}) {
  const winner = scenario.sides.find((s) => s.id === state.winner);
  const historical = state.mode === 'historical';
  return (
    <div
      className={`absolute left-1/2 top-16 -translate-x-1/2 bg-bg border-2 px-16 py-10 text-center max-w-[560px] shadow-pixel ${mobile ? 'w-[calc(100%-20px)] max-h-[calc(100%-32px)] overflow-y-auto' : ''}`}
      style={{ borderColor: winner?.color ?? 'var(--color-border)' }}
    >
      <div className="text-lg" style={{ color: winner?.color }}>
        {winner && <FlagIcon side={winner} scale={3} />}
        <div>{winner ? `${winner.name} victorious` : 'Indecisive'}</div>
      </div>
      <div className="text-xs text-text-muted mt-4">
        {historical
          ? scenario.result.summary
          : state.winner === scenario.victor
            ? 'Your changes did not alter the result history recorded.'
            : 'Your changes rewrote history.'}
      </div>
      {historical && scenario.result.casualties && (
        <div className="text-xs mt-4">
          {scenario.sides.map((s) => (
            <div key={s.id}>
              <span style={{ color: s.color }}>{s.name}:</span> {scenario.result.casualties?.[s.id]}
            </div>
          ))}
        </div>
      )}
      <button
        className="mt-8 border-2 border-accent bg-active-bg px-10 py-2 text-sm cursor-pointer"
        onClick={onReplay}
      >
        ⟲ Replay
      </button>
    </div>
  );
}
