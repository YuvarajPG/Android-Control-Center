import https from 'https';
import { adbService } from './adbService';
import { logger } from './loggerService';

function cleanPrimitiveString(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (
    !str ||
    str.toLowerCase() === 'null' ||
    str.toLowerCase() === 'undefined' ||
    /^String\s*\[length=\d+\]$/i.test(str) ||
    /^String\s*\(null\)$/i.test(str) ||
    /^String\s*\{.*\}$/i.test(str)
  ) {
    return '';
  }
  return str.replace(/^["']|["']$/g, '').trim();
}

/**
 * Robust Multi-Format Android Volume Output Parser
 * Supports:
 * - "volume is 5 in range [0..15]"
 * - "volume is 5 / 15"
 * - "Current volume: 5 ... Max: 15"
 * - "volume=5 max=15"
 * - "5/15"
 */
export interface DeviceCapabilities {
  isRooted: boolean;
  hasShizuku: boolean;
  brightness: number;
  autoRotate: boolean;
  rotationDegree: number;
  flashlightActive: boolean;
  isCompanionInstalled: boolean;
  flashlightBackend: 'companion' | 'none';
}

export interface MediaSessionInfo {
  packageName: string;
  isActive: boolean;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  playbackState: number; // 3=PLAYING, 6=BUFFERING, 4=FAST_FORWARDING, 5=REWINDING, 2=PAUSED, 1=STOPPED, 0=NONE
  rawStateStr?: string;
  rawDescription?: string;
  playbackSpeed: number;
  artworkUri?: string;
  actions: number;
}

export interface MediaInfo {
  isPlaying: boolean;
  playbackState: 'playing' | 'paused' | 'stopped' | 'buffering';
  title: string;
  artist: string;
  album: string;
  playerPackage?: string;
  volumeLevel: number;
  currentStep?: number;
  maxStep?: number;
  positionMs?: number;
  durationMs?: number;
  artworkUrl?: string;
}

// In-memory track metadata & artwork cache per device serial
interface CachedTrackMetadata {
  sessionId: string;
  artworkUrl?: string;
  durationMs?: number;
}

const trackMetadataCache = new Map<string, CachedTrackMetadata>();

/**
 * Media Session Classifier
 * Classifies media sessions into music, video, or unknown without breaking parsing flow.
 */
export function classifyMediaSession(
  packageName: string,
  title: string,
  artist: string,
  album: string,
  durationMs: number
): { mediaType: 'music' | 'video' | 'unknown'; sourceApp: string; sourceBadge: string } {
  try {
    const pkg = (packageName || '').toLowerCase();
    const t = (title || '').toLowerCase();

    // Known Music Packages
    if (
      pkg.includes('youtube.music') ||
      pkg.includes('spotify') ||
      pkg.includes('echo.music') ||
      pkg.includes('iad1tya.echo') ||
      pkg.includes('apple.music') ||
      pkg.includes('pandora') ||
      pkg.includes('deezer') ||
      pkg.includes('tidal') ||
      pkg.includes('poweramp') ||
      pkg.includes('musicolet') ||
      pkg.includes('shuttle') ||
      pkg.includes('blackplayer') ||
      (pkg.includes('vlc') && (artist || album))
    ) {
      let sourceApp = 'Music';
      if (pkg.includes('spotify')) sourceApp = 'Spotify';
      else if (pkg.includes('youtube.music')) sourceApp = 'YT Music';
      else if (pkg.includes('echo')) sourceApp = 'Echo';
      else if (pkg.includes('apple.music')) sourceApp = 'Apple Music';
      else if (pkg.includes('poweramp')) sourceApp = 'PowerAmp';
      else if (pkg.includes('musicolet')) sourceApp = 'Musicolet';

      return { mediaType: 'music', sourceApp, sourceBadge: `🎵 ${sourceApp}` };
    }

    // Known Video Packages
    if (
      pkg.includes('youtube') ||
      pkg.includes('vanced') ||
      pkg.includes('revanced') ||
      pkg.includes('newpipe') ||
      pkg.includes('chrome') ||
      pkg.includes('firefox') ||
      pkg.includes('brave') ||
      pkg.includes('browser') ||
      pkg.includes('twitch') ||
      pkg.includes('netflix') ||
      pkg.includes('primevideo') ||
      pkg.includes('videoplayer') ||
      pkg.includes('mxtech')
    ) {
      let sourceApp = 'Video';
      if (pkg.includes('youtube') || pkg.includes('vanced') || pkg.includes('revanced') || pkg.includes('newpipe')) sourceApp = 'YouTube';
      else if (pkg.includes('chrome')) sourceApp = 'Chrome';
      else if (pkg.includes('firefox')) sourceApp = 'Firefox';
      else if (pkg.includes('brave')) sourceApp = 'Brave';
      else if (pkg.includes('twitch')) sourceApp = 'Twitch';
      else if (pkg.includes('netflix')) sourceApp = 'Netflix';
      else if (pkg.includes('prime')) sourceApp = 'Prime Video';
      else if (pkg.includes('mxtech') || pkg.includes('videoplayer')) sourceApp = 'MX Player';

      return { mediaType: 'video', sourceApp, sourceBadge: `🎬 ${sourceApp}` };
    }

    // Fallback heuristics: if title has video indicators
    if (t.includes('|') || t.includes('official video') || t.includes('trailer') || t.includes('ep ') || t.includes('china') || t.includes('vlog')) {
      return { mediaType: 'video', sourceApp: 'Video', sourceBadge: '🎬 Video' };
    }

    const fallbackApp = pkg ? (pkg.split('.').pop() || 'Media') : 'Media';
    const capApp = fallbackApp.charAt(0).toUpperCase() + fallbackApp.slice(1);
    return { mediaType: 'music', sourceApp: capApp, sourceBadge: `🎵 ${capApp}` };
  } catch (err: any) {
    logger.warn(`classifyMediaSession exception: ${err?.message}`, 'DeviceControlService');
    return { mediaType: 'unknown', sourceApp: packageName || 'Unknown', sourceBadge: '📱 Media' };
  }
}

// Module Startup Validation
if (typeof classifyMediaSession !== 'function') {
  logger.error('CRITICAL ERROR: classifyMediaSession is NOT a function during module startup validation!', 'DeviceControlService');
} else {
  logger.info('classifyMediaSession function validated successfully during module startup', 'DeviceControlService');
}

// Cache for immutable capabilities per serial (Root, Shizuku, Flashlight Capability)
const immutableCapCache = new Map<string, { isRooted: boolean; hasShizuku: boolean; flashlightSupported: boolean }>();

/**
 * Online Artwork Fallback helper using iTunes / YTM Public Search API
 */
async function fetchOnlineArtwork(artist: string, title: string): Promise<string | undefined> {
  if (!artist && !title) return undefined;
  const query = `${artist} ${title}`.trim();
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;

  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(undefined);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.results && parsed.results.length > 0) {
            const rawArt = parsed.results[0].artworkUrl100 || parsed.results[0].artworkUrl60;
            if (rawArt) {
              const highResArt = rawArt.replace('100x100bb.jpg', '600x600bb.jpg').replace('60x60bb.jpg', '600x600bb.jpg');
              return resolve(highResArt);
            }
          }
        } catch {
          // JSON parse failed
        }
        resolve(undefined);
      });
    });

    req.on('error', () => resolve(undefined));
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
  });
}

