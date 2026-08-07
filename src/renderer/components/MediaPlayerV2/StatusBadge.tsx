import React from 'react';
import { STATE_BADGE_COLORS, STATE_LABELS } from './constants';
import { PlaybackState } from './types';

interface StatusBadgeProps {
  state: PlaybackState;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ state }) => {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATE_BADGE_COLORS[state] || STATE_BADGE_COLORS.stopped}`}>
      {STATE_LABELS[state] || 'Stopped'}
    </span>
  );
};
