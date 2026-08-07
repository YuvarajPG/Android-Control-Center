export function normalizeDurationMs(duration?: number): number {
  if (!duration || duration <= 0) return 0;
  if (duration > 0 && duration < 10000) {
    return Math.round(duration * 1000);
  }
  return Math.round(duration);
}

export function formatTime(milliseconds?: number, isDuration: boolean = false): string {
  if (!milliseconds || milliseconds <= 0) {
    return isDuration ? '--:--' : '0:00';
  }
  const normMs = isDuration ? normalizeDurationMs(milliseconds) : milliseconds;
  const totalSeconds = Math.max(0, Math.floor(normMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function calculateProgress(position: number, duration: number): number {
  const normDur = normalizeDurationMs(duration);
  if (!normDur || normDur <= 0) return 0;
  const normPos = Math.max(0, position || 0);

  const percent = (normPos / normDur) * 100;
  return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
}
