import { useCallback, useEffect, useState } from 'react';
import { ipcService } from '../../../services/ipcService';
import { DEFAULT_BRIGHTNESS_RAW, BRIGHTNESS_POLL_INTERVAL_MS } from '../constants';
import { rawToBrightnessPercent } from '../utils';

export function useBrightness(serial: string) {
  const [brightnessRaw, setBrightnessRaw] = useState<number>(DEFAULT_BRIGHTNESS_RAW);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const brightnessPercent = rawToBrightnessPercent(brightnessRaw);
  const sliderValue = brightnessRaw;

  const fetchBrightness = useCallback(async () => {
    if (!serial) return;
    try {
      setIsLoading(true);
      const caps = await ipcService.control.getCapabilities(serial);
      if (caps && typeof caps.brightness === 'number') {
        setBrightnessRaw(caps.brightness);
      }
    } catch {
      // Keep previous state
    } finally {
      setIsLoading(false);
    }
  }, [serial]);

  const updateBrightness = useCallback(
    async (rawVal: number) => {
      setBrightnessRaw(rawVal);
      if (!serial) return;
      try {
        await ipcService.control.setBrightness(serial, rawVal);
      } catch {
        // Handle error silently
      }
    },
    [serial],
  );

  useEffect(() => {
    fetchBrightness();
    const interval = setInterval(fetchBrightness, BRIGHTNESS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchBrightness]);

  return {
    brightnessRaw,
    brightnessPercent,
    sliderValue,
    isAutoBrightness: false,
    isLoading,
    updateBrightness,
    refreshBrightness: fetchBrightness,
  };
}
