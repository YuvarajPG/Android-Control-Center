import { adbService } from './adbService';
import { logger } from './loggerService';

export interface AppItem {
  id: string;
  packageName: string;
  label: string;
  apkPath: string;
  isSystem: boolean;
  versionName: string;
  permissions: string[];
}

interface PackageFlagsInfo {
  isSystem: boolean;
  versionName: string;
  codePath: string;
}

/**
 * Fast & precise PackageInfo / dumpsys flags parser.
 * Rules according to Android Spec:
 * User App: FLAG_SYSTEM == false AND FLAG_UPDATED_SYSTEM_APP == false
 * System App: FLAG_SYSTEM == true OR FLAG_UPDATED_SYSTEM_APP == true
 */
function parsePackageFlagsFromDumpsys(dumpsysOutput: string): Map<string, PackageFlagsInfo> {
  const map = new Map<string, PackageFlagsInfo>();
  if (!dumpsysOutput) return map;

  const blocks = dumpsysOutput.split(/Package\s+\[/);

  for (const block of blocks) {
    if (!block || !block.includes(']')) continue;

    const endIdx = block.indexOf(']');
    const packageName = block.substring(0, endIdx).trim();
    if (!packageName || packageName.includes(' ')) continue;

    // Extract flags array: e.g. flags=[ SYSTEM HAS_CODE UPDATED_SYSTEM_APP ]
    const flagsMatch = block.match(/flags=\[\s*([^\]]*)\s*\]/i);
    const flagsStr = flagsMatch ? flagsMatch[1].toUpperCase() : '';

    // Pure Package Flags Classification Rules:
    // User App: FLAG_SYSTEM == false AND FLAG_UPDATED_SYSTEM_APP == false
    // System App: FLAG_SYSTEM == true OR FLAG_UPDATED_SYSTEM_APP == true
    const isSystem = flagsStr.includes('SYSTEM') || flagsStr.includes('UPDATED_SYSTEM_APP');

    const verNameMatch = block.match(/versionName=([^\s\r\n]+)/i);
    const versionName = verNameMatch ? verNameMatch[1] : 'Beta';

    const codePathMatch = block.match(/codePath=([^\s\r\n]+)/i);
    const codePath = codePathMatch ? codePathMatch[1] : '';

    map.set(packageName, { isSystem, versionName, codePath });
  }

  return map;
}

export class AppManagerService {
  private static instance: AppManagerService;
  private workingCommandCache = new Map<string, string[]>();

  private constructor() {}

  public static getInstance(): AppManagerService {
    if (!AppManagerService.instance) {
      AppManagerService.instance = new AppManagerService();
    }
    return AppManagerService.instance;
  }

  /**
   * List installed Android applications.
   * Uses Android package flags (FLAG_SYSTEM, FLAG_UPDATED_SYSTEM_APP) for accurate classification.
   */
  public async listApps(serial: string, filterType: 'all' | 'user' | 'system' = 'all'): Promise<AppItem[]> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return [];

    const pmFlags: string[] = ['-f'];
    let stdout = '';
    let lastError = '';

    // 1. Re-use cached working command base for this device if available
    const cachedBase = this.workingCommandCache.get(activeSerial);
    if (cachedBase) {
      try {
        const fullArgs = ['-s', activeSerial, ...cachedBase, ...pmFlags];
        const res = await adbService.execAdb(fullArgs);
        const out = (res.stdout || '').trim();
        const count = (out.match(/^package:/gm) || []).length;

        if (out.includes('package:') && count >= 5) {
          stdout = out;
        } else {
          this.workingCommandCache.delete(activeSerial);
        }
      } catch {
        this.workingCommandCache.delete(activeSerial);
      }
    }

