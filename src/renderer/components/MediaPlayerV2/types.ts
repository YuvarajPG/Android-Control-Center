export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'buffering';

export interface MediaSessionData {
  title: string;
  artist: string;
  album: string;
  artwork?: string;
  duration: number; // ms
  position: number; // ms
  playbackState: PlaybackState;
  packageName?: string;
  playbackSpeed?: number;
}

export type MediaControlAction = 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down';
