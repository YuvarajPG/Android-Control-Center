import { adbService } from './adbService';
import { trustedDevicesService, DeviceInfoModel, DeviceTransport } from './trustedDevicesService';
import { ElectronUtils } from '../utils/electronUtils';
import { logger } from './loggerService';

export class DeviceDiscoveryService {
  private static instance: DeviceDiscoveryService;
  private discoveryInterval: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;
  private cachedDevices: DeviceInfoModel[] = [];
  private adbFailCount: number = 0;
  private previousActiveSerials: Set<string> = new Set();
  private lastEmitTimestamp: number = 0;
  private preferredTransportMap: Map<string, 'usb' | 'wireless'> = new Map();

  // Feature Flag: Toggle to enable/disable automatic Wireless ADB reconnection & tcpip setup
  public enableAutoWirelessReconnect: boolean = false;

  private constructor() {}

  public static getInstance(): DeviceDiscoveryService {
    if (!DeviceDiscoveryService.instance) {
      DeviceDiscoveryService.instance = new DeviceDiscoveryService();
    }
    return DeviceDiscoveryService.instance;
  }

  private currentDiscoverySessionId: number = 0;
  private isDiscoveryActive: boolean = false;
  private currentAttempt: number = 0;
  private maxAttempts: number = 5;

  /**
   * Allow user to set preferred transport for a logical device
   */
  public setPreferredTransport(targetIdOrSerial: string, transport: 'usb' | 'wireless'): DeviceInfoModel[] {
    const dev = this.cachedDevices.find(
      (d) =>
        d.id === targetIdOrSerial ||
        d.serialNumber === targetIdOrSerial ||
        d.hardwareSerial === targetIdOrSerial ||
        d.availableTransports?.some((t) => t.serial === targetIdOrSerial),
    );

    if (dev) {
      const key = dev.hardwareSerial || dev.id;
      this.preferredTransportMap.set(key, transport);
      dev.preferredTransport = transport;

      const targetTransport = dev.availableTransports?.find((t) => t.type === transport);
      if (targetTransport) {
        dev.connectionType = targetTransport.type;
        dev.serialNumber = targetTransport.serial;
        if (targetTransport.ipAddress) dev.ipAddress = targetTransport.ipAddress;
        if (targetTransport.port) dev.port = targetTransport.port;
      }

      trustedDevicesService.saveDevice(dev);
      logger.info(`Set preferred transport for ${dev.deviceName} to ${transport.toUpperCase()} (${dev.serialNumber})`, 'DeviceDiscoveryService');
      ElectronUtils.sendToRenderer('device:list-updated', this.cachedDevices);
    }
    return this.cachedDevices;
  }

