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
  forgetDevice: (serial: string) => Promise<void>;
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
let listenerRegistered = false;

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
    // The main process emits device:list-updated ONLY when something actually changed,
    // so we don't need to do change-detection here — but we still guard against
    // identity-equal arrays causing spurious re-renders.
    if (!listenerRegistered) {
      listenerRegistered = true;

      ipcService.on('device:list-updated', (data: unknown) => {
        if (!Array.isArray(data)) return;

        const formatted = data.map(formatDevice);
        const current = get().devices;

        // Skip state update when the logical device list is identical
        if (!haveDevicesChanged(formatted, current)) return;

        set({ devices: formatted, isLoading: false });

        // Maintain or update the active selected device
        const currentSelectedId = get().selectedDeviceId;
        const currentSelected = formatted.find((d) => d.id === currentSelectedId);

        if (!currentSelected || currentSelected.status === 'offline') {
          const firstOnline = formatted.find((d) => d.status === 'online');
          if (firstOnline) set({ selectedDeviceId: firstOnline.id });
        }
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

  forgetDevice: async (serial: string) => {
    try {
      const list = await ipcService.invoke<any[]>('device:forget-trusted', serial);
      const formatted = list.map(formatDevice);
      set({ devices: formatted });
    } catch {
      // ignore error
    }
  },

  setPreferredTransport: async (deviceId: string, transport: 'usb' | 'wireless') => {
    try {
      const list = await ipcService.adb.setPreferredTransport(deviceId, transport);
      if (Array.isArray(list)) {
        const formatted = list.map(formatDevice);
        set({ devices: formatted });
      }
    } catch {
      // ignore error
    }
  },
}));
