import { useEffect, useState } from 'react';

export function useArtwork(rawArtworkUrl?: string, trackIdentifier?: string) {
  const [activeArtwork, setActiveArtwork] = useState<string | null>(rawArtworkUrl || null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (rawArtworkUrl && rawArtworkUrl !== failedUrl) {
      setActiveArtwork(rawArtworkUrl);
    }
  }, [rawArtworkUrl, trackIdentifier, failedUrl]);

  const handleArtworkError = () => {
    if (rawArtworkUrl) {
      setFailedUrl(rawArtworkUrl);
      setActiveArtwork(null);
    }
  };

  return {
    artworkUrl: activeArtwork,
    handleArtworkError,
  };
}
