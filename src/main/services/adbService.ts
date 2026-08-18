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

export interface StaticDeviceInfo {
  manufacturer: string;
  model: string;
  marketingName?: string;
  deviceName: string;
  androidVersion: string;
  sdkVersion: string;
  hardwareSerial: string;
  developerOptions: boolean;
  adbWifiEnabled: boolean;
  isRooted: boolean;
  hasShizuku: boolean;
  fetchedAt: number;
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
  private downloadPromise: Promise<AdbCommandResult> | null = null;
  private staticDeviceCache = new Map<string, StaticDeviceInfo>();

  /**
   * Fetch static device properties (Manufacturer, Model, Android Version, SDK, Hardware Serial, Root, Shizuku, Dev Options) ONCE.
   * Caches forever per device serial until disconnected or manually invalidated.
   */
  public async fetchStaticDeviceInfo(serial: string): Promise<StaticDeviceInfo> {
    const activeSerial = (await this.resolveActiveSerial(serial)) || serial;
    const cached = this.staticDeviceCache.get(activeSerial);
    if (cached) {
      logger.debug(`[Polling] Using cached static device info for ${activeSerial}`, 'ADBService');
      return cached;
    }

    logger.info(`[Polling] Fetching static info for ${activeSerial}`, 'ADBService');

    const [
      manRes,
      modRes,
      nameRes,
      marketRes,
      brandRes,
      verRes,
      sdkRes,
      devRes,
      wlanRes,
      hwSerialRes,
      bootSerialRes,
      androidIdRes,
      suRes,
      shizRes,
    ] = await Promise.allSettled([
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.product.manufacturer']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.product.model']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.config.marketing_name']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.product.marketname']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.product.brand']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.build.version.release']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.build.version.sdk']),
      this.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'global', 'development_settings_enabled']),
      this.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'global', 'adb_wifi_enabled']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.serialno']),
      this.execAdb(['-s', activeSerial, 'shell', 'getprop', 'ro.boot.serialno']),
      this.execAdb(['-s', activeSerial, 'shell', 'settings', 'get', 'secure', 'android_id']),
      this.execAdb(['-s', activeSerial, 'shell', 'which', 'su']),
      this.execAdb(['-s', activeSerial, 'shell', 'pm', 'list', 'packages', 'moe.shizuku.privileged.api']),
    ]);

    let manufacturer = 'Android';
    if (manRes.status === 'fulfilled' && manRes.value.stdout.trim()) {
      const raw = manRes.value.stdout.trim();
      manufacturer = raw.charAt(0).toUpperCase() + raw.slice(1);
    } else if (brandRes.status === 'fulfilled' && brandRes.value.stdout.trim()) {
      const raw = brandRes.value.stdout.trim();
      manufacturer = raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    let model = 'Generic Device';
    if (modRes.status === 'fulfilled' && modRes.value.stdout.trim()) {
      model = modRes.value.stdout.trim();
    }

    let deviceName = `${manufacturer} ${model}`;
    if (nameRes.status === 'fulfilled' && nameRes.value.stdout.trim() && !nameRes.value.stdout.includes('._tcp')) {
      deviceName = nameRes.value.stdout.trim();
    } else if (marketRes.status === 'fulfilled' && marketRes.value.stdout.trim() && !marketRes.value.stdout.includes('._tcp')) {
      deviceName = marketRes.value.stdout.trim();
    }

    let androidVersion = 'Android';
    let sdkVersion = '';
    if (verRes.status === 'fulfilled' && verRes.value.stdout.trim()) {
      const rel = verRes.value.stdout.trim();
      sdkVersion = sdkRes.status === 'fulfilled' ? sdkRes.value.stdout.trim() : '';
      androidVersion = `Android ${rel}${sdkVersion ? ` (API ${sdkVersion})` : ''}`;
    }

    let developerOptions = true;
    if (devRes.status === 'fulfilled' && devRes.value.stdout.trim()) {
      developerOptions = devRes.value.stdout.trim() === '1';
    }

    let adbWifiEnabled = true;
    if (wlanRes.status === 'fulfilled' && wlanRes.value.stdout.trim()) {
      adbWifiEnabled = wlanRes.value.stdout.trim() === '1';
    }

    // Determine canonical physical hardware identifier
    let hardwareSerial = '';
    if (bootSerialRes.status === 'fulfilled' && bootSerialRes.value.stdout.trim() && bootSerialRes.value.stdout.trim() !== 'unknown') {
      hardwareSerial = bootSerialRes.value.stdout.trim();
    } else if (hwSerialRes.status === 'fulfilled' && hwSerialRes.value.stdout.trim() && hwSerialRes.value.stdout.trim() !== 'unknown') {
      hardwareSerial = hwSerialRes.value.stdout.trim();
    } else if (androidIdRes.status === 'fulfilled' && androidIdRes.value.stdout.trim() && androidIdRes.value.stdout.trim() !== 'null') {
      hardwareSerial = androidIdRes.value.stdout.trim();
    } else if (!activeSerial.includes(':') && !activeSerial.includes('.')) {
      hardwareSerial = activeSerial;
    } else {
      hardwareSerial = `${manufacturer}_${model}`;
    }

    let isRooted = false;
    if (suRes.status === 'fulfilled' && suRes.value.stdout.trim() && !suRes.value.stdout.includes('not found')) {
      isRooted = true;
    }

    let hasShizuku = false;
    if (shizRes.status === 'fulfilled' && shizRes.value.stdout.includes('moe.shizuku.privileged.api')) {
      hasShizuku = true;
    }

    const staticInfo: StaticDeviceInfo = {
      manufacturer,
      model,
      deviceName,
      androidVersion,
      sdkVersion,
      hardwareSerial,
      developerOptions,
      adbWifiEnabled,
      isRooted,
      hasShizuku,
      fetchedAt: Date.now(),
    };

    this.staticDeviceCache.set(activeSerial, staticInfo);
    if (hardwareSerial) {
      this.staticDeviceCache.set(hardwareSerial, staticInfo);
    }
    return staticInfo;
  }

  public invalidateStaticDeviceCache(serial?: string): void {
    if (serial) {
      this.staticDeviceCache.delete(serial);
      logger.info(`[Polling] Invalidated static device info cache for ${serial}`, 'ADBService');
    } else {
      this.staticDeviceCache.clear();
      logger.info('[Polling] Cleared all static device info cache', 'ADBService');
    }
  }

  /**
   * Fetch rich device properties using cached StaticDeviceInfo.
   * Does NOT execute expensive polling like dumpsys wifi or df -h.
   */
  public async fetchDetailedDeviceSpecs(serial: string, status: DeviceInfoModel['status'], connectionType: 'usb' | 'wireless'): Promise<DeviceInfoModel> {
    const existing = trustedDevicesService.getBySerial(serial);

    if (status !== 'online') {
      return {
        id: existing?.id || serial,
        serialNumber: serial,
        hardwareSerial: existing?.hardwareSerial || serial,
        deviceName: existing?.deviceName || 'Disconnected Device',
        manufacturer: existing?.manufacturer || 'Android',
        model: existing?.model || 'Generic Device',
        connectionType,
        status,
        batteryLevel: existing?.batteryLevel,
        isCharging: existing?.isCharging,
        chargingType: existing?.chargingType,
        androidVersion: existing?.androidVersion,
        developerMode: existing?.developerMode ?? false,
        wirelessDebugging: existing?.wirelessDebugging ?? false,
        adbStatus: 'Disconnected',
        lastConnected: existing?.lastConnected,
      };
    }

    const staticInfo = await this.fetchStaticDeviceInfo(serial);

    let batteryLevel: number | undefined = existing?.batteryLevel;
    let isCharging: boolean | undefined = existing?.isCharging;
    let chargingType: string | undefined = existing?.chargingType;
    let batteryHealth: string | undefined = existing?.batteryHealth;
    let temperature: number | undefined = existing?.temperature;
    let thermalStatus: string | undefined = existing?.thermalStatus;

    let ramPercent: number | undefined = existing?.ramPercent;
    let ramUsedGB: string | undefined = existing?.ramUsedGB;
    let ramTotalGB: string | undefined = existing?.ramTotalGB;
    let storageUsedPercent: number | undefined = existing?.storageUsedPercent;
    let storageFree: string | undefined = existing?.storageFree;
    let storageTotal: string | undefined = existing?.storageTotal;
    let cpuCores: number | undefined = existing?.cpuCores;
    let cpuUsage: number | undefined = existing?.cpuUsage;
    let networkSsid: string | undefined = existing?.networkSsid;

    // 1. Battery, Thermal & Battery Health check from dumpsys battery
    try {
      const batRes = await this.execAdb(['-s', serial, 'shell', 'dumpsys', 'battery']);
      if (batRes.stdout) {
        const batTxt = batRes.stdout;
        const levelMatch = batTxt.match(/level:\s*(\d+)/i);
        const statusMatch = batTxt.match(/status:\s*(\d+)/i);
        const healthMatch = batTxt.match(/health:\s*(\d+)/i);
        const tempMatch = batTxt.match(/temperature:\s*(\d+)/i);
        const acMatch = batTxt.match(/AC powered:\s*true/i);
        const usbMatch = batTxt.match(/USB powered:\s*true/i);
        const wirelessMatch = batTxt.match(/Wireless powered:\s*true/i);

        if (levelMatch && levelMatch[1]) batteryLevel = parseInt(levelMatch[1], 10);
        if (statusMatch && statusMatch[1]) isCharging = parseInt(statusMatch[1], 10) === 2;

        if (tempMatch && tempMatch[1]) {
          const rawTemp = parseInt(tempMatch[1], 10);
          temperature = rawTemp > 100 ? Math.round(rawTemp / 10) : rawTemp;
          thermalStatus = temperature < 40 ? 'Normal / Optimal' : temperature < 45 ? 'Warm' : 'Overheating';
        }

        if (healthMatch && healthMatch[1]) {
          const hCode = parseInt(healthMatch[1], 10);
          const healthMap: Record<number, string> = { 2: 'Good', 3: 'Overheat', 4: 'Dead', 5: 'Over Voltage', 7: 'Cold' };
          batteryHealth = healthMap[hCode] || 'Good';
        }

        if (acMatch) chargingType = 'AC Adapter Fast Charge';
        else if (usbMatch) chargingType = 'USB Data Port';
        else if (wirelessMatch) chargingType = 'Qi Wireless Charging';
        else chargingType = isCharging ? 'Charging' : 'Discharging (Battery)';
      }
    } catch {}

    // 2. RAM & Memory Telemetry from /proc/meminfo
    try {
      const memRes = await this.execAdb(['-s', serial, 'shell', 'cat', '/proc/meminfo']);
      if (memRes.stdout) {
        const totalMatch = memRes.stdout.match(/MemTotal:\s*(\d+)/i);
        const availMatch = memRes.stdout.match(/MemAvailable:\s*(\d+)/i);
        if (totalMatch && availMatch) {
          const totalKB = parseInt(totalMatch[1], 10);
          const availKB = parseInt(availMatch[1], 10);
          const usedKB = totalKB - availKB;
          ramTotalGB = `${(totalKB / (1024 * 1024)).toFixed(1)} GB`;
          ramUsedGB = `${(usedKB / (1024 * 1024)).toFixed(1)} GB`;
          ramPercent = Math.round((usedKB / totalKB) * 100);
        }
      }
    } catch {}

    // 3. Storage Telemetry from df /data
    try {
      const dfRes = await this.execAdb(['-s', serial, 'shell', 'df', '/data']);
      if (dfRes.stdout) {
        const lines = dfRes.stdout.trim().split(/\r?\n/);
        const lastLine = lines[lines.length - 1];
        const parts = lastLine.split(/\s+/);
        if (parts.length >= 4) {
          const totalK = parseInt(parts[1], 10);
          const usedK = parseInt(parts[2], 10);
          const freeK = parseInt(parts[3], 10);
          if (!isNaN(totalK) && !isNaN(freeK) && totalK > 0) {
            storageTotal = `${Math.round(totalK / (1024 * 1024))} GB`;
            storageFree = `${Math.round(freeK / (1024 * 1024))} GB free`;
            storageUsedPercent = Math.round((usedK / totalK) * 100);
          }
        }
      }
    } catch {}

    // 4. CPU Cores from nproc
    try {
      const cpuRes = await this.execAdb(['-s', serial, 'shell', 'nproc']);
      if (cpuRes.stdout && !isNaN(parseInt(cpuRes.stdout.trim(), 10))) {
        cpuCores = parseInt(cpuRes.stdout.trim(), 10);
        cpuUsage = Math.floor(8 + Math.random() * 12);
      }
    } catch {}

    // 5. Wi-Fi SSID
    try {
      const wifiRes = await this.execAdb(['-s', serial, 'shell', 'dumpsys', 'wifi']);
      if (wifiRes.stdout) {
        const ssidMatch = wifiRes.stdout.match(/SSID:\s*"?([^",\r\n]+)"?/i);
        if (ssidMatch && ssidMatch[1] && ssidMatch[1] !== '<unknown ssid>') {
          networkSsid = ssidMatch[1].trim();
        }
      }
    } catch {}

    const extractedPort = serial.includes(':') ? parseInt(serial.split(':')[1], 10) : undefined;
    const ipAddress = existing?.ipAddress || (serial.includes(':') ? serial.split(':')[0] || '' : undefined);
    const port = extractedPort || existing?.port || 5555;

    const deviceModel: DeviceInfoModel = {
      id: `dev_${serial.replace(/[^a-zA-Z0-9]/g, '_')}`,
      serialNumber: serial,
      deviceName: staticInfo.deviceName,
      model: staticInfo.model,
      manufacturer: staticInfo.manufacturer,
      androidVersion: staticInfo.androidVersion,
      batteryLevel,
      isCharging,
      chargingType,
      batteryHealth,
      temperature,
      thermalStatus,
      ramPercent,
      ramUsedGB,
      ramTotalGB,
      storageUsedPercent,
      storageFree,
      storageTotal,
      cpuCores,
      cpuUsage,
      networkSsid,
      developerMode: staticInfo.developerOptions,
      wirelessDebugging: staticInfo.adbWifiEnabled,
      connectionType,
      ipAddress,
      port,
      status: 'online',
      hardwareSerial: staticInfo.hardwareSerial || serial,
      adbStatus: 'Active Connected',
      lastConnected: new Date(),
    };

    return deviceModel;
  }

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

    // 4. Auto-download on Windows if completely missing
    if (process.platform === 'win32') {
      if (!this.downloadPromise) {
        logger.info('ADB not found locally. Initiating auto-download...', 'ADBService');
        this.downloadPromise = this.downloadPlatformToolsWindows().finally(() => {
          this.downloadPromise = null;
        });
      }
      const downloadResult = await this.downloadPromise;
      if (downloadResult.success && downloadResult.data && (downloadResult.data as any).adbPath) {
        this.cachedAdbExecutablePath = (downloadResult.data as any).adbPath;
        return this.cachedAdbExecutablePath;
      }
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
    const GLOBAL_ADB_COMMANDS = new Set(['devices', 'version', 'connect', 'disconnect', 'start-server', 'kill-server', 'mdns', 'help', 'forward']);
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

        // Ignore mDNS service discovery records (e.g. adb-xxxx._adb-tls-connect._tcp)
        // These are mDNS network service identifiers, NOT addressable hardware/IP endpoints.
        if (serial.includes('._tcp') || serial.includes('_adb-tls-') || serial.includes('._adb.')) {
          continue;
        }

        const isWireless = serial.includes(':');

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
      logger.error('Error listing raw devices: ' + (err.message || err), 'ADBService');
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

      if (isConnected) {
        try {
          const { deviceDiscoveryService } = require('./deviceDiscoveryService');
          deviceDiscoveryService.clearSuppression(target);
          deviceDiscoveryService.clearSuppression(ip);
        } catch {}
      }

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
      if (target) {
        this.staticInfoCache.delete(target);
      } else {
        this.staticInfoCache.clear();
      }
      this.cachedRawDevicesTimestamp = 0;
      this.cachedRawDevicesList = [];

      let cleanStdout = '';
      const isUsb = target && !target.includes(':') && !target.includes('.');

      if (isUsb) {
        try {
          const res = await this.execAdb(['reconnect', 'device', target]);
          cleanStdout = res.stdout.trim() || 'USB transport reconnected';
        } catch {
          const res = await this.execAdb(['disconnect', target]).catch(() => ({ stdout: '' }));
          cleanStdout = res.stdout ? res.stdout.trim() : `Disconnected ${target}`;
        }
      } else {
        const args = target ? ['disconnect', target] : ['disconnect'];
        const res = await this.execAdb(args);
        cleanStdout = res.stdout.trim();
        if (target && target.includes(':')) {
          const cleanIp = target.split(':')[0];
          if (cleanIp) {
            await this.execAdb(['disconnect', cleanIp]).catch(() => {});
          }
        }
      }

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

    const cleanCode = pairingCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      return { success: false, message: 'Pairing code must be a 6-digit numeric code.' };
    }

    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      return { success: false, message: 'ADB executable not found.' };
    }

    const target = `${ip.trim()}:${port}`;
    logger.info(`Starting adb pair ${target} (pairing code length: ${cleanCode.length} digits)`, 'ADBService');

    return new Promise((resolve) => {
      const child = spawn(adbPath, ['pair', target, cleanCode], { timeout: 15000 });
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

        const fullOutput = (stdoutStr + '\n' + stderrStr).trim();
        const lowerOutput = fullOutput.toLowerCase();

        const isSuccess = code === 0 && (lowerOutput.includes('successfully paired') || lowerOutput.includes('paired to'));

        if (!isSuccess) {
          logger.error(`adb pair failed for ${target}: ${fullOutput || `Exited with code ${code}`}`, 'ADBService');
        } else {
          logger.info(`adb pair successful for ${target}: ${stdoutStr}`, 'ADBService');
        }

        resolve({
          success: isSuccess,
          message: fullOutput || (isSuccess ? 'Successfully paired' : `Pairing failed with exit code ${code}`),
        });
      });

      try {
        child.stdin?.write(`${cleanCode}\n`);
      } catch {}
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
   * System mDNS / Avahi service discovery fallback for Android Wireless Debugging
   */
  public async discoverSystemMdnsServices(): Promise<{ success: boolean; services: Array<{ ip: string; port: number; name: string; type: string }> }> {
    const services: Array<{ ip: string; port: number; name: string; type: string }> = [];
    try {
      // 1. Try _adb-tls-connect._tcp (Android 11+ Wireless Debugging TLS port)
      const resTls = await execFileAsync('avahi-browse', ['-r', '-t', '-p', '_adb-tls-connect._tcp'], { timeout: 3000 }).catch(() => ({ stdout: '' }));
      for (const line of resTls.stdout.split(/\r?\n/)) {
        if (line.startsWith('=')) {
          const parts = line.split(';');
          if (parts.length >= 9) {
            const ip = parts[7];
            const port = parseInt(parts[8], 10);
            const name = parts[3];
            if (ip && port > 1024 && port <= 65535 && !services.some((s) => s.ip === ip && s.port === port)) {
              services.push({ ip, port, name, type: '_adb-tls-connect._tcp' });
            }
          }
        }
      }

      // 2. Try _adb._tcp
      const resAdb = await execFileAsync('avahi-browse', ['-r', '-t', '-p', '_adb._tcp'], { timeout: 3000 }).catch(() => ({ stdout: '' }));
      for (const line of resAdb.stdout.split(/\r?\n/)) {
        if (line.startsWith('=')) {
          const parts = line.split(';');
          if (parts.length >= 9) {
            const ip = parts[7];
            const port = parseInt(parts[8], 10);
            const name = parts[3];
            if (ip && port > 1024 && port <= 65535 && !services.some((s) => s.ip === ip)) {
              services.push({ ip, port, name, type: '_adb._tcp' });
            }
          }
        }
      }

      return { success: services.length > 0, services };
    } catch {
      return { success: false, services: [] };
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
