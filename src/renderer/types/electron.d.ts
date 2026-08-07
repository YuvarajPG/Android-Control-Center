export interface SystemInfo {
  platform: string;
  arch: string;
  osRelease: string;
  type: string;
  hostname: string;
  totalMemoryMB: number;
  freeMemoryMB: number;
  cpuModel: string;
  cpuCores: number;
  uptimeSeconds: number;
}

export interface AppVersionInfo {
  appVersion: string;
  appName: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  platform: string;
}

export interface AdbCheckResult {
  installed: boolean;
  executablePath: string | null;
  version?: string;
  platform: string;
  packageManagerSuggestion?: string;
  autoDownloadSupported: boolean;
  message: string;
}

export interface AdbCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface IElectronAPI {
  ipcRenderer: {
    send(channel: string, data?: unknown): void;
    on(channel: string, func: (...args: unknown[]) => void): () => void;
    invoke<T = unknown>(channel: string, data?: unknown): Promise<T>;
  };
  platform: string;
}

declare global {
  interface Window {
    electron?: IElectronAPI;
  }
}