    // 2. Candidate Fallback Pipeline (Samsung One UI & Android 13/14/15 compliant)
    // Mandatory Rule: ALWAYS try --user 0 commands first to prevent SecurityException on secondary/guest profiles
    if (!stdout) {
      const candidateBases: { base: string[]; flags: string[] }[] = [
        { base: ['shell', 'cmd', 'package', 'list', 'packages', '--user', '0'], flags: pmFlags },
        { base: ['shell', 'pm', 'list', 'packages', '--user', '0'], flags: pmFlags },
        { base: ['shell', 'pm', 'list', 'packages', '-u', '0'], flags: pmFlags },
        { base: ['shell', 'cmd', 'package', 'list', 'packages'], flags: [...pmFlags, '--user', '0'] },
        { base: ['shell', 'pm', 'list', 'packages'], flags: [...pmFlags, '--user', '0'] },
        { base: ['shell', 'cmd', 'package', 'list', 'packages'], flags: pmFlags },
        { base: ['shell', 'pm', 'list', 'packages'], flags: pmFlags },
        { base: ['shell', 'pm', 'list', 'packages'], flags: [] },
      ];

      let bestOutput = '';
      let maxPackagesFound = 0;
      let bestBase: string[] | null = null;

      for (const candidate of candidateBases) {
        try {
          const fullArgs = ['-s', activeSerial, ...candidate.base, ...candidate.flags];
          const res = await adbService.execAdb(fullArgs);
          const out = (res.stdout || '').trim();
          const errStr = (res.stderr || '').trim();

          if (out.includes('SecurityException') || out.includes('Permission') || errStr.includes('SecurityException') || errStr.includes('Permission')) {
            lastError = errStr || out;
            continue;
          }

          if (out.includes('package:')) {
            const count = (out.match(/^package:/gm) || []).length;
            if (count > maxPackagesFound) {
              maxPackagesFound = count;
              bestOutput = out;
              bestBase = candidate.base;
            }

            // If we found a comprehensive package list (>= 15 packages), lock it in!
            if (count >= 15) {
              break;
            }
          }
        } catch (err: any) {
          lastError = err.message || String(err);
        }
      }

      if (bestOutput && bestBase) {
        stdout = bestOutput;
        this.workingCommandCache.set(activeSerial, bestBase);
        logger.info(`Cached package list command for ${activeSerial} (${maxPackagesFound} packages found): ${bestBase.join(' ')}`, 'AppManagerService');
      }
    }

