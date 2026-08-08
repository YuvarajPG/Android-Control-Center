import { create } from 'zustand';
import { ipcService, DeviceCapabilities } from '../services/ipcService';

interface CapabilitiesState {
  capabilitiesMap: Record<string, DeviceCapabilities>;
  isLoadingMap: Record<string, boolean>;

  getCapabilities: (serial: string) => DeviceCapabilities;
  fetchCapabilities: (serial: string) => Promise<void>;
  updateCapabilities: (serial: string, updates: Partial<DeviceCapabilities>) => void;
}

const DEFAULT_CAPABILITIES: DeviceCapabilities = {
  isRooted: false,
  hasShizuku: false,
  brightness: 180,
  autoRotate: true,
  rotationDegree: 0,
  flashlightActive: false,
  isCompanionInstalled: false,
  flashlightBackend: 'none',
};

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  capabilitiesMap: {},
  isLoadingMap: {},

  getCapabilities: (serial: string) => {
    return get().capabilitiesMap[serial] || DEFAULT_CAPABILITIES;
  },

  fetchCapabilities: async (serial: string) => {
    if (!serial) return;
    set((state) => ({
      isLoadingMap: { ...state.isLoadingMap, [serial]: true },
    }));

    try {
      const caps = await ipcService.control.getCapabilities(serial);
      set((state) => ({
        capabilitiesMap: {
          ...state.capabilitiesMap,
          [serial]: caps,
        },
      }));
    } catch {
      // ignore
    } finally {
      set((state) => ({
        isLoadingMap: { ...state.isLoadingMap, [serial]: false },
      }));
    }
  },

  updateCapabilities: (serial: string, updates: Partial<DeviceCapabilities>) => {
    if (!serial) return;
    set((state) => {
      const current = state.capabilitiesMap[serial] || DEFAULT_CAPABILITIES;
      return {
        capabilitiesMap: {
          ...state.capabilitiesMap,
          [serial]: {
            ...current,
            ...updates,
          },
        },
      };
    });
  },
}));
