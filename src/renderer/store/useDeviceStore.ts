import { create } from 'zustand';
import { AndroidDevice } from '../types/device';
import { ipcService } from '../services/ipcService';

interface DeviceState {
  devices: AndroidDevice[];
  selectedDeviceId: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  isAutoWirelessEnabled: boolean;
  autoWirelessMessage: string;
  initDiscovery: () => void;
  setDevices: (devices: AndroidDevice[]) => void;
  setSelectedDeviceId: (id: string | null) => void;
  getSelectedDevice: () => AndroidDevice | undefined;
  refreshDevices: () => Promise<void>;
  reconnectAll: () => Promise<void>;
  forgetDevice: (serial: string) => Promise<boolean>;
  setPreferredTransport: (deviceId: string, transport: 'usb' | 'wireless') => Promise<void>;
}

/**
 * Helper: returns true only when the two device lists differ in a way that
 * should trigger a Zustand state update (and therefore a re-render).
 * Compares by count, id, status, and connectionType — not object identity.
 */
function haveDevicesChanged(next: AndroidDevice[], prev: AndroidDevice[]): boolean {
  if (next.length !== prev.length) return true;
  for (let i = 0; i < next.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const n = next[i]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = prev[i]!;
    if (
      n.id !== p.id ||
      n.status !== p.status ||
      n.connectionType !== p.connectionType ||
      n.preferredTransport !== p.preferredTransport ||
      (n as any).serialNumber !== (p as any).serialNumber ||
      n.availableTransports?.length !== p.availableTransports?.length
    ) {
      return true;
    }
  }
  return false;
}

/** Normalise a raw ADB device record into an AndroidDevice */
function formatDevice(d: any): AndroidDevice {
  return {
    ...d,
    serial: d.serialNumber || d.serial,
    name: d.deviceName || d.name || d.model,
  };
}

// Track whether the IPC listener has already been registered to prevent
// duplicate handlers being added if initDiscovery is somehow called twice.
let listenerRegistered = false;const inFlightForgets = new Set<string>();

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDeviceId: null,
  isLoading: false,
  isInitialized: false,
  isAutoWirelessEnabled: false,
  autoWirelessMessage: 'Automatic Wireless Reconnect is currently disabled.',

  initDiscovery: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true, isLoading: true });

    // Fetch auto wireless status flag
    ipcService.adb.getAutoWirelessStatus().then((st) => {
      set({ isAutoWirelessEnabled: st.enabled, autoWirelessMessage: st.message });
    }).catch(() => {});

    // Initial fetch — uses cached list, no ADB scan triggered
    ipcService.adb.listDevices().then((list) => {
      const formatted = list.map(formatDevice);
      set({ devices: formatted, isLoading: false });

      if (formatted.length > 0 && !get().selectedDeviceId) {
        const firstOnline = formatted.find((dev) => dev.status === 'online') || formatted[0];
        if (firstOnline) set({ selectedDeviceId: firstOnline.id });
      }
    }).catch(() => set({ isLoading: false }));

    // Subscribe to real-time background discovery push events exactly once.
    if (!listenerRegistered) {
      listenerRegistered = true;

      ipcService.on('device:list-updated', (data: unknown) => {
        if (!Array.isArray(data)) return;
        const formatted = data.map(formatDevice);
        const current = get().devices;

        // Skip state update when the logical device list is identical
        if (!haveDevicesChanged(formatted, current)) return;

        // Maintain or update the active selected device
        const currentSelectedId = get().selectedDeviceId;
        const currentSelected = formatted.find((d) => d.id === currentSelectedId);
        const nextSelectedId = (!currentSelected || currentSelected.status === 'offline')
          ? (formatted.find((d) => d.status === 'online')?.id || currentSelectedId)
          : currentSelectedId;

        set({ devices: formatted, selectedDeviceId: nextSelectedId });
      });
    }
  },

  setDevices: (devices) => set({ devices }),
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
  getSelectedDevice: () => {
    const { devices, selectedDeviceId } = get();
    return devices.find((d) => d.id === selectedDeviceId);
  },

  refreshDevices: async () => {
    set({ isLoading: true });
    try {
      const list = await ipcService.invoke<any[]>('device:rescan');
      if (Array.isArray(list)) {
        const formatted = list.map(formatDevice);
        set({ devices: formatted, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  reconnectAll: async () => {
    set({ isLoading: true });
    try {
      const list = await ipcService.invoke<any[]>('device:reconnect-all');
      const formatted = list.map(formatDevice);
      set({ devices: formatted, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  forgetDevice: async (serial: string): Promise<boolean> => {
    if (!serial || inFlightForgets.has(serial)) return false;
    inFlightForgets.add(serial);

    // 1. Immediate optimistic UI removal from Zustand state
    const current = get().devices;
    const cleanSerialIp = serial.includes(':') ? serial.split(':')[0] : serial;
    const remaining = current.filter(
      (d) =>
        d.id !== serial &&
        d.serial !== serial &&
        d.hardwareSerial !== serial &&
        (d as any).serialNumber !== serial &&
        d.ipAddress !== serial &&
        (cleanSerialIp ? d.ipAddress !== cleanSerialIp : true) &&
        !d.availableTransports?.some((t) => t.serial === serial),
    );

    const currentSelectedId = get().selectedDeviceId;
    const targetWasSelected = current.some(
      (d) =>
        d.id === currentSelectedId &&
        (d.id === serial || d.serial === serial || d.hardwareSerial === serial || (d as any).serialNumber === serial),
    );
    const nextSelectedId = targetWasSelected
      ? remaining.find((d) => d.status === 'online')?.id || null
      : currentSelectedId;

    set({ devices: remaining, selectedDeviceId: nextSelectedId });

    try {
      console.log(`[IPC -> MAIN] device:forget: ${serial}`);
      const res = await ipcService.invoke<{ success: boolean; wasRemoved: boolean; deviceName?: string; devices: any[] }>(
        'device:forget',
        serial,
      );
      if (res && Array.isArray(res.devices)) {
        const formatted = res.devices.map(formatDevice);
        set({ devices: formatted });
      }
      return true;
    } catch {
      return false;
    } finally {
      inFlightForgets.delete(serial);
    }
  },

  setPreferredTransport: async (deviceId: string, transport: 'usb' | 'wireless') => {
    // 1. Immediate optimistic UI update
    const current = get().devices;
    const optimistic = current.map((dev) => {
      if (dev.id === deviceId || dev.hardwareSerial === deviceId || dev.serial === deviceId) {
        const targetTransport = dev.availableTransports?.find((t) => t.type === transport);
        return {
          ...dev,
          preferredTransport: transport,
          connectionType: transport,
          serial: targetTransport?.serial || dev.serial,
          serialNumber: targetTransport?.serial || dev.serialNumber,
        };
      }
      return dev;
    });
    set({ devices: optimistic });

    // 2. Persist in backend
    try {
      const list = await ipcService.adb.setPreferredTransport(deviceId, transport);
      if (Array.isArray(list)) {
        const formatted = list.map(formatDevice);
        set({ devices: formatted });
      }
    } catch (err) {
      console.error('Failed to set preferred transport', err);
    }
  },
}));
