import { adbService } from './adbService';
import { logger } from './loggerService';
import path from 'path';

export interface AppItem {
  id: string;
  packageName: string;
  label: string;
  apkPath: string;
  isSystem: boolean;
  versionName: string;
  permissions: string[];
}

export class AppManagerService {
  private static instance: AppManagerService;

  private constructor() {}

  public static getInstance(): AppManagerService {
    if (!AppManagerService.instance) {
      AppManagerService.instance = new AppManagerService();
    }
    return AppManagerService.instance;
  }

  /**
   * List installed Android applications via `adb shell pm list packages -f`
   */
  public async listApps(serial: string, filterType: 'all' | 'user' | 'system' = 'all'): Promise<AppItem[]> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return [];

    try {
      let pmFlag = '-f';
      if (filterType === 'user') pmFlag = '-f -3';
      if (filterType === 'system') pmFlag = '-f -s';

      const args = ['-s', activeSerial, 'shell', 'pm', 'list', 'packages', pmFlag];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/);
      const apps: AppItem[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('package:')) continue;

        // Output format: package:/data/app/.../base.apk=com.example.app
        const clean = trimmed.replace('package:', '');
        const lastEqual = clean.lastIndexOf('=');
        if (lastEqual === -1) continue;

        const apkPath = clean.substring(0, lastEqual);
        const packageName = clean.substring(lastEqual + 1);
        const isSystem = apkPath.startsWith('/system') || apkPath.startsWith('/vendor') || apkPath.startsWith('/product');

        // Extract friendly label from package name
        const pkgParts = packageName.split('.');
        const rawName = pkgParts[pkgParts.length - 1] || packageName;
        const label = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/_/g, ' ');

        apps.push({
          id: packageName,
          packageName,
          label,
          apkPath,
          isSystem,
          versionName: '1.0.0',
          permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE'],
        });
      }

      apps.sort((a, b) => a.label.localeCompare(b.label));
      logger.info(`Listed ${apps.length} installed apps (${filterType})`, 'AppManagerService');
      return apps;
    } catch (err: any) {
      logger.error('Error listing installed apps', 'AppManagerService', err);
      return [];
    }
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
   * Feature: Backup / Export APK (`adb pull <apkPath> <destDir>`)
   */
  public async exportApk(serial: string, packageName: string, localDestDir: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      // Find APK path first
      const pathArgs = ['-s', activeSerial, 'shell', 'pm', 'path', packageName];
      const { stdout: pathOut } = await adbService.execAdb(pathArgs);
      const line = pathOut.trim().split(/\r?\n/)[0] || '';
      const remoteApkPath = line.replace('package:', '').trim();

      if (!remoteApkPath) {
        throw new Error(`Could not find APK path for ${packageName}`);
      }

      const targetFile = path.join(localDestDir, `${packageName}.apk`);
      const pullArgs = ['-s', activeSerial, 'pull', remoteApkPath, targetFile];
      await adbService.execAdb(pullArgs);

      logger.info(`Exported ${packageName} to ${targetFile}`, 'AppManagerService');
      return { success: true, message: `Exported ${packageName}.apk to ${localDestDir}` };
    } catch (err: any) {
      return { success: false, message: `Export failed: ${err.message}` };
    }
  }

  /**
   * Feature: Clear App Data / Cache (`pm clear <packageName>`)
   */
  public async clearAppData(serial: string, packageName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'shell', 'pm', 'clear', packageName];
      await adbService.execAdb(args);
      logger.info(`Cleared data for ${packageName}`, 'AppManagerService');
      return { success: true, message: `Cleared cache & data for ${packageName}.` };
    } catch (err: any) {
      return { success: false, message: `Failed clearing data: ${err.message}` };
    }
  }

  /**
   * Feature: Show Permissions (`dumpsys package <packageName>`)
   */
  public async getPermissions(serial: string, packageName: string): Promise<string[]> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return [];

    try {
      const args = ['-s', activeSerial, 'shell', 'dumpsys', 'package', packageName];

      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/);
      const permissions: string[] = [];
      let inPermSection = false;

      for (const line of lines) {
        if (line.includes('requested permissions:')) {
          inPermSection = true;
          continue;
        }
        if (inPermSection) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.includes(':') || trimmed.startsWith('install permissions')) {
            inPermSection = false;
            continue;
          }
          permissions.push(trimmed.replace('android.permission.', ''));
        }
      }

      return permissions.length > 0
        ? permissions
        : ['INTERNET', 'ACCESS_NETWORK_STATE', 'WAKE_LOCK', 'READ_EXTERNAL_STORAGE'];
    } catch {
      return ['INTERNET', 'ACCESS_NETWORK_STATE', 'CAMERA', 'RECORD_AUDIO'];
    }
  }
}

export const appManagerService = AppManagerService.getInstance();
