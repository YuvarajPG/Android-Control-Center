import React from 'react';
import { Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '../common/Button';
import { MediaControlAction } from './types';

interface PlaybackControlsProps {
  isPlaying: boolean;
  isBuffering: boolean;
  onAction: (action: MediaControlAction) => void;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({ isPlaying, isBuffering, onAction }) => {
  return (
    <div className="flex items-center justify-center gap-4 py-1">
      <Button
        variant="ghost"
        size="sm"
        icon={<SkipBack className="h-5 w-5" />}
        onClick={() => onAction('previous')}
        title="Previous track"
        aria-label="Previous track"
        className="h-10 w-10 p-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10"
      />
      <Button
        variant="filled"
        size="sm"
        icon={isBuffering ? <Loader2 className="h-5 w-5 animate-spin" /> : isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        onClick={() => onAction('play_pause')}
        title={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
        aria-label={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
        className="h-10 min-w-28 rounded-full justify-center bg-m3-primary text-m3-on-primary font-bold shadow-m3-1 hover:brightness-110"
      >
        {isBuffering ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<SkipForward className="h-5 w-5" />}
        onClick={() => onAction('next')}
        title="Next track"
        aria-label="Next track"
        className="h-10 w-10 p-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10"
      />
    </div>
  );
};
