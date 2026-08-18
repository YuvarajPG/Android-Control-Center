import { SystemInfo, AppVersionInfo, AdbCheckResult, AdbCommandResult } from '../types/electron';
import { AndroidDevice } from '../types/device';
import { AppSettings } from '../store/useSettingsStore';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: string;
  sizeBytes: number;
  modified: string;
  permissions: string;
  owner: string;
  group: string;
}

export interface FileListResult {
  currentPath: string;
  items: FileItem[];
}

export interface AppItem {
  id: string;
  packageName: string;
  label: string;
  apkPath: string;
  isSystem: boolean;
  versionName: string;
  permissions: string[];
  iconUrl?: string;
}

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

export interface MediaInfo {
  isPlaying: boolean;
  playbackState?: 'playing' | 'paused' | 'stopped' | 'buffering' | string;
  title: string;
  artist: string;
  album: string;
  playerPackage?: string;
  volumeLevel: number;
  positionMs?: number;
  durationMs?: number;
  artworkUrl?: string;
  mediaType?: 'music' | 'video' | 'unknown';
  sourceApp?: string;
  sourceBadge?: string;
}

export interface ScreenshotResult {
  success: boolean;
  base64Image: string;
  filePath?: string;
  message: string;
}

export interface RecordResult {
  success: boolean;
  filePath?: string;
  message: string;
}

export interface SystemPropertyItem {
  key: string;
  value: string;
}

export interface LogcatEntry {
  id: string;
  timestamp: string;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  pid: string;
  message: string;
}

/**
 * Client-side IPC bridge wrapper ensuring modular type-safety between React renderer
 * and Electron main process handlers.
 */
