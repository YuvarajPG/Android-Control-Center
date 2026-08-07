import { adbService } from './adbService';
import { logger } from './loggerService';
import path from 'path';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: string;
  sizeBytes: number;
  modified: string;
  permissions: string;
  owner: string;
  group: string;
}

export interface FileListResult {
  currentPath: string;
  items: FileItem[];
}

export class FileService {
  private static instance: FileService;

  private constructor() {}

  public static getInstance(): FileService {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  /**
   * Format bytes to human readable string (KB, MB, GB)
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * List files and folders in a remote Android directory via `adb shell ls -la`
   */
  public async listDirectory(serial: string, targetPath: string = '/sdcard'): Promise<FileListResult> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    const cleanPath = targetPath.endsWith('/') && targetPath !== '/' ? targetPath.slice(0, -1) : targetPath;

    if (!activeSerial) {
      return { currentPath: cleanPath, items: [] };
    }

    // /sdcard is a symlink to /storage/emulated/0 on Android.
    // ADB shell ls -la /sdcard can return 0 results or a symlink header that
    // bypasses all entries. Using the real physical path avoids this entirely.
    const adbPath = cleanPath === '/sdcard'
      ? '/storage/emulated/0'
      : cleanPath.startsWith('/sdcard/')
        ? cleanPath.replace('/sdcard/', '/storage/emulated/0/')
        : cleanPath;

    try {
      const args = ['-s', activeSerial, 'shell', 'ls', '-la', adbPath];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/);
      const items: FileItem[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip 'total N' lines, ls error lines, and symlink/directory header lines
        // (Android toybox ls prints the path as a header, e.g. "/storage/emulated/0:")
        if (
          trimmed.startsWith('total ') ||
          trimmed.startsWith('ls: ') ||
          trimmed.endsWith(':') ||
          trimmed.includes(' -> ')
        ) {
          // Only skip lines that look like headers/errors — not file entries
          // A symlink file entry WILL have a permissions column first
          if (!trimmed.match(/^[drwxstls-]/)) continue;
        }

        // ls -la format: permissions links owner group size date time name
        const match = trimmed.match(/^([drwxstls-]+)\s+\d+\s+([^\s]+)\s+([^\s]+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
        if (match) {
          const [, permissions = '', owner = '', group = '', sizeStr = '0', modified = '', filename = ''] = match;

          if (filename === '.' || filename === '..') continue;

          // Strip symlink target if present (e.g. "link -> /real/path")
          const cleanName = filename.split(' -> ')[0].trim();
          if (!cleanName) continue;

          const isDir = permissions.startsWith('d') || permissions.startsWith('l');
          const sizeBytes = parseInt(sizeStr, 10) || 0;

          // Build the path using the UI-facing cleanPath (preserving /sdcard for breadcrumbs)
          items.push({
            name: cleanName,
            path: `${cleanPath}/${cleanName}`.replace(/\/+/g, '/'),
            isDirectory: isDir,
            size: isDir ? '--' : this.formatBytes(sizeBytes),
            sizeBytes,
            modified,
            permissions,
            owner,
            group,
          });
        } else {
          // Fallback parser for non-standard ls output
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 7) {
            const permissions = parts[0] || '';
            if (!permissions.match(/^[drwxstls-]/)) continue;

            const isDir = permissions.startsWith('d') || permissions.startsWith('l');
            const rawName = parts.slice(6).join(' ');
            const cleanName = rawName.split(' -> ')[0].trim();

            if (!cleanName || cleanName === '.' || cleanName === '..') continue;

            const sizeBytes = parseInt(parts[4] || '0', 10) || 0;
            const modified = `${parts[5] || ''} ${parts[6] || ''}`.trim();

            items.push({
              name: cleanName,
              path: `${cleanPath}/${cleanName}`.replace(/\/+/g, '/'),
              isDirectory: isDir,
              size: isDir ? '--' : this.formatBytes(sizeBytes),
              sizeBytes,
              modified,
              permissions,
              owner: parts[1] || 'root',
              group: parts[2] || 'root',
            });
          }
        }
      }

      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      logger.debug(`Listed ${items.length} items for ${cleanPath} (adb path: ${adbPath})`, 'FileService');

      // Always return cleanPath (the /sdcard-based path) so breadcrumbs stay consistent
      return { currentPath: cleanPath, items };
    } catch (err: any) {
      logger.error(`Error listing directory ${cleanPath}`, 'FileService', err);
      return { currentPath: cleanPath, items: [] };
    }
  }

