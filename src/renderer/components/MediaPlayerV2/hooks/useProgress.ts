import { useEffect, useRef, useState } from 'react';
import { calculateProgress, normalizeTimeMs } from '../utils';

export function useProgress(
  position: number,
  duration: number,
  playbackState: string,
  playbackSpeed: number = 1.0,
  trackId?: string
) {
  const normPos = normalizeTimeMs(position);
  const normDur = normalizeTimeMs(duration);

  const [displayPosition, setDisplayPosition] = useState(normPos);
  const lastPositionRef = useRef(normPos);
  const lastSyncTimeRef = useRef(performance.now());
  const prevTrackIdRef = useRef(trackId);

  const isPlaying = playbackState === 'playing';

  // Synchronize position anchor with Android whenever position, playbackState, or trackId changes
  useEffect(() => {
    prevTrackIdRef.current = trackId;
    const freshPos = normalizeTimeMs(position);
    lastPositionRef.current = freshPos;
    lastSyncTimeRef.current = performance.now();
    setDisplayPosition(freshPos);
  }, [position, playbackState, trackId]);

  // Animate locally using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) return;

    let frameId = 0;
    const tick = () => {
      const elapsed = (performance.now() - lastSyncTimeRef.current) * playbackSpeed;
      const rawPos = lastPositionRef.current + elapsed;
      const currentPos = normDur > 0 ? Math.min(normDur, Math.max(0, rawPos)) : Math.max(0, rawPos);
      setDisplayPosition(currentPos);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, normDur, playbackSpeed]);

  const progressPercent = calculateProgress(displayPosition, normDur);

  return {
    displayPosition,
    progressPercent,
  };
}
