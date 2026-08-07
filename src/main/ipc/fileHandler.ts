import { ipcMain, dialog } from 'electron';
import { fileService } from '../services/fileService';
import { logger } from '../services/loggerService';

export function registerFileHandlers(): void {
  // List directory contents
  ipcMain.handle('file:list', async (_event, payload: { serial: string; path: string }) => {
    logger.debug(`IPC file:list called for path: ${payload.path}`, 'FileHandler');
    return fileService.listDirectory(payload.serial, payload.path);
  });

  // Open native OS file dialog to select local files for Upload (Push)
  ipcMain.handle('file:select-local-upload', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files to Upload to Android Device',
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  // Open native OS folder dialog to select download destination for Download (Pull)
  ipcMain.handle('file:select-local-download-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Directory on Computer',
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });

  // Push local file to remote Android directory
  ipcMain.handle('file:push', async (_event, payload: { serial: string; localPath: string; remoteDir: string }) => {
    return fileService.pushFile(payload.serial, payload.localPath, payload.remoteDir);
  });

  // Pull remote Android file to computer local directory
  ipcMain.handle('file:pull', async (_event, payload: { serial: string; remotePath: string; localDir: string }) => {
    return fileService.pullFile(payload.serial, payload.remotePath, payload.localDir);
  });

  // Create folder
  ipcMain.handle('file:mkdir', async (_event, payload: { serial: string; parentPath: string; folderName: string }) => {
    return fileService.createFolder(payload.serial, payload.parentPath, payload.folderName);
  });

  // Delete file or folder
  ipcMain.handle('file:delete', async (_event, payload: { serial: string; targetPath: string }) => {
    return fileService.deleteItem(payload.serial, payload.targetPath);
  });

  // Rename file or folder
  ipcMain.handle('file:rename', async (_event, payload: { serial: string; oldPath: string; newName: string }) => {
    return fileService.renameItem(payload.serial, payload.oldPath, payload.newName);
  });

  // Copy or Move item
  ipcMain.handle('file:copy', async (_event, payload: { serial: string; srcPath: string; destDir: string; isMove?: boolean }) => {
    return fileService.copyOrMoveItem(payload.serial, payload.srcPath, payload.destDir, payload.isMove);
  });
}
