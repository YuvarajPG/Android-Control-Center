import fs from 'fs';
import path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { logger } from './loggerService';

export interface DeviceTransport {
  type: 'usb' | 'wireless';
  serial: string;
  status: 'online' | 'offline' | 'unauthorized' | 'connecting' | 'unknown';
  ipAddress?: string;
  port?: number;
}

export interface DeviceInfoModel {
  id: string;
  serialNumber: string;
  deviceName: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  batteryLevel: number;
  isCharging: boolean;
  chargingType: string;
  storageFree: string;
  storageTotal: string;
  storageUsedPercent: number;
  cpuUsage: number;
  cpuModel: string;
  cpuCores: number;
  ramUsedGB: string;
  ramTotalGB: string;
  ramPercent: number;
  temperature: number;
  thermalStatus: string;
  networkSsid?: string;
  networkRssi?: number;
  networkType?: 'wifi' | 'cellular' | 'none';
  carrierName?: string;
  cellularGeneration?: string;
  connectionType: 'usb' | 'wireless';
  ipAddress: string;
  port: number;
  status: 'online' | 'offline' | 'unauthorized' | 'connecting' | 'unknown';
  adbStatus: string;
  developerMode: boolean;
  wirelessDebugging: boolean;
  hardwareSerial?: string;
  lastConnected: string;
  isTrusted: boolean;
  availableTransports?: DeviceTransport[];
  preferredTransport?: 'usb' | 'wireless';
}

export function cleanIp(ip?: string): string {
  if (!ip) return '';
  const trimmed = ip.trim();
  if (trimmed.includes(':')) {
    return trimmed.split(':')[0] || '';
  }
  return trimmed;
}

export class TrustedDevicesService {
  private static instance: TrustedDevicesService;
  private filePath: string;
  private trustedDevices: Map<string, DeviceInfoModel> = new Map();

  private constructor() {
    this.filePath = path.join(PathUtils.getUserDataPath(), 'trusted_devices.json');
    this.loadFromDisk();
  }

  public static getInstance(): TrustedDevicesService {
    if (!TrustedDevicesService.instance) {
      TrustedDevicesService.instance = new TrustedDevicesService();
    }
    return TrustedDevicesService.instance;
  }

  private isValidHardwareSerial(s?: string): boolean {
    if (!s) return false;
    const trimmed = s.trim();
    if (!trimmed || trimmed.includes(':') || trimmed.includes('._tcp') || trimmed.includes('_adb-tls-') || trimmed.toLowerCase() === 'unknown') {
      return false;
    }
    return true;
  }

  private getDeviceKey(item: Partial<DeviceInfoModel>): string {
    if (this.isValidHardwareSerial(item.hardwareSerial)) {
      return item.hardwareSerial!.trim();
    }
    if (item.manufacturer && item.model && item.model !== 'Generic Device' && item.model !== 'Android Phone') {
      return `${item.manufacturer}_${item.model}`;
    }
    if (this.isValidHardwareSerial(item.serialNumber)) {
      return item.serialNumber!.trim();
    }
    const cIp = cleanIp(item.ipAddress);
    if (cIp) {
      return `ip_${cIp}`;
    }
    return item.id || `dev_${Date.now()}`;
  }

