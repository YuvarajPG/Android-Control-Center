export function normalizeTimeMs(val?: number): number {
  if (!val || val <= 0) return 0;
  if (val > 0 && val < 10000) {
    return Math.round(val * 1000);
  }
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
