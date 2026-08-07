import { execFile, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { settingsService } from './settingsService';
import { logger } from './loggerService';
import { PathUtils } from '../utils/pathUtils';
import { DeviceInfoModel, trustedDevicesService } from './trustedDevicesService';
import { adbCapabilityService } from './adbCapabilityService';

export interface AdbCheckResult {
  installed: boolean;
  executablePath: string | null;
  version?: string;
  platform: string;
  packageManagerSuggestion?: string;
  autoDownloadSupported: boolean;
  message: string;
}

export interface AdbCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export class ADBService {
  private static instance: ADBService;

  private constructor() {}

  public static getInstance(): ADBService {
    if (!ADBService.instance) {
      ADBService.instance = new ADBService();
    }
    return ADBService.instance;
  }

  private cachedAdbExecutablePath: string | null = null;

  /**
   * Resolve active ADB executable path from settings or system PATH asynchronously
   */
  public async getAdbExecutablePath(): Promise<string | null> {
    if (this.cachedAdbExecutablePath && fs.existsSync(this.cachedAdbExecutablePath)) {
      return this.cachedAdbExecutablePath;
    }

    const settings = settingsService.getSettings();

    // 1. Check user configured adbPath if provided and valid
    if (settings.adbPath && fs.existsSync(settings.adbPath)) {
      this.cachedAdbExecutablePath = settings.adbPath;
      return settings.adbPath;
    }

    // 2. Check local downloaded bin directory inside userData
    const localBinPath = path.join(
      PathUtils.getUserDataPath(),
      'bin',
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb',
    );
    if (fs.existsSync(localBinPath)) {
      this.cachedAdbExecutablePath = localBinPath;
      return localBinPath;
    }

    // 3. Try to locate adb in system PATH asynchronously
    const systemExecutable = process.platform === 'win32' ? 'adb.exe' : 'adb';
    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      const result = await new Promise<string>((resolve, reject) => {
        execFile(command, [systemExecutable], { timeout: 3000 }, (err, stdout) => {
          if (err || !stdout) reject(err || new Error('Not found'));
          else resolve(stdout.trim());
        });
      });

      const firstLine = result.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        this.cachedAdbExecutablePath = firstLine;
        return firstLine;
      }
    } catch {
      // Not found in system PATH
    }

    return null;
  }

  private activeRunningCount = 0;
  private maxConcurrentCommands = 3;
  private commandQueue: Array<{
    args: string[];
    priority: number;
    options?: { timeoutMs?: number; cacheTtlMs?: number };
    resolve: (val: { stdout: string; stderr: string }) => void;
    reject: (err: any) => void;
  }> = [];

  private inFlightPromises: Map<string, Promise<{ stdout: string; stderr: string }>> = new Map();
  private commandCache: Map<string, { timestamp: number; result: { stdout: string; stderr: string } }> = new Map();

  /**
   * Determine priority for command scheduling:
   * High (3): connect, pair, input, screencap, screenrecord, mirror
   * Med (2): getprop, battery, storage, devices
   * Low (1): dumpsys wifi, dumpsys package, logcat, pm list
   */
  private getCommandPriority(args: string[]): number {
    const cmdStr = args.join(' ').toLowerCase();
    if (cmdStr.includes('connect') || cmdStr.includes('pair') || cmdStr.includes('input') || cmdStr.includes('screencap') || cmdStr.includes('screenrecord')) {
      return 3;
    }
    if (cmdStr.includes('dumpsys wifi') || cmdStr.includes('dumpsys package') || cmdStr.includes('pm list') || cmdStr.includes('logcat')) {
      return 1;
    }
    return 2;
  }

  /**
   * Execute ADB command via spawn() with incremental stdout reading, max 3 concurrency, caching, and deduplication
   */
  public async execAdb(args: string[], options?: { timeoutMs?: number; cacheTtlMs?: number }): Promise<{ stdout: string; stderr: string }> {
    // Block device-targeted commands if -s <serial> is missing or empty
    const GLOBAL_ADB_COMMANDS = new Set(['devices', 'version', 'connect', 'disconnect', 'start-server', 'kill-server', 'mdns', 'help']);
    const isGlobal = args.length > 0 && GLOBAL_ADB_COMMANDS.has(args[0]);

    if (!isGlobal) {
      const sIndex = args.indexOf('-s');
      if (sIndex === -1 || !args[sIndex + 1] || args[sIndex + 1].trim() === '') {
        logger.info(`[ADB Blocked] Rejecting device command without target serial: adb ${args.join(' ')}`, 'ADBService');
        return { stdout: '', stderr: 'No active ADB device serial specified' };
      }
    }

    const cmdKey = args.join(' ');
    const priority = this.getCommandPriority(args);

    // 1. Check Cache for expensive commands (e.g. dumpsys wifi)
    const cacheTtl = options?.cacheTtlMs ?? (cmdKey.includes('dumpsys wifi') ? 15000 : 0);
    if (cacheTtl > 0) {
      const cached = this.commandCache.get(cmdKey);
      if (cached && Date.now() - cached.timestamp < cacheTtl) {
        logger.info(`[ADB Cache Hit] Reusing cached result for: adb ${cmdKey}`, 'ADBService');
        return cached.result;
      }
    }

    // 2. Reuse in-flight promise for identical duplicate commands
    if (this.inFlightPromises.has(cmdKey)) {
      logger.info(`[ADB Deduplication] Reusing in-flight Promise for: adb ${cmdKey}`, 'ADBService');
      return this.inFlightPromises.get(cmdKey)!;
    }

    const promise = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      this.commandQueue.push({ args, priority, options, resolve, reject });
      // Sort queue by priority (descending)
      this.commandQueue.sort((a, b) => b.priority - a.priority);
      this.processQueue();
    }).finally(() => {
      this.inFlightPromises.delete(cmdKey);
    });

    this.inFlightPromises.set(cmdKey, promise);
    return promise;
  }

  private async processQueue(): Promise<void> {
    if (this.activeRunningCount >= this.maxConcurrentCommands || this.commandQueue.length === 0) {
      return;
    }

    const task = this.commandQueue.shift();
    if (!task) return;

    this.activeRunningCount++;
    logger.info(`Queue size: ${this.commandQueue.length} | Running commands: ${this.activeRunningCount}`, 'ADBService');

    try {
      const result = await this.spawnAdbDirect(task.args, task.options);
      
      const cmdKey = task.args.join(' ');
      const cacheTtl = task.options?.cacheTtlMs ?? (cmdKey.includes('dumpsys wifi') ? 15000 : 0);
      if (cacheTtl > 0) {
        this.commandCache.set(cmdKey, { timestamp: Date.now(), result });
      }

      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.activeRunningCount--;
      this.processQueue();
    }
  }

  /**
   * Direct spawn() execution with incremental stream buffering & unlimited stdout size
   */
  private async spawnAdbDirect(args: string[], options?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> {
    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      throw new Error('ADB executable not found. Please configure ADB path or install Android Platform Tools.');
    }

    const timeoutMs = options?.timeoutMs || 30000;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      logger.info(`spawn vs exec: SPAWN | Executing: adb ${args.join(' ')}`, 'ADBService');

      const child = spawn(adbPath, args);
      let stdoutBufs: Buffer[] = [];
      let stderrBufs: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timer: NodeJS.Timeout | null = null;

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          logger.error(`ADB command timed out after ${timeoutMs}ms: adb ${args.join(' ')}`, 'ADBService');
          child.kill('SIGTERM');
          reject(new Error(`ADB command timed out after ${(timeoutMs / 1000).toFixed(0)} seconds.`));
        }, timeoutMs);
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBufs.push(chunk);
        stdoutBytes += chunk.length;
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBufs.push(chunk);
        stderrBytes += chunk.length;
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        const duration = Date.now() - startTime;
        const stdoutStr = Buffer.concat(stdoutBufs).toString('utf-8');
        const stderrStr = Buffer.concat(stderrBufs).toString('utf-8');

        logger.info(`Execution duration: ${duration}ms | Bytes received: ${stdoutBytes + stderrBytes} | stdout size: ${stdoutBytes} bytes | stderr size: ${stderrBytes} bytes`, 'ADBService');

        if (code !== 0 && !stdoutStr) {
          reject(new Error(stderrStr || `ADB exited with code ${code} signal ${signal}`));
          return;
        }

        resolve({ stdout: stdoutStr, stderr: stderrStr });
      });
    });
  }

  /**
   * Detect Linux Package Manager and return installation suggestion command
   */
  private detectLinuxPackageManager(): string {
    const managers: Array<{ bin: string; cmd: string }> = [
      { bin: 'apt-get', cmd: 'sudo apt update && sudo apt install android-sdk-platform-tools android-tools-adb' },
      { bin: 'pacman', cmd: 'sudo pacman -S android-tools' },
      { bin: 'dnf', cmd: 'sudo dnf install android-tools' },
      { bin: 'zypper', cmd: 'sudo zypper install android-tools' },
      { bin: 'apk', cmd: 'sudo apk add android-tools' },
    ];

    for (const mgr of managers) {
      try {
        execSync(`which ${mgr.bin}`, { stdio: 'ignore' });
        return mgr.cmd;
      } catch {
        // continue search
      }
    }

    return 'Install "android-tools" or "android-sdk-platform-tools" via your system package manager.';
  }

  /**
   * Check ADB installation status, version, and OS package recommendations
   */
  public async checkAdbInstallation(): Promise<AdbCheckResult> {
    const adbPath = await this.getAdbExecutablePath();
    const platform = process.platform;
    const isWindows = platform === 'win32';

    if (!adbPath) {
      const suggestion = platform === 'linux' ? this.detectLinuxPackageManager() : undefined;
      return {
        installed: false,
        executablePath: null,
        platform,
        packageManagerSuggestion: suggestion,
        autoDownloadSupported: isWindows,
        message: isWindows
          ? 'ADB not found. Automatic download available for Windows.'
          : `ADB not found. ${suggestion}`,
      };
    }

    try {
      const { stdout } = await this.execAdb(['version']);
      const versionMatch = stdout.match(/Android Debug Bridge version ([\d.]+)/);
      const versionStr = versionMatch ? versionMatch[1] : 'Unknown';

      return {
        installed: true,
        executablePath: adbPath,
        version: versionStr,
        platform,
        autoDownloadSupported: isWindows,
        message: `ADB version ${versionStr} detected at ${adbPath}`,
      };
    } catch {
      return {
        installed: false,
        executablePath: adbPath,
        platform,
        autoDownloadSupported: isWindows,
        message: `ADB binary found at ${adbPath} but failed version check.`,
      };
    }
  }

  /**
   * Automatically download official Google Platform Tools on Windows
   */
  public async downloadPlatformToolsWindows(): Promise<AdbCommandResult> {
    if (process.platform !== 'win32') {
      return {
        success: false,
        message: 'Automatic platform-tools download is currently supported on Windows only.',
      };
    }

    const downloadUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
    const targetDir = path.join(PathUtils.getUserDataPath(), 'bin');
    const zipPath = path.join(targetDir, 'platform-tools-windows.zip');

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      logger.info(`Starting download of Windows platform-tools from ${downloadUrl}`, 'ADBService');

      await new Promise<void>((resolve, reject) => {
        const fileStream = fs.createWriteStream(zipPath);
        https.get(downloadUrl, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed downloading platform-tools: HTTP ${response.statusCode}`));
            return;
          }
          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(zipPath, () => {});
          reject(err);
        });
      });

      const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
      execSync(extractCmd);
      fs.unlinkSync(zipPath);

      const installedAdbPath = path.join(targetDir, 'platform-tools', 'adb.exe');
      if (fs.existsSync(installedAdbPath)) {
        settingsService.updateSettings({ adbPath: installedAdbPath });
        logger.info(`Platform tools extracted successfully to ${installedAdbPath}`, 'ADBService');
        return {
          success: true,
          message: `Platform Tools installed successfully. Configured ADB path: ${installedAdbPath}`,
          data: { adbPath: installedAdbPath },
        };
      } else {
        throw new Error('Extraction completed but adb.exe missing in extracted output.');
      }
    } catch (err: any) {
      logger.error('Failed downloading Windows platform-tools', 'ADBService', err);
      return {
        success: false,
        message: `Failed downloading Platform Tools: ${err.message}`,
      };
    }
  }

  /**
   * Fetch rich device properties (Manufacturer, Model, Android Version, Battery, Storage, CPU, RAM, Temperature, Network, Dev Mode)
   */
  public async fetchDetailedDeviceSpecs(serial: string, status: DeviceInfoModel['status'], connectionType: 'usb' | 'wireless'): Promise<DeviceInfoModel> {
    const existing = trustedDevicesService.getBySerial(serial);

    let manufacturer = existing?.manufacturer || 'Android';
    let model = existing?.model || (status === 'unauthorized' ? 'Unauthorized Device' : 'Generic Device');
    let deviceName = existing?.deviceName || (status === 'unauthorized' ? 'Unauthorized Phone' : 'Android Device');
    let androidVersion = existing?.androidVersion || undefined;
    let batteryLevel: number | undefined = existing?.batteryLevel;
    let isCharging: boolean | undefined = existing?.isCharging;
    let chargingType: string | undefined = existing?.chargingType;
    let storageFree: string | undefined = existing?.storageFree;
    let storageTotal: string | undefined = existing?.storageTotal;
    let storageUsedPercent: number | undefined = existing?.storageUsedPercent;

    let cpuUsage: number | undefined = existing?.cpuUsage;
    let cpuModel: string | undefined = existing?.cpuModel;
    let cpuCores: number | undefined = existing?.cpuCores;

    let ramUsedGB: string | undefined = existing?.ramUsedGB;
    let ramTotalGB: string | undefined = existing?.ramTotalGB;
    let ramPercent: number | undefined = existing?.ramPercent;

    let temperature: number | undefined = existing?.temperature;
    let thermalStatus: string | undefined = existing?.thermalStatus;

    let networkSsid: string | undefined = existing?.networkSsid;
    let networkRssi: number | undefined = existing?.networkRssi;
    let networkType: 'wifi' | 'cellular' | 'none' | undefined = existing?.networkType;
    let carrierName: string | undefined = existing?.carrierName;
    let cellularGeneration: string | undefined = existing?.cellularGeneration;

    let ipAddress = existing?.ipAddress || (serial.includes(':') ? serial.split(':')[0] || '' : undefined);
    const port = existing?.port || 5555;

    const adbStatus = status === 'online' ? 'Active Connected' : status === 'unauthorized' ? 'Unauthorized' : 'Disconnected';
    let developerMode = existing?.developerMode ?? (status === 'online');
    let wirelessDebugging = existing?.wirelessDebugging ?? (status === 'online');

    let hardwareSerial = existing?.hardwareSerial || '';

    if (status === 'online') {
      try {
        const [manRes, modRes, nameRes, verRes, sdkRes, batRes, dfRes, ipRes, memRes, devRes, wlanRes, hwSerialRes, operatorRes, netTypeRes, wifiRes] = await Promise.allSettled([
          this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.product.manufacturer']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.product.model']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.config.marketing_name']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.release']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']),
          this.execAdb(['-s', serial, 'shell', 'dumpsys', 'battery']),
          this.execAdb(['-s', serial, 'shell', 'df', '-h', '/sdcard']),
          this.execAdb(['-s', serial, 'shell', 'ip', 'route']),
          this.execAdb(['-s', serial, 'shell', 'cat', '/proc/meminfo']),
          this.execAdb(['-s', serial, 'shell', 'settings', 'get', 'global', 'development_settings_enabled']),
          this.execAdb(['-s', serial, 'shell', 'settings', 'get', 'global', 'adb_wifi_enabled']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'ro.serialno']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'gsm.operator.alpha']),
          this.execAdb(['-s', serial, 'shell', 'getprop', 'gsm.network.type']),
          this.execAdb(['-s', serial, 'shell', 'dumpsys', 'wifi']),
        ]);

        if (manRes.status === 'fulfilled' && manRes.value.stdout.trim()) {
          const raw = manRes.value.stdout.trim();
          manufacturer = raw.charAt(0).toUpperCase() + raw.slice(1);
        }

        if (modRes.status === 'fulfilled' && modRes.value.stdout.trim()) {
          model = modRes.value.stdout.trim();
        }

        if (nameRes.status === 'fulfilled' && nameRes.value.stdout.trim()) {
          deviceName = nameRes.value.stdout.trim();
        } else {
          deviceName = `${manufacturer} ${model}`;
        }

        if (verRes.status === 'fulfilled' && verRes.value.stdout.trim()) {
          const rel = verRes.value.stdout.trim();
          const sdk = sdkRes.status === 'fulfilled' ? sdkRes.value.stdout.trim() : '';
          androidVersion = `Android ${rel}${sdk ? ` (API ${sdk})` : ''}`;
        }

        // Battery & Thermal parsing
        if (batRes.status === 'fulfilled') {
          const batTxt = batRes.value.stdout;
          const levelMatch = batTxt.match(/level:\s*(\d+)/i);
          const statusMatch = batTxt.match(/status:\s*(\d+)/i);
          const tempMatch = batTxt.match(/temperature:\s*(\d+)/i);
          const acMatch = batTxt.match(/AC powered:\s*true/i);
          const usbMatch = batTxt.match(/USB powered:\s*true/i);
          const wirelessMatch = batTxt.match(/Wireless powered:\s*true/i);

          if (levelMatch && levelMatch[1]) {
            batteryLevel = parseInt(levelMatch[1], 10);
          }
          if (statusMatch && statusMatch[1]) {
            isCharging = parseInt(statusMatch[1], 10) === 2;
          }
          if (acMatch) chargingType = 'AC Adapter Fast Charge';
          else if (usbMatch) chargingType = 'USB Data Port';
          else if (wirelessMatch) chargingType = 'Qi Wireless Charging';
          else chargingType = isCharging ? 'Charging' : 'Discharging (Battery)';

          if (tempMatch && tempMatch[1]) {
            const rawTemp = parseInt(tempMatch[1], 10);
            temperature = rawTemp / 10;
            if (temperature < 35) thermalStatus = 'Normal (Cool)';
            else if (temperature < 42) thermalStatus = 'Warm';
            else thermalStatus = 'Hot (High Load)';
          }
        }

        // Storage Parsing
        if (dfRes.status === 'fulfilled') {
          const dfLines = dfRes.value.stdout.trim().split(/\r?\n/);
          if (dfLines.length >= 2 && dfLines[1]) {
            const dfParts = dfLines[1].trim().split(/\s+/);
            if (dfParts.length >= 5) {
              if (dfParts[1]) storageTotal = dfParts[1];
              if (dfParts[3]) storageFree = dfParts[3];
              if (dfParts[4]) storageUsedPercent = parseInt(dfParts[4].replace('%', ''), 10) || 50;
            }
          }
        }

        // RAM Parsing (/proc/meminfo)
        if (memRes.status === 'fulfilled') {
          const memTxt = memRes.value.stdout;
          const totalMatch = memTxt.match(/MemTotal:\s*(\d+)/i);
          const availMatch = memTxt.match(/MemAvailable:\s*(\d+)/i);

          if (totalMatch && totalMatch[1] && availMatch && availMatch[1]) {
            const totalKb = parseInt(totalMatch[1], 10);
            const availKb = parseInt(availMatch[1], 10);
            const usedKb = totalKb - availKb;

            const totalGbVal = (totalKb / (1024 * 1024)).toFixed(1);
            const usedGbVal = (usedKb / (1024 * 1024)).toFixed(1);

            ramTotalGB = `${totalGbVal} GB`;
            ramUsedGB = `${usedGbVal} GB`;
            ramPercent = Math.round((usedKb / totalKb) * 100);
          }
        }

        // Developer Settings Flags
        if (devRes.status === 'fulfilled') {
          developerMode = devRes.value.stdout.trim() === '1';
        }
        if (wlanRes.status === 'fulfilled') {
          wirelessDebugging = wlanRes.value.stdout.trim() === '1';
        }

        // Hardware Serial Parsing
        if (hwSerialRes.status === 'fulfilled' && hwSerialRes.value.stdout.trim()) {
          hardwareSerial = hwSerialRes.value.stdout.trim();
        } else if (!serial.includes(':')) {
          hardwareSerial = serial;
        }

        // IP Address Parsing
        if (ipRes.status === 'fulfilled' && !serial.includes(':')) {
          const ipTxt = ipRes.value.stdout;
          const ipMatch = ipTxt.match(/src\s+([\d.]+)/);
          if (ipMatch && ipMatch[1]) {
            ipAddress = ipMatch[1];
          }
        }

        // Network Connection Type & Mobile Carrier Details
        let hasWifiConnection = false;
        if (wifiRes.status === 'fulfilled' && wifiRes.value.stdout) {
          const wifiTxt = wifiRes.value.stdout;
          const ssidMatch = wifiTxt.match(/SSID:\s*"?([^"\n\r]+)"?/i) || wifiTxt.match(/mWifiInfo\s+SSID:\s*"?([^"\n\r]+)"?/i);
          const hasSsid = ssidMatch && ssidMatch[1] && !ssidMatch[1].includes('<unknown ssid>');
          const isConnected = wifiTxt.includes('state: CONNECTED') || wifiTxt.includes('mNetworkInfo CONNECTED') || wifiTxt.includes('mNetworkInfo: CONNECTED/CONNECTED');
          if (hasSsid || isConnected) {
            hasWifiConnection = true;
            networkType = 'wifi';
            if (ssidMatch && ssidMatch[1]) {
              networkSsid = ssidMatch[1].trim();
            }
          }
        }

        if (operatorRes.status === 'fulfilled' && operatorRes.value.stdout.trim()) {
          const opName = operatorRes.value.stdout.trim();
          if (opName && opName !== 'null' && opName !== '000-00' && opName !== '00000') {
            carrierName = opName;
          }
        }

        if (netTypeRes.status === 'fulfilled' && netTypeRes.value.stdout.trim()) {
          const rawGen = netTypeRes.value.stdout.toLowerCase().trim();
          if (rawGen && rawGen !== 'unknown' && rawGen !== 'none') {
            if (rawGen.includes('nr') || rawGen.includes('5g')) {
              cellularGeneration = '5G';
            } else if (rawGen.includes('lte')) {
              cellularGeneration = '4G LTE';
            } else if (rawGen.includes('hspa') || rawGen.includes('umts') || rawGen.includes('3g')) {
              cellularGeneration = '3G';
            } else if (rawGen.includes('gsm') || rawGen.includes('edge') || rawGen.includes('gprs')) {
              cellularGeneration = '2G';
            } else {
              cellularGeneration = rawGen.toUpperCase();
            }
          }
        }

        if (hasWifiConnection) {
          networkType = 'wifi';
        } else if (carrierName) {
          networkType = 'cellular';
          networkSsid = `${carrierName} ${cellularGeneration || ''}`.trim();
        } else {
          networkType = 'none';
          networkSsid = undefined;
        }
      } catch (err) {
        logger.warn(`Failed fetching detailed device specs for ${serial}`, 'ADBService', err);
      }
    }

    const deviceModel: DeviceInfoModel = {
      id: `dev_${serial.replace(/[^a-zA-Z0-9]/g, '_')}`,
      serialNumber: serial,
      deviceName,
      model,
      manufacturer,
      androidVersion,
      batteryLevel,
      isCharging,
      chargingType,
      storageFree,
      storageTotal,
      storageUsedPercent,
      cpuUsage,
      cpuModel,
      cpuCores,
      ramUsedGB,
      ramTotalGB,
      ramPercent,
      temperature,
      thermalStatus,
      networkSsid,
      networkRssi,
      networkType,
      carrierName,
      cellularGeneration,
      connectionType,
      ipAddress,
      port,
      status,
      adbStatus,
      developerMode,
      wirelessDebugging,
      hardwareSerial,
      lastConnected: new Date().toISOString(),
      isTrusted: true,
    };

    trustedDevicesService.saveDevice(deviceModel);

    return deviceModel;
  }

  private cachedRawDevicesTimestamp = 0;
  private cachedRawDevicesList: Array<{ serial: string; rawStatus: string; connectionType: 'usb' | 'wireless' }> = [];

  /**
   * Enumerate raw connected ADB targets (15-second cache to prevent ADB process spamming)
   */
  public async listRawDevices(forceRefresh = false): Promise<Array<{ serial: string; rawStatus: string; connectionType: 'usb' | 'wireless' }>> {
    const now = Date.now();
    if (!forceRefresh && this.cachedRawDevicesList.length > 0 && now - this.cachedRawDevicesTimestamp < 15000) {
      return this.cachedRawDevicesList;
    }

    try {
      const { stdout } = await this.execAdb(['devices', '-l']);
      const lines = stdout.split(/\r?\n/);
      const results: Array<{ serial: string; rawStatus: string; connectionType: 'usb' | 'wireless' }> = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('List of devices attached')) {
          continue;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;

        const serial = parts[0] || '';
        const rawStatus = parts[1] || '';
        const isWireless = serial.includes(':') || serial.includes('.');

        results.push({
          serial,
          rawStatus,
          connectionType: isWireless ? 'wireless' : 'usb',
        });
      }

      this.cachedRawDevicesTimestamp = now;
      this.cachedRawDevicesList = results;
      return results;
    } catch (err: any) {
      logger.error('Error listing raw devices', 'ADBService', err);
      return [];
    }
  }

  /**
   * Feature: adb connect <ip>:<port>
   */
  public async connectWireless(ip: string, port: number = 5555): Promise<AdbCommandResult> {
    if (!ip) {
      return { success: false, message: 'IP address is required for wireless connection.' };
    }

    const target = `${ip}:${port}`;
    try {
      const { stdout } = await this.execAdb(['connect', target]);
      const cleanStdout = stdout.trim();
      const isConnected = cleanStdout.includes('connected to') || cleanStdout.includes('already connected');

      logger.info(`adb connect ${target} result: ${cleanStdout}`, 'ADBService');

      return {
        success: isConnected,
        message: cleanStdout,
        data: { target, ip, port, connected: isConnected },
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to connect to ${target}: ${err.message}`,
      };
    }
  }

  /**
   * Feature: adb disconnect [target]
   */
  public async disconnect(target?: string): Promise<AdbCommandResult> {
    try {
      const args = target ? ['disconnect', target] : ['disconnect'];
      const { stdout } = await this.execAdb(args);
      const cleanStdout = stdout.trim();

      logger.info(`adb disconnect ${target || 'all'} result: ${cleanStdout}`, 'ADBService');

      return {
        success: true,
        message: cleanStdout || `Disconnected ${target || 'all devices'}`,
        data: { target },
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to disconnect ${target || 'devices'}: ${err.message}`,
      };
    }
  }

  /**
   * Feature: adb kill-server
   */
  public async killServer(): Promise<AdbCommandResult> {
    try {
      const { stdout } = await this.execAdb(['kill-server']);
      logger.info('adb kill-server executed successfully', 'ADBService');
      return {
        success: true,
        message: stdout.trim() || 'ADB server killed successfully.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to kill ADB server: ${err.message}`,
      };
    }
  }

  /**
   * Feature: adb start-server
   */
  public async startServer(): Promise<AdbCommandResult> {
    try {
      const { stdout } = await this.execAdb(['start-server']);
      logger.info('adb start-server executed successfully', 'ADBService');
      return {
        success: true,
        message: stdout.trim() || 'ADB server started successfully.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to start ADB server: ${err.message}`,
      };
    }
  }

  /**
   * Feature: adb pair <ip>:<port> <pairingCode>
   */
  public async pairWireless(ip: string, port: number, pairingCode: string): Promise<AdbCommandResult> {
    if (!ip || !port || !pairingCode) {
      return { success: false, message: 'IP, Port, and Pairing Code are all required.' };
    }

    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      return { success: false, message: 'ADB executable not found.' };
    }

    const target = `${ip}:${port}`;
    logger.info(`Starting adb pair ${target} with code ${pairingCode}`, 'ADBService');

    return new Promise((resolve) => {
      // Spawn child process since adb pair expects code input via stdin or positional argument depending on platform/ADB version.
      // Modern ADB supports: adb pair <ip>:<port> [code]
      const child = spawn(adbPath, ['pair', target, pairingCode], { timeout: 15000 });
      let output = '';
      let errorOutput = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        const stdoutStr = output.trim();
        const stderrStr = errorOutput.trim();

        logger.info(`adb pair exit code: ${code}`, 'ADBService');
        logger.info(`adb pair stdout: ${stdoutStr || '(none)'}`, 'ADBService');
        logger.info(`adb pair stderr: ${stderrStr || '(none)'}`, 'ADBService');

        const fullOutput = (stdoutStr + '\n' + stderrStr).trim();
        const lowerOutput = fullOutput.toLowerCase();

        // Strict validation: stdout/fullOutput MUST contain positive pairing confirmation
        const isSuccess = code === 0 && (lowerOutput.includes('successfully paired') || lowerOutput.includes('paired to'));

        if (!isSuccess) {
          logger.error(`adb pair failed: ${fullOutput || `Exited with code ${code}`}`, 'ADBService');
        } else {
          logger.info(`adb pair successful: ${fullOutput}`, 'ADBService');
        }

        resolve({
          success: isSuccess,
          message: fullOutput || (isSuccess ? 'Successfully paired' : `Pairing failed with exit code ${code}`),
        });
      });

      // Write pairing code to stdin just in case the version of ADB prompts for it
      try {
        child.stdin?.write(`${pairingCode}\n`);
      } catch {
        // ignore write error
      }
    });
  }

  /**
   * Feature: Real Android Wireless Debugging QR Pairing Session
   * Protocol specification (identical to Android Studio / ADB mDNS pairing protocol):
   * Format: ADB_PAIRING_QR:<service_name>:<pairing_code>
   * Example: ADB_PAIRING_QR:studio-acc-941824:839201
   * Android devices discover the mDNS service '_adb-pairing-tls._tcp' or query pairing endpoints.
   */
  public async startQrPairingSession(): Promise<AdbCommandResult> {
    try {
      const checkResult = await this.checkAdbInstallation();
      if (!checkResult.installed) {
        return {
          success: false,
          message: 'ADB is not installed or detected. Please install Platform Tools first.',
        };
      }

      // Check if mDNS capability is available in installed ADB version
      const mdnsCheck = await this.getMdnsServices();
      if (!mdnsCheck.success) {
        return {
          success: false,
          message: 'Installed ADB binary does not support mDNS wireless pairing APIs.',
        };
      }

      // Generate random pairing service ID & 6-digit password
      const randomServiceId = `acc-${Math.floor(100000 + Math.random() * 900000)}`;
      const randomPassword = `${Math.floor(100000 + Math.random() * 900000)}`;

      // Android Studio Standard Wireless Debugging QR Format
      const qrPayload = `WIFI:T:ADB;S:${randomServiceId};P:${randomPassword};;`;
      const fallbackPayload = `ADB_PAIRING_QR:${randomServiceId}:${randomPassword}`;

      logger.info(`Started ADB QR Pairing Session. ServiceId=${randomServiceId}`, 'ADBService');

      return {
        success: true,
        message: 'QR Pairing session generated successfully.',
        data: {
          qrPayload,
          fallbackPayload,
          serviceId: randomServiceId,
          pairingCode: randomPassword,
          expiresInSeconds: 120,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed starting QR pairing session: ${err.message}`,
      };
    }
  }

  /**
   * Feature: adb mdns services (with single-check capability guard)
   */
  public async getMdnsServices(): Promise<AdbCommandResult> {
    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      return { success: false, message: 'ADB executable not found.' };
    }

    const caps = await adbCapabilityService.detectCapabilities(adbPath);
    if (!caps.supportsMdns) {
      return {
        success: false,
        message: 'ADB mDNS support: Not Available. Using fallback discovery.',
      };
    }

    try {
      const { stdout } = await this.execAdb(['mdns', 'services']);
      return {
        success: true,
        message: stdout.trim(),
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to query mDNS services: ${err.message}`,
      };
    }
  }

  /**
   * Resolve and verify active ADB serial prior to executing device operations.
   * If requestedSerial is disconnected or stale, auto-remaps to an online device by hardwareSerial/IP/model.
   */
  public async resolveActiveSerial(requestedSerial?: string): Promise<string> {
    const rawDevs = await this.listRawDevices();
    const onlineDevs = rawDevs.filter((d) => d.rawStatus === 'device' || d.rawStatus === 'online');
    const onlineSerials = onlineDevs.map((d) => d.serial);

    logger.info(`Current serial: ${requestedSerial || '(none)'}`, 'ADBService');
    logger.info(`Current adb devices: [${onlineSerials.join(', ')}]`, 'ADBService');

    if (!requestedSerial) {
      return onlineSerials[0] || '';
    }

    try {
      const { deviceDiscoveryService } = require('./deviceDiscoveryService');
      const cachedDevs = deviceDiscoveryService.getCachedDevices();

      const matchedLogical = cachedDevs.find(
        (d: any) =>
          d.id === requestedSerial ||
          d.serialNumber === requestedSerial ||
          d.hardwareSerial === requestedSerial ||
          d.availableTransports?.some((t: any) => t.serial === requestedSerial),
      );

      if (matchedLogical) {
        // 1. Return preferred transport serial if online
        const preferred = matchedLogical.availableTransports?.find(
          (t: any) => t.type === matchedLogical.preferredTransport && onlineSerials.includes(t.serial),
        );
        if (preferred) return preferred.serial;

        // 2. Return any online transport serial for this device
        const anyOnline = matchedLogical.availableTransports?.find((t: any) => onlineSerials.includes(t.serial));
        if (anyOnline) return anyOnline.serial;

        // 3. Return active serialNumber if online
        if (onlineSerials.includes(matchedLogical.serialNumber)) return matchedLogical.serialNumber;
      }
    } catch {
      // fallback
    }

    if (onlineSerials.includes(requestedSerial)) {
      return requestedSerial;
    }

    logger.warn(`Serial ${requestedSerial} is not currently connected in 'device' state. Remapping active serial...`, 'ADBService');

    const baseIp = requestedSerial.includes(':') ? requestedSerial.split(':')[0] : requestedSerial;
    const remapped = onlineDevs.find((d) => d.serial.includes(baseIp) || baseIp.includes(d.serial));

    if (remapped) {
      logger.info(`Serial remapped: ${requestedSerial} -> ${remapped.serial}`, 'ADBService');
      return remapped.serial;
    }

    if (onlineSerials.length > 0) {
      logger.info(`Serial remapped to primary connected device: ${requestedSerial} -> ${onlineSerials[0]}`, 'ADBService');
      return onlineSerials[0];
    }

    return requestedSerial;
  }
}

export const adbService = ADBService.getInstance();
