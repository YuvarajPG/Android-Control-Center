import { execFile } from 'child_process';
import { logger } from './loggerService';

export interface AdbCapabilities {
  adbPath: string | null;
  adbVersion: string | null;
  supportsMdns: boolean;
  supportsQrPairing: boolean;
  isDetected: boolean;
}

export class AdbCapabilityService {
  private static instance: AdbCapabilityService;
  private cachedCapabilities: AdbCapabilities | null = null;
  private isDetecting: boolean = false;

  private constructor() {}

  public static getInstance(): AdbCapabilityService {
    if (!AdbCapabilityService.instance) {
      AdbCapabilityService.instance = new AdbCapabilityService();
    }
    return AdbCapabilityService.instance;
  }

  /**
   * Run ONCE at application startup or when ADB path changes.
   * Caches supportsMdns, supportsQrPairing, adbVersion, and adbPath for the entire app lifetime.
   */
  public async detectCapabilities(adbPath: string): Promise<AdbCapabilities> {
    if (this.cachedCapabilities && this.cachedCapabilities.adbPath === adbPath) {
      return this.cachedCapabilities;
    }

    if (this.isDetecting && this.cachedCapabilities) {
      return this.cachedCapabilities;
    }

    this.isDetecting = true;
    let versionStr: string | null = null;
    let supportsMdns = false;
    let supportsQrPairing = false;

    // 1. Check version
    try {
      const versionOutput = await this.execAdb(adbPath, ['version']);
      const versionMatch = versionOutput.match(/Android Debug Bridge version ([\d.]+)/);
      if (versionMatch) {
        versionStr = versionMatch[1] || null;
      }
    } catch {
      // ignore
    }

    // 2. Check mDNS support ONCE
    try {
      const mdnsOutput = await this.execAdb(adbPath, ['mdns', 'services']);
      const lower = mdnsOutput.toLowerCase();
      if (lower.includes('mdns is not supported') || lower.includes('not supported by this version')) {
        supportsMdns = false;
        logger.info('ADB mDNS support: Not Available (Compilation unsupported). Using fallback discovery.', 'AdbCapabilityService');
      } else {
        supportsMdns = true;
        logger.info('ADB mDNS support: Available', 'AdbCapabilityService');
      }
    } catch {
      supportsMdns = false;
      logger.info('ADB mDNS support: Not Available. Using fallback discovery.', 'AdbCapabilityService');
    }

    // 3. Probe QR pairing capability (Requires mDNS server & background daemon handshake capability)
    // System command-line ADB binaries (`adb pair HOST:PORT`) support CLI manual pairing, but do not export a background TLS QR server creation flag.
    supportsQrPairing = supportsMdns;
    if (!supportsQrPairing) {
      logger.info('ADB QR Pairing support: Not Available. Automatic fallback to Manual Pairing.', 'AdbCapabilityService');
    } else {
      logger.info('ADB QR Pairing support: Available', 'AdbCapabilityService');
    }

    this.cachedCapabilities = {
      adbPath,
      adbVersion: versionStr,
      supportsMdns,
      supportsQrPairing,
      isDetected: true,
    };

    this.isDetecting = false;
    return this.cachedCapabilities;
  }

  /**
   * Synchronously return cached capabilities
   */
  public getCapabilities(): AdbCapabilities {
    if (this.cachedCapabilities) {
      return this.cachedCapabilities;
    }
    return {
      adbPath: null,
      adbVersion: null,
      supportsMdns: false,
      supportsQrPairing: false,
      isDetected: false,
    };
  }

  /**
   * Helper to execute adb binary
   */
  private execAdb(adbPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(adbPath, args, { timeout: 3000 }, (error, stdout, stderr) => {
        const out = (stdout || '').toString() + (stderr || '').toString();
        if (error && !out) {
          reject(error);
          return;
        }
        resolve(out);
      });
    });
  }
}

export const adbCapabilityService = AdbCapabilityService.getInstance();
