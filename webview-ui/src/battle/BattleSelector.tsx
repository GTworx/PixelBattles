import { BATTLE_SELECTOR_Z_INDEX } from '../constants.js';
import type { BattleSummary } from './battleTypes.js';
import { FlagIcon } from './FlagIcon.js';

interface BattleSelectorProps {
  battles: BattleSummary[];
  currentId: string | null;
  onPick: (id: string) => void;
  /** Absent until a battle is loaded: the first choice can't be dismissed. */
  onClose?: () => void;
}

export function BattleSelector({ battles, currentId, onPick, onClose }: BattleSelectorProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-16"
      style={{ zIndex: BATTLE_SELECTOR_Z_INDEX, background: 'var(--vignette)' }}
      onClick={onClose}
    >
      <div
        className="bg-bg border-2 border-border max-w-[960px] w-full max-h-full overflow-y-auto shadow-pixel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-14 py-10 border-b-2 border-border">
          <div className="flex-1">
            <div className="text-xl">Choose a battle</div>
            <div className="text-xs text-text-muted">
              Watch it unfold as the records tell it — then change the orders and see if history
              holds.
            </div>
          </div>
          {onClose && (
            <button
              className="bg-transparent border-0 text-text-muted text-lg cursor-pointer"
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>
        <div
          className="grid gap-8 p-14"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {battles.map((b) => {
            const victor = b.sides.find((s) => s.id === b.victor);
            return (
              <button
                key={b.id}
                className={`text-left border-2 px-10 py-8 cursor-pointer hover:bg-btn-hover ${b.id === currentId ? 'border-accent bg-active-bg' : 'border-border bg-btn-bg'}`}
                onClick={() => onPick(b.id)}
              >
                <div className="text-xs text-text-muted">
                  {b.year} · {b.location}
                </div>
                <div className="text-base">{b.title}</div>
                <div className="flex gap-6 mt-4 text-2xs items-center flex-wrap">
                  {b.sides.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-4">
                      {i > 0 && <span className="text-text-muted">vs</span>}
                      <FlagIcon side={s} scale={1} />
                      {s.name}
                    </span>
                  ))}
                </div>
                <div className="text-2xs text-text-muted mt-4 line-clamp-3">{b.summary}</div>
                {victor && (
                  <div className="text-2xs mt-4" style={{ color: victor.color }}>
                    Victor: {victor.name}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