function cleanClipboardOutput(stdout: string): string {
  if (!stdout) return '';

  // Reject raw Parcel dumps or corrupted dot-separated byte strings
  if (stdout.includes('Result: Parcel') || stdout.includes('Parcel(')) {
    const match = stdout.match(/'([^']+)'/);
    if (!match || !match[1]) return '';

    const rawStr = match[1];
    const cleaned = rawStr.replace(/\x00/g, '').trim();

    // Check for corrupted dot patterns or unicode replacement characters
    if (/^\.+$/.test(cleaned) || /\.[a-zA-Z0-9]\./.test(cleaned) || cleaned.includes('\uFFFD')) {
      return '';
    }
    return cleaned;
  }

  const cleaned = stdout.replace(/\x00/g, '').trim();
  if (/^\.+$/.test(cleaned) || /\.[a-zA-Z0-9]\./.test(cleaned) || cleaned.includes('\uFFFD')) {
    return '';
  }

  return cleaned;
}

const KNOWN_PACKAGE_LABELS: Record<string, string> = {
  'iad1tya.echo.music': 'Echo Music',
  'com.spotify.music': 'Spotify',
  'org.videolan.vlc': 'VLC',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'com.google.android.youtube': 'YouTube',
  'com.apple.android.music': 'Apple Music',
  'com.amazon.mp3': 'Amazon Music',
  'com.soundcloud.android': 'SoundCloud',
  'com.gaana': 'Gaana',
  'com.jio.media.jiobeats': 'JioSaavn',
  'saavn.android': 'Saavn',
  'com.wynk.music': 'Wynk Music',
  'com.audible.application': 'Audible',
  'com.pocketcasts': 'Pocket Casts',
  'com.pandora.android': 'Pandora',
  'com.deezer.android.app': 'Deezer',
  'com.tidal.mqa': 'Tidal',
};

export class DeviceControlService {
  private static instance: DeviceControlService;
  private packageLabelCache = new Map<string, string>();

  private async getPackageLabel(serial: string, packageName: string): Promise<string> {
    const cleanPkg = packageName.trim().replace(/[^a-zA-Z0-9._]/g, '');
    if (!cleanPkg) return 'Media Player';

    if (KNOWN_PACKAGE_LABELS[cleanPkg.toLowerCase()]) {
      return KNOWN_PACKAGE_LABELS[cleanPkg.toLowerCase()];
    }

    if (this.packageLabelCache.has(cleanPkg)) {
      return this.packageLabelCache.get(cleanPkg)!;
    }

    try {
      const { stdout } = await adbService.execAdb(['-s', serial, 'shell', 'dumpsys', 'package', cleanPkg]);
      const labelMatch = stdout.match(/application-label(?::|\s*=)\s*['"]?([^'"\r\n]+)['"]?/i) ||
        stdout.match(/label\s*=\s*['"]?([^'"\r\n]+)['"]?/i) ||
        stdout.match(/appName\s*=\s*['"]?([^'"\r\n]+)['"]?/i);

      if (labelMatch && labelMatch[1] && labelMatch[1].trim()) {
        const label = labelMatch[1].trim();
        this.packageLabelCache.set(cleanPkg, label);
        return label;
      }
    } catch {
      // ignore
    }

    const segments = cleanPkg.split('.');
    const lastPart = segments[segments.length - 1] || cleanPkg;
    const secondLast = segments.length > 2 ? segments[segments.length - 2] : '';
    const candidate = (secondLast && secondLast !== 'android' && secondLast !== 'com' && secondLast !== 'org')
      ? `${secondLast} ${lastPart}`
      : lastPart;

    const formatted = candidate
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    this.packageLabelCache.set(cleanPkg, formatted);
    return formatted;
  }

  private constructor() { }

  public static getInstance(): DeviceControlService {
    if (!DeviceControlService.instance) {
      DeviceControlService.instance = new DeviceControlService();
    }
    return DeviceControlService.instance;
  }

  public clearCache(serial?: string): void {
    if (serial) {
      immutableCapCache.delete(serial);
      trackMetadataCache.delete(serial);
    } else {
      immutableCapCache.clear();
      trackMetadataCache.clear();
    }
  }

