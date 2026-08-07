import { create } from 'zustand';

export interface ToastNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  durationMs?: number;
}

interface AppState {
  isSidebarCollapsed: boolean;
  activePath: string;
  toasts: ToastNotification[];
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActivePath: (path: string) => void;
  addToast: (type: ToastNotification['type'], message: string, durationMs?: number) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isSidebarCollapsed: false,
  activePath: '/',
  toasts: [],
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  setActivePath: (path) => set({ activePath: path }),
  addToast: (type, message, durationMs) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    set((state) => ({ toasts: [...state.toasts, { id, type, message, durationMs }] }));
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
