import React from 'react';
import { Tooltip } from '../common/Tooltip';

interface MediaInfoProps {
  title: string;
  artist: string;
  album: string;
  mediaType?: 'music' | 'video' | 'unknown';
  sourceApp?: string;
  sourceBadge?: string;
}

export const MediaInfoDisplay: React.FC<MediaInfoProps> = ({
  title,
  artist,
  album,
  mediaType = 'music',
  sourceApp,
  sourceBadge,
}) => {
  const displayTitle = title || 'Unknown title';
  const displayArtist = artist || 'Unknown artist';
  const displayAlbum = album || 'Unknown album';
  const isVideo = mediaType === 'video';

  return (
    <div className="min-w-0 flex-1 space-y-1 text-white overflow-hidden flex flex-col justify-center">
      <Tooltip content={displayTitle} position="top">
        <p className="truncate text-base font-bold leading-snug text-white max-w-full">
          {displayTitle}
        </p>
      </Tooltip>

      {isVideo ? (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/90 border border-white/15">
            {sourceBadge || `🎬 ${sourceApp || 'Video'}`}
          </span>
        </div>
      ) : (
        <>
          <Tooltip content={displayArtist} position="top">
            <p className="truncate text-xs font-medium text-white/80 max-w-full">
              {displayArtist}
            </p>
          </Tooltip>
          {album && album.toLowerCase() !== 'unknown album' && (
            <Tooltip content={displayAlbum} position="top">
              <p className="truncate text-[11px] text-white/60 max-w-full">
                {displayAlbum}
              </p>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
};