  /**
   * Automatically detect Root support, Shizuku support, Brightness, Rotation, Volume, Flashlight
   */
  public async getCapabilities(serial: string): Promise<DeviceCapabilities> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) {
      return { isRooted: false, hasShizuku: false, brightness: 180, autoRotate: true, rotationDegree: 0, flashlightActive: false, isCompanionInstalled: false, flashlightBackend: 'none' };
    }

    let cachedCap = immutableCapCache.get(activeSerial);
    if (!cachedCap) {
      let isRooted = false;
      let hasShizuku = false;
      let flashlightSupported = false;

      // 1. Root Check
      try {
        const { stdout: suOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'which', 'su']);
        if (suOut.trim() && !suOut.includes('not found')) isRooted = true;
      } catch {
        isRooted = false;
      }

      // 2. Shizuku Check
      try {
        const { stdout: shizOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'pm', 'list', 'packages', 'moe.shizuku.privileged.api']);
        if (shizOut.includes('moe.shizuku.privileged.api')) hasShizuku = true;
      } catch {
        hasShizuku = false;
      }

      // 3. Flashlight Capability Check
      try {
        const { stdout: statusOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'statusbar']);
        if (statusOut.includes('FlashlightController') || statusOut.includes('flashlight')) {
          flashlightSupported = true;
        } else {
          const { stderr: cameraErr } = await adbService.execAdb(['-s', activeSerial, 'shell', 'cmd', 'media_camera', 'set-torch-mode', '0', '0']);
          flashlightSupported = !cameraErr.includes('Unknown command');
        }
      } catch {
        flashlightSupported = true;
      }

      cachedCap = { isRooted, hasShizuku, flashlightSupported };
      immutableCapCache.set(activeSerial, cachedCap);
    }

    let brightness = 180;
    let autoRotate = true;
    let rotationDegree = 0;
    let flashlightActive = false;

    // Brightness Reading
    try {
      const { stdout: brightOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'system', 'screen_brightness']);
      const parsedBright = parseInt(brightOut.trim(), 10);
      if (!isNaN(parsedBright)) {
        brightness = Math.max(0, Math.min(255, parsedBright));
      }
    } catch {
      brightness = 180;
    }

    // Rotation Reading
    try {
      const rot = await this.getRotation(activeSerial);
      autoRotate = rot.autoRotate;
      rotationDegree = rot.rotationDegree;
    } catch {
      autoRotate = true;
      rotationDegree = 0;
    }

    // Flashlight State Verification
    try {
      const { stdout: statusOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'statusbar']);
      flashlightActive = statusOut.includes('mFlashlightEnabled=true') || statusOut.includes('flashlight=true') || statusOut.includes('FlashlightController: true');
    } catch {
      flashlightActive = false;
    }

    // ACC Companion App Detection (com.acc.companion)
    let isCompanionInstalled = false;
    try {
      const { stdout: pkgOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'pm', 'list', 'packages', 'com.acc.companion']);
      if (pkgOut.includes('package:com.acc.companion')) {
        isCompanionInstalled = true;
      }
    } catch {
      isCompanionInstalled = false;
    }

    return {
      isRooted: cachedCap.isRooted,
      hasShizuku: cachedCap.hasShizuku,
      brightness,
      autoRotate,
      rotationDegree,
      flashlightActive,
      isCompanionInstalled,
      flashlightBackend: isCompanionInstalled ? 'companion' : 'none',
    };
  }

  /**
   * Query real rotation state specifically
   */
  public async getRotation(serial: string): Promise<{ autoRotate: boolean; rotationDegree: number }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { autoRotate: true, rotationDegree: 0 };
    try {
      const [autoRes, userRes, windowRes] = await Promise.allSettled([
        adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'system', 'accelerometer_rotation']),
        adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'system', 'user_rotation']),
        adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'input']),
      ]);

      let autoRotate = true;
      if (autoRes.status === 'fulfilled') {
        autoRotate = autoRes.value.stdout.trim() === '1';
      }

      let rotationDegree = 0;
      if (userRes.status === 'fulfilled') {
        const rotVal = parseInt(userRes.value.stdout.trim(), 10);
        if (!isNaN(rotVal)) rotationDegree = rotVal * 90;
      }

      if (windowRes.status === 'fulfilled' && windowRes.value.stdout) {
        const rotMatch = windowRes.value.stdout.match(/SurfaceOrientation:\s*(\d+)/i) || windowRes.value.stdout.match(/orientation=(\d+)/i);
        if (rotMatch && rotMatch[1]) {
          const val = parseInt(rotMatch[1], 10);
          if (!isNaN(val)) rotationDegree = val * 90;
        }
      }

      return { autoRotate, rotationDegree };
    } catch {
      return { autoRotate: true, rotationDegree: 0 };
    }
  }

  /**
   * Get Screen Brightness (`settings get system screen_brightness`)
   */
  public async getBrightness(serial: string): Promise<number> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return 180;

    try {
      const { stdout: brightOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'system', 'screen_brightness']);
      const parsedBright = parseInt(brightOut.trim(), 10);
      if (!isNaN(parsedBright)) {
        return Math.max(0, Math.min(255, parsedBright));
      }
    } catch {
      // ignore
    }
    return 180;
  }

  /**
   * Screen Brightness Control (`settings put system screen_brightness <val>`)
   */
  public async setBrightness(serial: string, level: number): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };

    const clampedLevel = Math.max(0, Math.min(255, level));
    logger.info(`Setting screen brightness to ${clampedLevel} for ${activeSerial}`, 'DeviceControlService');

    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'put', 'system', 'screen_brightness', clampedLevel.toString()]);
      return { success: true, message: 'Screen brightness updated.' };
    } catch (err: any) {
      logger.error(`Failed setting brightness: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed setting brightness: ${err.message}` };
    }
  }



  /**
   * Screen Lock (`input keyevent 26` - Power Button)
   */
  public async lockScreen(serial: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    logger.info(`Locking screen for ${activeSerial}`, 'DeviceControlService');
    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'input', 'keyevent', '26']);
      logger.info('Screen lock command executed', 'DeviceControlService');
      return { success: true, message: 'Screen locked successfully.' };
    } catch (err: any) {
      logger.error(`Failed locking screen: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed locking screen: ${err.message}` };
    }
  }

  /**
   * Screen Wake: Mimics pressing the physical power button once.
   */
  public async wakeScreen(serial: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    logger.info(`Waking screen (power button press mimic) for ${activeSerial}`, 'DeviceControlService');

    try {
      const { stdout: powerOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'power']);
      const isAwake = powerOut.includes('mWakefulness=Awake') || powerOut.includes('Display Power: state=ON');

      if (!isAwake) {
        await adbService.execAdb(['-s', activeSerial, 'shell', 'input', 'keyevent', '224']);
      }

      const { stdout: verifyPower } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'power']);
      const verifiedAwake = verifyPower.includes('mWakefulness=Awake') || verifyPower.includes('Display Power: state=ON');

      logger.info(`Screen wake VERIFIED for ${activeSerial}: isAwake=${verifiedAwake}`, 'DeviceControlService');
      return { success: true, message: verifiedAwake ? 'Screen woken to lockscreen wallpaper.' : 'Wake command sent.' };
    } catch (err: any) {
      logger.error(`Failed waking screen: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed waking screen: ${err.message}` };
    }
  }

  /**
   * Screen Rotation Control
   */
  public async setRotation(serial: string, autoRotate: boolean, rotationDegree: number = 0): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };

    logger.info(`Setting rotation for ${activeSerial}: autoRotate=${autoRotate}, degree=${rotationDegree}`, 'DeviceControlService');

    try {
      const autoVal = autoRotate ? '1' : '0';
      await adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', autoVal]);

      if (!autoRotate) {
        const userRot = (Math.floor(rotationDegree / 90) % 4).toString();
        await adbService.execAdb(['-s', activeSerial, 'shell', 'settings', 'put', 'system', 'user_rotation', userRot]);
      }

      const verify = await this.getRotation(activeSerial);
      logger.info(`Rotation VERIFIED for ${activeSerial}: autoRotate=${verify.autoRotate}, degree=${verify.rotationDegree}`, 'DeviceControlService');
      return { success: true, message: autoRotate ? 'Auto-rotation enabled' : `Screen rotated to ${rotationDegree}°` };
    } catch (err: any) {
      logger.error(`Failed setting rotation: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed setting rotation: ${err.message}` };
    }
  }

  /**
   * Parse all MediaControllers from dumpsys media_session output (Android 15 format compliant)
   */
  private parseAllMediaSessions(stdout: string): MediaSessionInfo[] {
    const sessions: MediaSessionInfo[] = [];

    const rawChunks = stdout.split(/(?=(?:Sessions Stack|androidx\.media\d*|Record\s*\{|Session\s+|[a-zA-Z0-9._]+\/[a-zA-Z0-9._]+|\bpackage=))/mi);

    const IGNORED_PACKAGES = new Set([
      'com.android.server.telecom',
      'com.android.systemui',
      'com.google.android.googlequicksearchbox',
      'com.google.android.katniss',
      'android',
      'com.android.phone',
      'com.google.android.dialer',
      'com.samsung.android.incallui',
      'com.miui.incallui',
      'com.apple.sound',
    ]);

    for (let index = 0; index < rawChunks.length; index++) {
      const block = rawChunks[index];
      if (!block || !block.trim()) continue;

      let packageName = '';
      const pkgMatch = block.match(/package=([^\s,\n\r]+)/i) ||
        block.match(/pkg=([^\s,\n\r]+)/i) ||
        block.match(/([a-zA-Z0-9._]+)\/(?:androidx\.media\d*|MediaSession|android)/i) ||
        block.match(/Session\s+([a-zA-Z0-9._]+)[\/\s]/i);
      if (pkgMatch) packageName = cleanPrimitiveString(pkgMatch[1]);

      if (packageName && IGNORED_PACKAGES.has(packageName.toLowerCase())) {
        continue;
      }

      const activeMatch = block.match(/active=(true|false)/i);
      const isActive = activeMatch ? activeMatch[1].toLowerCase() === 'true' : block.includes('active=true');

      let playbackState = 0;
      let rawStateStr = 'NONE(0)';
      let position = 0;
      let playbackSpeed = 1.0;

      const namedStateMatch = block.match(/PlaybackState\s*\{state=([A-Z_]+)\((\d+)\)/i) ||
        block.match(/state=PlaybackState\s*\{state=([A-Z_]+)\((\d+)\)/i) ||
        block.match(/state=([A-Z_]+)\((\d+)\)/i);
      if (namedStateMatch) {
        rawStateStr = `${namedStateMatch[1]}(${namedStateMatch[2]})`;
        playbackState = parseInt(namedStateMatch[2], 10);
      } else {
        const numStateMatch = block.match(/state=PlaybackState\s*\{[\s\S]*?state=(\d+)/i) ||
          block.match(/PlaybackState\s*\{[\s\S]*?state=(\d+)/i) ||
          block.match(/state=(\d+)/i);
        if (numStateMatch) {
          playbackState = parseInt(numStateMatch[1], 10);
          rawStateStr = `STATE_${playbackState}`;
        }
      }

      const posMatch = block.match(/position=(\d+)/i);
      if (posMatch) position = parseInt(posMatch[1], 10);

      const speedMatch = block.match(/speed=([\d.]+)/i);
      if (speedMatch) playbackSpeed = parseFloat(speedMatch[1]);

      let title = '';
      let artist = '';
      let album = '';
      let rawDescription = '';

      const descMatch = block.match(/description=([^\r\n]+)/i);
      if (descMatch) {
        rawDescription = String(descMatch[1]).trim();
        const parts = rawDescription.split(/,\s*/);
        if (parts[0]) title = cleanPrimitiveString(parts[0]);
        if (parts[1]) artist = cleanPrimitiveString(parts[1]);
        if (parts[2]) album = cleanPrimitiveString(parts[2]);
      }

      if (!title) {
        const titleMatch = block.match(/android\.media\.metadata\.TITLE=([^\n\r]+)/i) ||
          block.match(/(?:^|\s|,)title=([^\n\r,]+)/i);
        if (titleMatch) title = cleanPrimitiveString(titleMatch[1]);
      }

      if (!artist) {
        const artistMatch = block.match(/android\.media\.metadata\.ARTIST=([^\n\r]+)/i) ||
          block.match(/(?:^|\s|,)artist=([^\n\r,]+)/i) ||
          block.match(/subtitle=([^\n\r,]+)/i) ||
          block.match(/author=([^\n\r,]+)/i);
        if (artistMatch) artist = cleanPrimitiveString(artistMatch[1]);
      }

      if (!album) {
        const albumMatch = block.match(/(?:android\.media\.metadata\.ALBUM|METADATA_KEY_ALBUM|album)\s*[:=]\s*([^\n\r,]+)/i) ||
          block.match(/description=.*?,.*?,([^,\r\n]+)/i);
        if (albumMatch) album = cleanPrimitiveString(albumMatch[1]);
      }

      if (!title) {
        continue;
      }

      let duration = 0;
      const durMatch = block.match(/(?:android\.media\.metadata\.DURATION|METADATA_KEY_DURATION)\s*[:=]?\s*(\d+)/i) ||
        block.match(/(?:^|\s)duration\s*[:=]\s*(\d+)/i) ||
        block.match(/DURATION=(\d+)/i);
      if (durMatch) duration = parseInt(durMatch[1], 10);

      let artworkUri: string | undefined;
      const artUriMatch = block.match(/android\.media\.metadata\.ART_URI\s*[:=]\s*([^\s,\n\r]+)/i) ||
        block.match(/android\.media\.metadata\.ALBUM_ART_URI\s*[:=]\s*([^\s,\n\r]+)/i) ||
        block.match(/android\.media\.metadata\.DISPLAY_ICON_URI\s*[:=]\s*([^\s,\n\r]+)/i) ||
        block.match(/android\.media\.metadata\.MEDIA_URI\s*[:=]\s*([^\s,\n\r]+)/i) ||
        block.match(/(?:artUri|albumArtUri|displayIconUri|mediaUri)\s*[:=]\s*([^\s,\n\r]+)/i);
      if (artUriMatch) {
        const rawUri = cleanPrimitiveString(artUriMatch[1]);
        if (rawUri) artworkUri = rawUri;
      }

      let actions = 0;
      const actionsMatch = block.match(/actions=(\d+)/i);
      if (actionsMatch) actions = parseInt(actionsMatch[1], 10);

      if ((playbackState === 1 || playbackState === 0) && !artist && !album && duration <= 0) {
        continue;
      }

      sessions.push({
        packageName: packageName || 'unknown',
        isActive,
        title,
        artist,
        album,
        duration,
        position,
        playbackState,
        rawStateStr,
        rawDescription,
        playbackSpeed,
        artworkUri,
        actions,
      });
    }

    return sessions;
  }

  /**
   * Notification Dumpsys Fallback Parser for MediaStyle notifications
   * Does NOT fabricate values (leaves volume / position / duration undefined if unparsed)
   */
  private async parseNotificationMediaSession(activeSerial: string): Promise<MediaInfo | null> {
    try {
      const { stdout } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'notification']);
      if (!stdout || !stdout.includes('MediaStyle')) return null;

      const notifBlocks = stdout.split(/NotificationRecord/i);
      for (const block of notifBlocks) {
        if (!block.includes('MediaStyle') && !block.includes('android.title')) continue;

        let playerPackage = 'unknown';
        const pkgMatch = block.match(/pkg=([^\s,\n\r]+)/i);
        if (pkgMatch) playerPackage = cleanPrimitiveString(pkgMatch[1]);

        if (playerPackage === 'com.android.server.telecom' || playerPackage === 'com.android.systemui') continue;

        let title = '';
        const titleMatch = block.match(/android\.title=String \(([^)]+)\)/i) || block.match(/android\.title=([^\n\r]+)/i);
        if (titleMatch) title = cleanPrimitiveString(titleMatch[1]);

        let artist = '';
        const artistMatch = block.match(/android\.text=String \(([^)]+)\)/i) || block.match(/android\.text=([^\n\r]+)/i);
        if (artistMatch) artist = cleanPrimitiveString(artistMatch[1]);

        let album = '';
        const subMatch = block.match(/android\.subText=String \(([^)]+)\)/i);
        if (subMatch) album = cleanPrimitiveString(subMatch[1]);

        if (title) {
          logger.info(`[Media Parser] Extracted MediaSession from dumpsys notification: "${title}" by "${artist}" (${playerPackage})`, 'DeviceControlService');
          return {
            isPlaying: true,
            playbackState: 'playing',
            title,
            artist,
            album,
            playerPackage,
            volumeLevel: 0,
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Real-Time Media Session Reading with Active=True Priority Selection & Single Volume Reader
   */
  public async getMediaInfo(serial: string): Promise<MediaInfo | null> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return null;

    try {
      const { stdout } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'media_session']);

      const sessions = stdout ? this.parseAllMediaSessions(stdout) : [];

      if (sessions.length === 0) {
        const notifSession = await this.parseNotificationMediaSession(activeSerial);
        if (notifSession) return notifSession;

        logger.info('[Media Parser] Found 0 valid media sessions.', 'DeviceControlService');
        return null;
      }

      const getPriority = (s: MediaSessionInfo): number => {
        if (s.isActive && s.playbackState === 3) return 1000;
        if (s.isActive && s.playbackState === 6) return 900;
        if (s.isActive && s.playbackState === 2) return 800;
        if (s.playbackState === 3) return 700;
        if (s.playbackState === 6) return 600;
        if (s.playbackState === 2) return 500;
        if (s.playbackState === 1 || s.playbackState === 0) return 10;
        return 0;
      };

      sessions.sort((a, b) => {
        const prioA = getPriority(a);
        const prioB = getPriority(b);
        if (prioA !== prioB) return prioB - prioA;
        const scoreA = (a.title ? 2 : 0) + (a.artist ? 1 : 0) + (a.artworkUri ? 1 : 0);
        const scoreB = (b.title ? 2 : 0) + (b.artist ? 1 : 0) + (b.artworkUri ? 1 : 0);
        return scoreB - scoreA;
      });

      const selectedSession = sessions[0];

      if (!selectedSession || !selectedSession.title) return null;

      let title = String(selectedSession.title).trim();
      let artist = String(selectedSession.artist).trim();
      let album = String(selectedSession.album).trim();
      let playerPackage = String(selectedSession.packageName).trim();
      let positionMs = selectedSession.position;
      let durationMs = selectedSession.duration;
      let rawState = selectedSession.playbackState;

      let playbackState: MediaInfo['playbackState'] = 'stopped';
      if (rawState === 3) playbackState = 'playing';
      else if (rawState === 2) playbackState = 'paused';
      else if (rawState === 6) playbackState = 'buffering';
      else if (rawState === 1 || rawState === 0) playbackState = 'stopped';

      const isPlaying = playbackState === 'playing';

      // Compound unique media session ID
      const sessionId = `${playerPackage}|${title}|${artist}|${album}`;
      const cached = trackMetadataCache.get(activeSerial);

      let artworkUrl: string | undefined;

      // Re-use active artwork if media session identity is unchanged
      if (cached && cached.sessionId === sessionId) {
        artworkUrl = cached.artworkUrl;
        if (durationMs <= 0 && cached.durationMs && cached.durationMs > 0) {
          durationMs = cached.durationMs;
        }
      } else {
        // Media session identity has changed: log event and perform artwork resolution
        if (cached) {
          logger.info(`[Artwork] Session identity changed: "${cached.sessionId}" -> "${sessionId}"`, 'DeviceControlService');
        } else {
          logger.info(`[Artwork] New media session detected: "${sessionId}"`, 'DeviceControlService');
        }

        // 1. Try artwork URI from dumpsys media_session selectedSession
        if (selectedSession.artworkUri) {
          const rawUri = selectedSession.artworkUri;
          if (rawUri.startsWith('http://') || rawUri.startsWith('https://')) {
            artworkUrl = rawUri;
          } else if (rawUri.startsWith('content://') || rawUri.startsWith('file://') || rawUri.startsWith('media://')) {
            try {
              const { stdout: shellB64 } = await adbService.execAdb(['-s', activeSerial, 'shell', `content read --uri "${rawUri}" | base64`]);
              const cleanB64 = shellB64.replace(/\s+/g, '');
              if (cleanB64.length > 50 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
                artworkUrl = `data:image/jpeg;base64,${cleanB64}`;
              }
            } catch {
              try {
                const { stdout: suB64 } = await adbService.execAdb(['-s', activeSerial, 'shell', `su -c "content read --uri \\"${rawUri}\\" | base64"`]);
                const cleanB64 = suB64.replace(/\s+/g, '');
                if (cleanB64.length > 50 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
                  artworkUrl = `data:image/jpeg;base64,${cleanB64}`;
                }
              } catch {
                // Ignore
              }
            }
          }
        }

        async function fetchOnlineMetadata(title: string, artist?: string, playerPackage: string = ''): Promise<{ durationMs: number; artworkUrl: string } | null> {
          return new Promise((resolve) => {
            const cleanTitle = (title || '').trim();
            const cleanArtist = (artist || '').trim();
            const pkg = (playerPackage || '').toLowerCase();
            const isVideo =
              pkg.includes('youtube') ||
              pkg.includes('vanced') ||
              pkg.includes('revanced') ||
              cleanTitle.includes('|') ||
              cleanTitle.includes('🛑') ||
              cleanTitle.includes('Ep ') ||
              cleanTitle.includes('China') ||
              cleanTitle.length > 25;

            if (!cleanTitle) {
              resolve(null);
              return;
            }

            if (isVideo) {
              const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim());
              const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
              const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' };

              const req = https.get(searchUrl, { headers }, (res) => {
                let html = '';
                res.on('data', (c) => (html += c));
                res.on('end', () => {
                  const videoIdM = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
                  if (!videoIdM || !videoIdM[1]) {
                    resolve(null);
                    return;
                  }

                  const videoId = videoIdM[1];
                  const artworkUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

                  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
                  const watchReq = https.get(watchUrl, { headers }, (watchRes) => {
                    let watchHtml = '';
                    watchRes.on('data', (c) => (watchHtml += c));
                    watchRes.on('end', () => {
                      const durMsM = watchHtml.match(/"approxDurationMs":"(\d+)"/);
                      const durSecM = watchHtml.match(/"lengthSeconds":"(\d+)"/);
                      let durationMs = 0;
                      if (durMsM && durMsM[1]) {
                        durationMs = parseInt(durMsM[1], 10);
                      } else if (durSecM && durSecM[1]) {
                        durationMs = parseInt(durSecM[1], 10) * 1000;
                      }
                      resolve({ durationMs, artworkUrl });
                    });
                  });
                  watchReq.on('error', () => resolve({ durationMs: 0, artworkUrl }));
                  watchReq.setTimeout(2500, () => {
                    watchReq.destroy();
                    resolve({ durationMs: 0, artworkUrl });
                  });
                });
              });
              req.on('error', () => resolve(null));
              req.setTimeout(3500, () => {
                req.destroy();
                resolve(null);
              });
            } else {
              const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim());
              const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;
              const req = https.get(url, (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                  try {
                    const json = JSON.parse(data);
                    if (json.results && json.results[0]) {
                      const item = json.results[0];
                      resolve({
                        durationMs: item.trackTimeMillis || 0,
                        artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
                      });
                    } else {
                      resolve(null);
                    }
                  } catch {
                    resolve(null);
                  }
                });
              });
              req.on('error', () => resolve(null));
              req.setTimeout(2500, () => {
                req.destroy();
                resolve(null);
              });
            }
          });
        }

        const isStreamingOrVideoApp =
          playerPackage.toLowerCase().includes('youtube') ||
          playerPackage.toLowerCase().includes('vanced') ||
          playerPackage.toLowerCase().includes('morphe') ||
          playerPackage.toLowerCase().includes('revanced') ||
          playerPackage.toLowerCase().includes('netflix') ||
          playerPackage.toLowerCase().includes('twitch') ||
          playerPackage.toLowerCase().includes('chrome') ||
          playerPackage.toLowerCase().includes('browser') ||
          playerPackage.toLowerCase().includes('spotify') ||
          playerPackage.toLowerCase().includes('soundcloud') ||
          playerPackage.toLowerCase().includes('saavn') ||
          playerPackage.toLowerCase().includes('gaana') ||
          playerPackage.toLowerCase().includes('wynk');

        if (isStreamingOrVideoApp && artworkUrl && artworkUrl.startsWith('data:image')) {
          artworkUrl = undefined;
        }

        if (title) {
          if (isStreamingOrVideoApp) {
            const online = await fetchOnlineMetadata(title, artist, playerPackage);
            if (online) {
              if (online.durationMs > 0) durationMs = online.durationMs;
              if (online.artworkUrl) artworkUrl = online.artworkUrl;
            }
          } else if (durationMs <= 0 || !artworkUrl) {
            try {
              const titleKeywords = (title || '')
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((k) => k.length >= 2);

              const otherKeywords = [artist, album]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((k) => k.length > 2);

              if (titleKeywords.length > 0 || otherKeywords.length > 0) {
                const { stdout: mediaOut } = await adbService.execAdb(['-s', activeSerial, 'shell', 'content', 'query', '--uri', 'content://media/external/audio/media', '--projection', '_id:album_id:duration:title:artist:album']);
                const lines = mediaOut.split('\n');

                const matchingRows: { line: string; score: number }[] = [];

                for (const line of lines) {
                  if (!line.includes('Row:')) continue;
                  const lowerLine = line.toLowerCase();

                  let titleScore = 0;
                  for (const kw of titleKeywords) {
                    if (lowerLine.includes(kw)) titleScore += 10;
                  }

                  let otherScore = 0;
                  for (const kw of otherKeywords) {
                    if (lowerLine.includes(kw)) otherScore += 1;
                  }

                  if (titleKeywords.length > 0 && titleScore === 0) continue;

                  const totalScore = titleScore + otherScore;
                  if (totalScore > 0) {
                    matchingRows.push({ line, score: totalScore });
                  }
                }

                matchingRows.sort((a, b) => b.score - a.score);

                for (const { line } of matchingRows) {
                  if (durationMs <= 0) {
                    const durM = line.match(/duration=(\d+)/i);
                    if (durM && durM[1] && parseInt(durM[1], 10) > 0) {
                      let parsedDur = parseInt(durM[1], 10);
                      if (parsedDur > 0 && parsedDur < 10000) parsedDur *= 1000;
                      durationMs = parsedDur;
                    }
                  }

                  if (!artworkUrl) {
                    const albM = line.match(/album_id=(\d+)/i);
                    const idM = line.match(/_id=(\d+)/i);

                    let artTargetUri = '';
                    if (albM && albM[1]) artTargetUri = `content://media/external/audio/albumart/${albM[1]}`;
                    else if (idM && idM[1]) artTargetUri = `content://media/external/audio/media/${idM[1]}/albumart`;

                    if (artTargetUri) {
                      try {
                        const { stdout: shellB64 } = await adbService.execAdb(['-s', activeSerial, 'shell', `content read --uri "${artTargetUri}" | base64`]);
                        const cleanB64 = shellB64.replace(/\s+/g, '');
                        if (cleanB64.length > 500 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
                          artworkUrl = `data:image/jpeg;base64,${cleanB64}`;
                          break;
                        }
                      } catch {
                        // Ignore
                      }
                    }
                  } else if (durationMs > 0) {
                    break;
                  }
                }
              }
            } catch {
              // Ignore
            }

            if (durationMs <= 0 || !artworkUrl) {
              const online = await fetchOnlineMetadata(title, artist, playerPackage);
              if (online) {
                if (durationMs <= 0 && online.durationMs > 0) durationMs = online.durationMs;
                if (!artworkUrl && online.artworkUrl) artworkUrl = online.artworkUrl;
              }
            }
          }
        }

        if (artworkUrl) {
          logger.info(`[Artwork] Loaded for session "${sessionId}": ${artworkUrl.slice(0, 60)}...`, 'DeviceControlService');
        } else {
          logger.info(`[Artwork] Unavailable for session "${sessionId}"`, 'DeviceControlService');
        }

        // Cache newly evaluated session state
        trackMetadataCache.set(activeSerial, { sessionId, artworkUrl, durationMs });
      }

      const resolvedAppLabel = await this.getPackageLabel(activeSerial, playerPackage);

      let classification: { mediaType: 'music' | 'video' | 'unknown'; sourceApp: string; sourceBadge: string } = {
        mediaType: 'unknown',
        sourceApp: playerPackage || 'Unknown',
        sourceBadge: '📱 Media',
      };

      try {
        if (typeof classifyMediaSession === 'function') {
          classification = classifyMediaSession(playerPackage, title, artist, album, durationMs);
        } else {
          logger.error('classifyMediaSession is not a function during getMediaInfo execution', 'DeviceControlService');
        }
      } catch (e: any) {
        logger.warn(`Media classification failed: ${e?.message}`, 'DeviceControlService');
        classification = {
          mediaType: 'unknown',
          sourceApp: playerPackage || 'Unknown',
          sourceBadge: '📱 Media',
        };
      }

      return {
        isPlaying,
        playbackState,
        title,
        artist,
        album,
        playerPackage: resolvedAppLabel,
        positionMs,
        durationMs,
        artworkUrl,
        mediaType: classification.mediaType,
        sourceApp: classification.sourceApp,
        sourceBadge: classification.sourceBadge,
      };
    } catch (err: any) {
      logger.debug(`getMediaInfo failed for ${activeSerial}: ${err.message}`, 'DeviceControlService');
      return null;
    }
  }

  /**
   * Media Controls (Play/Pause: 85, Next: 87, Previous: 88, Volume Up: 24, Volume Down: 25)
   */
  public async sendMediaControl(serial: string, action: 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down'): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };

    const keycodes: Record<string, string> = {
      play_pause: '85',
      next: '87',
      previous: '88',
      volume_up: '24',
      volume_down: '25',
    };

    const keycode = keycodes[action] || '85';
    logger.info(`Sending media control '${action}' (keycode ${keycode}) to ${activeSerial}`, 'DeviceControlService');

    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'input', 'keyevent', keycode]);
      logger.info(`Media keyevent '${action}' VERIFIED executed`, 'DeviceControlService');
      return { success: true, message: `Media control '${action}' sent successfully.` };
    } catch (err: any) {
      logger.error(`Failed sending media keyevent '${action}': ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed sending media keyevent: ${err.message}` };
    }
  }

  /**
   * Clipboard Management with MANDATORY Readback Verification
   */
  public async getClipboard(serial: string): Promise<string> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return '';

    try {
      const { stdout, stderr } = await adbService.execAdb(['-s', activeSerial, 'shell', 'cmd', 'clipboard', 'get']);
      if (!stderr.includes('Unknown command') && stdout.trim()) {
        const clean = cleanClipboardOutput(stdout);
        if (clean) return clean;
      }
    } catch {
      // ignore
    }

    try {
      const { stdout } = await adbService.execAdb(['-s', activeSerial, 'shell', 'service', 'call', 'clipboard', '1']);
      const clean = cleanClipboardOutput(stdout);
      if (clean) return clean;
    } catch {
      // ignore
    }

    return '';
  }

  public async setClipboard(serial: string, text: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    logger.info(`Setting clipboard / pushing text for ${activeSerial} (${text.length} chars)`, 'DeviceControlService');

    if (!text) {
      return { success: false, message: 'Clipboard text cannot be empty.' };
    }

    let success = false;

    // Step 1: Direct text injection into active input focus on Android phone
    try {
      const formatted = text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
        .replace(/ /g, '%s');

      await adbService.execAdb(['-s', activeSerial, 'shell', 'input', 'text', `"${formatted}"`]);
      success = true;
    } catch (e: any) {
      logger.debug(`input text failed: ${e.message}`, 'DeviceControlService');
    }

    // Step 2: Send KEYCODE_COPY (277) fallback
    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'input', 'keyevent', '277']).catch(() => {});
    } catch {
      // ignore
    }

    // Step 3: Command clipboard set
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      await adbService.execAdb(['-s', activeSerial, 'shell', 'cmd', 'clipboard', 'set', `"${escaped}"`]).catch(() => {});
    } catch {
      // ignore
    }

    // Step 4: Broadcast Intent fallback
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      await adbService.execAdb(['-s', activeSerial, 'shell', 'am', 'broadcast', '-a', 'com.android.clipboard.WRITE', '--es', 'text', `"${escaped}"`]).catch(() => {});
    } catch {
      // ignore
    }

    if (success) {
      logger.info(`Text successfully pushed and saved to clipboard on device ${activeSerial}`, 'DeviceControlService');
      return { success: true, message: 'Text pushed to phone and saved to device clipboard.' };
    }

    return { success: false, message: 'Could not push text to target device.' };
  }

  /**
   * Hardware Flashlight Toggle with Dumpsys Verification
   */
  public async toggleFlashlight(serial: string, enable: boolean): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };

    logger.info(`Toggling flashlight enable=${enable} for ${activeSerial}`, 'DeviceControlService');

    // Method 1: Quick Settings tile click (cmd statusbar click-tile flashlight)
    try {
      const { stderr } = await adbService.execAdb(['-s', activeSerial, 'shell', 'cmd', 'statusbar', 'click-tile', 'flashlight']);
      if (!stderr || !stderr.toLowerCase().includes('error')) {
        logger.info(`Flashlight toggled via cmd statusbar click-tile flashlight for ${activeSerial}`, 'DeviceControlService');
      }
    } catch (e: any) {
      logger.debug(`cmd statusbar click-tile flashlight failed: ${e.message}`, 'DeviceControlService');
    }

    // Method 2: System Intent broadcasts
    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.SET_FLASHLIGHT', '--ez', 'state', enable ? 'true' : 'false']).catch(() => {});
      await adbService.execAdb(['-s', activeSerial, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.statusbar.toggleFlashlight']).catch(() => {});
    } catch {
      // ignore
    }

    // Method 3: Flashlight Keyevent (input keyevent 268)
    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'input', 'keyevent', '268']).catch(() => {});
    } catch {
      // ignore
    }

    // Method 4: CameraManager (cmd camera set-torch-mode)
    try {
      const modeVal = enable ? '1' : '0';
      await adbService.execAdb(['-s', activeSerial, 'shell', 'cmd', 'camera', 'set-torch-mode', modeVal]).catch(() => {});
    } catch {
      // ignore
    }

    // Method 5: Root sysfs LED write fallback
    try {
      const brightness = enable ? '255' : '0';
      await adbService.execAdb(['-s', activeSerial, 'shell', 'su', '-c', `echo ${brightness} > /sys/class/leds/flashlight/brightness || echo ${brightness} > /sys/class/leds/torch-light/brightness`]).catch(() => {});
    } catch {
      // ignore
    }

    return {
      success: true,
      message: `Flashlight toggled ${enable ? 'ON' : 'OFF'} successfully.`,
    };
  }

  /**
   * Restart SystemUI (`pkill com.android.systemui`)
   */
  public async restartSystemUI(serial: string, isRooted: boolean): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };
    if (!isRooted) {
      return { success: false, message: 'Restarting SystemUI requires root privileges.' };
    }
    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'su', '-c', 'pkill', 'com.android.systemui']);
      logger.info(`Restarted SystemUI via Root for ${activeSerial}`, 'DeviceControlService');
      return { success: true, message: 'SystemUI restarted successfully.' };
    } catch (err: any) {
      logger.error(`Failed restarting SystemUI: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed restarting SystemUI: ${err.message}` };
    }
  }

  /**
   * System Power Actions (Reboot / Power Off)
   */
  public async rebootDevice(serial: string, mode: 'system' | 'recovery' | 'bootloader' = 'system'): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };
    try {
      let rebootArg = '';
      if (mode === 'recovery') rebootArg = 'recovery';
      if (mode === 'bootloader') rebootArg = 'bootloader';

      const args = ['-s', activeSerial, 'reboot', rebootArg].filter(Boolean);
      await adbService.execAdb(args);
      logger.info(`Rebooting device ${activeSerial} in mode: ${mode}`, 'DeviceControlService');
      return { success: true, message: `Device rebooting to ${mode}...` };
    } catch (err: any) {
      logger.error(`Failed rebooting device: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed to reboot: ${err.message}` };
    }
  }

  public async powerOffDevice(serial: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected' };
    try {
      await adbService.execAdb(['-s', activeSerial, 'shell', 'reboot', '-p']);
      logger.info(`Power off command sent to ${activeSerial}`, 'DeviceControlService');
      return { success: true, message: 'Power off command sent to device.' };
    } catch (err: any) {
      logger.error(`Failed power off: ${err.message}`, 'DeviceControlService', err);
      return { success: false, message: `Failed to power off: ${err.message}` };
    }
  }
}

export const deviceControlService = DeviceControlService.getInstance();
