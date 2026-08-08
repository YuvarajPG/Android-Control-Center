import React from 'react';
import { Music2, RefreshCw, Volume2 } from 'lucide-react';
import { useMediaSession } from './hooks/useMediaSession';
import { useProgress } from './hooks/useProgress';
import { useArtwork } from './hooks/useArtwork';
import { Artwork } from './Artwork';
import { MediaInfoDisplay } from './MediaInfo';
import { ProgressBar } from './ProgressBar';
import { PlaybackControls } from './PlaybackControls';
import { StatusBadge } from './StatusBadge';
import { formatAppPackageName } from './utils';

interface MediaPlayerProps {
  serial: string;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ serial }) => {
  const { session, isLoading, refreshSession, sendControl } = useMediaSession(serial);

  const title = session?.title || '';
  const artist = session?.artist || '';
  const album = session?.album || '';
  const duration = session?.duration || 0;
  const position = session?.position || 0;
  const playbackState = session?.playbackState || 'stopped';
  const rawArtwork = session?.artwork;

  const trackIdentifier = `${title}/${artist}`;
  const { artworkUrl, handleArtworkError } = useArtwork(rawArtwork, trackIdentifier);
  const { displayPosition, progressPercent } = useProgress(position, duration, playbackState, session?.playbackSpeed, trackIdentifier);

  const isPlaying = playbackState === 'playing';
  const isBuffering = playbackState === 'buffering';
  const isStopped = playbackState === 'stopped';
  const hasSession = Boolean(session && (title || artist || album));

  return (
    <section className="overflow-hidden rounded-m3-lg border border-m3-surface-4 bg-m3-surface-1 shadow-m3-2">
      <header className="flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2 text-sm font-bold text-m3-on-surface">
          <Volume2 className="h-[18px] w-[18px] text-m3-tertiary" />
          {session?.mediaType === 'video' ? 'Video playback' : 'Media playback'}
        </div>
        {(!hasSession || isStopped) && (
          <button
            type="button"
            onClick={refreshSession}
            disabled={isLoading}
            className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-3 hover:text-m3-on-surface disabled:opacity-50"
            title="Refresh media session"
            aria-label="Refresh media session"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </header>

      <div className="relative isolate m-3 mt-3 overflow-hidden rounded-m3-lg border border-white/10 p-4 sm:p-5">
        {artworkUrl && (
          <img
            src={artworkUrl}
            onError={handleArtworkError}
            alt=""
            aria-hidden="true"
            className="absolute inset-[-12%] -z-20 h-[124%] w-[124%] scale-110 object-cover blur-3xl opacity-60"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-slate-950/75" />

        {hasSession ? (
          <div className="space-y-4 animate-[media-metadata-in_350ms_ease-out]">
            <div className="flex min-w-0 items-center gap-3.5">
              <Artwork artworkUrl={artworkUrl} title={title} onError={handleArtworkError} />
              <MediaInfoDisplay
                title={title}
                artist={artist}
                album={album}
                mediaType={session?.mediaType}
                sourceApp={session?.sourceApp}
                sourceBadge={session?.sourceBadge}
              />
            </div>

            <ProgressBar position={displayPosition} duration={duration} progressPercent={progressPercent} />

            <PlaybackControls isPlaying={isPlaying} isBuffering={isBuffering} onAction={sendControl} />

            <div className="flex items-center justify-between rounded-m3-md border border-white/10 bg-black/25 px-3.5 py-2 text-xs text-white/80">
              <span className="font-semibold text-xs text-white/80 truncate max-w-[220px]">
                {session?.sourceBadge || formatAppPackageName(session?.packageName)}
              </span>
              <StatusBadge state={playbackState} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-[190px] flex-col items-center justify-center gap-3 text-center text-white/75">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-black/15">
              <Music2 className="h-7 w-7" />
            </div>
            <div>
              <p className="font-semibold text-sm text-white">{isLoading ? 'Reading media session…' : 'No active media session'}</p>
              <p className="mt-0.5 text-xs text-white/60">Artwork appears here when Android provides it.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
