import { useEffect, useRef, useState } from 'react';

export function useArtwork(rawArtworkUrl?: string, trackIdentifier?: string) {
  const [activeArtwork, setActiveArtwork] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const prevTrackRef = useRef<string | undefined>(trackIdentifier);

  useEffect(() => {
    // Detect track change: invalidate and clear artwork immediately
    if (prevTrackRef.current !== trackIdentifier) {
      console.log(`[Artwork] Invalidated & Cleared for track change: ${prevTrackRef.current || 'none'} -> ${trackIdentifier || 'none'}`);
      prevTrackRef.current = trackIdentifier;
      setActiveArtwork(null);
      setFailedUrl(null);
    }

    if (rawArtworkUrl && rawArtworkUrl !== failedUrl) {
      console.log(`[Artwork] Loaded for ${trackIdentifier}: ${rawArtworkUrl.slice(0, 80)}...`);
      setActiveArtwork(rawArtworkUrl);
    } else {
      if (!rawArtworkUrl) {
        console.log(`[Artwork] Unavailable for ${trackIdentifier}`);
      }
      setActiveArtwork(null);
    }
  }, [rawArtworkUrl, trackIdentifier, failedUrl]);

  const handleArtworkError = () => {
    if (rawArtworkUrl) {
      console.warn(`[Artwork] Image failed to load: ${rawArtworkUrl.slice(0, 80)}...`);
      setFailedUrl(rawArtworkUrl);
      setActiveArtwork(null);
    }
  };

  return {
    artworkUrl: activeArtwork,
    handleArtworkError,
  };
}
