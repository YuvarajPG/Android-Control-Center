import { create } from 'zustand';
import { ipcService } from '../services/ipcService';
import { MediaControlAction, MediaSessionData, PlaybackState } from '../components/MediaPlayerV2/types';
import { normalizeTimeMs } from '../components/MediaPlayerV2/utils';

interface MediaState {
  session: MediaSessionData | null;
  isLoading: boolean;
  emptyPollCount: number;
  lastSyncTime: number;
  rawPositionMs: number;
  extrapolatedPositionMs: number;

  fetchMediaSession: (serial: string) => Promise<void>;
  sendMediaControl: (serial: string, action: MediaControlAction) => Promise<void>;
  tickExtrapolation: () => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  session: null,
  isLoading: false,
  emptyPollCount: 0,
  lastSyncTime: 0,
  rawPositionMs: 0,
  extrapolatedPositionMs: 0,

  fetchMediaSession: async (serial: string) => {
    if (!serial) {
      set({ session: null });
      return;
    }

    try {
      const media = await ipcService.control.getMediaInfo(serial);
      const now = performance.now();

      if (media && (media.title || media.artist || media.album)) {
        const prevSession = get().session;
        const newTitle = media.title?.trim() || '';
        const newArtist = media.artist?.trim() || '';
        const sameTrack = Boolean(newTitle && prevSession?.title === newTitle);

        const title = newTitle || (sameTrack ? prevSession?.title : '') || 'Unknown title';
        const artist = newArtist || (sameTrack ? prevSession?.artist : '') || 'Unknown artist';

        const rawDur = media.durationMs && media.durationMs > 0
          ? media.durationMs
          : (sameTrack && prevSession?.duration && prevSession.duration > 0 ? prevSession.duration : 0);
        const normDur = normalizeTimeMs(rawDur);

        const album = media.album && media.album.toLowerCase() !== 'unknown album'
          ? media.album
          : (sameTrack && prevSession?.album ? prevSession.album : 'Unknown album');

        const artwork = media.artworkUrl || (sameTrack ? prevSession?.artwork : undefined);

        let state: PlaybackState = 'stopped';
        const rawState = String(media.playbackState || '').toLowerCase();
        if (media.isPlaying || rawState.includes('play') || rawState === '3') {
          state = 'playing';
        } else if (rawState.includes('pause') || rawState === '2') {
          state = 'paused';
        } else if (rawState.includes('buffer') || rawState === '6') {
          state = 'buffering';
        }

        const rawPosMs = normalizeTimeMs(media.positionMs ?? 0);
        const prevRawPos = get().rawPositionMs;
        const prevExtrapolated = get().extrapolatedPositionMs;
        const prevSyncTime = get().lastSyncTime;

        let finalPosition = rawPosMs;

        if (sameTrack && state === 'playing' && prevSyncTime > 0) {
          const speed = (media as any).playbackSpeed || 1.0;
          const elapsed = (now - prevSyncTime) * speed;
          const candidatePos = prevExtrapolated + elapsed;

          if (Math.abs(rawPosMs - prevRawPos) < 3000 || rawPosMs === prevRawPos) {
            finalPosition = normDur > 0 ? Math.min(normDur, candidatePos) : candidatePos;
          }
        }

        set({
          emptyPollCount: 0,
          rawPositionMs: rawPosMs,
          extrapolatedPositionMs: finalPosition,
          lastSyncTime: now,
          session: {
            title,
            artist,
            album,
            artwork,
            duration: normDur,
            position: finalPosition,
            playbackState: state,
            packageName: media.playerPackage,
            playbackSpeed: (media as any).playbackSpeed || 1.0,
            mediaType: media.mediaType,
            sourceApp: media.sourceApp,
            sourceBadge: media.sourceBadge,
          },
        });
      } else {
        const count = get().emptyPollCount + 1;
        set({ emptyPollCount: count });
        if (count >= 3) {
          set({ session: null, rawPositionMs: 0, extrapolatedPositionMs: 0 });
        }
      }
    } catch {
      const count = get().emptyPollCount + 1;
      set({ emptyPollCount: count });
      if (count >= 3) {
        set({ session: null, rawPositionMs: 0, extrapolatedPositionMs: 0 });
      }
    }
  },

  sendMediaControl: async (serial: string, action: MediaControlAction) => {
    if (!serial) return;
    try {
      await ipcService.control.media(serial, action);
      setTimeout(() => get().fetchMediaSession(serial), 300);
    } catch {
      // Silently handle
    }
  },

  tickExtrapolation: () => {
    const session = get().session;
    if (!session || session.playbackState !== 'playing') return;

    const now = performance.now();
    const lastSync = get().lastSyncTime;
    if (lastSync <= 0) return;

    const speed = session.playbackSpeed || 1.0;
    const elapsed = (now - lastSync) * speed;
    const basePos = get().extrapolatedPositionMs;
    const newPos = basePos + elapsed;
    const normDur = session.duration;

    const finalPos = normDur > 0 ? Math.min(normDur, newPos) : newPos;

    set({
      extrapolatedPositionMs: finalPos,
      lastSyncTime: now,
      session: {
        ...session,
        position: finalPos,
      },
    });
  },
}));
