export type ConnectionType = 'usb' | 'wireless';
export type DeviceStatus = 'online' | 'offline' | 'unauthorized' | 'connecting' | 'unknown';

export interface DeviceTransport {
  type: ConnectionType;
  serial: string;
  status: DeviceStatus;
  ipAddress?: string;
  port?: number;
}

export interface AndroidDevice {
  id: string;
  serialNumber: string;
  serial: string;
  hardwareSerial?: string;
  deviceName: string;
  name: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  batteryLevel: number;
  isCharging: boolean;
  chargingType?: string;
  storageFree: string;
  storageTotal: string;
  storageUsedPercent?: number;
  cpuUsage?: number;
  cpuModel?: string;
  cpuCores?: number;
  ramUsedGB?: string;
  ramTotalGB?: string;
  ramPercent?: number;
  temperature?: number;
  thermalStatus?: string;
  networkSsid?: string;
  networkRssi?: number;
  networkType?: 'wifi' | 'cellular' | 'none';
  carrierName?: string;
  cellularGeneration?: string;
  connectionType: ConnectionType;
  ipAddress: string;
  port: number;
  status: DeviceStatus;
  adbStatus?: string;
  developerMode?: boolean;
  wirelessDebugging?: boolean;
  lastConnected?: string;
  isTrusted?: boolean;
  availableTransports?: DeviceTransport[];
  preferredTransport?: ConnectionType;
}

export interface KeyCodeAction {
  name: string;
  code: number;
  iconName: string;
  description: string;
}
