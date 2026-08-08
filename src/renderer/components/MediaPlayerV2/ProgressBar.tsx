import React from 'react';
import { calculateProgress, formatTime, normalizeTimeMs } from './utils';

interface ProgressBarProps {
  position: number;
  duration: number;
  progressPercent?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ position, duration }) => {
  const normDur = normalizeTimeMs(duration);
  const rawPos = normalizeTimeMs(position);

  // Clamp position to duration if duration is known (> 0)
  const normPos = normDur > 0 ? Math.min(normDur, Math.max(0, rawPos)) : Math.max(0, rawPos);
  const safePercent = normDur > 0 ? calculateProgress(normPos, normDur) : 0;

  return (
    <div className="space-y-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-white/20 p-[1px]">
        <div
          className="h-full rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)] transition-[width] duration-200 ease-linear"
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-xs text-white/70">
        <span>{formatTime(normPos)}</span>
        <span>{formatTime(normDur, true)}</span>
      </div>
    </div>
  );
};
