import { contextBridge, ipcRenderer } from 'electron';

// Runtime instrumentation for preload execution


// Expose type-safe Electron bridge to renderer window with protection
try {
  contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
      send(channel: string, data?: unknown) {
        ipcRenderer.send(channel, data);
      },
      on(channel: string, func: (...args: unknown[]) => void) {
        const subscription = (_event: unknown, ...args: unknown[]) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      },
      invoke(channel: string, data?: unknown) {
        return ipcRenderer.invoke(channel, data);
      },
    },
    platform: process.platform,
  });
} catch (e) {
  console.error('[PRELOAD] Error during exposeInMainWorld:', e);
}
// import { contextBridge } from "electron";

// console.log("========== PRELOAD RUNNING ==========");

// alert("PRELOAD");

// contextBridge.exposeInMainWorld("electron", {
//   hello: "world",
// });
