import React from 'react';
import { Music2 } from 'lucide-react';

interface ArtworkProps {
  artworkUrl: string | null;
  title: string;
  onError: () => void;
}

export const Artwork: React.FC<ArtworkProps> = ({ artworkUrl, title, onError }) => {
  if (artworkUrl) {
    return (
      <img
        src={artworkUrl}
        onError={onError}
        alt={`Artwork for ${title}`}
        className="h-20 w-20 shrink-0 rounded-m3-md border border-white/20 object-cover shadow-lg transition-all duration-300 sm:h-22 sm:w-22"
      />
    );
  }

  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-m3-md border border-white/15 bg-gradient-to-br from-indigo-900/60 via-purple-900/40 to-slate-900/80 shadow-inner sm:h-22 sm:w-22" aria-label="No album artwork available">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,199,250,0.15),transparent_70%)] animate-pulse" />
      <Music2 className="h-9 w-9 text-indigo-300 drop-shadow-[0_0_10px_rgba(168,199,250,0.5)]" />
    </div>
  );
};
