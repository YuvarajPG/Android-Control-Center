import { useEffect, useRef, useState } from 'react';
import { calculateProgress } from '../utils';

export function useProgress(position: number, duration: number, playbackState: string, playbackSpeed: number = 1.0) {
  const [displayPosition, setDisplayPosition] = useState(position);
  const lastPositionRef = useRef(position);
  const lastSyncTimeRef = useRef(performance.now());

  const isPlaying = playbackState === 'playing';

  // Resync position anchor only if user seeked (>2.5s delta) or when stopped/paused
  useEffect(() => {
    const currentEst = lastPositionRef.current + (performance.now() - lastSyncTimeRef.current) * playbackSpeed;
    const delta = Math.abs(position - currentEst);

    if (delta > 2500 || position === 0 || !isPlaying) {
      lastPositionRef.current = Math.max(0, position);
      lastSyncTimeRef.current = performance.now();
      setDisplayPosition(lastPositionRef.current);
    }
  }, [position, duration, playbackState, isPlaying, playbackSpeed]);

  // Animate locally using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) return;

    let frameId = 0;
    const tick = () => {
      const elapsed = (performance.now() - lastSyncTimeRef.current) * playbackSpeed;
      const rawPos = lastPositionRef.current + elapsed;
      const currentPos = duration > 0 ? Math.min(duration, Math.max(0, rawPos)) : Math.max(0, rawPos);
      setDisplayPosition(currentPos);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, duration, playbackSpeed]);

  const progressPercent = calculateProgress(displayPosition, duration);

  return {
    displayPosition,
    progressPercent,
  };
}
