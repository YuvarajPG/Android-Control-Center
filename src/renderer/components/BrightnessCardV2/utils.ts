/** Converts raw hardware brightness (0..255) to Android Settings visual percentage (0..100) using Android 2.2 gamma curve */
export function rawToBrightnessPercent(raw: number): number {
  const clamped = Math.max(0, Math.min(255, raw));
  if (clamped === 0) return 0;
  return Math.round(Math.pow(clamped / 255, 1 / 2.2) * 100);
}

/** Converts Android Settings visual percentage (0..100) back to raw hardware brightness (0..255) using Android 2.2 gamma curve */
export function percentToRawBrightness(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  if (clamped === 0) return 0;
  return Math.round(Math.pow(clamped / 100, 2.2) * 255);
}
