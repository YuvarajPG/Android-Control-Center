import React from 'react';
import { formatTime } from './utils';

interface ProgressBarProps {
  position: number;
  duration: number;
  progressPercent: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ position, duration, progressPercent }) => {
  return (
    <div className="space-y-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-white/20 p-[1px]">
        <div
          className="h-full rounded-full bg-m3-primary shadow-[0_0_8px_rgba(168,199,250,0.6)] transition-[width] duration-200 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-xs text-white/70">
        <span>{formatTime(position)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
