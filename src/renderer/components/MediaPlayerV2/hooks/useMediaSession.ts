import { useCallback, useEffect } from 'react';
import { useMediaStore } from '../../../store/useMediaStore';
import { MediaControlAction } from '../types';
import { MEDIA_POLL_INTERVAL_MS } from '../constants';

export function useMediaSession(serial: string) {
  const { session, fetchMediaSession, sendMediaControl } = useMediaStore();

  const refreshSession = useCallback(() => {
    if (serial) fetchMediaSession(serial);
  }, [serial, fetchMediaSession]);

  const sendControl = useCallback(
    (action: MediaControlAction) => {
      if (serial) sendMediaControl(serial, action);
    },
    [serial, sendMediaControl],
  );

  useEffect(() => {
    refreshSession();
    const interval = setInterval(refreshSession, MEDIA_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshSession]);

  return {
    session,
    isLoading: false,
    refreshSession,
    sendControl,
  };
}