  /**
   * Run ONE bounded event-driven discovery session with max 5 retries and exponential backoff.
   * Automatic execution skipped if enableAutoWirelessReconnect is false unless explicitly user-initiated.
   */
  public async startBoundedDiscoverySession(
    onProgress?: (attempt: number, max: number, status: string) => void,
    isUserInitiated: boolean = false,
  ): Promise<{ success: boolean; devices: DeviceInfoModel[] }> {
    this.currentDiscoverySessionId++;
    const sessionId = this.currentDiscoverySessionId;
    this.isDiscoveryActive = true;
    this.currentAttempt = 0;

    logger.info(`Starting discovery session #${sessionId} (User Initiated: ${isUserInitiated})`, 'DeviceDiscoveryService');

    // Skip automatic background wireless reconnect if flag is disabled and session is not explicitly user-initiated
    if (!isUserInitiated && !this.enableAutoWirelessReconnect) {
      logger.info('Automatic Wireless Reconnect is currently disabled. Skipping automatic wireless reconnect attempt.', 'DeviceDiscoveryService');
      const scanned = await this.scanDevices();
      this.isDiscoveryActive = false;
      return { success: true, devices: scanned };
    }

    const trusted = trustedDevicesService.getAll();
    const wirelessTrusted = trusted.filter((d) => d.ipAddress && d.ipAddress !== '127.0.0.1');

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (this.currentDiscoverySessionId !== sessionId) {
        logger.info(`Discovery session #${sessionId} cancelled.`, 'DeviceDiscoveryService');
        return { success: false, devices: this.cachedDevices };
      }

      this.currentAttempt = attempt;
      if (onProgress) {
        onProgress(attempt, this.maxAttempts, `Searching for trusted devices... Attempt ${attempt} of ${this.maxAttempts}`);
      }

      // Check existing connected adb devices first
      const scanned = await this.scanDevices();
      const onlineDevs = scanned.filter((d) => d.status === 'online');
      if (onlineDevs.length > 0) {
        this.isDiscoveryActive = false;
        if (onProgress) onProgress(attempt, this.maxAttempts, 'Connected');
        return { success: true, devices: scanned };
      }

      // Attempt adb connect to latest single stored endpoint per physical device
      for (const dev of wirelessTrusted) {
        if (!dev.ipAddress) continue;
        try {
          const connRes = await adbService.connectWireless(dev.ipAddress, dev.port || 5555);
          if (connRes.success) {
            const reScanned = await this.scanDevices();
            if (reScanned.some((d) => d.status === 'online')) {
              this.isDiscoveryActive = false;
              if (onProgress) onProgress(attempt, this.maxAttempts, 'Connected');
              return { success: true, devices: reScanned };
            }
          }
        } catch {
          // Ignore failed single attempt
        }
      }

      // Attempt mDNS query on attempt 2 to resolve any IP changes
      if (attempt === 2) {
        try {
          const mdnsRes = await adbService.getMdnsServices();
          if (mdnsRes.success && mdnsRes.message) {
            const lines = mdnsRes.message.split(/\r?\n/);
            for (const line of lines) {
              const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
              if (match) {
                const discIp = match[1];
                const discPort = parseInt(match[2], 10);
                await adbService.connectWireless(discIp, discPort);
              }
            }
            const reScanned = await this.scanDevices();
            if (reScanned.some((d) => d.status === 'online')) {
              this.isDiscoveryActive = false;
              if (onProgress) onProgress(attempt, this.maxAttempts, 'Connected');
              return { success: true, devices: reScanned };
            }
          }
        } catch {
          // mDNS check ignored
        }
      }

      if (attempt === this.maxAttempts) {
        break;
      }

      const waitMs = attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.isDiscoveryActive = false;
    if (onProgress) onProgress(this.maxAttempts, this.maxAttempts, 'No wireless device found');
    return { success: false, devices: this.cachedDevices };
  }

  public startDiscovery(intervalMs: number = 10000): void {
    logger.info('[Polling] Device discovery started (10s)', 'DeviceDiscoveryService');
    this.startBoundedDiscoverySession(undefined, false);
    if (!this.discoveryInterval) {
      this.discoveryInterval = setInterval(() => {
        this.scanDevices().catch(() => {});
      }, intervalMs);
    }
  }

