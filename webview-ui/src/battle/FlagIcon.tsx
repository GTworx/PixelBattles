import { useEffect, useRef } from 'react';

import { FLAG_H, FLAG_W, getFlagSprite } from '../office/sprites/battleFlags.js';
import type { ScenarioSide } from './battleTypes.js';

/** A side's pixel flag, drawn crisp at an integer scale. */
export function FlagIcon({ side, scale = 2 }: { side: ScenarioSide; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sprite = getFlagSprite(side.flag, side.color);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sprite.forEach((row, y) =>
      row.forEach((color, x) => {
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }),
    );
  }, [side.flag, side.color, scale]);
  return (
    <canvas
      ref={ref}
      width={FLAG_W * scale}
      height={FLAG_H * scale}
      className="inline-block shrink-0"
      style={{ imageRendering: 'pixelated' }}
      title={side.name}
      aria-label={`${side.name} flag`}
    />
  );
}
