import { useCallback, useEffect, useState } from 'react';
import { ipcService } from '../../../services/ipcService';
import { MediaControlAction, MediaSessionData, PlaybackState } from '../types';
import { MEDIA_POLL_INTERVAL_MS } from '../constants';

export function useMediaSession(serial: string) {
  const [session, setSession] = useState<MediaSessionData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchSession = useCallback(async () => {
    if (!serial) {
      setSession(null);
      return;
    }

    try {
      setIsLoading(true);
      const media = await ipcService.control.getMediaInfo(serial);
      if (media && (media.title || media.artist || media.album)) {
        setSession((prev) => {
          const newTitle = media.title?.trim() || '';
          const newArtist = media.artist?.trim() || '';
          const sameTrack = Boolean(newTitle && prev?.title === newTitle);

          const title = newTitle || (sameTrack ? prev?.title : '') || 'Unknown title';
          const artist = newArtist || (sameTrack ? prev?.artist : '') || 'Unknown artist';

          const duration = media.durationMs && media.durationMs > 0
            ? media.durationMs
            : (sameTrack && prev?.duration && prev.duration > 0 ? prev.duration : 0);

          const album = media.album && media.album.toLowerCase() !== 'unknown album'
            ? media.album
            : (sameTrack && prev?.album ? prev.album : 'Unknown album');

          const artwork = media.artworkUrl || (sameTrack ? prev?.artwork : undefined);

          let state: PlaybackState = 'stopped';
          const rawState = String(media.playbackState || '').toLowerCase();
          if (media.isPlaying || rawState.includes('play') || rawState === '3') {
            state = 'playing';
          } else if (rawState.includes('pause') || rawState === '2') {
            state = 'paused';
          } else if (rawState.includes('buffer') || rawState === '6') {
            state = 'buffering';
          }

          return {
            title,
            artist,
            album,
            artwork,
            duration,
            position: media.positionMs ?? 0,
            playbackState: state,
            packageName: media.playerPackage,
            playbackSpeed: (media as any).playbackSpeed || 1.0,
          };
        });
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [serial]);

  const sendControl = useCallback(
    async (action: MediaControlAction) => {
      if (!serial) return;
      try {
        await ipcService.control.media(serial, action);
        setTimeout(fetchSession, 300);
      } catch {
        // Silently handle control failure
      }
    },
    [serial, fetchSession],
  );

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, MEDIA_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchSession]);

  return {
    session,
    isLoading,
    refreshSession: fetchSession,
    sendControl,
  };
}
