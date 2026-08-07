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

  private getDeviceKey(item: Partial<DeviceInfoModel>): string {
    return item.hardwareSerial || item.id || (item.model && item.model !== 'Generic Device' ? `${item.manufacturer}_${item.model}` : item.serialNumber || '');
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: DeviceInfoModel[] = JSON.parse(raw);
        for (const item of list) {
          const key = this.getDeviceKey(item);
          if (key) {
            // Deduplicate stale duplicate entries from older versions
            const existing = this.trustedDevices.get(key);
            if (!existing || new Date(item.lastConnected).getTime() > new Date(existing.lastConnected).getTime()) {
              this.trustedDevices.set(key, item);
            }
          }
        }
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

  public getBySerial(serial: string): DeviceInfoModel | undefined {
    if (!serial) return undefined;
    for (const dev of this.trustedDevices.values()) {
      if (
        dev.hardwareSerial === serial ||
        dev.id === serial ||
        dev.serialNumber === serial ||
        dev.ipAddress === serial ||
        dev.availableTransports?.some((t) => t.serial === serial)
      ) {
        return dev;
      }
    }
    return this.trustedDevices.get(serial);
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

  public addDevice(entry: { serialNumber: string; deviceName: string; model: string; ipAddress?: string; port?: number; connectionType: 'usb' | 'wireless'; lastConnected: number; hardwareSerial?: string }): void {
    const existing = this.getBySerial(entry.hardwareSerial || entry.serialNumber);
    const updated: DeviceInfoModel = {
      id: existing?.id || `dev-${Date.now()}`,
      serialNumber: entry.serialNumber,
      hardwareSerial: entry.hardwareSerial || existing?.hardwareSerial,
      deviceName: entry.deviceName,
      model: entry.model,
      manufacturer: existing?.manufacturer || 'Android',
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

  public removeDevice(serial: string): void {
    const dev = this.getBySerial(serial);
    if (dev) {
      const key = this.getDeviceKey(dev);
      this.trustedDevices.delete(key);
    }
    this.trustedDevices.delete(serial);
    this.saveToDisk();
  }
}

export const trustedDevicesService = TrustedDevicesService.getInstance();
