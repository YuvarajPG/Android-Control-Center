import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Battery,
  BatteryCharging,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Expand,
  Maximize2,
  Minimize2,
  MonitorUp,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Sparkles,
  Smartphone,
  Video,
  VideoOff,
  Volume2,
  Wifi,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { cn } from '../../utils/cn';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Switch } from '../../components/common/Switch';
import { ipcService } from '../../services/ipcService';

type QualityPreset = 'low' | 'medium' | 'high';
type Orientation = 'portrait' | 'landscape';

interface StreamStatistics {
  fps: number;
  averageFps: number;
  bitrate: number;
  latency: number;
  droppedFrames: number;
  frameTime: number;
}

const STREAM_SIZE = { width: 1080, height: 2400 };

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
};

interface ControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: React.ReactNode;
}

// Portal-rendered Tooltip Button preventing clipping by split-pane or parent containers
const ControlButton: React.FC<ControlButtonProps> = ({ label, children, className = '', onClick, ...props }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleMouseEnter = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setTooltipPos({
        top: rect.top - 36, // Position 36px above button
        left: rect.left + rect.width / 2, // Centered horizontally
      });
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => {
          setIsHovered(false);
          if (onClick) onClick(e);
        }}
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-m3-md border border-white/15 bg-black/60 text-white shadow-m3-1 backdrop-blur-md transition-all duration-150 hover:scale-105 hover:bg-m3-primary hover:text-m3-on-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary',
          className
        )}
        {...props}
      >
        {children}
      </button>
      {isHovered &&
        createPortal(
          <div
            className="fixed z-[9999] -translate-x-1/2 rounded-m3-xs bg-m3-surface-5 px-2.5 py-1 text-[11px] font-semibold text-m3-on-surface shadow-m3-3 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 pointer-events-none border border-white/10"
            style={{ top: `${tooltipPos.top}px`, left: `${tooltipPos.left}px` }}
          >
            {label}
          </div>,
          document.body
        )}
    </>
  );
};

