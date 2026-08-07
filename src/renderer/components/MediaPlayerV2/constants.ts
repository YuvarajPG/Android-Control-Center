export const MEDIA_POLL_INTERVAL_MS = 1000;

export const STATE_LABELS: Record<string, string> = {
  playing: 'Playing',
  paused: 'Paused',
  stopped: 'Stopped',
  buffering: 'Buffering',
};

export const STATE_BADGE_COLORS: Record<string, string> = {
  playing: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  paused: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  buffering: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  stopped: 'bg-white/10 text-white/60 border-white/10',
};