    // 3. Retrieve package flags from dumpsys package packages for pure flag-based classification
    let flagsMap = new Map<string, PackageFlagsInfo>();
    try {
      const res = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'package', 'packages']);
      if (res.stdout && res.stdout.includes('Package [')) {
        flagsMap = parsePackageFlagsFromDumpsys(res.stdout);
      }
    } catch {
      // ignore dumpsys errors if unavailable
    }

    // Fallback parsing if list package commands failed but dumpsys succeeded
    if (!stdout && flagsMap.size > 0) {
      const fallbackApps: AppItem[] = [];
      for (const [packageName, info] of flagsMap.entries()) {
        if (filterType === 'user' && info.isSystem) continue;
        if (filterType === 'system' && !info.isSystem) continue;

        const pkgParts = packageName.split('.');
        const rawName = pkgParts[pkgParts.length - 1] || packageName;
        const label = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/_/g, ' ');

        fallbackApps.push({
          id: packageName,
          packageName,
          label,
          apkPath: info.codePath,
          isSystem: info.isSystem,
          versionName: info.versionName,
          permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE'],
        });
      }
      fallbackApps.sort((a, b) => a.label.localeCompare(b.label));
      logger.info(`Extracted ${fallbackApps.length} packages via dumpsys flags for ${activeSerial}`, 'AppManagerService');
      return fallbackApps;
    }

    if (!stdout && lastError) {
      logger.error(`All package list commands failed for ${activeSerial}: ${lastError}`, 'AppManagerService');
      throw new Error(`Failed listing packages: ${lastError}`);
    }

    const lines = stdout.split(/\r?\n/);
    const apps: AppItem[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('package:')) continue;

      const clean = trimmed.replace('package:', '');
      const lastEqual = clean.lastIndexOf('=');

      let apkPath = '';
      let packageName = '';

      if (lastEqual === -1) {
        packageName = clean;
      } else {
        apkPath = clean.substring(0, lastEqual);
        packageName = clean.substring(lastEqual + 1);
      }

      // Classify strictly using PackageInfo / dumpsys package flags (FLAG_SYSTEM, FLAG_UPDATED_SYSTEM_APP)
      const flagInfo = flagsMap.get(packageName);
      const isSystem = flagInfo
        ? flagInfo.isSystem
        : apkPath.startsWith('/system') || apkPath.startsWith('/vendor') || apkPath.startsWith('/product') || apkPath.startsWith('/apex') || apkPath.startsWith('/system_ext');

      if (filterType === 'user' && isSystem) continue;
      if (filterType === 'system' && !isSystem) continue;

      const pkgParts = packageName.split('.');
      const rawName = pkgParts[pkgParts.length - 1] || packageName;
      const label = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/_/g, ' ');
      const versionName = flagInfo?.versionName || 'Beta';

      apps.push({
        id: packageName,
        packageName,
        label,
        apkPath,
        isSystem,
        versionName,
        permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE'],
      });
    }

    apps.sort((a, b) => a.label.localeCompare(b.label));
    logger.info(`Listed ${apps.length} installed apps (${filterType}) for ${activeSerial}`, 'AppManagerService');
    return apps;
  }

  /**
   * Feature: Launch App (`monkey -p <packageName> 1`)
   */
  public async launchApp(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'];

      await adbService.execAdb(args);
      logger.info(`Launched app ${packageName}`, 'AppManagerService');
      return { success: true, message: `Launched ${packageName} successfully.` };
    } catch (err: any) {
      return { success: false, message: `Failed to launch ${packageName}: ${err.message}` };
    }
  }

  /**
   * Feature: Force Stop App (`am force-stop <packageName>`)
   */
  public async stopApp(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'shell', 'am', 'force-stop', packageName];

      await adbService.execAdb(args);
      logger.info(`Stopped app ${packageName}`, 'AppManagerService');
      return { success: true, message: `Force stopped ${packageName}.` };
    } catch (err: any) {
      return { success: false, message: `Failed stopping app: ${err.message}` };
    }
  }

  /**
   * Feature: Install APK (`adb install -r <apkPath>`)
   */
  public async installApk(serial: string, apkPath: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'install', '-r', apkPath];
      logger.info(`Installing APK from ${apkPath}`, 'AppManagerService');
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || 'APK installed successfully.' };
    } catch (err: any) {
      return { success: false, message: `Installation failed: ${err.message}` };
    }
  }

  /**
   * Feature: Uninstall App (`adb uninstall <packageName>`)
   */
  public async uninstallApp(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'uninstall', packageName];
      logger.info(`Uninstalling ${packageName}`, 'AppManagerService');
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || `Uninstalled ${packageName} successfully.` };
    } catch (err: any) {
      return { success: false, message: `Uninstall failed: ${err.message}` };
    }
  }

  /**
   * Feature: Export / Backup APK (`adb pull <apkPath> <destDir>/<packageName>.apk`)
   */
  public async exportApk(serial: string, packageName: string, destDir: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      // 1. Get path to APK
      const { stdout } = await adbService.execAdb(['-s', activeSerial, 'shell', 'pm', 'path', packageName]);
      const firstLine = stdout.split(/\r?\n/).find((l) => l.trim().startsWith('package:'));
      if (!firstLine) return { success: false, message: `Could not find APK path for ${packageName}` };

      const apkPathOnDevice = firstLine.trim().replace('package:', '').trim();
      const localDestPath = `${destDir}/${packageName}.apk`;

      // 2. Pull APK file
      await adbService.execAdb(['-s', activeSerial, 'pull', apkPathOnDevice, localDestPath]);
      logger.info(`Exported APK for ${packageName} to ${localDestPath}`, 'AppManagerService');
      return { success: true, message: `Exported ${packageName}.apk to ${destDir}` };
    } catch (err: any) {
      return { success: false, message: `APK export failed: ${err.message}` };
    }
  }

  /**
   * Feature: Clear App Data & Cache (`pm clear <packageName>`)
   */
  public async clearAppData(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const { stdout } = await adbService.execAdb(['-s', activeSerial, 'shell', 'pm', 'clear', packageName]);
      logger.info(`Cleared data for ${packageName}`, 'AppManagerService');
      return { success: true, message: stdout.trim() || `Cleared data for ${packageName}.` };
    } catch (err: any) {
      return { success: false, message: `Clear data failed: ${err.message}` };
    }
  }

  /**
   * Feature: Get App Requested Permissions (`dumpsys package <packageName>`)
   */
  public async getAppPermissions(serial: string, packageName: string): Promise<string[]> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return [];

    try {
      const { stdout } = await adbService.execAdb(['-s', activeSerial, 'shell', 'dumpsys', 'package', packageName]);
      const lines = stdout.split(/\r?\n/);
      const permissions: string[] = [];
      let inPermSection = false;

      for (const line of lines) {
        if (line.includes('requested permissions:')) {
          inPermSection = true;
          continue;
        }
        if (inPermSection) {
          if (line.includes('install permissions:') || line.includes('runtime permissions:') || line.includes('User ') || !line.trim()) {
            inPermSection = false;
            continue;
          }
          const trimmed = line.trim();
          if (trimmed.startsWith('android.permission.')) {
            permissions.push(trimmed);
          }
        }
      }

      return Array.from(new Set(permissions));
    } catch (err: any) {
      logger.error(`Error fetching permissions for ${packageName}`, 'AppManagerService', err);
      return [];
    }
  }
}

export const appManagerService = AppManagerService.getInstance();