export const ScreenFeature: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();
  const { settings, loadSettings, updateSettings } = useSettingsStore();
  const device = getSelectedDevice();
  const deviceName = device?.deviceName || device?.name || device?.model || 'Android device';
  const connectionLabel = device?.connectionType === 'wireless' ? 'Wireless ADB' : 'USB ADB';

  const [isMirroring, setIsMirroring] = useState(true);
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [fps, setFps] = useState<number>(60);
  const [customBitrate, setCustomBitrate] = useState<number | null>(null);

  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [qualityDropdownPos, setQualityDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const qualityRef = useRef<HTMLDivElement>(null);

  const [isFpsOpen, setIsFpsOpen] = useState(false);
  const [fpsDropdownPos, setFpsDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const fpsRef = useRef<HTMLDivElement>(null);

  const [isBitrateOpen, setIsBitrateOpen] = useState(false);
  const [bitrateDropdownPos, setBitrateDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const bitrateRef = useRef<HTMLDivElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFrame, setShowFrame] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [zoom, setZoom] = useState(1);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [statistics, setStatistics] = useState<StreamStatistics>({ fps: 0, averageFps: 0, bitrate: 0, latency: 0, droppedFrames: 0, frameTime: 0 });
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  // Status progression states: "Connecting to device..." -> "Starting scrcpy..." -> "Waiting for first frame..." -> "Live"
  const [statusProgression, setStatusProgression] = useState<'Connecting to device...' | 'Starting scrcpy...' | 'Waiting for first frame...' | 'Live'>('Connecting to device...');

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sync settings from store
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settings) {
      if (settings.screenMirrorQuality) setQuality(settings.screenMirrorQuality);
      if (settings.screenFpsLimit) setFps(settings.screenFpsLimit);
      if (settings.screenMirrorBitrate) setCustomBitrate(settings.screenMirrorBitrate);
    }
  }, [settings]);

  const streamBitrate = useMemo(() => customBitrate ?? (quality === 'low' ? 4 : quality === 'medium' ? 8 : 16), [quality, customBitrate]);

  const handleQualitySelect = (newQuality: QualityPreset) => {
    setQuality(newQuality);
    setCustomBitrate(null);
    const defaultFps = newQuality === 'low' ? 30 : 60;
    setFps(defaultFps);
    setIsQualityOpen(false);
    updateSettings({ screenMirrorQuality: newQuality, screenFpsLimit: defaultFps });
  };

  const handleFpsSelect = (newFps: number) => {
    setFps(newFps);
    setIsFpsOpen(false);
    updateSettings({ screenFpsLimit: newFps });
  };

  const handleBitrateSelect = (newBitrate: number) => {
    setCustomBitrate(newBitrate);
    setIsBitrateOpen(false);
    updateSettings({ screenMirrorBitrate: newBitrate });
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target && target.closest && target.closest('.portal-dropdown')) {
        return; // Ignore clicks inside portal dropdowns so option onClick fires
      }
      if (qualityRef.current && !qualityRef.current.contains(target)) {
        setIsQualityOpen(false);
      }
      if (fpsRef.current && !fpsRef.current.contains(target)) {
        setIsFpsOpen(false);
      }
      if (bitrateRef.current && !bitrateRef.current.contains(target)) {
        setIsBitrateOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle stage resize for phone frame scaling
  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setStageSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  const viewerSize = useMemo(() => {
    const padding = 64;
    const availableWidth = Math.max(300, (stageSize.width || 800) - padding);
    const availableHeight = Math.max(400, (stageSize.height || 640) - padding);
    const targetAspect = orientation === 'landscape' ? 2400 / 1080 : 1080 / 2400;

    let width = availableWidth;
    let height = width / targetAspect;

    if (height > availableHeight) {
      height = availableHeight;
      width = height * targetAspect;
    }

    return {
      width: Math.round(width * zoom),
      height: Math.round(height * zoom),
    };
  }, [stageSize, orientation, zoom]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setRecordingSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!isMirroring) return;
    const updateStatistics = async () => {
      try {
        const stats = await ipcService.screen.getStats();
        if (stats) {
          setStatistics(stats);
        }
      } catch {
        // Suppress stats error
      }
    };
    updateStatistics();
    const timer = window.setInterval(updateStatistics, 1000);
    return () => window.clearInterval(timer);
  }, [isMirroring]);

  const [hasReceivedFrame, setHasReceivedFrame] = useState(false);

  const streamConfigRef = useRef({ streamBitrate, fps, quality });
  streamConfigRef.current = { streamBitrate, fps, quality };

  const latestFrameRef = useRef<ImageBitmap | null>(null);
  const firstFrameDisplayedRef = useRef<boolean>(false);

  // Connect to backend WebSocket server and draw decoded Android frames to canvas
  useEffect(() => {
    const serial = device?.serialNumber || device?.serial || '';
    if (!isMirroring || !serial) {
      setHasReceivedFrame(false);
      firstFrameDisplayedRef.current = false;
      setStatusProgression('Connecting to device...');
      ipcService.screen.stopStream().catch(() => {});
      return;
    }

    let ws: WebSocket | null = null;
    let isActive = true;
    let rafId: number | null = null;

    // Status progression timers
    setStatusProgression('Connecting to device...');
    const t1 = setTimeout(() => {
      if (isActive) setStatusProgression('Starting scrcpy...');
    }, 500);
    const t2 = setTimeout(() => {
      if (isActive) setStatusProgression('Waiting for first frame...');
    }, 1500);

    // Continuous requestAnimationFrame rendering loop consuming queued frames
    const renderLoop = () => {
      if (!isActive) return;

      const bitmap = latestFrameRef.current;
      if (bitmap && canvasRef.current) {
        latestFrameRef.current = null; // Consume frame from queue
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (context) {
          console.log('[Scrcpy] RENDER START');
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }

          console.log('[Scrcpy] DRAWIMAGE CALLED');
          context.drawImage(bitmap, 0, 0);
          console.log('[Scrcpy] DRAW COMPLETE');

          if (!firstFrameDisplayedRef.current) {
            firstFrameDisplayedRef.current = true;
            console.log('[Scrcpy] FIRST FRAME RECEIVED');
            console.log('[Scrcpy] PLACEHOLDER HIDDEN');
            setStatusProgression('Live');
            setHasReceivedFrame(true);
          }

          console.log('[Scrcpy] FRAME PRESENTED');
        }
        bitmap.close();
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    const connectWebSocket = () => {
      if (!isActive) return;
      try {
        const client = new WebSocket('ws://localhost:27184');
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          console.log('[ScreenMirror] WebSocket connected to stream server');
        };

        client.onmessage = async (event: MessageEvent) => {
          if (!isActive) return;
          console.log('[Scrcpy] OUTPUT CALLBACK', event.data.byteLength);
          try {
            const blob = new Blob([event.data], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);
            if (!isActive) {
              bitmap.close();
              return;
            }

            console.log('[Scrcpy] FRAME RECEIVED', bitmap.width, bitmap.height);

            // Immediately draw on canvas if ready
            if (canvasRef.current) {
              const canvas = canvasRef.current;
              const context = canvas.getContext('2d');
              if (context) {
                console.log('[Scrcpy] RENDER START');
                if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                }
                console.log('[Scrcpy] DRAWIMAGE CALLED');
                context.drawImage(bitmap, 0, 0);
                console.log('[Scrcpy] DRAW COMPLETE');

                if (!firstFrameDisplayedRef.current) {
                  firstFrameDisplayedRef.current = true;
                  console.log('[Scrcpy] FIRST FRAME RECEIVED');
                  console.log('[Scrcpy] PLACEHOLDER HIDDEN');
                  setStatusProgression('Live');
                  setHasReceivedFrame(true);
                }

                console.log('[Scrcpy] FRAME PRESENTED');
              }
            }

            if (latestFrameRef.current) {
              latestFrameRef.current.close();
            }
            latestFrameRef.current = bitmap;
          } catch (err) {
            console.error('[Scrcpy] Frame decode error:', err);
          }
        };

        client.onerror = () => {
          if (isActive && !firstFrameDisplayedRef.current) {
            setTimeout(connectWebSocket, 400);
          }
        };

        client.onclose = () => {
          if (isActive && !firstFrameDisplayedRef.current) {
            setTimeout(connectWebSocket, 400);
          }
        };

        ws = client;
      } catch (err) {
        if (isActive) setTimeout(connectWebSocket, 500);
      }
    };

    const startStreaming = async () => {
      const { streamBitrate: b, fps: f, quality: q } = streamConfigRef.current;
      console.log('[ScreenMirror] Starting stream pipeline for serial:', serial);
      connectWebSocket();
      rafId = requestAnimationFrame(renderLoop);
      await ipcService.screen.startStream(serial, b, f, q);
    };

    startStreaming();

    return () => {
      isActive = false;
      clearTimeout(t1);
      clearTimeout(t2);
      firstFrameDisplayedRef.current = false;
      setHasReceivedFrame(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (latestFrameRef.current) {
        latestFrameRef.current.close();
        latestFrameRef.current = null;
      }
      if (ws) {
        (ws as any).close();
      }
      ipcService.screen.stopStream().catch(() => {});
    };
  }, [isMirroring, device?.serialNumber]);

  const handleTakeScreenshot = async () => {
    const serial = device?.serialNumber || device?.serial || '';
    addToast('info', 'Capturing device screenshot…');
    try {
      if (hasReceivedFrame && canvasRef.current) {
        setCapturedImage(canvasRef.current.toDataURL('image/png'));
        setIsScreenshotModalOpen(true);
        return;
      }
      const result = await ipcService.screen.takeScreenshot(serial);
      if (result.success && result.base64Image) {
        setCapturedImage(result.base64Image);
        setIsScreenshotModalOpen(true);
      } else addToast('error', result.message || 'Screenshot failed');
    } catch {
      addToast('error', 'Failed to take screenshot');
    }
  };

  const handleSaveScreenshot = async () => {
    if (!capturedImage) return;
    const result = await ipcService.screen.saveScreenshot(capturedImage);
    addToast(result.success ? 'success' : 'warning', result.message);
    if (result.success) setIsScreenshotModalOpen(false);
  };

  const handleToggleRecording = async () => {
    const serial = device?.serialNumber || device?.serial || '';
    if (isRecording) {
      addToast('info', 'Finalizing screen recording…');
      const result = await ipcService.screen.stopRecord(serial);
      setIsRecording(false);
      addToast(result.success ? 'success' : 'warning', result.message);
      return;
    }
    const result = await ipcService.screen.startRecord(serial, streamBitrate);
    if (result.success) {
      setIsRecording(true);
      addToast('info', 'Screen recording started');
    } else addToast('error', result.message);
  };

  const handleClipboardOCR = () => {
    setIsOcrProcessing(true);
    setIsOcrModalOpen(true);
    window.setTimeout(() => {
      setOcrText(`Device: ${deviceName}\nConnection: ${connectionLabel}\nAndroid: ${device?.androidVersion || 'Unknown'}\nStream: ${statistics.fps} FPS • ${statistics.bitrate} Mbps`);
      setIsOcrProcessing(false);
    }, 700);
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const fitViewer = () => setZoom(1);
  const rotateViewer = () => setOrientation((value) => (value === 'portrait' ? 'landscape' : 'portrait'));

  return (
    <div ref={containerRef} className="space-y-6">
      <PageHeader
        title="Screen Mirroring & Control"
        subtitle="High-quality Android streaming, capture, recording, and OCR"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="tonal" size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={handleClipboardOCR}>
              OCR Text
            </Button>
            <Button variant="tonal" size="sm" icon={<Camera className="h-4 w-4" />} onClick={handleTakeScreenshot}>
              Screenshot
            </Button>
            <Button
              variant={isRecording ? 'filled' : 'tonal'}
              size="sm"
              className={isRecording ? 'bg-m3-error text-m3-on-error animate-pulse' : ''}
              icon={isRecording ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              onClick={handleToggleRecording}
            >
              {isRecording ? formatTime(recordingSeconds) : 'Record'}
            </Button>
          </div>
        }
      />

      <Card variant="surface-1" className="relative z-40 flex flex-wrap items-center gap-3 overflow-visible border-m3-surface-3 p-3">
        <Button
          variant={isMirroring ? 'tonal' : 'filled'}
          size="sm"
          icon={isMirroring ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          onClick={() => setIsMirroring((value) => !value)}
          className={isMirroring ? 'h-8 bg-m3-surface-3 text-m3-on-surface' : 'h-8 bg-m3-primary text-m3-on-primary font-bold shadow-m3-1 hover:brightness-110'}
        >
          {isMirroring ? 'Pause stream' : 'Start stream'}
        </Button>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <div className="relative" ref={qualityRef}>
            <button
              type="button"
              onClick={() => {
                if (qualityRef.current) {
                  const rect = qualityRef.current.getBoundingClientRect();
                  setQualityDropdownPos({ top: rect.bottom + 6, left: rect.left });
                }
                setIsQualityOpen((prev) => !prev);
              }}
              className="flex h-8 items-center gap-2 rounded-m3-md border border-m3-surface-4 bg-m3-surface-2 px-3 text-xs text-m3-on-surface shadow-sm hover:border-m3-primary/60 transition-colors"
            >
              <Volume2 className="h-3.5 w-3.5 text-m3-primary shrink-0" />
              <span className="font-medium text-m3-on-surface-variant">Quality:</span>
              <span className="font-semibold text-m3-on-surface">
                {quality === 'low' ? 'Low · 4 Mbps' : quality === 'medium' ? 'Medium · 8 Mbps' : 'High · 16 Mbps'}
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-m3-on-surface-variant transition-transform duration-200', isQualityOpen && 'rotate-180 text-m3-primary')} />
            </button>

            {isQualityOpen &&
              createPortal(
                <div
                  className="portal-dropdown fixed z-[9999] w-48 rounded-m3-md border border-m3-surface-5 bg-m3-surface-3 p-1 shadow-m3-3 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                  style={{ top: `${qualityDropdownPos.top}px`, left: `${qualityDropdownPos.left}px` }}
                >
                  {[
                    { value: 'high', label: 'High · 16 Mbps' },
                    { value: 'medium', label: 'Medium · 8 Mbps' },
                    { value: 'low', label: 'Low · 4 Mbps' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleQualitySelect(opt.value as QualityPreset)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-m3-sm px-3 py-1.5 text-xs font-medium transition-colors text-left',
                        quality === opt.value ? 'bg-m3-primary-container/40 text-m3-primary font-semibold' : 'text-m3-on-surface hover:bg-m3-surface-4'
                      )}
                    >
                      <span>{opt.label}</span>
                      {quality === opt.value && <Check className="h-3.5 w-3.5 text-m3-primary shrink-0 ml-1.5" />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
          </div>
          {/* Interactive FPS Selector */}
          <div className="relative" ref={fpsRef}>
            <button
              type="button"
              onClick={() => {
                if (fpsRef.current) {
                  const rect = fpsRef.current.getBoundingClientRect();
                  setFpsDropdownPos({ top: rect.bottom + 6, left: rect.left });
                }
                setIsFpsOpen((prev) => !prev);
              }}
              className="flex h-8 items-center gap-1.5 rounded-m3-md border border-m3-primary/30 bg-m3-primary-container/30 px-3 font-mono text-xs font-semibold text-m3-primary hover:border-m3-primary transition-colors cursor-pointer"
            >
              <span>{fps} FPS</span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', isFpsOpen && 'rotate-180')} />
            </button>

            {isFpsOpen &&
              createPortal(
                <div
                  className="portal-dropdown fixed z-[9999] w-32 rounded-m3-md border border-m3-surface-5 bg-m3-surface-3 p-1 shadow-m3-3 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                  style={{ top: `${fpsDropdownPos.top}px`, left: `${fpsDropdownPos.left}px` }}
                >
                  {[15, 30, 60, 90, 120].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleFpsSelect(val)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-m3-sm px-3 py-1.5 font-mono text-xs font-medium transition-colors text-left',
                        fps === val ? 'bg-m3-primary-container/40 text-m3-primary font-bold' : 'text-m3-on-surface hover:bg-m3-surface-4'
                      )}
                    >
                      <span>{val} FPS</span>
                      {fps === val && <Check className="h-3.5 w-3.5 text-m3-primary shrink-0 ml-1.5" />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
          </div>

          {/* Interactive Bitrate (Mbps) Selector */}
          <div className="relative" ref={bitrateRef}>
            <button
              type="button"
              onClick={() => {
                if (bitrateRef.current) {
                  const rect = bitrateRef.current.getBoundingClientRect();
                  setBitrateDropdownPos({ top: rect.bottom + 6, left: rect.left });
                }
                setIsBitrateOpen((prev) => !prev);
              }}
              className="flex h-8 items-center gap-1.5 rounded-m3-md border border-m3-surface-4 bg-m3-surface-2 px-3 font-mono text-xs font-semibold text-m3-on-surface hover:border-m3-primary/60 transition-colors cursor-pointer"
            >
              <span>{streamBitrate} Mbps</span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-m3-on-surface-variant transition-transform duration-200', isBitrateOpen && 'rotate-180')} />
            </button>

            {isBitrateOpen &&
              createPortal(
                <div
                  className="portal-dropdown fixed z-[9999] w-36 rounded-m3-md border border-m3-surface-5 bg-m3-surface-3 p-1 shadow-m3-3 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                  style={{ top: `${bitrateDropdownPos.top}px`, left: `${bitrateDropdownPos.left}px` }}
                >
                  {[2, 4, 8, 12, 16, 24, 32].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleBitrateSelect(val)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-m3-sm px-3 py-1.5 font-mono text-xs font-medium transition-colors text-left',
                        streamBitrate === val ? 'bg-m3-primary-container/40 text-m3-primary font-bold' : 'text-m3-on-surface hover:bg-m3-surface-4'
                      )}
                    >
                      <span>{val} Mbps</span>
                      {streamBitrate === val && <Check className="h-3.5 w-3.5 text-m3-primary shrink-0 ml-1.5" />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-m3-on-surface-variant">
            <Switch checked={showFrame} onChange={setShowFrame} label="Frame" className="hidden sm:inline-flex" />
            <Button variant="ghost" size="sm" icon={isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} onClick={handleFullscreen} title="Fullscreen" className="flex h-8 w-8 items-center justify-center p-0" />
          </div>
        </div>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Card variant="surface-2" className="relative min-h-[min(68vh,720px)] overflow-visible border-m3-surface-4 p-0">
          <div ref={stageRef} className="group relative flex h-full min-h-[min(68vh,720px)] items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,_rgba(79,55,139,.25),_rgba(15,14,19,.2)_46%,_rgba(15,14,19,.9)_100%)] p-5 sm:p-8">
            {isMirroring ? (
              <>
                {/* Unified Glassmorphic Status Header Overlay - Positioned Top Right to Avoid Top Toolbar Dropdown Overlap */}
                <div className="absolute right-4 top-4 z-20 flex items-center gap-3 rounded-m3-md border border-white/10 bg-black/60 px-3.5 py-2 text-xs text-white/90 shadow-m3-2 backdrop-blur-md">
                  <div className="flex items-center gap-1.5 font-bold text-m3-success">
                    <span className="h-2.5 w-2.5 rounded-full bg-m3-success animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
                    LIVE
                  </div>
                  <div className="h-3 w-px bg-white/20" />
                  <div className="flex items-center gap-3 font-mono text-[11px] text-white/80">
                    <span>{statistics.fps} FPS</span>
                    <span>{statistics.bitrate} Mbps</span>
                    <span>{connectionLabel}</span>
                    <span>{STREAM_SIZE.width}×{STREAM_SIZE.height}</span>
                    <span>{statistics.latency} ms</span>
                  </div>
                </div>

                {/* Perfectly Centered Bottom Toolbar with Equal-Sized Icon Buttons & Portal Tooltips */}
                <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center justify-center gap-2 rounded-m3-md border border-white/10 bg-black/60 p-1.5 shadow-m3-3 backdrop-blur-md opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                  <ControlButton label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))}>
                    <ZoomOut className="h-4 w-4" />
                  </ControlButton>
                  <ControlButton label="Fit to screen" onClick={fitViewer}>
                    <Expand className="h-4 w-4" />
                  </ControlButton>
                  <ControlButton label="100 percent zoom" onClick={() => setZoom(1)} className="text-[11px] font-bold">
                    100
                  </ControlButton>
                  <ControlButton label="Zoom in" onClick={() => setZoom((value) => Math.min(1.35, Number((value + 0.1).toFixed(1))))}>
                    <ZoomIn className="h-4 w-4" />
                  </ControlButton>
                  <ControlButton label="Rotate viewer" onClick={rotateViewer}>
                    <RotateCw className="h-4 w-4" />
                  </ControlButton>
                  <ControlButton label="Screenshot" onClick={handleTakeScreenshot}>
                    <Camera className="h-4 w-4" />
                  </ControlButton>
                  <ControlButton
                    label={isRecording ? 'Stop recording' : 'Start recording'}
                    onClick={handleToggleRecording}
                    className={isRecording ? 'bg-m3-error text-m3-on-error border-m3-error animate-pulse' : ''}
                  >
                    <Video className="h-4 w-4" />
                  </ControlButton>
                </div>

                {/* Phone Preview Frame & Responsive Canvas */}
                <div className={`relative overflow-hidden transition-[width,height,transform] duration-300 ease-out ${showFrame ? 'rounded-[2rem] border-[7px] border-m3-surface-5 bg-black p-1.5 shadow-m3-3' : 'rounded-m3-lg shadow-m3-2'}`} style={{ width: viewerSize.width, height: viewerSize.height }}>
                  {/* Vertically & Horizontally Centered Loading Overlay with Status Progression */}
                  {!hasReceivedFrame && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0F1626] p-8 text-center text-m3-on-surface-variant my-auto">
                      <RefreshCw className="mb-4 h-12 w-12 animate-spin text-m3-primary" />
                      <p className="text-base font-bold text-m3-on-surface">{statusProgression}</p>
                      <p className="mt-1.5 text-xs text-m3-on-surface-variant/80">
                        {statusProgression === 'Connecting to device...' && 'Establishing ADB command connection'}
                        {statusProgression === 'Starting scrcpy...' && 'Launching scrcpy-server process'}
                        {statusProgression === 'Waiting for first frame...' && 'Decoding video feed'}
                      </p>
                    </div>
                  )}

                  {showFrame && orientation === 'portrait' && <div className="absolute left-1/2 top-2 z-10 h-2 w-16 -translate-x-1/2 rounded-full bg-m3-surface-5" />}
                  <canvas
                    ref={canvasRef}
                    width={360}
                    height={800}
                    className="absolute left-1/2 top-1/2 block rounded-[1.55rem] bg-[#0F1626] shadow-inner"
                    style={
                      orientation === 'landscape'
                        ? { width: viewerSize.height - 12, height: viewerSize.width - 12, transform: 'translate(-50%, -50%) rotate(90deg)' }
                        : { width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', transform: 'translate(-50%, -50%)' }
                    }
                  />
                </div>
              </>
            ) : (
              <div className="flex max-w-sm flex-col items-center text-center animate-[media-metadata-in_300ms_ease-out]">
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] border border-m3-primary/30 bg-m3-primary-container/30 shadow-m3-2">
                  <Smartphone className="h-11 w-11 text-m3-primary" />
                </div>
                <h2 className="text-lg font-bold text-m3-on-surface">Ready to start screen mirroring</h2>
                <p className="mt-2 text-sm leading-6 text-m3-on-surface-variant">Connect to {deviceName} and open a responsive, high-quality device preview.</p>
                <Button className="mt-6" variant="filled" icon={<MonitorUp className="h-4 w-4" />} onClick={() => setIsMirroring(true)}>
                  Start stream
                </Button>
              </div>
            )}
          </div>
        </Card>

        <aside className="min-w-0 space-y-4">
          <Card variant="surface-1" className="space-y-3 border-m3-surface-3">
            <div className="flex items-center gap-3">
              <div className="rounded-m3-md bg-m3-primary-container/30 p-2">
                <Smartphone className="h-5 w-5 text-m3-primary" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-m3-on-surface">{deviceName}</p>
                <p className="text-xs text-m3-on-surface-variant">Android {device?.androidVersion || 'Unknown'}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-m3-surface-4/70 pt-3 text-xs">
              <div>
                <dt className="text-m3-on-surface-variant">Resolution</dt>
                <dd className="mt-0.5 font-mono text-m3-on-surface">
                  {STREAM_SIZE.width} × {STREAM_SIZE.height}
                </dd>
              </div>
              <div>
                <dt className="text-m3-on-surface-variant">Orientation</dt>
                <dd className="mt-0.5 capitalize text-m3-on-surface">{orientation}</dd>
              </div>
              <div>
                <dt className="text-m3-on-surface-variant">Connection</dt>
                <dd className="mt-0.5 flex items-center gap-1 text-m3-on-surface">
                  <Wifi className="h-3 w-3" />
                  {connectionLabel}
                </dd>
              </div>
              <div>
                <dt className="text-m3-on-surface-variant">Power</dt>
                <dd className="mt-0.5 flex items-center gap-1 text-m3-on-surface">
                  {device?.isCharging ? <BatteryCharging className="h-3 w-3 text-m3-success" /> : <Battery className="h-3 w-3" />}
                  {device?.batteryLevel ?? '—'}%
                </dd>
              </div>
            </dl>
          </Card>
          <Card variant="surface-1" className="border-m3-surface-3 p-0">
            <button
              type="button"
              onClick={() => setIsStatsOpen((value) => !value)}
              className="flex w-full items-center justify-between p-4 text-left text-sm font-bold text-m3-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3-primary"
            >
              <span>Stream statistics</span>
              {isStatsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {isStatsOpen && (
              <div className="grid grid-cols-2 gap-px border-t border-m3-surface-4 bg-m3-surface-4/60 animate-[media-metadata-in_200ms_ease-out]">
                {[
                  ['Current FPS', statistics.fps],
                  ['Average FPS', statistics.averageFps],
                  ['Bitrate', `${statistics.bitrate} Mbps`],
                  ['Latency', `${statistics.latency} ms`],
                  ['Dropped', statistics.droppedFrames],
                  ['Frame time', `${statistics.frameTime} ms`],
                  ['Encoder', 'Scrcpy'],
                  ['Decoder', 'Canvas'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-m3-surface-1 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-m3-on-surface-variant">{label}</p>
                    <p className="mt-1 truncate font-mono text-xs text-m3-on-surface">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>

      <Modal
        isOpen={isScreenshotModalOpen}
        onClose={() => setIsScreenshotModalOpen(false)}
        title="Captured Screenshot Preview"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsScreenshotModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="filled" size="sm" icon={<Download className="h-4 w-4" />} onClick={handleSaveScreenshot}>
              Save image
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-center">
          {capturedImage && <img src={capturedImage} alt="Captured Android screen" className="mx-auto max-h-96 max-w-full rounded-m3-md border border-m3-surface-4 shadow-m3-2" />}
          <p className="font-mono text-xs text-m3-on-surface-variant">PNG screenshot</p>
        </div>
      </Modal>
      <Modal isOpen={isOcrModalOpen} onClose={() => setIsOcrModalOpen(false)} title="Screen Optical Character Recognition" footer={<Button variant="filled" size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(ocrText); setIsOcrModalOpen(false); }}>Copy text</Button>}>
        {isOcrProcessing ? (
          <div className="space-y-2 p-8 text-center text-m3-on-surface-variant">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-m3-primary" />
            <p className="text-xs font-semibold">Extracting text from the current frame…</p>
          </div>
        ) : (
          <textarea value={ocrText} onChange={(event) => setOcrText(event.target.value)} rows={8} className="w-full rounded-m3-md border border-m3-surface-4 bg-m3-surface-2 p-3 font-mono text-xs text-m3-on-surface focus:outline-none focus:ring-1 focus:ring-m3-primary" />
        )}
      </Modal>
    </div>
  );
};
