import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc';
import { deviceDiscoveryService } from './services/deviceDiscoveryService';
import fs from "node:fs";

// Linux GPU Stability & Compatibility Config
if (process.platform === 'linux') {
  // Disable GPU sandboxing which often fails due to namespace permissions on Linux distros
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  // Disable Vulkan to prevent Vulkan driver init failures crashing the GPU process
  app.commandLine.appendSwitch('disable-vulkan');
  // Disable GPU process crash limit to allow automatic fallback to software rendering
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
}

// Log warning and fallback to software rendering if GPU goes offline
app.on('child-process-gone', (event, details) => {
  if (details.type === 'GPU') {
    console.warn(`[GPU WARNING] GPU process terminated: reason=${details.reason}, exitCode=${details.exitCode}. Falling back to software rendering.`);
  }
});

console.log("EXEC PATH:", process.execPath);
console.log("ARGV:", process.argv);
console.log("MAIN FILE:", __filename);
// Diagnostic: log every BrowserWindow creation and periodic status


let mainWindow: BrowserWindow | null = null;

const createWindow = async (): Promise<void> => {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  console.log('[MAIN IPC AUDIT] Calculated preload path:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 830,
    minWidth: 1024,
    minHeight: 700,
    title: 'Android Control Center',
    backgroundColor: '#0F0E13',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0F0E13',
      symbolColor: '#E3E2E6',
      height: 38,
    },
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
  });
console.log("========== MAIN ==========");
console.log("PID:", process.pid);
console.log("Preload path:", preloadPath);
console.log("Exists:", fs.existsSync(preloadPath));

// console.log(
//   "Actual BrowserWindow preload:",
//   (mainWindow.webContents as any).getLastWebPreferences().preload
// );

mainWindow.webContents.on("did-finish-load", () => {
  console.log("did-finish-load");
  console.log("URL:", mainWindow!.webContents.getURL());
});
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Register main IPC handlers
  registerIpcHandlers();

  // Start automatic background device discovery & auto-reconnect service (10s interval)
  deviceDiscoveryService.startDiscovery(10000);

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[MAIN] Page finished loading');
  });

  // Log which loading path is chosen
  console.log('[MAIN] Loading renderer. VITE_DEV_SERVER_URL:', process.env.VITE_DEV_SERVER_URL);
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('[MAIN] Loading from dev server URL');
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../../dist/index.html');
    console.log('[MAIN] Loading from file:', indexPath);
    await mainWindow.loadFile(indexPath);
  }
  console.log('[MAIN] Load completed');

};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  deviceDiscoveryService.stopDiscovery();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
