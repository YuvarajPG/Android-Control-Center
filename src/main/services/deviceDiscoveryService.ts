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

  private manualDisconnectSuppression: Set<string> = new Set();

  public suppressDevice(target?: string, hardwareSerial?: string): void {
    if (!target) {
      this.manualDisconnectSuppression.clear();
      return;
    }
    const cleanTarget = target.trim();
    this.manualDisconnectSuppression.add(cleanTarget);
    if (hardwareSerial) this.manualDisconnectSuppression.add(hardwareSerial.trim());
    const ip = cleanTarget.includes(':') ? cleanTarget.split(':')[0] : cleanTarget;
    if (ip) this.manualDisconnectSuppression.add(ip);

    const matchedDev = this.cachedDevices.find(
      (d) =>
        d.id === cleanTarget ||
        d.serialNumber === cleanTarget ||
        d.hardwareSerial === cleanTarget ||
        (d.ipAddress && cleanTarget.includes(d.ipAddress)) ||
        d.availableTransports?.some((t) => t.serial === cleanTarget),
    );

    if (matchedDev) {
      if (matchedDev.id) this.manualDisconnectSuppression.add(matchedDev.id);
      if (matchedDev.serialNumber) this.manualDisconnectSuppression.add(matchedDev.serialNumber);
      if (matchedDev.hardwareSerial) this.manualDisconnectSuppression.add(matchedDev.hardwareSerial);
      if (matchedDev.ipAddress) {
        const cleanIp = matchedDev.ipAddress.includes(':') ? matchedDev.ipAddress.split(':')[0] : matchedDev.ipAddress;
        this.manualDisconnectSuppression.add(cleanIp);
        if (matchedDev.port) this.manualDisconnectSuppression.add(`${cleanIp}:${matchedDev.port}`);
      }
      matchedDev.availableTransports?.forEach((t) => {
        if (t.serial) this.manualDisconnectSuppression.add(t.serial);
        if (t.ipAddress) this.manualDisconnectSuppression.add(t.ipAddress);
      });
    }

    logger.info(`[DISCONNECT] Suppressed ${cleanTarget} and all related device endpoints from active state`, 'DeviceDiscoveryService');
  }

  public clearSuppression(target?: string, hardwareSerial?: string): void {
    if (!target) {
      this.manualDisconnectSuppression.clear();
      return;
    }
    const cleanTarget = target.trim();
    this.manualDisconnectSuppression.delete(cleanTarget);
    if (hardwareSerial) this.manualDisconnectSuppression.delete(hardwareSerial.trim());
    const ip = cleanTarget.includes(':') ? cleanTarget.split(':')[0] : cleanTarget;
    if (ip) this.manualDisconnectSuppression.delete(ip);

    const matchedDev = this.cachedDevices.find(
      (d) =>
        d.id === cleanTarget ||
        d.serialNumber === cleanTarget ||
        d.hardwareSerial === cleanTarget ||
        (d.ipAddress && cleanTarget.includes(d.ipAddress)) ||
        d.availableTransports?.some((t) => t.serial === cleanTarget),
    );

    if (matchedDev) {
      if (matchedDev.id) this.manualDisconnectSuppression.delete(matchedDev.id);
      if (matchedDev.serialNumber) this.manualDisconnectSuppression.delete(matchedDev.serialNumber);
      if (matchedDev.hardwareSerial) this.manualDisconnectSuppression.delete(matchedDev.hardwareSerial);
      if (matchedDev.ipAddress) {
        const cleanIp = matchedDev.ipAddress.includes(':') ? matchedDev.ipAddress.split(':')[0] : matchedDev.ipAddress;
        this.manualDisconnectSuppression.delete(cleanIp);
        if (matchedDev.port) this.manualDisconnectSuppression.delete(`${cleanIp}:${matchedDev.port}`);
      }
      matchedDev.availableTransports?.forEach((t) => {
        if (t.serial) this.manualDisconnectSuppression.delete(t.serial);
        if (t.ipAddress) this.manualDisconnectSuppression.delete(t.ipAddress);
      });
    }

    logger.info(`[RECONNECT] Cleared suppression for ${cleanTarget}`, 'DeviceDiscoveryService');
  }

  public isSuppressed(target?: string, hardwareSerial?: string): boolean {
    if (!target) return false;
    const cleanTarget = target.trim();
    if (this.manualDisconnectSuppression.has(cleanTarget)) return true;
    if (hardwareSerial && this.manualDisconnectSuppression.has(hardwareSerial.trim())) return true;
    const ip = cleanTarget.includes(':') ? cleanTarget.split(':')[0] : cleanTarget;
    if (ip && this.manualDisconnectSuppression.has(ip)) return true;

    const dev = this.cachedDevices.find(
      (d) =>
        d.id === cleanTarget ||
        d.serialNumber === cleanTarget ||
        d.hardwareSerial === cleanTarget ||
        (d.ipAddress && cleanTarget.includes(d.ipAddress)) ||
        d.availableTransports?.some((t) => t.serial === cleanTarget),
    );

    if (dev) {
      if (dev.id && this.manualDisconnectSuppression.has(dev.id)) return true;
      if (dev.serialNumber && this.manualDisconnectSuppression.has(dev.serialNumber)) return true;
      if (dev.hardwareSerial && this.manualDisconnectSuppression.has(dev.hardwareSerial)) return true;
      if (dev.ipAddress && this.manualDisconnectSuppression.has(dev.ipAddress)) return true;
    }

    return false;
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
        if (this.isSuppressed(dev.ipAddress) || this.isSuppressed(dev.serialNumber)) {
          logger.info(`Skipping auto connect for ${dev.ipAddress} — device is manually suppressed after explicit user disconnect`, 'DeviceDiscoveryService');
          continue;
        }
        try {
          const connRes = await adbService.connectWireless(dev.ipAddress, dev.port || 5555);
          if (connRes.success) {
            const reScanned = await this.scanDevices(true);
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
      const rawList = await adbService.listRawDevices(forceRefresh);
      this.adbFailCount = 0;

      if (forceRefresh) {
        this.lastRawSerialsKey = '';
      }

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

        const isDisconnected = this.isSuppressed(item.serial);

        let status: DeviceInfoModel['status'] = 'unknown';
        if (isDisconnected) {
          status = 'offline';
        } else if (item.rawStatus === 'device') {
          status = 'online';
        } else if (item.rawStatus === 'unauthorized') {
          status = 'unauthorized';
        } else if (item.rawStatus === 'offline') {
          status = 'offline';
        } else if (item.rawStatus === 'connecting') {
          status = 'connecting';
        }

        const detailedSpecs = await adbService.fetchDetailedDeviceSpecs(item.serial, status, item.connectionType);
        
        // Ensure clean IP without port
        if (detailedSpecs.ipAddress) {
          detailedSpecs.ipAddress = detailedSpecs.ipAddress.includes(':') ? detailedSpecs.ipAddress.split(':')[0] : detailedSpecs.ipAddress;
        }

        if (item.connectionType === 'usb' && status === 'online') {
          this.autoConfigureWirelessForUsbDevice(item.serial, detailedSpecs).catch(() => {});
        }

        currentDevices.push(detailedSpecs);
      }

      // 2. Append remembered trusted devices that are currently offline
      for (const trustedDev of trustedList) {
        const cleanTrustedIp = trustedDev.ipAddress && trustedDev.ipAddress.includes(':') ? trustedDev.ipAddress.split(':')[0] : trustedDev.ipAddress;

        const isConnected = Array.from(currentActiveSerials).some(
          (s) =>
            s === trustedDev.serialNumber ||
            (cleanTrustedIp && s.includes(cleanTrustedIp)) ||
            (trustedDev.hardwareSerial && !trustedDev.hardwareSerial.includes(':') && s === trustedDev.hardwareSerial),
        );

        if (!isConnected) {
          currentDevices.push({
            ...trustedDev,
            ipAddress: cleanTrustedIp,
            status: 'offline',
          });
        }
      }

      // 3. Group raw specs by physical device identity to form UNIFIED physical devices
      const groupedSpecsMap = new Map<string, DeviceInfoModel[]>();

      for (const dev of currentDevices) {
        let targetKey: string | null = null;
        const devIp = dev.ipAddress && dev.ipAddress.includes(':') ? dev.ipAddress.split(':')[0] : dev.ipAddress;

        for (const [existingKey, list] of groupedSpecsMap.entries()) {
          const match = list.some((existing) => {
            const existIp = existing.ipAddress && existing.ipAddress.includes(':') ? existing.ipAddress.split(':')[0] : existing.ipAddress;

            const isHwMatch = Boolean(
              dev.hardwareSerial &&
              existing.hardwareSerial &&
              !dev.hardwareSerial.includes(':') &&
              !existing.hardwareSerial.includes(':') &&
              dev.hardwareSerial === existing.hardwareSerial
            );

            const isIpMatch = Boolean(devIp && existIp && devIp === existIp);

            const isModelMatch = Boolean(
              dev.manufacturer &&
              existing.manufacturer &&
              dev.model &&
              existing.model &&
              dev.model !== 'Generic Device' &&
              dev.model !== 'Android Phone' &&
              dev.model !== 'Android Device' &&
              dev.manufacturer.toLowerCase() === existing.manufacturer.toLowerCase() &&
              dev.model.toLowerCase() === existing.model.toLowerCase()
            );

            return isHwMatch || isIpMatch || isModelMatch;
          });
          if (match) {
            targetKey = existingKey;
            break;
          }
        }

        const groupKey = targetKey || (dev.hardwareSerial && !dev.hardwareSerial.includes(':') ? dev.hardwareSerial : devIp ? `ip_${devIp}` : dev.serialNumber);
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
          const cleanSpecIp = spec.ipAddress && spec.ipAddress.includes(':') ? spec.ipAddress.split(':')[0] : spec.ipAddress;
          const existingT = transports.find((t) => t.type === spec.connectionType);
          if (!existingT) {
            transports.push({
              type: spec.connectionType,
              serial: spec.serialNumber,
              status: spec.status,
              ipAddress: cleanSpecIp,
              port: spec.port || 5555,
            });
          } else if (spec.status === 'online' && existingT.status !== 'online') {
            existingT.status = spec.status;
            existingT.serial = spec.serialNumber;
            if (cleanSpecIp) existingT.ipAddress = cleanSpecIp;
            if (spec.port) existingT.port = spec.port;
          }
        }

        // Include remembered offline wireless transport ONLY if it was explicitly a wireless device with a real port
        const trustedMatch = trustedList.find(
          (t) => t.hardwareSerial === groupKey || t.serialNumber === groupKey || t.id === primarySpec.id,
        );
        if (trustedMatch && trustedMatch.connectionType === 'wireless' && trustedMatch.ipAddress && trustedMatch.port) {
          const hasWireless = transports.some((t) => t.type === 'wireless');
          if (!hasWireless) {
            const cleanTrustedIp = trustedMatch.ipAddress.includes(':') ? trustedMatch.ipAddress.split(':')[0] : trustedMatch.ipAddress;
            transports.push({
              type: 'wireless',
              serial: `${cleanTrustedIp}:${trustedMatch.port}`,
              status: 'offline',
              ipAddress: cleanTrustedIp,
              port: trustedMatch.port,
            });
          }
        }

        // Determine user preferred / active transport with strict online failover
        const savedPref = this.preferredTransportMap.get(groupKey) || trustedMatch?.preferredTransport;
        const onlineUsb = transports.find((t) => t.type === 'usb' && t.status === 'online');
        const onlineWireless = transports.find((t) => t.type === 'wireless' && t.status === 'online');

        let chosenPref: 'usb' | 'wireless' = 'usb';

        if (savedPref && transports.some((t) => t.type === savedPref && t.status === 'online')) {
          chosenPref = savedPref;
        } else if (onlineUsb) {
          chosenPref = 'usb';
          if (savedPref && savedPref !== 'usb') {
            this.preferredTransportMap.set(groupKey, 'usb');
          }
        } else if (onlineWireless) {
          chosenPref = 'wireless';
          if (savedPref && savedPref !== 'wireless') {
            this.preferredTransportMap.set(groupKey, 'wireless');
          }
        } else if (savedPref && transports.some((t) => t.type === savedPref)) {
          chosenPref = savedPref;
        } else {
          chosenPref = transports[0]?.type || 'usb';
        }

        const activeTransport = transports.find((t) => t.type === chosenPref) || transports[0];
        const overallStatus = transports.some((t) => t.status === 'online')
          ? 'online'
          : transports.some((t) => t.status === 'unauthorized')
            ? 'unauthorized'
            : 'offline';

        const isTrustedDevice = Boolean(trustedMatch && trustedMatch.isTrusted);

        let cleanDeviceName = primarySpec.deviceName;
        if (!cleanDeviceName || cleanDeviceName.includes('._tcp') || cleanDeviceName.includes('_adb-tls-') || cleanDeviceName === 'Disconnected Device') {
          cleanDeviceName = `${primarySpec.manufacturer || 'Android'} ${primarySpec.model || 'Device'}`;
        }

        const primaryCleanIp = primarySpec.ipAddress && primarySpec.ipAddress.includes(':') ? primarySpec.ipAddress.split(':')[0] : primarySpec.ipAddress;

        const unifiedDevice: DeviceInfoModel = {
          ...primarySpec,
          id: primarySpec.id || `dev_${groupKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
          deviceName: cleanDeviceName,
          hardwareSerial: groupKey,
          serialNumber: activeTransport.serial,
          connectionType: activeTransport.type,
          ipAddress: activeTransport.ipAddress || primaryCleanIp || (trustedMatch?.ipAddress ? trustedMatch.ipAddress.split(':')[0] : ''),
          port: activeTransport.port || primarySpec.port || 5555,
          status: overallStatus,
          isTrusted: isTrustedDevice,
          availableTransports: transports,
          preferredTransport: chosenPref,
        };

        if (isTrustedDevice) {
          trustedDevicesService.saveDevice(unifiedDevice);
        }

        deduplicatedDevices.push(unifiedDevice);
      }

      // 4. Final Deduplication Pass: Filter out any stale/generic offline records if an online physical device exists
      const onlinePhysicalKeys = new Set<string>();
      for (const dev of deduplicatedDevices) {
        if (dev.status === 'online') {
          if (dev.hardwareSerial) onlinePhysicalKeys.add(dev.hardwareSerial);
          if (dev.ipAddress) onlinePhysicalKeys.add(dev.ipAddress);
          if (dev.manufacturer && dev.model) onlinePhysicalKeys.add(`${dev.manufacturer.toLowerCase()}_${dev.model.toLowerCase()}`);
        }
      }

      const finalDevices = deduplicatedDevices.filter((dev) => {
        if (dev.status === 'offline') {
          // If an offline device is untrusted (deleted/forgotten by user), remove it from UI completely
          if (!dev.isTrusted) {
            logger.info(`[Deduplication Pass] Dropped untrusted offline device '${dev.deviceName}' (${dev.serialNumber})`, 'DeviceDiscoveryService');
            return false;
          }

          const isGenericOrStale = dev.deviceName === 'Disconnected Device' || dev.model === 'Generic Device' || dev.model === 'Android Phone' || dev.hardwareSerial?.includes(':');
          const devIp = dev.ipAddress && dev.ipAddress.includes(':') ? dev.ipAddress.split(':')[0] : dev.ipAddress;
          const devModelKey = dev.manufacturer && dev.model ? `${dev.manufacturer.toLowerCase()}_${dev.model.toLowerCase()}` : '';

          const hasOnlineMatch = Boolean(
            (devIp && onlinePhysicalKeys.has(devIp)) ||
            (dev.hardwareSerial && onlinePhysicalKeys.has(dev.hardwareSerial)) ||
            (devModelKey && onlinePhysicalKeys.has(devModelKey))
          );

          if (isGenericOrStale && hasOnlineMatch) {
            logger.info(`[Deduplication Pass] Dropped stale offline record '${dev.deviceName}' (${dev.serialNumber}) matching online physical device`, 'DeviceDiscoveryService');
            return false;
          }
        }
        return true;
      });

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
      const hasChanged = this.hasDeviceListChanged(finalDevices, this.cachedDevices);
      const now = Date.now();
      const isDebounced = now - this.lastEmitTimestamp > 500;

      this.cachedDevices = finalDevices;

      if (hasChanged && isDebounced) {
        this.lastEmitTimestamp = now;
        const onlineCount = finalDevices.filter((d) => d.status === 'online').length;
        const offlineCount = finalDevices.filter((d) => d.status === 'offline').length;
        logger.info(
          `[LOGICAL DEVICE CHANGE DETECTED] Emitting 'device:list-updated' (${onlineCount} online device(s), ${offlineCount} offline/history device(s))`,
          'DeviceDiscoveryService',
        );
        ElectronUtils.sendToRenderer('device:list-updated', finalDevices);
      }

      return finalDevices;
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

  public getOnlineDevices(): DeviceInfoModel[] {
    return this.cachedDevices.filter((d) => d.status === 'online');
  }
}

export const deviceDiscoveryService = DeviceDiscoveryService.getInstance();