  public normalizeAndDeduplicateStore(): void {
    const list = Array.from(this.trustedDevices.values());
    this.trustedDevices.clear();

    for (const item of list) {
      item.ipAddress = cleanIp(item.ipAddress);

      if (!this.isValidHardwareSerial(item.hardwareSerial)) {
        item.hardwareSerial = this.isValidHardwareSerial(item.serialNumber)
          ? item.serialNumber
          : item.manufacturer && item.model && item.model !== 'Generic Device'
          ? `${item.manufacturer}_${item.model}`
          : item.ipAddress
          ? `ip_${item.ipAddress}`
          : item.id;
      }

      if (!item.deviceName || item.deviceName.includes('._tcp') || item.deviceName.includes('_adb-tls-') || item.deviceName === 'Disconnected Device') {
        item.deviceName = `${item.manufacturer || 'Android'} ${item.model || 'Device'}`;
      }

      const key = this.getDeviceKey(item);
      const existing = this.trustedDevices.get(key);

      if (!existing) {
        this.trustedDevices.set(key, item);
      } else {
        const latestTime = new Date(item.lastConnected).getTime() > new Date(existing.lastConnected).getTime();
        const merged: DeviceInfoModel = {
          ...existing,
          ...(latestTime ? item : {}),
          id: existing.id || item.id,
          hardwareSerial: existing.hardwareSerial || item.hardwareSerial,
          ipAddress: item.ipAddress || existing.ipAddress,
          port: (latestTime && item.port) ? item.port : existing.port,
          deviceName: existing.deviceName && !existing.deviceName.includes('Disconnected') ? existing.deviceName : item.deviceName,
          model: existing.model && existing.model !== 'Generic Device' ? existing.model : item.model,
          manufacturer: existing.manufacturer && existing.manufacturer !== 'Android' ? existing.manufacturer : item.manufacturer,
          availableTransports: item.availableTransports || existing.availableTransports,
          isTrusted: true,
        };
        this.trustedDevices.set(key, merged);
      }
    }
    this.saveToDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: DeviceInfoModel[] = JSON.parse(raw);
        for (const item of list) {
          const key = this.getDeviceKey(item);
          if (key) {
            const existing = this.trustedDevices.get(key);
            if (!existing || new Date(item.lastConnected).getTime() > new Date(existing.lastConnected).getTime()) {
              this.trustedDevices.set(key, item);
            }
          }
        }
        this.normalizeAndDeduplicateStore();
        logger.info(`Loaded ${this.trustedDevices.size} unique physical trusted devices from store`, 'TrustedDevicesService');
      }
    } catch (err) {
      logger.error('Failed reading trusted devices file', 'TrustedDevicesService', err);
    }
  }

  private saveToDisk(): void {
    try {
      const list = Array.from(this.trustedDevices.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed saving trusted devices file', 'TrustedDevicesService', err);
    }
  }

  public getAll(): DeviceInfoModel[] {
    return Array.from(this.trustedDevices.values());
  }

  public getAllDevices(): DeviceInfoModel[] {
    return this.getAll();
  }

  public getTrustedDevices(): DeviceInfoModel[] {
    return this.getAll();
  }

  public getBySerial(serial: string): DeviceInfoModel | undefined {
    if (!serial) return undefined;
    const cleanSerial = serial.trim();
    if (!cleanSerial) return undefined;

    for (const dev of this.trustedDevices.values()) {
      if (
        (dev.hardwareSerial && dev.hardwareSerial === cleanSerial) ||
        (dev.id && dev.id === cleanSerial) ||
        (dev.serialNumber && dev.serialNumber === cleanSerial) ||
        (dev.ipAddress && dev.ipAddress === cleanSerial) ||
        dev.availableTransports?.some((t) => t.serial === cleanSerial)
      ) {
        return dev;
      }
    }
    return undefined;
  }

  public saveDevice(device: DeviceInfoModel): void {
    const key = this.getDeviceKey(device);
    const existing = this.trustedDevices.get(key) || this.getBySerial(device.serialNumber);

    const mergedTransports = device.availableTransports || existing?.availableTransports || [];

    const updated: DeviceInfoModel = {
      ...existing,
      ...device,
      id: existing?.id || device.id || `dev_${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
      hardwareSerial: device.hardwareSerial || existing?.hardwareSerial || (device.serialNumber.includes(':') ? '' : device.serialNumber),
      ipAddress: device.ipAddress || existing?.ipAddress || '',
      port: device.port || existing?.port || 5555,
      availableTransports: mergedTransports,
      preferredTransport: device.preferredTransport || existing?.preferredTransport || device.connectionType,
      isTrusted: true,
      lastConnected: new Date().toISOString(),
    };

    const finalKey = this.getDeviceKey(updated);
    this.trustedDevices.set(finalKey, updated);
    this.saveToDisk();
  }

  public addDevice(entry: {
    serialNumber: string;
    deviceName: string;
    model: string;
    manufacturer?: string;
    ipAddress?: string;
    port?: number;
    connectionType: 'usb' | 'wireless';
    lastConnected: number;
    hardwareSerial?: string;
  }): void {
    const existing = this.getBySerial(entry.hardwareSerial || entry.serialNumber);
    const updated: DeviceInfoModel = {
      id: existing?.id || `dev-${Date.now()}`,
      serialNumber: entry.serialNumber,
      hardwareSerial: entry.hardwareSerial || existing?.hardwareSerial,
      deviceName: entry.deviceName,
      model: entry.model,
      manufacturer: entry.manufacturer || existing?.manufacturer || 'Android',
      androidVersion: existing?.androidVersion || '11+',
      batteryLevel: existing?.batteryLevel || 100,
      isCharging: existing?.isCharging || false,
      chargingType: existing?.chargingType || 'none',
      storageFree: existing?.storageFree || '10GB',
      storageTotal: existing?.storageTotal || '64GB',
      storageUsedPercent: existing?.storageUsedPercent || 50,
      cpuUsage: existing?.cpuUsage || 10,
      cpuModel: existing?.cpuModel || 'ARM64',
      cpuCores: existing?.cpuCores || 8,
      ramUsedGB: existing?.ramUsedGB || '4GB',
      ramTotalGB: existing?.ramTotalGB || '8GB',
      ramPercent: existing?.ramPercent || 50,
      temperature: existing?.temperature || 35,
      thermalStatus: existing?.thermalStatus || 'Normal',
      connectionType: entry.connectionType,
      ipAddress: entry.ipAddress || (entry.serialNumber.includes(':') ? entry.serialNumber.split(':')[0] : existing?.ipAddress || ''),
      port: entry.port || existing?.port || 5555,
      status: 'online',
      adbStatus: 'Active Connected',
      developerMode: true,
      wirelessDebugging: entry.connectionType === 'wireless',
      lastConnected: new Date(entry.lastConnected).toISOString(),
      isTrusted: true,
      availableTransports: existing?.availableTransports,
      preferredTransport: existing?.preferredTransport || entry.connectionType,
    };
    this.saveDevice(updated);
  }

  public removeDevice(serial: string): boolean {
    if (!serial) return false;
    const clean = serial.trim();
    if (!clean) return false;

    const cleanTargetIp = cleanIp(clean);
    const targetDev = this.getBySerial(clean);

    const beforeCount = this.trustedDevices.size;
    logger.info(`[TrustedDevicesService] Before: ${beforeCount} trusted device(s)`, 'TrustedDevicesService');
    logger.info(`[TrustedDevicesService] Removing: ${clean}`, 'TrustedDevicesService');

    const keysToDelete = new Set<string>();

    for (const [key, dev] of this.trustedDevices.entries()) {
      const devCleanIp = cleanIp(dev.ipAddress);

      const matchesDirectly =
        key === clean ||
        dev.id === clean ||
        dev.serialNumber === clean ||
        dev.hardwareSerial === clean ||
        (cleanTargetIp && (key.includes(cleanTargetIp) || devCleanIp === cleanTargetIp || dev.serialNumber.includes(cleanTargetIp) || (dev.hardwareSerial && dev.hardwareSerial.includes(cleanTargetIp)))) ||
        dev.availableTransports?.some((t) => t.serial === clean || cleanIp(t.ipAddress) === cleanTargetIp);

      const matchesTargetDev =
        targetDev &&
        (key === this.getDeviceKey(targetDev) ||
          dev.id === targetDev.id ||
          (dev.hardwareSerial && targetDev.hardwareSerial && dev.hardwareSerial === targetDev.hardwareSerial) ||
          (dev.serialNumber && targetDev.serialNumber && dev.serialNumber === targetDev.serialNumber) ||
          (devCleanIp && cleanIp(targetDev.ipAddress) && devCleanIp === cleanIp(targetDev.ipAddress)) ||
          (dev.model && targetDev.model && dev.model !== 'Generic Device' && dev.model === targetDev.model && dev.manufacturer === targetDev.manufacturer));

      if (matchesDirectly || matchesTargetDev) {
        keysToDelete.add(key);
        if (dev.id) keysToDelete.add(dev.id);
        if (dev.serialNumber) keysToDelete.add(dev.serialNumber);
        if (dev.hardwareSerial) keysToDelete.add(dev.hardwareSerial);
      }
    }

    for (const k of keysToDelete) {
      this.trustedDevices.delete(k);
    }

    const afterCount = this.trustedDevices.size;
    logger.info(`[TrustedDevicesService] After: ${afterCount} trusted device(s)`, 'TrustedDevicesService');

    const wasRemoved = beforeCount > afterCount || keysToDelete.size > 0;
    if (wasRemoved) {
      this.saveToDisk();
      logger.info(`[TrustedDevicesService] Successfully removed device '${clean}' from persistent store`, 'TrustedDevicesService');
      return true;
    }

    logger.info(`[TrustedDevicesService] Device '${clean}' was not in trusted storage (already removed or not found)`, 'TrustedDevicesService');
    return false;
  }
}

export const trustedDevicesService = TrustedDevicesService.getInstance();
