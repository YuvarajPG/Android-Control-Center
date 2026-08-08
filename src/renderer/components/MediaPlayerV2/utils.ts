export function normalizeTimeMs(val?: number): number {
  if (!val || val <= 0 || !Number.isFinite(val)) return 0;
  return Math.round(val);
}

export function normalizeDurationMs(duration?: number): number {
  return normalizeTimeMs(duration);
}

export function formatTime(val?: number, isDuration: boolean = false): string {
  const normMs = normalizeTimeMs(val);
  if (!normMs || normMs <= 0) {
    return isDuration ? '--:--' : '0:00';
  }
  const totalSeconds = Math.max(0, Math.floor(normMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function calculateProgress(position: number, duration: number): number {
  const normDur = normalizeTimeMs(duration);
  if (!normDur || normDur <= 0) return 0;
  const normPos = normalizeTimeMs(position);

  const percent = (normPos / normDur) * 100;
  return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
}

export function formatAppPackageName(pkg?: string): string {
  if (!pkg || pkg === 'unknown') return 'Media Player';
  const clean = pkg.trim().toLowerCase();
  if (clean.includes('youtube')) return 'YouTube';
  if (clean.includes('spotify')) return 'Spotify';
  if (clean.includes('chrome')) return 'Google Chrome';
  if (clean.includes('vlc')) return 'VLC';
  if (clean.includes('netflix')) return 'Netflix';
  if (clean.includes('amazon.mp3') || clean.includes('music')) return 'Music Player';
  if (clean.includes('files')) return 'Files';
  if (clean.includes('audible')) return 'Audible';
  if (clean.includes('podcast')) return 'Podcasts';
  if (clean.includes('soundcloud')) return 'SoundCloud';

  const parts = clean.split('.');
  const lastPart = parts[parts.length - 1] || clean;
  return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
}
