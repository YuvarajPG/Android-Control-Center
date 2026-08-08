import { create } from 'zustand';
import { ipcService } from '../services/ipcService';

interface RotationState {
  rotationMap: Record<string, { autoRotate: boolean; rotationDegree: number }>;
  rotationLoadingMap: Record<string, boolean>;

  getRotationState: (serial: string) => { autoRotate: boolean; rotationDegree: number };
  isRotationLoading: (serial: string) => boolean;
  fetchRotation: (serial: string) => Promise<void>;
  setRotation: (serial: string, autoRotate: boolean, degree: number) => Promise<{ success: boolean; message: string }>;
}

export const useRotationStore = create<RotationState>((set, get) => ({
  rotationMap: {},
  rotationLoadingMap: {},

  getRotationState: (serial: string) => {
    return get().rotationMap[serial] || { autoRotate: false, rotationDegree: 0 };
  },

  isRotationLoading: (serial: string) => {
    return Boolean(get().rotationLoadingMap[serial]);
  },

  fetchRotation: async (serial: string) => {
    if (!serial) return;
    try {
      const result = await ipcService.control.getRotation(serial);
      set((state) => ({
        rotationMap: {
          ...state.rotationMap,
          [serial]: {
            autoRotate: result.autoRotate,
            rotationDegree: result.rotationDegree,
          },
        },
      }));
    } catch {
      // ignore
    }
  },

  setRotation: async (serial: string, autoRotate: boolean, degree: number) => {
    if (!serial) return { success: false, message: 'No serial provided' };

    set((state) => ({
      rotationLoadingMap: {
        ...state.rotationLoadingMap,
        [serial]: true,
      },
    }));

    // Optimistically set state in store immediately
    set((state) => ({
      rotationMap: {
        ...state.rotationMap,
        [serial]: { autoRotate, rotationDegree: degree },
      },
    }));

    try {
      const res = await ipcService.control.rotate(serial, autoRotate, degree);
      if (res.success) {
        await new Promise((r) => setTimeout(r, 350));
        const verified = await ipcService.control.getRotation(serial);
        set((state) => ({
          rotationMap: {
            ...state.rotationMap,
            [serial]: {
              autoRotate: verified.autoRotate,
              rotationDegree: verified.rotationDegree,
            },
          },
        }));
      }
      return res;
    } catch (err: any) {
      return { success: false, message: err.message || 'Rotation failed' };
    } finally {
      set((state) => ({
        rotationLoadingMap: {
          ...state.rotationLoadingMap,
          [serial]: false,
        },
      }));
    }
  },
}));
