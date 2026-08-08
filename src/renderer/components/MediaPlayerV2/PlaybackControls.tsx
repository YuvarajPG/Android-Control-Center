import React from 'react';
import { Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '../common/Button';
import { Tooltip } from '../common/Tooltip';
import { MediaControlAction } from './types';

interface PlaybackControlsProps {
  isPlaying: boolean;
  isBuffering: boolean;
  onAction: (action: MediaControlAction) => void;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({ isPlaying, isBuffering, onAction }) => {
  return (
    <div className="flex items-center justify-center gap-4 py-1">
      <Tooltip content="Previous track" position="top">
        <Button
          variant="ghost"
          size="sm"
          icon={<SkipBack className="h-5 w-5" />}
          onClick={() => onAction('previous')}
          aria-label="Previous track"
          className="h-10 w-10 p-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10"
        />
      </Tooltip>
      <Tooltip content={isBuffering ? 'Buffering' : isPlaying ? 'Pause media' : 'Play media'} position="top">
        <Button
          variant="filled"
          size="sm"
          icon={isBuffering ? <Loader2 className="h-5 w-5 animate-spin" /> : isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          onClick={() => onAction('play_pause')}
          aria-label={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
          className="h-10 min-w-28 rounded-full justify-center bg-m3-primary text-m3-on-primary font-bold shadow-m3-1 hover:brightness-110"
        >
          {isBuffering ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
        </Button>
      </Tooltip>
      <Tooltip content="Next track" position="top">
        <Button
          variant="ghost"
          size="sm"
          icon={<SkipForward className="h-5 w-5" />}
          onClick={() => onAction('next')}
          aria-label="Next track"
          className="h-10 w-10 p-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10"
        />
      </Tooltip>
    </div>
  );
};
