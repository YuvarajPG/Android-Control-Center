import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcService } from '../../../services/ipcService';
import { DEFAULT_BRIGHTNESS_RAW } from '../constants';
import { rawToBrightnessPercent } from '../utils';

// Global cache per device serial across component mounts
const brightnessCache = new Map<string, { val: number; lastRead: number }>();

export function useBrightness(serial: string) {
  const cachedEntry = serial ? brightnessCache.get(serial) : undefined;
  const [brightnessRaw, setBrightnessRaw] = useState<number>(
    cachedEntry ? cachedEntry.val : DEFAULT_BRIGHTNESS_RAW
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const lastValueRef = useRef<number>(brightnessRaw);
  const isMountedRef = useRef<boolean>(true);
  const isUpdatingRef = useRef<boolean>(false);

  const brightnessPercent = rawToBrightnessPercent(brightnessRaw);
  const sliderValue = brightnessRaw;

  const fetchBrightness = useCallback(
    async (isInitial: boolean = false) => {
      if (!serial) return;

      // 1. Check if we can use cached value on initial mount
      const cached = brightnessCache.get(serial);
      if (isInitial && cached && Date.now() - cached.lastRead < 5000) {
        console.log('[Brightness] Using cached brightness');
        if (lastValueRef.current !== cached.val) {
          lastValueRef.current = cached.val;
          setBrightnessRaw(cached.val);
          console.log('[Brightness] UI updated from cache');
        }
        return;
      }

      // Skip read if we just updated locally via slider (redundant read-back prevention)
      if (isUpdatingRef.current) {
        isUpdatingRef.current = false;
        return;
      }

      try {
        if (isMountedRef.current) setIsLoading(true);

        // Call direct lightweight getBrightness IPC
        const val = await ipcService.control.getBrightness(serial);

        if (typeof val === 'number') {
          const clamped = Math.max(0, Math.min(255, val));

          // Cache value
          brightnessCache.set(serial, { val: clamped, lastRead: Date.now() });

          // 3. Skip unnecessary renderer updates if brightness hasn't changed
          if (lastValueRef.current !== clamped) {
            console.log(`[Brightness] Brightness changed: ${lastValueRef.current} → ${clamped}`);
            lastValueRef.current = clamped;
            if (isMountedRef.current) {
              setBrightnessRaw(clamped);
            }
          } else {
            console.log('[Brightness] Using cached brightness');
          }
        }
      } catch {
        // Keep previous state on error
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [serial],
  );

  const updateBrightness = useCallback(
    async (rawVal: number) => {
      // 4. Immediate refresh after local changes (optimistic UI update)
      const clamped = Math.max(0, Math.min(255, rawVal));
      lastValueRef.current = clamped;
      setBrightnessRaw(clamped);
      brightnessCache.set(serial, { val: clamped, lastRead: Date.now() });
      isUpdatingRef.current = true;

      console.log('[Brightness] UI updated from cache');

      if (!serial) return;
      try {
        await ipcService.control.setBrightness(serial, clamped);
      } catch {
        // Handle error silently
      }
    },
    [serial],
  );

  useEffect(() => {
    isMountedRef.current = true;
    console.log('[Brightness] Polling every 5s');

    // Initial fetch / cache application
    fetchBrightness(true);

    // 2. Slow 5-second polling while mounted
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && isMountedRef.current) {
        fetchBrightness(false);
      } else {
        console.log('[Brightness] Skipped (card hidden)');
      }
    }, 5000);

    // 5. Stop polling when hidden / unmounted
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      console.log('[Brightness] Skipped (card hidden)');
    };
  }, [fetchBrightness]);

  return {
    brightnessRaw,
    brightnessPercent,
    sliderValue,
    isAutoBrightness: false,
    isLoading,
    updateBrightness,
    refreshBrightness: () => fetchBrightness(false),
  };
}