  /**
   * Feature: Upload (Push) local file to remote directory
   */
  public async pushFile(serial: string, localPath: string, remoteDir: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const filename = path.basename(localPath);
      const remoteTarget = `${remoteDir}/${filename}`.replace(/\/+/g, '/');
      const args = ['-s', activeSerial, 'push', localPath, remoteTarget];

      logger.info(`Pushing ${localPath} -> ${remoteTarget}`, 'FileService');
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || `Pushed ${filename} to ${remoteDir}` };
    } catch (err: any) {
      logger.error('Failed pushing file', 'FileService', err);
      return { success: false, message: `Failed uploading file: ${err.message}` };
    }
  }

  /**
   * Feature: Download (Pull) remote file to host local path
   */
  public async pullFile(serial: string, remotePath: string, localDir: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'pull', remotePath, localDir];
      logger.info(`Pulling ${remotePath} -> ${localDir}`, 'FileService');
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || `Pulled ${path.basename(remotePath)} to ${localDir}` };
    } catch (err: any) {
      logger.error('Failed pulling file', 'FileService', err);
      return { success: false, message: `Failed downloading file: ${err.message}` };
    }
  }

  /**
   * Feature: Create Folder (mkdir -p)
   */
  public async createFolder(serial: string, parentPath: string, folderName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const target = `${parentPath}/${folderName}`.replace(/\/+/g, '/');
      const args = ['-s', activeSerial, 'shell', 'mkdir', '-p', target];
      await adbService.execAdb(args);
      logger.info(`Created directory ${target}`, 'FileService');
      return { success: true, message: `Directory '${folderName}' created successfully.` };
    } catch (err: any) {
      return { success: false, message: `Failed creating folder: ${err.message}` };
    }
  }

  /**
   * Feature: Delete (rm -rf)
   */
  public async deleteItem(serial: string, targetPath: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const args = ['-s', activeSerial, 'shell', 'rm', '-rf', targetPath];
      await adbService.execAdb(args);
      logger.info(`Deleted ${targetPath}`, 'FileService');
      return { success: true, message: `Deleted ${path.basename(targetPath)} successfully.` };
    } catch (err: any) {
      return { success: false, message: `Failed deleting target: ${err.message}` };
    }
  }

  /**
   * Feature: Rename (mv)
   */
  public async renameItem(serial: string, oldPath: string, newName: string): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const parentDir = path.dirname(oldPath);
      const newPath = `${parentDir}/${newName}`.replace(/\/+/g, '/');
      const args = ['-s', activeSerial, 'shell', 'mv', oldPath, newPath];
      await adbService.execAdb(args);
      logger.info(`Renamed ${oldPath} -> ${newPath}`, 'FileService');
      return { success: true, message: `Renamed to '${newName}' successfully.` };
    } catch (err: any) {
      return { success: false, message: `Failed renaming item: ${err.message}` };
    }
  }

  /**
   * Feature: Copy / Move (cp -r / mv)
   */
  public async copyOrMoveItem(serial: string, srcPath: string, destDir: string, isMove: boolean = false): Promise<{ success: boolean; message: string }> {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: 'No active device connected.' };

    try {
      const filename = path.basename(srcPath);
      const targetPath = `${destDir}/${filename}`.replace(/\/+/g, '/');
      const command = isMove ? 'mv' : 'cp';
      const args = ['-s', activeSerial, 'shell', command, '-r', srcPath, targetPath];

      await adbService.execAdb(args);
      logger.info(`${isMove ? 'Moved' : 'Copied'} ${srcPath} -> ${targetPath}`, 'FileService');
      return {
        success: true,
        message: `${isMove ? 'Moved' : 'Copied'} ${filename} to ${destDir} successfully.`,
      };
    } catch (err: any) {
      return { success: false, message: `Failed operation: ${err.message}` };
    }
  }
}

export const fileService = FileService.getInstance();