  public stopDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    this.currentDiscoverySessionId++;
    this.isDiscoveryActive = false;
  }

  private async checkAdbHealthAndRestartIfNeeded(_error: any): Promise<void> {
    this.adbFailCount++;
    if (this.adbFailCount >= 3) {
      logger.warn('ADB server unresponsive. Executing automatic ADB restart...', 'DeviceDiscoveryService');
      this.adbFailCount = 0;
      try {
        await adbService.killServer();
        await adbService.startServer();
        ElectronUtils.sendNotification('ADB Daemon Auto-Restart', 'ADB server was restarted automatically to restore connectivity.');
      } catch (err) {
        logger.error('Failed auto-restarting ADB server', 'DeviceDiscoveryService', err);
      }
    }
  }

  private async autoConfigureWirelessForUsbDevice(usbSerial: string, specs: DeviceInfoModel): Promise<void> {
    if (!this.enableAutoWirelessReconnect) {
      logger.debug('Automatic Wireless Reconnect is currently disabled. Skipping auto-enable tcpip 5555.', 'DeviceDiscoveryService');
      return;
    }
    if (!specs.ipAddress || specs.ipAddress === '192.168.1.100') return;

    const existingTrusted = trustedDevicesService.getBySerial(specs.ipAddress);
    if (!existingTrusted || existingTrusted.ipAddress !== specs.ipAddress) {
      try {
        await adbService.execAdb(['-s', usbSerial, 'tcpip', '5555']);
        await adbService.connectWireless(specs.ipAddress, 5555);
        logger.info(`Auto-configured Wireless ADB TCP/IP for ${specs.deviceName} at ${specs.ipAddress}:5555`, 'DeviceDiscoveryService');
      } catch (err) {
        logger.warn(`Could not auto-enable TCP/IP port 5555 on ${usbSerial}`, 'DeviceDiscoveryService', err);
      }
    }
  }

  private hasDeviceListChanged(newList: DeviceInfoModel[], oldList: DeviceInfoModel[]): boolean {
    if (newList.length !== oldList.length) return true;

    for (let i = 0; i < newList.length; i++) {
      const n = newList[i];
      const o = oldList[i];
      if (
        n.serialNumber !== o.serialNumber ||
        n.status !== o.status ||
        n.connectionType !== o.connectionType ||
        n.preferredTransport !== o.preferredTransport ||
        n.ipAddress !== o.ipAddress ||
        n.batteryLevel !== o.batteryLevel ||
        n.availableTransports?.length !== o.availableTransports?.length
      ) {
        return true;
      }
    }
    return false;
  }

  private lastRawSerialsKey: string = '';

  private hasRawSerialsChanged(rawList: { serial: string; rawStatus: string; connectionType: 'usb' | 'wireless' }[]): boolean {
    const currentKey = rawList.map((r) => `${r.serial}:${r.rawStatus}:${r.connectionType}`).sort().join('|');
    if (currentKey === this.lastRawSerialsKey) {
      return false;
    }
    this.lastRawSerialsKey = currentKey;
    return true;
  }

  /**
   * Core discovery scan method: Groups USB and Wireless into UNIFIED physical device objects.
   */
  public async scanDevices(forceRefresh: boolean = false): Promise<DeviceInfoModel[]> {
    if (this.isScanning) return this.cachedDevices;
    this.isScanning = true;

    try {
      const rawList = await adbService.listRawDevices();
      this.adbFailCount = 0;

      // If raw serials list is unchanged and not forceRefresh, return cached devices immediately
      if (!forceRefresh && !this.hasRawSerialsChanged(rawList) && this.cachedDevices.length > 0) {
        logger.debug('[Polling] Device discovery (10s) — raw serials unchanged, using cache', 'DeviceDiscoveryService');
        this.isScanning = false;
        return this.cachedDevices;
      }

      logger.info('[Polling] Device discovery (10s) — updating device list', 'DeviceDiscoveryService');
      const trustedList = trustedDevicesService.getAll();
      const currentDevices: DeviceInfoModel[] = [];
      const currentActiveSerials = new Set<string>();

      // 1. Process active connected raw ADB devices
      for (const item of rawList) {
        currentActiveSerials.add(item.serial);

        let status: DeviceInfoModel['status'] = 'unknown';
        if (item.rawStatus === 'device') status = 'online';
        else if (item.rawStatus === 'unauthorized') status = 'unauthorized';
        else if (item.rawStatus === 'offline') status = 'offline';
        else if (item.rawStatus === 'connecting') status = 'connecting';

        const detailedSpecs = await adbService.fetchDetailedDeviceSpecs(item.serial, status, item.connectionType);

        if (item.connectionType === 'usb' && status === 'online') {
          this.autoConfigureWirelessForUsbDevice(item.serial, detailedSpecs).catch(() => {});
        }

        currentDevices.push(detailedSpecs);
      }

      // 2. Append remembered trusted devices that are currently offline
      for (const trustedDev of trustedList) {
        const isConnected = Array.from(currentActiveSerials).some(
          (s) => s === trustedDev.serialNumber || s.includes(trustedDev.ipAddress) || (trustedDev.hardwareSerial && s === trustedDev.hardwareSerial),
        );

        if (!isConnected) {
          currentDevices.push({
            ...trustedDev,
            status: 'offline',
          });
        }
      }

      // 3. Group raw specs by hardwareSerial to form UNIFIED physical devices
      const groupedSpecsMap = new Map<string, DeviceInfoModel[]>();

      for (const dev of currentDevices) {
        const groupKey =
          dev.hardwareSerial || (dev.model && dev.model !== 'Generic Device' ? `${dev.manufacturer}_${dev.model}` : dev.serialNumber);

        if (!groupedSpecsMap.has(groupKey)) {
          groupedSpecsMap.set(groupKey, []);
        }
        groupedSpecsMap.get(groupKey)!.push(dev);
      }

      const deduplicatedDevices: DeviceInfoModel[] = [];

      for (const [groupKey, specsList] of groupedSpecsMap.entries()) {
        const primarySpec = specsList.find((s) => s.status === 'online') || specsList[0];

        // Build list of available transports for this single logical device
        const transports: DeviceTransport[] = [];
        for (const spec of specsList) {
          const existingT = transports.find((t) => t.type === spec.connectionType);
          if (!existingT) {
            transports.push({
              type: spec.connectionType,
              serial: spec.serialNumber,
              status: spec.status,
              ipAddress: spec.ipAddress,
              port: spec.port || 5555,
            });
          } else if (spec.status === 'online' && existingT.status !== 'online') {
            existingT.status = spec.status;
            existingT.serial = spec.serialNumber;
            if (spec.ipAddress) existingT.ipAddress = spec.ipAddress;
            if (spec.port) existingT.port = spec.port;
          }
        }

        // Include remembered offline wireless transport from trusted store if missing
        const trustedMatch = trustedList.find(
          (t) => t.hardwareSerial === groupKey || t.id === primarySpec.id || (t.model === primarySpec.model && t.manufacturer === primarySpec.manufacturer),
        );
        if (trustedMatch && trustedMatch.ipAddress) {
          const hasWireless = transports.some((t) => t.type === 'wireless');
          if (!hasWireless) {
            transports.push({
              type: 'wireless',
              serial: `${trustedMatch.ipAddress}:${trustedMatch.port || 5555}`,
              status: 'offline',
              ipAddress: trustedMatch.ipAddress,
              port: trustedMatch.port || 5555,
            });
          }
        }

        // Determine user preferred transport
        const savedPref = this.preferredTransportMap.get(groupKey) || trustedMatch?.preferredTransport;
        let chosenPref: 'usb' | 'wireless' = 'usb';

        const onlineWireless = transports.find((t) => t.type === 'wireless' && t.status === 'online');
        const onlineUsb = transports.find((t) => t.type === 'usb' && t.status === 'online');

        if (savedPref && transports.some((t) => t.type === savedPref)) {
          chosenPref = savedPref;
        } else if (this.enableAutoWirelessReconnect && onlineWireless && onlineUsb) {
          chosenPref = 'wireless';
        } else if (onlineUsb) {
          chosenPref = 'usb';
        } else if (onlineWireless) {
          chosenPref = 'wireless';
        } else {
          chosenPref = transports[0].type;
        }

        const activeTransport = transports.find((t) => t.type === chosenPref) || transports[0];
        const overallStatus = transports.some((t) => t.status === 'online')
          ? 'online'
          : transports.some((t) => t.status === 'unauthorized')
            ? 'unauthorized'
            : 'offline';

        const unifiedDevice: DeviceInfoModel = {
          ...primarySpec,
          id: primarySpec.id || `dev_${groupKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
          hardwareSerial: groupKey,
          serialNumber: activeTransport.serial,
          connectionType: activeTransport.type,
          ipAddress: activeTransport.ipAddress || primarySpec.ipAddress || trustedMatch?.ipAddress || '',
          port: activeTransport.port || primarySpec.port || 5555,
          status: overallStatus,
          availableTransports: transports,
          preferredTransport: chosenPref,
        };

        trustedDevicesService.saveDevice(unifiedDevice);
        deduplicatedDevices.push(unifiedDevice);
      }

      // 4. Notifications for connections/disconnections
      for (const serial of currentActiveSerials) {
        if (!this.previousActiveSerials.has(serial)) {
          const dev = deduplicatedDevices.find((d) => d.serialNumber === serial || d.hardwareSerial === serial || d.availableTransports?.some((t) => t.serial === serial));
          if (dev) {
            ElectronUtils.sendNotification(
              'Device Connected',
              `${dev.deviceName} (${dev.manufacturer} ${dev.model}) connected`,
            );
          }
        }
      }

      this.previousActiveSerials = currentActiveSerials;

      // 5. Change detection & debounced IPC broadcast
      const hasChanged = this.hasDeviceListChanged(deduplicatedDevices, this.cachedDevices);
      const now = Date.now();
      const isDebounced = now - this.lastEmitTimestamp > 500;

      this.cachedDevices = deduplicatedDevices;

      if (hasChanged && isDebounced) {
        this.lastEmitTimestamp = now;
        logger.info(
          `[LOGICAL DEVICE CHANGE DETECTED] Emitting 'device:list-updated' (${deduplicatedDevices.length} unified devices, Online: ${deduplicatedDevices.filter((d) => d.status === 'online').length})`,
          'DeviceDiscoveryService',
        );
        ElectronUtils.sendToRenderer('device:list-updated', deduplicatedDevices);
      }

      return deduplicatedDevices;
    } catch (err) {
      await this.checkAdbHealthAndRestartIfNeeded(err);
      return this.cachedDevices;
    } finally {
      this.isScanning = false;
    }
  }

  public getCachedDevices(): DeviceInfoModel[] {
    return this.cachedDevices.length > 0 ? this.cachedDevices : trustedDevicesService.getAll();
  }
}

export const deviceDiscoveryService = DeviceDiscoveryService.getInstance();
