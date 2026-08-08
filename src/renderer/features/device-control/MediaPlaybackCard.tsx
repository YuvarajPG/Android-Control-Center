import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Music2,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Loader2,
} from 'lucide-react';
import { MediaInfo } from '../../services/ipcService';
import { Button } from '../../components/common/Button';

type MediaAction = 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down';

interface MediaPlaybackCardProps {
  media: MediaInfo | null;
  isLoading: boolean;
  onRefresh: () => void;
  onAction: (action: MediaAction) => void;
}



const getPlaybackState = (media: MediaInfo | null) => {
  if (!media) return 'stopped';
  const state = media.playbackState?.toLowerCase();
  if (state === 'playing' || state === 'paused' || state === 'stopped' || state === 'buffering') return state;
  return media.isPlaying ? 'playing' : 'paused';
};

const stateLabel: Record<string, string> = {
  playing: 'Playing',
  paused: 'Paused',
  stopped: 'Stopped',
  buffering: 'Buffering',
};

const stateBadgeColor: Record<string, string> = {
  playing: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  paused: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  buffering: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  stopped: 'bg-white/10 text-white/60 border-white/10',
};

/** A renderer-only MediaSession view. It never fetches device data itself. */
export const MediaPlaybackCard: React.FC<MediaPlaybackCardProps> = ({ media, isLoading, onRefresh, onAction }) => {
  const suppliedArtwork = media?.artworkUrl || null;
  const [unavailableArtwork, setUnavailableArtwork] = useState<string | null>(null);
  const artwork = suppliedArtwork === unavailableArtwork ? null : suppliedArtwork;
  const [displayPosition, setDisplayPosition] = useState(0);

  const playbackState = getPlaybackState(media);
  const isPlaying = playbackState === 'playing';
  const isBuffering = playbackState === 'buffering';
  const isStopped = playbackState === 'stopped';
  const duration = media?.durationMs ?? 0;
  const playbackSpeed = (media as any)?.playbackSpeed || 1.0;
  const isMuted = (media as any)?.isMuted || media?.volumeLevel === 0;

  const lastPositionMsRef = useRef(0);
  const lastSyncTimestampRef = useRef(performance.now());

  const progress = duration > 0 ? Math.min(100, Math.max(0, (displayPosition / duration) * 100)) : 0;

  useEffect(() => setUnavailableArtwork(null), [suppliedArtwork]);

  // Synchronize playback position & timestamp when Android sends new media snapshot
  useEffect(() => {
    if (isStopped) {
      lastPositionMsRef.current = 0;
      lastSyncTimestampRef.current = performance.now();
      setDisplayPosition(0);
    } else {
      lastPositionMsRef.current = Math.max(0, media?.positionMs ?? 0);
      lastSyncTimestampRef.current = performance.now();
      setDisplayPosition(lastPositionMsRef.current);
    }
  }, [media?.positionMs, media?.durationMs, media?.title, media?.artist, isStopped]);

  // Smooth local animation clock while playing using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying || duration <= 0) return;

    let frameId = 0;
    const tick = () => {
      const elapsed = (performance.now() - lastSyncTimestampRef.current) * playbackSpeed;
      const currentPosition = Math.min(duration, Math.max(0, lastPositionMsRef.current + elapsed));
      setDisplayPosition(currentPosition);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, duration, playbackSpeed]);

  const hasSession = Boolean(media && (media.title || media.artist || media.album));
  const metadata = useMemo(() => ({
    title: media?.title || 'Unknown title',
    artist: media?.artist || 'Unknown artist',
    album: media?.album || 'Unknown album',
  }), [media?.album, media?.artist, media?.title]);

  const renderVolumeIcon = () => {
    if (isMuted) return <VolumeX className="h-4 w-4 text-red-400" />;
    return <Volume2 className="h-4 w-4" />;
  };

  return (
    <section className="overflow-hidden rounded-m3-lg border border-m3-surface-4 bg-m3-surface-1 shadow-m3-2">
      <header className="flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2 text-sm font-bold text-m3-on-surface">
          <Volume2 className="h-[18px] w-[18px] text-m3-tertiary" />
          Media playback
        </div>
        {(!hasSession || !media || isStopped) && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-3 hover:text-m3-on-surface disabled:opacity-50"
            title="Refresh media session"
            aria-label="Refresh media session"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </header>

      <div className="relative isolate m-3 mt-4 min-h-[310px] overflow-hidden rounded-m3-lg border border-white/10 p-5 sm:p-6">
        {artwork && (
          <img
            src={artwork}
            onError={() => setUnavailableArtwork(artwork)}
            alt=""
            aria-hidden="true"
            className="absolute inset-[-12%] -z-20 h-[124%] w-[124%] scale-110 object-cover blur-3xl opacity-60"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-slate-950/75" />

        {hasSession ? (
          <div className="space-y-6 animate-[media-metadata-in_350ms_ease-out]">
            <div className="flex min-w-0 items-center gap-4">
              {artwork ? (
                <img
                  src={artwork}
                  onError={() => setUnavailableArtwork(artwork)}
                  alt={`Artwork for ${metadata.title}`}
                  className="h-20 w-20 shrink-0 rounded-m3-md border border-white/20 object-cover shadow-lg transition-opacity duration-500 sm:h-24 sm:w-24"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-m3-md border border-white/10 bg-black/20 sm:h-24 sm:w-24" aria-label="No album artwork available">
                  <Music2 className="h-9 w-9 text-white/65" />
                </div>
              )}
              <div className="min-w-0 flex-1 text-white">
                <p className="truncate text-lg font-bold leading-tight" title={metadata.title}>{metadata.title}</p>
                <p className="mt-1 truncate text-sm text-white/75" title={metadata.artist}>{metadata.artist}</p>
                <p className="mt-1 truncate text-xs text-white/55" title={metadata.album}>{metadata.album}</p>
              </div>
            </div>

            <div className="py-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-m3-primary transition-[width] duration-200 ease-linear" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button variant="ghost" size="sm" icon={<SkipBack className="h-5 w-5" />} onClick={() => onAction('previous')} title="Previous track" aria-label="Previous track" />
              <Button
                variant="filled"
                size="sm"
                icon={isBuffering ? <Loader2 className="h-5 w-5 animate-spin" /> : isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                onClick={() => onAction('play_pause')}
                title={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
                aria-label={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
                className="min-w-24 justify-center"
              >
                {isBuffering ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
              </Button>
              <Button variant="ghost" size="sm" icon={<SkipForward className="h-5 w-5" />} onClick={() => onAction('next')} title="Next track" aria-label="Next track" />
            </div>

            <div className="flex items-center justify-between rounded-m3-md border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white/85">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" icon={renderVolumeIcon()} onClick={() => onAction('volume_down')} title="Volume down" aria-label="Volume down" />
                <Button variant="ghost" size="sm" icon={<Volume2 className="h-4 w-4" />} onClick={() => onAction('volume_up')} title="Volume up" aria-label="Volume up" />
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stateBadgeColor[playbackState] || stateBadgeColor.stopped}`}>
                {stateLabel[playbackState] || 'Stopped'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[270px] flex-col items-center justify-center gap-3 text-center text-white/75">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-black/15">
              <Music2 className="h-8 w-8" />
            </div>
            <div>
              <p className="font-semibold text-white">{isLoading ? 'Reading media session…' : 'No active media session'}</p>
              <p className="mt-1 text-sm text-white/60">Artwork appears here when Android provides it.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