export const ipcService = {
  isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.electron?.ipcRenderer);
  },

  async invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
    if (this.isAvailable() && window.electron) {
      console.log(`[IPC TRACE -> MAIN] Invoking channel: '${channel}'`, payload !== undefined ? payload : '');
      try {
        const result = await window.electron.ipcRenderer.invoke<T>(channel, payload);
        console.log(`[IPC TRACE <- MAIN] Response for '${channel}':`, result);
        return result;
      } catch (err) {
        console.error(`[IPC TRACE <- MAIN ERROR] Invoke failed for '${channel}':`, err);
        throw err;
      }
    }
    const errorMsg = `[CRITICAL IPC ERROR] window.electron bridge is UNDEFINED. Cannot invoke '${channel}'. Ensure preload script compiled and loaded properly.`;
    console.error(errorMsg, { userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A' });
    return Promise.reject(new Error(errorMsg));
  },

  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    if (this.isAvailable() && window.electron) {
      console.log(`[IPC TRACE SUBSCRIBE] Listening on channel: '${channel}'`);
      return window.electron.ipcRenderer.on(channel, (...args: unknown[]) => {
        console.log(`[IPC TRACE EVENT RECV] Received pushed event on channel '${channel}':`, args);
        callback(...args);
      });
    }
    return () => {};
  },

  /**
   * Developer Tools IPC Services
   */
  dev: {
    async execTerminal(serial: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('dev:exec-terminal', { serial, command });
      }
      return { stdout: `Mock executed: ${command}`, stderr: '', exitCode: 0 };
    },

    async getSystemProperties(serial: string): Promise<SystemPropertyItem[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<SystemPropertyItem[]>('dev:get-props', serial);
      }
      return [
        { key: 'ro.product.manufacturer', value: 'Google' },
        { key: 'ro.product.model', value: 'Pixel 7 Pro' },
        { key: 'ro.build.version.release', value: '14' },
        { key: 'ro.build.version.sdk', value: '34' },
      ];
    },

    async setSystemProperty(serial: string, key: string, value: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('dev:set-prop', { serial, key, value });
      }
      return { success: true, message: `Set ${key} = ${value}` };
    },

    async fetchLogcat(serial: string): Promise<LogcatEntry[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<LogcatEntry[]>('dev:fetch-logcat', serial);
      }
      return [
        { id: '1', timestamp: '08-05 21:00:01', level: 'I', tag: 'ActivityManager', pid: '1240', message: 'Starting activity: com.android.settings' },
        { id: '2', timestamp: '08-05 21:00:02', level: 'D', tag: 'WifiService', pid: '1500', message: 'RSSI link speed: 433 Mbps, frequency: 5180 MHz' },
        { id: '3', timestamp: '08-05 21:00:03', level: 'W', tag: 'BatteryStats', pid: '900', message: 'High CPU utilization detected on background service' },
        { id: '4', timestamp: '08-05 21:00:04', level: 'E', tag: 'StrictMode', pid: '2100', message: 'DiskReadViolation: Disk read operation performed on main thread' },
      ];
    },

    async queryLogs(searchQuery?: string, levelFilter?: string): Promise<LogcatEntry[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<LogcatEntry[]>('dev:query-logs', { searchQuery, levelFilter });
      }
      return [];
    },

    async clearLogs(): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('dev:clear-logs');
      }
      return { success: true, message: 'Logs cleared.' };
    },
  },

  /**
   * Screen Feature IPC Services
   */
  screen: {
    async takeScreenshot(serial: string): Promise<ScreenshotResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<ScreenshotResult>('screen:take-screenshot', serial);
      }
      return {
        success: true,
        base64Image: '',
        message: 'Mock screenshot captured.',
      };
    },

    async saveScreenshot(base64Image: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('screen:save-screenshot', base64Image);
      }
      return { success: true, message: 'Saved screenshot.' };
    },

    async startRecord(serial: string, bitRateMb: number = 8): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('screen:start-record', { serial, bitRateMb });
      }
      return { success: true, message: 'Screen recording started.' };
    },

    async stopRecord(serial: string): Promise<RecordResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<RecordResult>('screen:stop-record', serial);
      }
      return { success: true, message: 'Screen recording saved.' };
    },

    async startStream(serial: string, bitrate: number, fps: number, quality: 'low' | 'medium' | 'high'): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('screen:start-stream', { serial, bitrate, fps, quality });
      }
      return { success: true, message: 'Mock stream started.' };
    },

    async stopStream(): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('screen:stop-stream');
      }
      return { success: true, message: 'Mock stream stopped.' };
    },

    async getStats(): Promise<any> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('screen:get-stats');
      }
      return {
        fps: 60,
        averageFps: 60,
        bitrate: 8,
        latency: 15,
        droppedFrames: 0,
        frameTime: 16.6,
        encoder: 'Mock',
        decoder: 'Mock'
      };
    },
  },

  /**
   * Device Control IPC Services
   */
  control: {
    async getCapabilities(serial: string): Promise<DeviceCapabilities> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<DeviceCapabilities>('control:get-capabilities', serial);
      }
      return { isRooted: true, hasShizuku: true, brightness: 180, autoRotate: true, rotationDegree: 0, flashlightActive: false, isCompanionInstalled: false, flashlightBackend: 'none' };
    },

    async getBrightness(serial: string): Promise<number> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<number>('control:get-brightness', serial);
      }
      return 180;
    },

    async setBrightness(serial: string, level: number): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:set-brightness', { serial, level });
      }
      return { success: true, message: `Brightness set to ${level}` };
    },

    async lock(serial: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:lock', serial);
      }
      return { success: true, message: 'Screen locked' };
    },

    async wake(serial: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:wake', serial);
      }
      return { success: true, message: 'Screen woken up' };
    },

    async rotate(serial: string, autoRotate: boolean, degree: number = 0): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:rotate', { serial, autoRotate, degree });
      }
      return { success: true, message: 'Rotation updated' };
    },

    async media(serial: string, action: 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down'): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:media', { serial, action });
      }
      return { success: true, message: `Media control ${action} sent` };
    },

    async getRotation(serial: string): Promise<{ autoRotate: boolean; rotationDegree: number }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<{ autoRotate: boolean; rotationDegree: number }>('control:get-rotation', serial);
      }
      return { autoRotate: true, rotationDegree: 0 };
    },

    async getMediaInfo(serial: string): Promise<MediaInfo | null> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<MediaInfo | null>('control:get-media-info', serial);
      }
      return null;
    },

    async getClipboard(serial: string): Promise<string> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string>('control:get-clipboard', serial);
      }
      return 'Synced Device Clipboard Content';
    },

    async setClipboard(serial: string, text: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:set-clipboard', { serial, text });
      }
      return { success: true, message: 'Clipboard text sent' };
    },

    async flashlight(serial: string, enable: boolean): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:flashlight', { serial, enable });
      }
      return { success: true, message: `Flashlight ${enable ? 'ON' : 'OFF'}` };
    },

    async restartSystemUI(serial: string, isRooted: boolean): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:restart-systemui', { serial, isRooted });
      }
      return { success: true, message: 'SystemUI restarted' };
    },

    async reboot(serial: string, mode: 'system' | 'recovery' | 'bootloader' = 'system'): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:reboot', { serial, mode });
      }
      return { success: true, message: `Rebooting ${mode}` };
    },

    async powerOff(serial: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('control:power-off', serial);
      }
      return { success: true, message: 'Power off sent' };
    },
  },

  /**
   * App Manager IPC Services
   */
  app: {
    async list(serial: string, filter: 'all' | 'user' | 'system' = 'all'): Promise<AppItem[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AppItem[]>('app:list', { serial, filter });
      }
      return [
        { id: 'com.android.chrome', packageName: 'com.android.chrome', label: 'Google Chrome', apkPath: '/system/app/Chrome.apk', isSystem: true, versionName: '126.0', permissions: ['INTERNET', 'CAMERA'] },
        { id: 'com.whatsapp', packageName: 'com.whatsapp', label: 'WhatsApp', apkPath: '/data/app/WhatsApp/base.apk', isSystem: false, versionName: '2.24.12', permissions: ['INTERNET', 'CAMERA', 'RECORD_AUDIO'] },
        { id: 'com.spotify.music', packageName: 'com.spotify.music', label: 'Spotify', apkPath: '/data/app/Spotify/base.apk', isSystem: false, versionName: '8.9.44', permissions: ['INTERNET', 'RECORD_AUDIO'] },
        { id: 'com.google.android.youtube', packageName: 'com.google.android.youtube', label: 'YouTube', apkPath: '/system/app/YouTube.apk', isSystem: true, versionName: '19.20', permissions: ['INTERNET', 'VIBRATE'] },
        { id: 'com.instagram.android', packageName: 'com.instagram.android', label: 'Instagram', apkPath: '/data/app/Instagram/base.apk', isSystem: false, versionName: '320.0', permissions: ['INTERNET', 'CAMERA', 'READ_EXTERNAL_STORAGE'] },
      ];
    },

    async selectApkInstall(): Promise<string | null> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string | null>('app:select-apk-install');
      }
      return null;
    },

    async selectExportDir(): Promise<string | null> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string | null>('app:select-export-dir');
      }
      return null;
    },

    async launch(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('app:launch', { serial, packageName });
      }
      return { success: true, message: `Launched ${packageName}` };
    },

    async stop(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('app:stop', { serial, packageName });
      }
      return { success: true, message: `Stopped ${packageName}` };
    },

    async install(serial: string, apkPath: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('app:install', { serial, apkPath });
      }
      return { success: true, message: `Installed ${apkPath}` };
    },

    async uninstall(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('app:uninstall', { serial, packageName });
      }
      return { success: true, message: `Uninstalled ${packageName}` };
    },

    async export(serial: string, packageName: string, destDir: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('app:export', { serial, packageName, destDir });
      }
      return { success: true, message: `Exported ${packageName}` };
    },

    async clearData(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('app:clear-data', { serial, packageName });
      }
      return { success: true, message: `Cleared data for ${packageName}` };
    },

    async getPermissions(serial: string, packageName: string): Promise<string[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string[]>('app:get-permissions', { serial, packageName });
      }
      return ['INTERNET', 'CAMERA', 'ACCESS_FINE_LOCATION'];
    },

    async getIcon(serial: string, packageName: string, apkPath?: string): Promise<string | undefined> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string | undefined>('app:get-icon', { serial, packageName, apkPath });
      }
      return undefined;
    },
  },

  /**
   * File Explorer IPC Services
   */
  file: {
    async list(serial: string, path: string): Promise<FileListResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<FileListResult>('file:list', { serial, path });
      }
      return {
        currentPath: path,
        items: [
          { name: 'Download', path: `${path}/Download`, isDirectory: true, size: '--', sizeBytes: 0, modified: '2026-08-01 14:22', permissions: 'drwxrwx--x', owner: 'media_rw', group: 'media_rw' },
          { name: 'Pictures', path: `${path}/Pictures`, isDirectory: true, size: '--', sizeBytes: 0, modified: '2026-08-03 10:15', permissions: 'drwxrwx--x', owner: 'media_rw', group: 'media_rw' },
          { name: 'DCIM', path: `${path}/DCIM`, isDirectory: true, size: '--', sizeBytes: 0, modified: '2026-07-28 09:30', permissions: 'drwxrwx--x', owner: 'media_rw', group: 'media_rw' },
          { name: 'Documents', path: `${path}/Documents`, isDirectory: true, size: '--', sizeBytes: 0, modified: '2026-08-04 18:10', permissions: 'drwxrwx--x', owner: 'media_rw', group: 'media_rw' },
          { name: 'Music', path: `${path}/Music`, isDirectory: true, size: '--', sizeBytes: 0, modified: '2026-06-14 11:30', permissions: 'drwxrwx--x', owner: 'media_rw', group: 'media_rw' },
          { name: 'Movies', path: `${path}/Movies`, isDirectory: true, size: '--', sizeBytes: 0, modified: '2026-07-20 16:45', permissions: 'drwxrwx--x', owner: 'media_rw', group: 'media_rw' },
          { name: 'sample_video.mp4', path: `${path}/sample_video.mp4`, isDirectory: false, size: '142.5 MB', sizeBytes: 149422080, modified: '2026-08-05 10:00', permissions: '-rw-rw----', owner: 'media_rw', group: 'media_rw' },
        ],
      };
    },

    async selectLocalUpload(): Promise<string[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string[]>('file:select-local-upload');
      }
      return [];
    },

    async selectLocalDownloadDir(): Promise<string | null> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string | null>('file:select-local-download-dir');
      }
      return null;
    },

    async push(serial: string, localPath: string, remoteDir: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('file:push', { serial, localPath, remoteDir });
      }
      return { success: true, message: `Pushed ${localPath} -> ${remoteDir}` };
    },

    async pull(serial: string, remotePath: string, localDir: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('file:pull', { serial, remotePath, localDir });
      }
      return { success: true, message: `Pulled ${remotePath} -> ${localDir}` };
    },

    async mkdir(serial: string, parentPath: string, folderName: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('file:mkdir', { serial, parentPath, folderName });
      }
      return { success: true, message: `Created ${folderName}` };
    },

    async delete(serial: string, targetPath: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('file:delete', { serial, targetPath });
      }
      return { success: true, message: `Deleted ${targetPath}` };
    },

    async rename(serial: string, oldPath: string, newName: string): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('file:rename', { serial, oldPath, newName });
      }
      return { success: true, message: `Renamed to ${newName}` };
    },

    async copy(serial: string, srcPath: string, destDir: string, isMove: boolean = false): Promise<{ success: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('file:copy', { serial, srcPath, destDir, isMove });
      }
      return { success: true, message: `${isMove ? 'Moved' : 'Copied'} ${srcPath}` };
    },
  },

  /**
   * ADB Service IPC Methods
   */
  adb: {
    async checkInstallation(): Promise<AdbCheckResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCheckResult>('adb:check-installation');
      }
      return {
        installed: true,
        executablePath: '/usr/bin/adb',
        version: '1.0.41',
        platform: 'linux',
        autoDownloadSupported: false,
        message: 'Mock ADB bridge detected.',
      };
    },

    async downloadWindows(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:download-windows');
      }
      return { success: false, message: 'Windows auto download unavailable in mock environment.' };
    },

    async listDevices(): Promise<AndroidDevice[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AndroidDevice[]>('adb:list-devices');
      }
      return [];
    },

    async connect(ip: string, port: number = 5555): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:connect', { ip, port });
      }
      return { success: true, message: `Connected to ${ip}:${port}` };
    },

    async pair(ip: string, port: number, pairingCode: string): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:pair', { ip, port, pairingCode });
      }
      return { success: true, message: `Mock paired with ${ip}:${port}` };
    },

    async getMdnsServices(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:mdns-services');
      }
      return { success: true, message: 'Mock mdns services list' };
    },

    async startQrSession(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('wireless:startQrPairing');
      }
      return {
        success: true,
        message: 'Mock QR session generated',
        data: {
          qrPayload: 'WIFI:T:ADB;S:acc-mock-12345;P:987654;;',
          fallbackPayload: 'ADB_PAIRING_QR:acc-mock-12345:987654',
          serviceId: 'acc-mock-12345',
          pairingCode: '987654',
          expiresInSeconds: 120,
        },
      };
    },

    async startQrPairing(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('wireless:startQrPairing');
      }
      return this.startQrSession();
    },

    async cancelQrPairing(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('wireless:cancelQrPairing');
      }
      return { success: true, message: 'Mock QR session cancelled' };
    },

    async refreshQrPairing(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('wireless:refreshQrPairing');
      }
      return this.startQrSession();
    },

    async getQrStatus(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('wireless:getQrStatus');
      }
      return { success: true, message: 'Mock QR status' };
    },

    async getCapabilities(): Promise<{ adbPath: string | null; adbVersion: string | null; supportsMdns: boolean; supportsQrPairing: boolean; isDetected: boolean }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke('adb:get-capabilities');
      }
      return {
        adbPath: '/usr/bin/adb',
        adbVersion: '35.0.1',
        supportsMdns: false,
        supportsQrPairing: false,
        isDetected: true,
      };
    },

    async getAutoWirelessStatus(): Promise<{ enabled: boolean; message: string }> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<{ enabled: boolean; message: string }>('device:get-auto-wireless-status');
      }
      return { enabled: false, message: 'Automatic Wireless Reconnect is currently disabled.' };
    },

    async setPreferredTransport(deviceId: string, transport: 'usb' | 'wireless'): Promise<AndroidDevice[]> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AndroidDevice[]>('device:set-preferred-transport', { deviceId, transport });
      }
      return [];
    },

    async disconnect(serial?: string): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:disconnect', serial);
      }
      return { success: true, message: `Disconnected ${serial || 'all'}` };
    },

    async killServer(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:kill-server');
      }
      return { success: true, message: 'ADB server killed.' };
    },

    async startServer(): Promise<AdbCommandResult> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AdbCommandResult>('adb:start-server');
      }
      return { success: true, message: 'ADB server started.' };
    },
  },

  /**
   * System Information & Platform IPC Services
   */
  system: {
    async getInfo(): Promise<SystemInfo> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<SystemInfo>('system:get-info');
      }
      return {
        platform: 'linux',
        arch: 'x64',
        osRelease: '6.8.0',
        type: 'Linux',
        hostname: 'antigravity-dev',
        totalMemoryMB: 16384,
        freeMemoryMB: 8192,
        cpuModel: 'AMD Ryzen 7 / Intel Core i7',
        cpuCores: 8,
        uptimeSeconds: 3600,
      };
    },

    async getAppVersion(): Promise<AppVersionInfo> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AppVersionInfo>('system:get-app-version');
      }
      return {
        appVersion: 'Beta',
        appName: 'Android Control Center',
        electronVersion: '33.2.1',
        nodeVersion: '26.5.0',
        chromeVersion: '130.0',
        platform: 'linux',
      };
    },

    async getPlatform(): Promise<string> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<string>('system:get-platform');
      }
      return 'linux';
    },
  },

  /**
   * Settings Storage IPC Services
   */
  settings: {
    async get(): Promise<AppSettings> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AppSettings>('settings:get');
      }
      return {
        adbPath: '/usr/bin/adb',
        autoConnectWireless: true,
        screenMirrorQuality: 'high',
        screenFpsLimit: 60,
        screenMirrorBitrate: 16,
        autoCheckUpdates: true,
        logcatBufferSize: 500,
        themeMode: 'dark',
        hasCompletedFirstRun: false,
        advancedAutomationEnabled: false,
        autoStartHelperServices: true,
        trustedDeviceReconnect: true,
        autoStartMirrorOnConnect: false,
        lastSelectedDevice: '',
        lastMirrorQuality: 'high',
        lastFPS: 60,
        lastBitrate: 16,
        lastMirrorOrientation: 'portrait',
      };
    },

    async update(partial: Partial<AppSettings>): Promise<AppSettings> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AppSettings>('settings:update', partial);
      }
      return {
        adbPath: '/usr/bin/adb',
        autoConnectWireless: true,
        screenMirrorQuality: 'high',
        screenFpsLimit: 60,
        screenMirrorBitrate: 16,
        autoCheckUpdates: true,
        logcatBufferSize: 500,
        themeMode: 'dark',
        hasCompletedFirstRun: false,
        advancedAutomationEnabled: false,
        autoStartHelperServices: true,
        trustedDeviceReconnect: true,
        autoStartMirrorOnConnect: false,
        lastSelectedDevice: '',
        lastMirrorQuality: 'high',
        lastFPS: 60,
        lastBitrate: 16,
        lastMirrorOrientation: 'portrait',
        ...partial,
      };
    },

    async reset(): Promise<AppSettings> {
      if (ipcService.isAvailable()) {
        return ipcService.invoke<AppSettings>('settings:reset');
      }
      return {
        adbPath: '/usr/bin/adb',
        autoConnectWireless: true,
        screenMirrorQuality: 'high',
        screenFpsLimit: 60,
        screenMirrorBitrate: 16,
        autoCheckUpdates: true,
        logcatBufferSize: 500,
        themeMode: 'dark',
        hasCompletedFirstRun: false,
        advancedAutomationEnabled: false,
        autoStartHelperServices: true,
        trustedDeviceReconnect: true,
        autoStartMirrorOnConnect: false,
        lastSelectedDevice: '',
        lastMirrorQuality: 'high',
        lastFPS: 60,
        lastBitrate: 16,
        lastMirrorOrientation: 'portrait',
      };
    },
  },

  /**
   * Logging Service IPC
   */
  logger: {
    info(message: string, context?: string, metadata?: unknown): void {
      if (ipcService.isAvailable()) {
        ipcService.invoke('log:event', { level: 'info', message, context, metadata }).catch(() => {});
      } else {
        console.info(`[${context || 'Renderer'}] ${message}`, metadata || '');
      }
    },
    warn(message: string, context?: string, metadata?: unknown): void {
      if (ipcService.isAvailable()) {
        ipcService.invoke('log:event', { level: 'warn', message, context, metadata }).catch(() => {});
      } else {
        console.warn(`[${context || 'Renderer'}] ${message}`, metadata || '');
      }
    },
    error(message: string, context?: string, metadata?: unknown): void {
      if (ipcService.isAvailable()) {
        ipcService.invoke('log:event', { level: 'error', message, context, metadata }).catch(() => {});
      } else {
        console.error(`[${context || 'Renderer'}] ${message}`, metadata || '');
      }
    },
    debug(message: string, context?: string, metadata?: unknown): void {
      if (ipcService.isAvailable()) {
        ipcService.invoke('log:event', { level: 'debug', message, context, metadata }).catch(() => {});
      } else {
        console.debug(`[${context || 'Renderer'}] ${message}`, metadata || '');
      }
    },
  },
};
