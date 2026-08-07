import React from 'react';

interface MediaInfoProps {
  title: string;
  artist: string;
  album: string;
}

export const MediaInfoDisplay: React.FC<MediaInfoProps> = ({ title, artist, album }) => {
  return (
    <div className="min-w-0 flex-1 space-y-1 text-white">
      <p className="truncate text-base font-bold leading-snug text-white" title={title || 'Unknown title'}>
        {title || 'Unknown title'}
      </p>
      <p className="truncate text-xs font-medium text-white/80" title={artist || 'Unknown artist'}>
        {artist || 'Unknown artist'}
      </p>
      <p className="truncate text-[11px] text-white/60" title={album || 'Unknown album'}>
        {album || 'Unknown album'}
      </p>
    </div>
  );
};
