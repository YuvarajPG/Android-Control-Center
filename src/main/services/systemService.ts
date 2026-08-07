import os from 'os';

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

export class SystemService {
  /**
   * Gather host operating system and hardware metrics
   */
  public static getSystemInfo(): SystemInfo {
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 && cpus[0] ? cpus[0].model : 'Unknown CPU';

    return {
      platform: process.platform,
      arch: os.arch(),
      osRelease: os.release(),
      type: os.type(),
      hostname: os.hostname(),
      totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
      cpuModel,
      cpuCores: cpus.length,
      uptimeSeconds: Math.round(os.uptime()),
    };
  }
}
