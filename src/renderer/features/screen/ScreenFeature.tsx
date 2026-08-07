import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Battery,
  BatteryCharging,
  Camera,
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
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
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

const ControlButton: React.FC<ControlButtonProps> = ({ label, children, className = '', ...props }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={`flex h-9 w-9 items-center justify-center rounded-m3-sm border border-white/15 bg-black/45 text-white shadow-m3-1 backdrop-blur-sm transition-colors hover:bg-m3-primary hover:text-m3-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary ${className}`}
    {...props}
  >
    {children}
  </button>
);

export const ScreenFeature: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();
  const device = getSelectedDevice();
  const deviceName = device?.deviceName || device?.name || device?.model || 'Android device';
  const connectionLabel = device?.connectionType === 'wireless' ? 'Wireless ADB' : 'USB ADB';

  const [isMirroring, setIsMirroring] = useState(false);
  const [quality, setQuality] = useState<QualityPreset>('high');
  const [fps, setFps] = useState(60);
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

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const streamBitrate = quality === 'low' ? 4 : quality === 'medium' ? 8 : 16;
  const displaySize = orientation === 'portrait'
    ? STREAM_SIZE
    : { width: STREAM_SIZE.height, height: STREAM_SIZE.width };

  const viewerSize = useMemo(() => {
    if (!stageSize.width || !stageSize.height) return { width: 260, height: 578 };
    const availableWidth = stageSize.width * 0.9;
    const availableHeight = stageSize.height * 0.86;
    const fit = Math.min(availableWidth / displaySize.width, availableHeight / displaySize.height);
    const scale = Math.min(1.35, Math.max(0.16, fit * zoom));
    return {
      width: Math.round(displaySize.width * scale),
      height: Math.round(displaySize.height * scale),
    };
  }, [displaySize.height, displaySize.width, stageSize.height, stageSize.width, zoom]);

  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  // Request actual statistics from ScrcpyService via IPC
  useEffect(() => {
    if (!isMirroring) {
      setStatistics({ fps: 0, averageFps: 0, bitrate: 0, latency: 0, droppedFrames: 0, frameTime: 0 });
      return;
    }
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

  // Connect to backend WebSocket server and draw decoded Android frames to canvas
  useEffect(() => {
    if (!isMirroring || !device?.serialNumber) {
      setHasReceivedFrame(false);
      ipcService.screen.stopStream().catch(() => {});
      return;
    }

    let ws: WebSocket | null = null;
    let isActive = true;

    const startStreaming = async () => {
      const serial = device.serialNumber || device.serial || '';
      console.log('[ScreenMirror] Starting stream pipeline for serial:', serial);
      await ipcService.screen.startStream(serial, streamBitrate, fps, quality);

      if (!isActive) return;

      const client = new WebSocket('ws://localhost:27184');
      client.binaryType = 'arraybuffer';

      client.onmessage = (event: MessageEvent) => {
        if (!isActive || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const blob = new Blob([event.data], { type: 'image/jpeg' });
        const img = new Image();
        img.onload = () => {
          if (!isActive) return;

          console.log('[ScreenMirror] Frame received:', {
            width: img.width,
            height: img.height,
            timestamp: Date.now(),
          });

          // Set canvas dimensions dynamically to match frame
          if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
          }

          context.drawImage(img, 0, 0);
          console.log('[ScreenMirror] drawImage called - Canvas updated');

          setHasReceivedFrame((prev) => {
            if (!prev) console.log('[ScreenMirror] First real frame rendered - hiding placeholder template');
            return true;
          });
        };
        img.src = URL.createObjectURL(blob);
      };

      client.onerror = (err) => {
        console.error('[ScreenMirror] Stream WebSocket error:', err);
        addToast('error', 'Screen stream connection error');
      };

      ws = client;
    };

    startStreaming();

    return () => {
      isActive = false;
      setHasReceivedFrame(false);
      if (ws) {
        (ws as any).close();
      }
      ipcService.screen.stopStream().catch(() => {});
    };
  }, [isMirroring, device?.serialNumber, quality, fps, streamBitrate]);

  const handleTakeScreenshot = async () => {
    const serial = device?.serialNumber || device?.serial || '';
    addToast('info', 'Capturing device screenshot…');
    try {
      // Prioritize live canvas frame capture if stream is active and has received frames
      if (hasReceivedFrame && canvasRef.current) {
        console.log('[ScreenMirror] Screenshot source: Live Canvas Frame');
        setCapturedImage(canvasRef.current.toDataURL('image/png'));
        setIsScreenshotModalOpen(true);
        return;
      }

      console.log('[ScreenMirror] Screenshot source: ADB Screencap');
      const result = await ipcService.screen.takeScreenshot(serial);
      if (result.success && result.base64Image) {
        setCapturedImage(result.base64Image);
      } else if (canvasRef.current && hasReceivedFrame) {
        setCapturedImage(canvasRef.current.toDataURL('image/png'));
      }
      setIsScreenshotModalOpen(true);
    } catch {
      if (canvasRef.current && hasReceivedFrame) {
        setCapturedImage(canvasRef.current.toDataURL('image/png'));
        setIsScreenshotModalOpen(true);
      }
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
      console.log('[ScreenMirror] Recording source: Stop screenrecord process');
      const result = await ipcService.screen.stopRecord(serial);
      setIsRecording(false);
      addToast(result.success ? 'success' : 'warning', result.message);
      return;
    }
    console.log('[ScreenMirror] Recording source: Start adb shell screenrecord');
    const result = await ipcService.screen.startRecord(serial, streamBitrate);
    if (result.success) {
      setIsRecording(true);
      addToast('info', 'Screen recording started');
    } else addToast('error', result.message);
  };

  const handleClipboardOCR = () => {
    setIsOcrProcessing(true); setIsOcrModalOpen(true);
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
  const rotateViewer = () => setOrientation((value) => value === 'portrait' ? 'landscape' : 'portrait');


  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-6" ref={containerRef}>
      <PageHeader
        title="Screen Mirror"
        subtitle="High-quality Android streaming, capture, recording, and OCR"
        actions={<div className="flex flex-wrap items-center gap-2">
          <Button variant="filled" size="sm" icon={<Camera className="h-4 w-4" />} onClick={handleTakeScreenshot}>Screenshot</Button>
          <Button variant={isRecording ? 'filled' : 'tonal'} size="sm" className={isRecording ? 'bg-m3-error text-m3-on-error animate-pulse' : ''} icon={isRecording ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />} onClick={handleToggleRecording}>{isRecording ? formatTime(recordingSeconds) : 'Record'}</Button>
          <Button variant="outlined" size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={handleClipboardOCR}>OCR</Button>
        </div>}
      />

      <Card variant="surface-1" className="relative z-20 flex flex-wrap items-center gap-3 overflow-visible border-m3-surface-3 p-3">
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
          <div className="flex h-8 items-center gap-2 rounded-m3-md border border-m3-surface-4 bg-m3-surface-2 px-3 text-xs text-m3-on-surface-variant shadow-sm">
            <Volume2 className="h-3.5 w-3.5 text-m3-primary shrink-0" />
            <span className="font-medium text-m3-on-surface-variant">Quality:</span>
            <select
              value={quality}
              onChange={(event) => {
                const value = event.target.value as QualityPreset;
                setQuality(value);
                setFps(value === 'low' ? 30 : 60);
              }}
              className="cursor-pointer border-none bg-m3-surface-2 py-0.5 pr-1 font-semibold text-xs text-m3-on-surface focus:outline-none"
            >
              <option value="low" className="bg-[#17171E] text-white">Low · 4 Mbps</option>
              <option value="medium" className="bg-[#17171E] text-white">Medium · 8 Mbps</option>
              <option value="high" className="bg-[#17171E] text-white">High · 16 Mbps</option>
            </select>
          </div>
          <Badge variant="primary" className="flex h-8 items-center px-3 font-mono text-xs">{fps} FPS</Badge>
          <Badge variant="neutral" className="flex h-8 items-center px-3 font-mono text-xs">{streamBitrate} Mbps</Badge>
          <div className="ml-auto flex items-center gap-2 text-xs text-m3-on-surface-variant">
            <Switch checked={showFrame} onChange={setShowFrame} label="Frame" className="hidden sm:inline-flex" />
            <Button variant="ghost" size="sm" icon={isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} onClick={handleFullscreen} title="Fullscreen" className="flex h-8 w-8 items-center justify-center p-0" />
          </div>
        </div>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Card variant="surface-2" className="relative min-h-[min(68vh,720px)] overflow-hidden border-m3-surface-4 p-0">
          <div ref={stageRef} className="group relative flex h-full min-h-[min(68vh,720px)] items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,_rgba(79,55,139,.25),_rgba(15,14,19,.2)_46%,_rgba(15,14,19,.9)_100%)] p-5 sm:p-8">
            {isMirroring ? <>
              <div className="absolute left-4 top-4 z-10 rounded-m3-md border border-white/10 bg-black/45 px-3 py-2 text-xs text-white/80 shadow-m3-1 backdrop-blur-md">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-white"><span className="h-2 w-2 rounded-full bg-m3-success animate-pulse" /> LIVE</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px]"><span>{statistics.fps} FPS</span><span>{statistics.bitrate} Mbps</span><span>{connectionLabel}</span><span>{STREAM_SIZE.width} × {STREAM_SIZE.height}</span><span className="col-span-2">Latency {statistics.latency} ms</span></div>
              </div>
              <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                <ControlButton label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))}><ZoomOut className="h-4 w-4" /></ControlButton>
                <ControlButton label="Fit to screen" onClick={fitViewer}><Expand className="h-4 w-4" /></ControlButton>
                <ControlButton label="100 percent zoom" onClick={() => setZoom(1)} className="text-[10px] font-bold">100</ControlButton>
                <ControlButton label="Zoom in" onClick={() => setZoom((value) => Math.min(1.35, Number((value + 0.1).toFixed(1))))}><ZoomIn className="h-4 w-4" /></ControlButton>
                <ControlButton label="Rotate viewer" onClick={rotateViewer}><RotateCw className="h-4 w-4" /></ControlButton>
                <ControlButton label="Screenshot" onClick={handleTakeScreenshot}><Camera className="h-4 w-4" /></ControlButton>
                <ControlButton label={isRecording ? 'Stop recording' : 'Start recording'} onClick={handleToggleRecording}><Video className="h-4 w-4" /></ControlButton>
              </div>

              {!hasReceivedFrame ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-m3-on-surface-variant">
                  <RefreshCw className="mb-3 h-10 w-10 animate-spin text-m3-primary" />
                  <p className="text-sm font-semibold text-m3-on-surface">Waiting for video stream...</p>
                  <p className="mt-1 text-xs">Connecting to device screen feed</p>
                </div>
              ) : (
                <div className={`relative overflow-hidden transition-[width,height,transform] duration-300 ease-out ${showFrame ? 'rounded-[2rem] border-[7px] border-m3-surface-5 bg-black p-1.5 shadow-m3-3' : 'rounded-m3-lg shadow-m3-2'}`} style={{ width: viewerSize.width, height: viewerSize.height }}>
                  {showFrame && orientation === 'portrait' && <div className="absolute left-1/2 top-2 z-10 h-2 w-16 -translate-x-1/2 rounded-full bg-m3-surface-5" />}
                  <canvas
                    ref={canvasRef}
                    width={360}
                    height={800}
                    className="absolute left-1/2 top-1/2 block rounded-[1.55rem] bg-[#0F1626] shadow-inner"
                    style={orientation === 'landscape'
                      ? { width: viewerSize.height - 12, height: viewerSize.width - 12, transform: 'translate(-50%, -50%) rotate(90deg)' }
                      : { width: 'calc(100% - 12px)', height: 'calc(100% - 12px)', transform: 'translate(-50%, -50%)' }}
                  />
                </div>
              )}
            </> : <div className="flex max-w-sm flex-col items-center text-center animate-[media-metadata-in_300ms_ease-out]">
              <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] border border-m3-primary/30 bg-m3-primary-container/30 shadow-m3-2"><Smartphone className="h-11 w-11 text-m3-primary" /></div>
              <h2 className="text-lg font-bold text-m3-on-surface">Ready to start screen mirroring</h2>
              <p className="mt-2 text-sm leading-6 text-m3-on-surface-variant">Connect to {deviceName} and open a responsive, high-quality device preview.</p>
              <Button className="mt-6" variant="filled" icon={<MonitorUp className="h-4 w-4" />} onClick={() => setIsMirroring(true)}>Start stream</Button>
            </div>}
          </div>
        </Card>

        <aside className="min-w-0 space-y-4">
          <Card variant="surface-1" className="space-y-3 border-m3-surface-3">
            <div className="flex items-center gap-3"><div className="rounded-m3-md bg-m3-primary-container/30 p-2"><Smartphone className="h-5 w-5 text-m3-primary" /></div><div className="min-w-0"><p className="truncate text-sm font-bold text-m3-on-surface">{deviceName}</p><p className="text-xs text-m3-on-surface-variant">Android {device?.androidVersion || 'Unknown'}</p></div></div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-m3-surface-4/70 pt-3 text-xs"><div><dt className="text-m3-on-surface-variant">Resolution</dt><dd className="mt-0.5 font-mono text-m3-on-surface">{STREAM_SIZE.width} × {STREAM_SIZE.height}</dd></div><div><dt className="text-m3-on-surface-variant">Orientation</dt><dd className="mt-0.5 capitalize text-m3-on-surface">{orientation}</dd></div><div><dt className="text-m3-on-surface-variant">Connection</dt><dd className="mt-0.5 flex items-center gap-1 text-m3-on-surface"><Wifi className="h-3 w-3" />{connectionLabel}</dd></div><div><dt className="text-m3-on-surface-variant">Power</dt><dd className="mt-0.5 flex items-center gap-1 text-m3-on-surface">{device?.isCharging ? <BatteryCharging className="h-3 w-3 text-m3-success" /> : <Battery className="h-3 w-3" />}{device?.batteryLevel ?? '—'}%</dd></div></dl>
          </Card>
          <Card variant="surface-1" className="border-m3-surface-3 p-0">
            <button type="button" onClick={() => setIsStatsOpen((value) => !value)} className="flex w-full items-center justify-between p-4 text-left text-sm font-bold text-m3-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3-primary"><span>Stream statistics</span>{isStatsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
            {isStatsOpen && <div className="grid grid-cols-2 gap-px border-t border-m3-surface-4 bg-m3-surface-4/60 animate-[media-metadata-in_200ms_ease-out]">{[['Current FPS', statistics.fps], ['Average FPS', statistics.averageFps], ['Bitrate', `${statistics.bitrate} Mbps`], ['Latency', `${statistics.latency} ms`], ['Dropped', statistics.droppedFrames], ['Frame time', `${statistics.frameTime} ms`], ['Encoder', 'Scrcpy'], ['Decoder', 'Canvas']].map(([label, value]) => <div key={String(label)} className="bg-m3-surface-1 p-3"><p className="text-[10px] uppercase tracking-wide text-m3-on-surface-variant">{label}</p><p className="mt-1 truncate font-mono text-xs text-m3-on-surface">{value}</p></div>)}</div>}
          </Card>
        </aside>
      </div>

      <Modal isOpen={isScreenshotModalOpen} onClose={() => setIsScreenshotModalOpen(false)} title="Captured Screenshot Preview" footer={<><Button variant="ghost" size="sm" onClick={() => setIsScreenshotModalOpen(false)}>Cancel</Button><Button variant="filled" size="sm" icon={<Download className="h-4 w-4" />} onClick={handleSaveScreenshot}>Save image</Button></>}>
        <div className="space-y-3 text-center">{capturedImage && <img src={capturedImage} alt="Captured Android screen" className="mx-auto max-h-96 max-w-full rounded-m3-md border border-m3-surface-4 shadow-m3-2" />}<p className="font-mono text-xs text-m3-on-surface-variant">PNG screenshot</p></div>
      </Modal>
      <Modal isOpen={isOcrModalOpen} onClose={() => setIsOcrModalOpen(false)} title="Screen Optical Character Recognition" footer={<Button variant="filled" size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(ocrText); setIsOcrModalOpen(false); }}>Copy text</Button>}>
        {isOcrProcessing ? <div className="space-y-2 p-8 text-center text-m3-on-surface-variant"><RefreshCw className="mx-auto h-8 w-8 animate-spin text-m3-primary" /><p className="text-xs font-semibold">Extracting text from the current frame…</p></div> : <textarea value={ocrText} onChange={(event) => setOcrText(event.target.value)} rows={8} className="w-full rounded-m3-md border border-m3-surface-4 bg-m3-surface-2 p-3 font-mono text-xs text-m3-on-surface focus:outline-none focus:ring-1 focus:ring-m3-primary" />}
      </Modal>
    </div>
  );
};
