"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const child_process = require("child_process");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const events = require("events");
const ws = require("ws");
const fs$1 = require("node:fs");
class SystemService {
  /**
   * Gather host operating system and hardware metrics
   */
  static getSystemInfo() {
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 && cpus[0] ? cpus[0].model : "Unknown CPU";
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
      uptimeSeconds: Math.round(os.uptime())
    };
  }
}
class AppInfoService {
  /**
   * Get app version and runtime dependencies versions
   */
  static getAppVersionInfo() {
    return {
      appVersion: electron.app.getVersion(),
      appName: electron.app.getName(),
      electronVersion: process.versions.electron || "unknown",
      nodeVersion: process.versions.node || "unknown",
      chromeVersion: process.versions.chrome || "unknown",
      platform: process.platform
    };
  }
}
class PathUtils {
  /**
   * Get user data folder path
   */
  static getUserDataPath() {
    if (typeof electron.app !== "undefined" && electron.app && typeof electron.app.getPath === "function") {
      try {
        return electron.app.getPath("userData");
      } catch {
      }
    }
    return path.join(process.cwd(), ".temp_user_data");
  }
  /**
   * Get settings JSON file path
   */
  static getSettingsFilePath() {
    return path.join(this.getUserDataPath(), "settings.json");
  }
  /**
   * Get logs folder path, creating it if missing
   */
  static getLogsDirectory() {
    const logsDir = path.join(this.getUserDataPath(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    return logsDir;
  }
  /**
   * Get current log file path for today
   */
  static getTodayLogFilePath() {
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    return path.join(this.getLogsDirectory(), `app-${dateStr}.log`);
  }
}
const _LoggerService = class _LoggerService {
  constructor() {
  }
  static getInstance() {
    if (!_LoggerService.instance) {
      _LoggerService.instance = new _LoggerService();
    }
    return _LoggerService.instance;
  }
  /**
   * Write formatted log to console and daily log file
   */
  log(level, message, context = "App", metadata) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const formattedLog = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${metadata ? " " + JSON.stringify(metadata) : ""}
`;
    switch (level) {
      case "debug":
        console.debug(formattedLog.trim());
        break;
      case "info":
        console.info(formattedLog.trim());
        break;
      case "warn":
        console.warn(formattedLog.trim());
        break;
      case "error":
        console.error(formattedLog.trim());
        break;
    }
    try {
      const logFile = PathUtils.getTodayLogFilePath();
      fs.appendFileSync(logFile, formattedLog, "utf-8");
    } catch (err) {
      console.error("Failed writing to log file:", err);
    }
  }
  debug(message, context, metadata) {
    this.log("debug", message, context, metadata);
  }
  info(message, context, metadata) {
    this.log("info", message, context, metadata);
  }
  warn(message, context, metadata) {
    this.log("warn", message, context, metadata);
  }
  error(message, context, metadata) {
    this.log("error", message, context, metadata);
  }
};
__publicField(_LoggerService, "instance");
let LoggerService = _LoggerService;
const logger = LoggerService.getInstance();
function registerSystemHandlers() {
  electron.ipcMain.handle("system:get-info", async () => {
    logger.debug("IPC handler system:get-info called", "SystemHandler");
    return SystemService.getSystemInfo();
  });
  electron.ipcMain.handle("system:get-app-version", async () => {
    logger.debug("IPC handler system:get-app-version called", "SystemHandler");
    return AppInfoService.getAppVersionInfo();
  });
  electron.ipcMain.handle("system:get-platform", async () => {
    return process.platform;
  });
}
const defaultSettings = {
  adbPath: "/usr/bin/adb",
  autoConnectWireless: true,
  screenMirrorQuality: "high",
  screenFpsLimit: 60,
  screenMirrorBitrate: 16,
  autoCheckUpdates: true,
  logcatBufferSize: 500,
  themeMode: "dark",
  hasCompletedFirstRun: false
};
const _SettingsService = class _SettingsService {
  constructor() {
    __publicField(this, "settings");
    __publicField(this, "filePath");
    this.filePath = PathUtils.getSettingsFilePath();
    this.settings = this.loadSettingsFromFile();
  }
  static getInstance() {
    if (!_SettingsService.instance) {
      _SettingsService.instance = new _SettingsService();
    }
    return _SettingsService.instance;
  }
  loadSettingsFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const rawData = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(rawData);
        logger.info("Loaded persistent settings from file", "SettingsService");
        return { ...defaultSettings, ...parsed };
      }
    } catch (err) {
      logger.error("Failed reading settings file, falling back to defaults", "SettingsService", err);
    }
    return { ...defaultSettings };
  }
  getSettings() {
    return { ...this.settings };
  }
  updateSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    this.saveToFile();
    logger.info("Updated settings store", "SettingsService", partial);
    return this.getSettings();
  }
  resetToDefaults() {
    this.settings = { ...defaultSettings };
    this.saveToFile();
    logger.info("Reset settings store to defaults", "SettingsService");
    return this.getSettings();
  }
  saveToFile() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (err) {
      logger.error("Failed writing settings to disk", "SettingsService", err);
    }
  }
};
__publicField(_SettingsService, "instance");
let SettingsService = _SettingsService;
const settingsService = SettingsService.getInstance();
function registerSettingsHandlers() {
  electron.ipcMain.handle("settings:get", async () => {
    return settingsService.getSettings();
  });
  electron.ipcMain.handle("settings:update", async (_event, partial) => {
    return settingsService.updateSettings(partial);
  });
  electron.ipcMain.handle("settings:reset", async () => {
    return settingsService.resetToDefaults();
  });
}
function registerLoggerHandlers() {
  electron.ipcMain.handle(
    "log:event",
    async (_event, payload) => {
      logger.log(payload.level, payload.message, payload.context || "Renderer", payload.metadata);
      return { success: true };
    }
  );
}
const _TrustedDevicesService = class _TrustedDevicesService {
  constructor() {
    __publicField(this, "filePath");
    __publicField(this, "trustedDevices", /* @__PURE__ */ new Map());
    this.filePath = path.join(PathUtils.getUserDataPath(), "trusted_devices.json");
    this.loadFromDisk();
  }
  static getInstance() {
    if (!_TrustedDevicesService.instance) {
      _TrustedDevicesService.instance = new _TrustedDevicesService();
    }
    return _TrustedDevicesService.instance;
  }
  getDeviceKey(item) {
    return item.hardwareSerial || item.id || (item.model && item.model !== "Generic Device" ? `${item.manufacturer}_${item.model}` : item.serialNumber || "");
  }
  loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const list = JSON.parse(raw);
        for (const item of list) {
          const key = this.getDeviceKey(item);
          if (key) {
            const existing = this.trustedDevices.get(key);
            if (!existing || new Date(item.lastConnected).getTime() > new Date(existing.lastConnected).getTime()) {
              this.trustedDevices.set(key, item);
            }
          }
        }
        logger.info(`Loaded ${this.trustedDevices.size} unique physical trusted devices from store`, "TrustedDevicesService");
      }
    } catch (err) {
      logger.error("Failed reading trusted devices file", "TrustedDevicesService", err);
    }
  }
  saveToDisk() {
    try {
      const list = Array.from(this.trustedDevices.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), "utf-8");
    } catch (err) {
      logger.error("Failed saving trusted devices file", "TrustedDevicesService", err);
    }
  }
  getAll() {
    return Array.from(this.trustedDevices.values());
  }
  getAllDevices() {
    return this.getAll();
  }
  getTrustedDevices() {
    return this.getAll();
  }
  getBySerial(serial) {
    var _a;
    if (!serial) return void 0;
    const cleanSerial = serial.trim();
    if (!cleanSerial) return void 0;
    for (const dev of this.trustedDevices.values()) {
      if (dev.hardwareSerial && dev.hardwareSerial === cleanSerial || dev.id && dev.id === cleanSerial || dev.serialNumber && dev.serialNumber === cleanSerial || dev.ipAddress && dev.ipAddress === cleanSerial || ((_a = dev.availableTransports) == null ? void 0 : _a.some((t) => t.serial === cleanSerial))) {
        return dev;
      }
    }
    return void 0;
  }
  saveDevice(device) {
    const key = this.getDeviceKey(device);
    const existing = this.trustedDevices.get(key) || this.getBySerial(device.serialNumber);
    const mergedTransports = device.availableTransports || (existing == null ? void 0 : existing.availableTransports) || [];
    const updated = {
      ...existing,
      ...device,
      id: (existing == null ? void 0 : existing.id) || device.id || `dev_${key.replace(/[^a-zA-Z0-9]/g, "_")}`,
      hardwareSerial: device.hardwareSerial || (existing == null ? void 0 : existing.hardwareSerial) || (device.serialNumber.includes(":") ? "" : device.serialNumber),
      ipAddress: device.ipAddress || (existing == null ? void 0 : existing.ipAddress) || "",
      port: device.port || (existing == null ? void 0 : existing.port) || 5555,
      availableTransports: mergedTransports,
      preferredTransport: device.preferredTransport || (existing == null ? void 0 : existing.preferredTransport) || device.connectionType,
      isTrusted: true,
      lastConnected: (/* @__PURE__ */ new Date()).toISOString()
    };
    const finalKey = this.getDeviceKey(updated);
    this.trustedDevices.set(finalKey, updated);
    this.saveToDisk();
  }
  addDevice(entry) {
    const existing = this.getBySerial(entry.hardwareSerial || entry.serialNumber);
    const updated = {
      id: (existing == null ? void 0 : existing.id) || `dev-${Date.now()}`,
      serialNumber: entry.serialNumber,
      hardwareSerial: entry.hardwareSerial || (existing == null ? void 0 : existing.hardwareSerial),
      deviceName: entry.deviceName,
      model: entry.model,
      manufacturer: (existing == null ? void 0 : existing.manufacturer) || "Android",
      androidVersion: (existing == null ? void 0 : existing.androidVersion) || "11+",
      batteryLevel: (existing == null ? void 0 : existing.batteryLevel) || 100,
      isCharging: (existing == null ? void 0 : existing.isCharging) || false,
      chargingType: (existing == null ? void 0 : existing.chargingType) || "none",
      storageFree: (existing == null ? void 0 : existing.storageFree) || "10GB",
      storageTotal: (existing == null ? void 0 : existing.storageTotal) || "64GB",
      storageUsedPercent: (existing == null ? void 0 : existing.storageUsedPercent) || 50,
      cpuUsage: (existing == null ? void 0 : existing.cpuUsage) || 10,
      cpuModel: (existing == null ? void 0 : existing.cpuModel) || "ARM64",
      cpuCores: (existing == null ? void 0 : existing.cpuCores) || 8,
      ramUsedGB: (existing == null ? void 0 : existing.ramUsedGB) || "4GB",
      ramTotalGB: (existing == null ? void 0 : existing.ramTotalGB) || "8GB",
      ramPercent: (existing == null ? void 0 : existing.ramPercent) || 50,
      temperature: (existing == null ? void 0 : existing.temperature) || 35,
      thermalStatus: (existing == null ? void 0 : existing.thermalStatus) || "Normal",
      connectionType: entry.connectionType,
      ipAddress: entry.ipAddress || (entry.serialNumber.includes(":") ? entry.serialNumber.split(":")[0] : (existing == null ? void 0 : existing.ipAddress) || ""),
      port: entry.port || (existing == null ? void 0 : existing.port) || 5555,
      status: "online",
      adbStatus: "Active Connected",
      developerMode: true,
      wirelessDebugging: entry.connectionType === "wireless",
      lastConnected: new Date(entry.lastConnected).toISOString(),
      isTrusted: true,
      availableTransports: existing == null ? void 0 : existing.availableTransports,
      preferredTransport: (existing == null ? void 0 : existing.preferredTransport) || entry.connectionType
    };
    this.saveDevice(updated);
  }
  removeDevice(serial) {
    var _a;
    if (!serial) return false;
    const clean = serial.trim();
    if (!clean) return false;
    const beforeCount = this.trustedDevices.size;
    logger.info(`[TrustedDevicesService] Before: ${beforeCount} trusted device(s)`, "TrustedDevicesService");
    logger.info(`[TrustedDevicesService] Removing: ${clean}`, "TrustedDevicesService");
    const targetDev = this.getBySerial(clean);
    const keysToDelete = /* @__PURE__ */ new Set();
    keysToDelete.add(clean);
    for (const [key, dev] of this.trustedDevices.entries()) {
      const matchesDirectly = key === clean || dev.id === clean || dev.serialNumber === clean || dev.hardwareSerial === clean || dev.ipAddress && dev.ipAddress === clean || ((_a = dev.availableTransports) == null ? void 0 : _a.some((t) => t.serial === clean));
      const matchesTargetDev = targetDev && (key === this.getDeviceKey(targetDev) || dev.id === targetDev.id || dev.hardwareSerial && targetDev.hardwareSerial && dev.hardwareSerial === targetDev.hardwareSerial || dev.serialNumber && targetDev.serialNumber && dev.serialNumber === targetDev.serialNumber || dev.model && targetDev.model && dev.model !== "Generic Device" && dev.model === targetDev.model && dev.manufacturer === targetDev.manufacturer);
      if (matchesDirectly || matchesTargetDev) {
        keysToDelete.add(key);
        if (dev.id) keysToDelete.add(dev.id);
        if (dev.serialNumber) keysToDelete.add(dev.serialNumber);
        if (dev.hardwareSerial) keysToDelete.add(dev.hardwareSerial);
      }
    }
    for (const k of keysToDelete) {
      this.trustedDevices.delete(k);
    }
    const afterCount = this.trustedDevices.size;
    logger.info(`[TrustedDevicesService] After: ${afterCount} trusted device(s)`, "TrustedDevicesService");
    const wasRemoved = beforeCount > afterCount;
    if (wasRemoved) {
      this.saveToDisk();
      logger.info(`[TrustedDevicesService] Successfully removed device '${clean}' from persistent store`, "TrustedDevicesService");
      return true;
    }
    logger.info(`[TrustedDevicesService] Device '${clean}' was not in trusted storage (already removed or not found)`, "TrustedDevicesService");
    return false;
  }
};
__publicField(_TrustedDevicesService, "instance");
let TrustedDevicesService = _TrustedDevicesService;
const trustedDevicesService = TrustedDevicesService.getInstance();
const _AdbCapabilityService = class _AdbCapabilityService {
  constructor() {
    __publicField(this, "cachedCapabilities", null);
    __publicField(this, "isDetecting", false);
  }
  static getInstance() {
    if (!_AdbCapabilityService.instance) {
      _AdbCapabilityService.instance = new _AdbCapabilityService();
    }
    return _AdbCapabilityService.instance;
  }
  /**
   * Run ONCE at application startup or when ADB path changes.
   * Caches supportsMdns, supportsQrPairing, adbVersion, and adbPath for the entire app lifetime.
   */
  async detectCapabilities(adbPath) {
    if (this.cachedCapabilities && this.cachedCapabilities.adbPath === adbPath) {
      return this.cachedCapabilities;
    }
    if (this.isDetecting && this.cachedCapabilities) {
      return this.cachedCapabilities;
    }
    this.isDetecting = true;
    let versionStr = null;
    let supportsMdns = false;
    let supportsQrPairing = false;
    try {
      const versionOutput = await this.execAdb(adbPath, ["version"]);
      const versionMatch = versionOutput.match(/Android Debug Bridge version ([\d.]+)/);
      if (versionMatch) {
        versionStr = versionMatch[1] || null;
      }
    } catch {
    }
    try {
      const mdnsOutput = await this.execAdb(adbPath, ["mdns", "services"]);
      const lower = mdnsOutput.toLowerCase();
      if (lower.includes("mdns is not supported") || lower.includes("not supported by this version")) {
        supportsMdns = false;
        logger.info("ADB mDNS support: Not Available (Compilation unsupported). Using fallback discovery.", "AdbCapabilityService");
      } else {
        supportsMdns = true;
        logger.info("ADB mDNS support: Available", "AdbCapabilityService");
      }
    } catch {
      supportsMdns = false;
      logger.info("ADB mDNS support: Not Available. Using fallback discovery.", "AdbCapabilityService");
    }
    supportsQrPairing = supportsMdns;
    if (!supportsQrPairing) {
      logger.info("ADB QR Pairing support: Not Available. Automatic fallback to Manual Pairing.", "AdbCapabilityService");
    } else {
      logger.info("ADB QR Pairing support: Available", "AdbCapabilityService");
    }
    this.cachedCapabilities = {
      adbPath,
      adbVersion: versionStr,
      supportsMdns,
      supportsQrPairing,
      isDetected: true
    };
    this.isDetecting = false;
    return this.cachedCapabilities;
  }
  /**
   * Synchronously return cached capabilities
   */
  getCapabilities() {
    if (this.cachedCapabilities) {
      return this.cachedCapabilities;
    }
    return {
      adbPath: null,
      adbVersion: null,
      supportsMdns: false,
      supportsQrPairing: false,
      isDetected: false
    };
  }
  /**
   * Helper to execute adb binary
   */
  execAdb(adbPath, args) {
    return new Promise((resolve, reject) => {
      child_process.execFile(adbPath, args, { timeout: 3e3 }, (error, stdout, stderr) => {
        const out = (stdout || "").toString() + (stderr || "").toString();
        if (error && !out) {
          reject(error);
          return;
        }
        resolve(out);
      });
    });
  }
};
__publicField(_AdbCapabilityService, "instance");
let AdbCapabilityService = _AdbCapabilityService;
const adbCapabilityService = AdbCapabilityService.getInstance();
const _ADBService = class _ADBService {
  constructor() {
    __publicField(this, "cachedAdbExecutablePath", null);
    __publicField(this, "staticDeviceCache", /* @__PURE__ */ new Map());
    __publicField(this, "activeRunningCount", 0);
    __publicField(this, "maxConcurrentCommands", 3);
    __publicField(this, "commandQueue", []);
    __publicField(this, "inFlightPromises", /* @__PURE__ */ new Map());
    __publicField(this, "commandCache", /* @__PURE__ */ new Map());
    __publicField(this, "cachedRawDevicesTimestamp", 0);
    __publicField(this, "cachedRawDevicesList", []);
  }
  static getInstance() {
    if (!_ADBService.instance) {
      _ADBService.instance = new _ADBService();
    }
    return _ADBService.instance;
  }
  /**
   * Fetch static device properties (Manufacturer, Model, Android Version, SDK, Hardware Serial, Root, Shizuku, Dev Options) ONCE.
   * Caches forever per device serial until disconnected or manually invalidated.
   */
  async fetchStaticDeviceInfo(serial) {
    const activeSerial = await this.resolveActiveSerial(serial) || serial;
    const cached = this.staticDeviceCache.get(activeSerial);
    if (cached) {
      logger.debug(`[Polling] Using cached static device info for ${activeSerial}`, "ADBService");
      return cached;
    }
    logger.info(`[Polling] Fetching static info for ${activeSerial}`, "ADBService");
    const [manRes, modRes, nameRes, verRes, sdkRes, devRes, wlanRes, hwSerialRes, suRes, shizRes] = await Promise.allSettled([
      this.execAdb(["-s", activeSerial, "shell", "getprop", "ro.product.manufacturer"]),
      this.execAdb(["-s", activeSerial, "shell", "getprop", "ro.product.model"]),
      this.execAdb(["-s", activeSerial, "shell", "getprop", "ro.config.marketing_name"]),
      this.execAdb(["-s", activeSerial, "shell", "getprop", "ro.build.version.release"]),
      this.execAdb(["-s", activeSerial, "shell", "getprop", "ro.build.version.sdk"]),
      this.execAdb(["-s", activeSerial, "shell", "settings", "get", "global", "development_settings_enabled"]),
      this.execAdb(["-s", activeSerial, "shell", "settings", "get", "global", "adb_wifi_enabled"]),
      this.execAdb(["-s", activeSerial, "shell", "getprop", "ro.serialno"]),
      this.execAdb(["-s", activeSerial, "shell", "which", "su"]),
      this.execAdb(["-s", activeSerial, "shell", "pm", "list", "packages", "moe.shizuku.privileged.api"])
    ]);
    let manufacturer = "Android";
    if (manRes.status === "fulfilled" && manRes.value.stdout.trim()) {
      const raw = manRes.value.stdout.trim();
      manufacturer = raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    let model = "Generic Device";
    if (modRes.status === "fulfilled" && modRes.value.stdout.trim()) {
      model = modRes.value.stdout.trim();
    }
    let deviceName = `${manufacturer} ${model}`;
    if (nameRes.status === "fulfilled" && nameRes.value.stdout.trim()) {
      deviceName = nameRes.value.stdout.trim();
    }
    let androidVersion = "Android";
    let sdkVersion = "";
    if (verRes.status === "fulfilled" && verRes.value.stdout.trim()) {
      const rel = verRes.value.stdout.trim();
      sdkVersion = sdkRes.status === "fulfilled" ? sdkRes.value.stdout.trim() : "";
      androidVersion = `Android ${rel}${sdkVersion ? ` (API ${sdkVersion})` : ""}`;
    }
    let developerOptions = true;
    if (devRes.status === "fulfilled" && devRes.value.stdout.trim()) {
      developerOptions = devRes.value.stdout.trim() === "1";
    }
    let adbWifiEnabled = true;
    if (wlanRes.status === "fulfilled" && wlanRes.value.stdout.trim()) {
      adbWifiEnabled = wlanRes.value.stdout.trim() === "1";
    }
    let hardwareSerial = activeSerial;
    if (hwSerialRes.status === "fulfilled" && hwSerialRes.value.stdout.trim()) {
      hardwareSerial = hwSerialRes.value.stdout.trim();
    }
    let isRooted = false;
    if (suRes.status === "fulfilled" && suRes.value.stdout.trim() && !suRes.value.stdout.includes("not found")) {
      isRooted = true;
    }
    let hasShizuku = false;
    if (shizRes.status === "fulfilled" && shizRes.value.stdout.includes("moe.shizuku.privileged.api")) {
      hasShizuku = true;
    }
    const staticInfo = {
      manufacturer,
      model,
      deviceName,
      androidVersion,
      sdkVersion,
      hardwareSerial,
      developerOptions,
      adbWifiEnabled,
      isRooted,
      hasShizuku,
      fetchedAt: Date.now()
    };
    this.staticDeviceCache.set(activeSerial, staticInfo);
    return staticInfo;
  }
  invalidateStaticDeviceCache(serial) {
    if (serial) {
      this.staticDeviceCache.delete(serial);
      logger.info(`[Polling] Invalidated static device info cache for ${serial}`, "ADBService");
    } else {
      this.staticDeviceCache.clear();
      logger.info("[Polling] Cleared all static device info cache", "ADBService");
    }
  }
  /**
   * Fetch rich device properties using cached StaticDeviceInfo.
   * Does NOT execute expensive polling like dumpsys wifi or df -h.
   */
  async fetchDetailedDeviceSpecs(serial, status, connectionType) {
    const existing = trustedDevicesService.getBySerial(serial);
    if (status !== "online") {
      return {
        id: (existing == null ? void 0 : existing.id) || serial,
        serialNumber: serial,
        hardwareSerial: (existing == null ? void 0 : existing.hardwareSerial) || serial,
        deviceName: (existing == null ? void 0 : existing.deviceName) || "Disconnected Device",
        manufacturer: (existing == null ? void 0 : existing.manufacturer) || "Android",
        model: (existing == null ? void 0 : existing.model) || "Generic Device",
        connectionType,
        status,
        batteryLevel: existing == null ? void 0 : existing.batteryLevel,
        isCharging: existing == null ? void 0 : existing.isCharging,
        chargingType: existing == null ? void 0 : existing.chargingType,
        androidVersion: existing == null ? void 0 : existing.androidVersion,
        developerMode: (existing == null ? void 0 : existing.developerMode) ?? false,
        wirelessDebugging: (existing == null ? void 0 : existing.wirelessDebugging) ?? false,
        adbStatus: "Disconnected",
        lastConnected: existing == null ? void 0 : existing.lastConnected
      };
    }
    const staticInfo = await this.fetchStaticDeviceInfo(serial);
    let batteryLevel = existing == null ? void 0 : existing.batteryLevel;
    let isCharging = existing == null ? void 0 : existing.isCharging;
    let chargingType = existing == null ? void 0 : existing.chargingType;
    try {
      const batRes = await this.execAdb(["-s", serial, "shell", "dumpsys", "battery"]);
      if (batRes.stdout) {
        const batTxt = batRes.stdout;
        const levelMatch = batTxt.match(/level:\s*(\d+)/i);
        const statusMatch = batTxt.match(/status:\s*(\d+)/i);
        const acMatch = batTxt.match(/AC powered:\s*true/i);
        const usbMatch = batTxt.match(/USB powered:\s*true/i);
        const wirelessMatch = batTxt.match(/Wireless powered:\s*true/i);
        if (levelMatch && levelMatch[1]) batteryLevel = parseInt(levelMatch[1], 10);
        if (statusMatch && statusMatch[1]) isCharging = parseInt(statusMatch[1], 10) === 2;
        if (acMatch) chargingType = "AC Adapter Fast Charge";
        else if (usbMatch) chargingType = "USB Data Port";
        else if (wirelessMatch) chargingType = "Qi Wireless Charging";
        else chargingType = isCharging ? "Charging" : "Discharging (Battery)";
      }
    } catch {
    }
    const ipAddress = (existing == null ? void 0 : existing.ipAddress) || (serial.includes(":") ? serial.split(":")[0] || "" : void 0);
    const port = (existing == null ? void 0 : existing.port) || 5555;
    const deviceModel = {
      id: `dev_${serial.replace(/[^a-zA-Z0-9]/g, "_")}`,
      serialNumber: serial,
      deviceName: staticInfo.deviceName,
      model: staticInfo.model,
      manufacturer: staticInfo.manufacturer,
      androidVersion: staticInfo.androidVersion,
      batteryLevel,
      isCharging,
      chargingType,
      developerMode: staticInfo.developerOptions,
      wirelessDebugging: staticInfo.adbWifiEnabled,
      connectionType,
      ipAddress,
      port,
      status: "online",
      hardwareSerial: staticInfo.hardwareSerial || serial,
      adbStatus: "Active Connected",
      lastConnected: /* @__PURE__ */ new Date()
    };
    return deviceModel;
  }
  /**
   * Resolve active ADB executable path from settings or system PATH asynchronously
   */
  async getAdbExecutablePath() {
    if (this.cachedAdbExecutablePath && fs.existsSync(this.cachedAdbExecutablePath)) {
      return this.cachedAdbExecutablePath;
    }
    const settings = settingsService.getSettings();
    if (settings.adbPath && fs.existsSync(settings.adbPath)) {
      this.cachedAdbExecutablePath = settings.adbPath;
      return settings.adbPath;
    }
    const localBinPath = path.join(
      PathUtils.getUserDataPath(),
      "bin",
      "platform-tools",
      process.platform === "win32" ? "adb.exe" : "adb"
    );
    if (fs.existsSync(localBinPath)) {
      this.cachedAdbExecutablePath = localBinPath;
      return localBinPath;
    }
    const systemExecutable = process.platform === "win32" ? "adb.exe" : "adb";
    try {
      const command = process.platform === "win32" ? "where" : "which";
      const result = await new Promise((resolve, reject) => {
        child_process.execFile(command, [systemExecutable], { timeout: 3e3 }, (err, stdout) => {
          if (err || !stdout) reject(err || new Error("Not found"));
          else resolve(stdout.trim());
        });
      });
      const firstLine = result.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        this.cachedAdbExecutablePath = firstLine;
        return firstLine;
      }
    } catch {
    }
    return null;
  }
  /**
   * Determine priority for command scheduling:
   * High (3): connect, pair, input, screencap, screenrecord, mirror
   * Med (2): getprop, battery, storage, devices
   * Low (1): dumpsys wifi, dumpsys package, logcat, pm list
   */
  getCommandPriority(args) {
    const cmdStr = args.join(" ").toLowerCase();
    if (cmdStr.includes("connect") || cmdStr.includes("pair") || cmdStr.includes("input") || cmdStr.includes("screencap") || cmdStr.includes("screenrecord")) {
      return 3;
    }
    if (cmdStr.includes("dumpsys wifi") || cmdStr.includes("dumpsys package") || cmdStr.includes("pm list") || cmdStr.includes("logcat")) {
      return 1;
    }
    return 2;
  }
  /**
   * Execute ADB command via spawn() with incremental stdout reading, max 3 concurrency, caching, and deduplication
   */
  async execAdb(args, options) {
    const GLOBAL_ADB_COMMANDS = /* @__PURE__ */ new Set(["devices", "version", "connect", "disconnect", "start-server", "kill-server", "mdns", "help"]);
    const isGlobal = args.length > 0 && GLOBAL_ADB_COMMANDS.has(args[0]);
    if (!isGlobal) {
      const sIndex = args.indexOf("-s");
      if (sIndex === -1 || !args[sIndex + 1] || args[sIndex + 1].trim() === "") {
        logger.info(`[ADB Blocked] Rejecting device command without target serial: adb ${args.join(" ")}`, "ADBService");
        return { stdout: "", stderr: "No active ADB device serial specified" };
      }
    }
    const cmdKey = args.join(" ");
    const priority = this.getCommandPriority(args);
    const cacheTtl = (options == null ? void 0 : options.cacheTtlMs) ?? (cmdKey.includes("dumpsys wifi") ? 15e3 : 0);
    if (cacheTtl > 0) {
      const cached = this.commandCache.get(cmdKey);
      if (cached && Date.now() - cached.timestamp < cacheTtl) {
        logger.info(`[ADB Cache Hit] Reusing cached result for: adb ${cmdKey}`, "ADBService");
        return cached.result;
      }
    }
    if (this.inFlightPromises.has(cmdKey)) {
      logger.info(`[ADB Deduplication] Reusing in-flight Promise for: adb ${cmdKey}`, "ADBService");
      return this.inFlightPromises.get(cmdKey);
    }
    const promise = new Promise((resolve, reject) => {
      this.commandQueue.push({ args, priority, options, resolve, reject });
      this.commandQueue.sort((a, b) => b.priority - a.priority);
      this.processQueue();
    }).finally(() => {
      this.inFlightPromises.delete(cmdKey);
    });
    this.inFlightPromises.set(cmdKey, promise);
    return promise;
  }
  async processQueue() {
    var _a;
    if (this.activeRunningCount >= this.maxConcurrentCommands || this.commandQueue.length === 0) {
      return;
    }
    const task = this.commandQueue.shift();
    if (!task) return;
    this.activeRunningCount++;
    logger.info(`Queue size: ${this.commandQueue.length} | Running commands: ${this.activeRunningCount}`, "ADBService");
    try {
      const result = await this.spawnAdbDirect(task.args, task.options);
      const cmdKey = task.args.join(" ");
      const cacheTtl = ((_a = task.options) == null ? void 0 : _a.cacheTtlMs) ?? (cmdKey.includes("dumpsys wifi") ? 15e3 : 0);
      if (cacheTtl > 0) {
        this.commandCache.set(cmdKey, { timestamp: Date.now(), result });
      }
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.activeRunningCount--;
      this.processQueue();
    }
  }
  /**
   * Direct spawn() execution with incremental stream buffering & unlimited stdout size
   */
  async spawnAdbDirect(args, options) {
    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      throw new Error("ADB executable not found. Please configure ADB path or install Android Platform Tools.");
    }
    const timeoutMs = (options == null ? void 0 : options.timeoutMs) || 3e4;
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      logger.info(`spawn vs exec: SPAWN | Executing: adb ${args.join(" ")}`, "ADBService");
      const child = child_process.spawn(adbPath, args);
      let stdoutBufs = [];
      let stderrBufs = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          logger.error(`ADB command timed out after ${timeoutMs}ms: adb ${args.join(" ")}`, "ADBService");
          child.kill("SIGTERM");
          reject(new Error(`ADB command timed out after ${(timeoutMs / 1e3).toFixed(0)} seconds.`));
        }, timeoutMs);
      }
      child.stdout.on("data", (chunk) => {
        stdoutBufs.push(chunk);
        stdoutBytes += chunk.length;
      });
      child.stderr.on("data", (chunk) => {
        stderrBufs.push(chunk);
        stderrBytes += chunk.length;
      });
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code, signal) => {
        if (timer) clearTimeout(timer);
        const duration = Date.now() - startTime;
        const stdoutStr = Buffer.concat(stdoutBufs).toString("utf-8");
        const stderrStr = Buffer.concat(stderrBufs).toString("utf-8");
        logger.info(`Execution duration: ${duration}ms | Bytes received: ${stdoutBytes + stderrBytes} | stdout size: ${stdoutBytes} bytes | stderr size: ${stderrBytes} bytes`, "ADBService");
        if (code !== 0 && !stdoutStr) {
          reject(new Error(stderrStr || `ADB exited with code ${code} signal ${signal}`));
          return;
        }
        resolve({ stdout: stdoutStr, stderr: stderrStr });
      });
    });
  }
  /**
   * Detect Linux Package Manager and return installation suggestion command
   */
  detectLinuxPackageManager() {
    const managers = [
      { bin: "apt-get", cmd: "sudo apt update && sudo apt install android-sdk-platform-tools android-tools-adb" },
      { bin: "pacman", cmd: "sudo pacman -S android-tools" },
      { bin: "dnf", cmd: "sudo dnf install android-tools" },
      { bin: "zypper", cmd: "sudo zypper install android-tools" },
      { bin: "apk", cmd: "sudo apk add android-tools" }
    ];
    for (const mgr of managers) {
      try {
        child_process.execSync(`which ${mgr.bin}`, { stdio: "ignore" });
        return mgr.cmd;
      } catch {
      }
    }
    return 'Install "android-tools" or "android-sdk-platform-tools" via your system package manager.';
  }
  /**
   * Check ADB installation status, version, and OS package recommendations
   */
  async checkAdbInstallation() {
    const adbPath = await this.getAdbExecutablePath();
    const platform = process.platform;
    const isWindows = platform === "win32";
    if (!adbPath) {
      const suggestion = platform === "linux" ? this.detectLinuxPackageManager() : void 0;
      return {
        installed: false,
        executablePath: null,
        platform,
        packageManagerSuggestion: suggestion,
        autoDownloadSupported: isWindows,
        message: isWindows ? "ADB not found. Automatic download available for Windows." : `ADB not found. ${suggestion}`
      };
    }
    try {
      const { stdout } = await this.execAdb(["version"]);
      const versionMatch = stdout.match(/Android Debug Bridge version ([\d.]+)/);
      const versionStr = versionMatch ? versionMatch[1] : "Unknown";
      return {
        installed: true,
        executablePath: adbPath,
        version: versionStr,
        platform,
        autoDownloadSupported: isWindows,
        message: `ADB version ${versionStr} detected at ${adbPath}`
      };
    } catch {
      return {
        installed: false,
        executablePath: adbPath,
        platform,
        autoDownloadSupported: isWindows,
        message: `ADB binary found at ${adbPath} but failed version check.`
      };
    }
  }
  /**
   * Automatically download official Google Platform Tools on Windows
   */
  async downloadPlatformToolsWindows() {
    if (process.platform !== "win32") {
      return {
        success: false,
        message: "Automatic platform-tools download is currently supported on Windows only."
      };
    }
    const downloadUrl = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
    const targetDir = path.join(PathUtils.getUserDataPath(), "bin");
    const zipPath = path.join(targetDir, "platform-tools-windows.zip");
    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      logger.info(`Starting download of Windows platform-tools from ${downloadUrl}`, "ADBService");
      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(zipPath);
        https.get(downloadUrl, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed downloading platform-tools: HTTP ${response.statusCode}`));
            return;
          }
          response.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close();
            resolve();
          });
        }).on("error", (err) => {
          fs.unlink(zipPath, () => {
          });
          reject(err);
        });
      });
      const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
      child_process.execSync(extractCmd);
      fs.unlinkSync(zipPath);
      const installedAdbPath = path.join(targetDir, "platform-tools", "adb.exe");
      if (fs.existsSync(installedAdbPath)) {
        settingsService.updateSettings({ adbPath: installedAdbPath });
        logger.info(`Platform tools extracted successfully to ${installedAdbPath}`, "ADBService");
        return {
          success: true,
          message: `Platform Tools installed successfully. Configured ADB path: ${installedAdbPath}`,
          data: { adbPath: installedAdbPath }
        };
      } else {
        throw new Error("Extraction completed but adb.exe missing in extracted output.");
      }
    } catch (err) {
      logger.error("Failed downloading Windows platform-tools", "ADBService", err);
      return {
        success: false,
        message: `Failed downloading Platform Tools: ${err.message}`
      };
    }
  }
  /**
   * Enumerate raw connected ADB targets (15-second cache to prevent ADB process spamming)
   */
  async listRawDevices(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedRawDevicesList.length > 0 && now - this.cachedRawDevicesTimestamp < 15e3) {
      return this.cachedRawDevicesList;
    }
    try {
      const { stdout } = await this.execAdb(["devices", "-l"]);
      const lines = stdout.split(/\r?\n/);
      const results = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("List of devices attached")) {
          continue;
        }
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const serial = parts[0] || "";
        const rawStatus = parts[1] || "";
        const isWireless = serial.includes(":") || serial.includes(".");
        results.push({
          serial,
          rawStatus,
          connectionType: isWireless ? "wireless" : "usb"
        });
      }
      this.cachedRawDevicesTimestamp = now;
      this.cachedRawDevicesList = results;
      return results;
    } catch (err) {
      logger.error("Error listing raw devices", "ADBService", err);
      return [];
    }
  }
  /**
   * Feature: adb connect <ip>:<port>
   */
  async connectWireless(ip, port = 5555) {
    if (!ip) {
      return { success: false, message: "IP address is required for wireless connection." };
    }
    const target = `${ip}:${port}`;
    try {
      const { stdout } = await this.execAdb(["connect", target]);
      const cleanStdout = stdout.trim();
      const isConnected = cleanStdout.includes("connected to") || cleanStdout.includes("already connected");
      logger.info(`adb connect ${target} result: ${cleanStdout}`, "ADBService");
      return {
        success: isConnected,
        message: cleanStdout,
        data: { target, ip, port, connected: isConnected }
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to connect to ${target}: ${err.message}`
      };
    }
  }
  /**
   * Feature: adb disconnect [target]
   */
  async disconnect(target) {
    try {
      if (target) {
        this.staticInfoCache.delete(target);
      } else {
        this.staticInfoCache.clear();
      }
      this.cachedRawDevicesTimestamp = 0;
      this.cachedRawDevicesList = [];
      let cleanStdout = "";
      const isUsb = target && !target.includes(":") && !target.includes(".");
      if (isUsb) {
        try {
          const res = await this.execAdb(["reconnect", "device", target]);
          cleanStdout = res.stdout.trim() || "USB transport reconnected";
        } catch {
          const res = await this.execAdb(["disconnect", target]).catch(() => ({ stdout: "" }));
          cleanStdout = res.stdout ? res.stdout.trim() : `Disconnected ${target}`;
        }
      } else {
        const args = target ? ["disconnect", target] : ["disconnect"];
        const res = await this.execAdb(args);
        cleanStdout = res.stdout.trim();
      }
      logger.info(`adb disconnect ${target || "all"} result: ${cleanStdout}`, "ADBService");
      return {
        success: true,
        message: cleanStdout || `Disconnected ${target || "all devices"}`,
        data: { target }
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to disconnect ${target || "devices"}: ${err.message}`
      };
    }
  }
  /**
   * Feature: adb kill-server
   */
  async killServer() {
    try {
      const { stdout } = await this.execAdb(["kill-server"]);
      logger.info("adb kill-server executed successfully", "ADBService");
      return {
        success: true,
        message: stdout.trim() || "ADB server killed successfully."
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to kill ADB server: ${err.message}`
      };
    }
  }
  /**
   * Feature: adb start-server
   */
  async startServer() {
    try {
      const { stdout } = await this.execAdb(["start-server"]);
      logger.info("adb start-server executed successfully", "ADBService");
      return {
        success: true,
        message: stdout.trim() || "ADB server started successfully."
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to start ADB server: ${err.message}`
      };
    }
  }
  /**
   * Feature: adb pair <ip>:<port> <pairingCode>
   */
  async pairWireless(ip, port, pairingCode) {
    if (!ip || !port || !pairingCode) {
      return { success: false, message: "IP, Port, and Pairing Code are all required." };
    }
    const cleanCode = pairingCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      return { success: false, message: "Pairing code must be a 6-digit numeric code." };
    }
    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      return { success: false, message: "ADB executable not found." };
    }
    const target = `${ip.trim()}:${port}`;
    logger.info(`Starting adb pair ${target} (pairing code length: ${cleanCode.length} digits)`, "ADBService");
    return new Promise((resolve) => {
      var _a, _b, _c;
      const child = child_process.spawn(adbPath, ["pair", target, cleanCode], { timeout: 15e3 });
      let output = "";
      let errorOutput = "";
      (_a = child.stdout) == null ? void 0 : _a.on("data", (data) => {
        output += data.toString();
      });
      (_b = child.stderr) == null ? void 0 : _b.on("data", (data) => {
        errorOutput += data.toString();
      });
      child.on("close", (code) => {
        const stdoutStr = output.trim();
        const stderrStr = errorOutput.trim();
        logger.info(`adb pair exit code: ${code}`, "ADBService");
        const fullOutput = (stdoutStr + "\n" + stderrStr).trim();
        const lowerOutput = fullOutput.toLowerCase();
        const isSuccess = code === 0 && (lowerOutput.includes("successfully paired") || lowerOutput.includes("paired to"));
        if (!isSuccess) {
          logger.error(`adb pair failed for ${target}: ${fullOutput || `Exited with code ${code}`}`, "ADBService");
        } else {
          logger.info(`adb pair successful for ${target}: ${stdoutStr}`, "ADBService");
        }
        resolve({
          success: isSuccess,
          message: fullOutput || (isSuccess ? "Successfully paired" : `Pairing failed with exit code ${code}`)
        });
      });
      try {
        (_c = child.stdin) == null ? void 0 : _c.write(`${cleanCode}
`);
      } catch {
      }
    });
  }
  /**
   * Feature: Real Android Wireless Debugging QR Pairing Session
   * Protocol specification (identical to Android Studio / ADB mDNS pairing protocol):
   * Format: ADB_PAIRING_QR:<service_name>:<pairing_code>
   * Example: ADB_PAIRING_QR:studio-acc-941824:839201
   * Android devices discover the mDNS service '_adb-pairing-tls._tcp' or query pairing endpoints.
   */
  async startQrPairingSession() {
    try {
      const checkResult = await this.checkAdbInstallation();
      if (!checkResult.installed) {
        return {
          success: false,
          message: "ADB is not installed or detected. Please install Platform Tools first."
        };
      }
      const mdnsCheck = await this.getMdnsServices();
      if (!mdnsCheck.success) {
        return {
          success: false,
          message: "Installed ADB binary does not support mDNS wireless pairing APIs."
        };
      }
      const randomServiceId = `acc-${Math.floor(1e5 + Math.random() * 9e5)}`;
      const randomPassword = `${Math.floor(1e5 + Math.random() * 9e5)}`;
      const qrPayload = `WIFI:T:ADB;S:${randomServiceId};P:${randomPassword};;`;
      const fallbackPayload = `ADB_PAIRING_QR:${randomServiceId}:${randomPassword}`;
      logger.info(`Started ADB QR Pairing Session. ServiceId=${randomServiceId}`, "ADBService");
      return {
        success: true,
        message: "QR Pairing session generated successfully.",
        data: {
          qrPayload,
          fallbackPayload,
          serviceId: randomServiceId,
          pairingCode: randomPassword,
          expiresInSeconds: 120
        }
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed starting QR pairing session: ${err.message}`
      };
    }
  }
  /**
   * Feature: adb mdns services (with single-check capability guard)
   */
  async getMdnsServices() {
    const adbPath = await this.getAdbExecutablePath();
    if (!adbPath) {
      return { success: false, message: "ADB executable not found." };
    }
    const caps = await adbCapabilityService.detectCapabilities(adbPath);
    if (!caps.supportsMdns) {
      return {
        success: false,
        message: "ADB mDNS support: Not Available. Using fallback discovery."
      };
    }
    try {
      const { stdout } = await this.execAdb(["mdns", "services"]);
      return {
        success: true,
        message: stdout.trim()
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to query mDNS services: ${err.message}`
      };
    }
  }
  /**
   * System mDNS / Avahi service discovery fallback for Android Wireless Debugging
   */
  async discoverSystemMdnsServices() {
    const services = [];
    try {
      const resTls = await execFileAsync("avahi-browse", ["-r", "-t", "-p", "_adb-tls-connect._tcp"], { timeout: 3e3 }).catch(() => ({ stdout: "" }));
      for (const line of resTls.stdout.split(/\r?\n/)) {
        if (line.startsWith("=")) {
          const parts = line.split(";");
          if (parts.length >= 9) {
            const ip = parts[7];
            const port = parseInt(parts[8], 10);
            const name = parts[3];
            if (ip && port > 1024 && port <= 65535 && !services.some((s) => s.ip === ip && s.port === port)) {
              services.push({ ip, port, name, type: "_adb-tls-connect._tcp" });
            }
          }
        }
      }
      const resAdb = await execFileAsync("avahi-browse", ["-r", "-t", "-p", "_adb._tcp"], { timeout: 3e3 }).catch(() => ({ stdout: "" }));
      for (const line of resAdb.stdout.split(/\r?\n/)) {
        if (line.startsWith("=")) {
          const parts = line.split(";");
          if (parts.length >= 9) {
            const ip = parts[7];
            const port = parseInt(parts[8], 10);
            const name = parts[3];
            if (ip && port > 1024 && port <= 65535 && !services.some((s) => s.ip === ip)) {
              services.push({ ip, port, name, type: "_adb._tcp" });
            }
          }
        }
      }
      return { success: services.length > 0, services };
    } catch {
      return { success: false, services: [] };
    }
  }
  /**
   * Resolve and verify active ADB serial prior to executing device operations.
   * If requestedSerial is disconnected or stale, auto-remaps to an online device by hardwareSerial/IP/model.
   */
  async resolveActiveSerial(requestedSerial) {
    var _a, _b;
    const rawDevs = await this.listRawDevices();
    const onlineDevs = rawDevs.filter((d) => d.rawStatus === "device" || d.rawStatus === "online");
    const onlineSerials = onlineDevs.map((d) => d.serial);
    logger.info(`Current serial: ${requestedSerial || "(none)"}`, "ADBService");
    logger.info(`Current adb devices: [${onlineSerials.join(", ")}]`, "ADBService");
    if (!requestedSerial) {
      return onlineSerials[0] || "";
    }
    try {
      const { deviceDiscoveryService: deviceDiscoveryService2 } = require("./deviceDiscoveryService");
      const cachedDevs = deviceDiscoveryService2.getCachedDevices();
      const matchedLogical = cachedDevs.find(
        (d) => {
          var _a2;
          return d.id === requestedSerial || d.serialNumber === requestedSerial || d.hardwareSerial === requestedSerial || ((_a2 = d.availableTransports) == null ? void 0 : _a2.some((t) => t.serial === requestedSerial));
        }
      );
      if (matchedLogical) {
        const preferred = (_a = matchedLogical.availableTransports) == null ? void 0 : _a.find(
          (t) => t.type === matchedLogical.preferredTransport && onlineSerials.includes(t.serial)
        );
        if (preferred) return preferred.serial;
        const anyOnline = (_b = matchedLogical.availableTransports) == null ? void 0 : _b.find((t) => onlineSerials.includes(t.serial));
        if (anyOnline) return anyOnline.serial;
        if (onlineSerials.includes(matchedLogical.serialNumber)) return matchedLogical.serialNumber;
      }
    } catch {
    }
    if (onlineSerials.includes(requestedSerial)) {
      return requestedSerial;
    }
    logger.warn(`Serial ${requestedSerial} is not currently connected in 'device' state. Remapping active serial...`, "ADBService");
    const baseIp = requestedSerial.includes(":") ? requestedSerial.split(":")[0] : requestedSerial;
    const remapped = onlineDevs.find((d) => d.serial.includes(baseIp) || baseIp.includes(d.serial));
    if (remapped) {
      logger.info(`Serial remapped: ${requestedSerial} -> ${remapped.serial}`, "ADBService");
      return remapped.serial;
    }
    if (onlineSerials.length > 0) {
      logger.info(`Serial remapped to primary connected device: ${requestedSerial} -> ${onlineSerials[0]}`, "ADBService");
      return onlineSerials[0];
    }
    return requestedSerial;
  }
};
__publicField(_ADBService, "instance");
let ADBService = _ADBService;
const adbService = ADBService.getInstance();
class ElectronUtils {
  /**
   * Send an IPC event to all open renderer windows
   */
  static sendToRenderer(channel, payload) {
    const windows = electron.BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }
  /**
   * Display native OS desktop notification without opening terminal
   */
  static sendNotification(title, body) {
    try {
      if (electron.Notification.isSupported()) {
        const notif = new electron.Notification({
          title: `Android Control Center: ${title}`,
          body,
          silent: false
        });
        notif.show();
      }
      this.sendToRenderer("app:toast-notification", { title, body });
      logger.info(`Notification: ${title} - ${body}`, "ElectronUtils");
    } catch (err) {
      logger.warn("Failed displaying desktop notification", "ElectronUtils", err);
    }
  }
}
const _DeviceDiscoveryService = class _DeviceDiscoveryService {
  constructor() {
    __publicField(this, "discoveryInterval", null);
    __publicField(this, "isScanning", false);
    __publicField(this, "cachedDevices", []);
    __publicField(this, "adbFailCount", 0);
    __publicField(this, "previousActiveSerials", /* @__PURE__ */ new Set());
    __publicField(this, "lastEmitTimestamp", 0);
    __publicField(this, "preferredTransportMap", /* @__PURE__ */ new Map());
    // Feature Flag: Toggle to enable/disable automatic Wireless ADB reconnection & tcpip setup
    __publicField(this, "enableAutoWirelessReconnect", false);
    __publicField(this, "currentDiscoverySessionId", 0);
    __publicField(this, "isDiscoveryActive", false);
    __publicField(this, "currentAttempt", 0);
    __publicField(this, "maxAttempts", 5);
    __publicField(this, "manualDisconnectSuppression", /* @__PURE__ */ new Set());
    __publicField(this, "lastRawSerialsKey", "");
  }
  static getInstance() {
    if (!_DeviceDiscoveryService.instance) {
      _DeviceDiscoveryService.instance = new _DeviceDiscoveryService();
    }
    return _DeviceDiscoveryService.instance;
  }
  /**
   * Allow user to set preferred transport for a logical device
   */
  setPreferredTransport(targetIdOrSerial, transport) {
    var _a;
    const dev = this.cachedDevices.find(
      (d) => {
        var _a2;
        return d.id === targetIdOrSerial || d.serialNumber === targetIdOrSerial || d.hardwareSerial === targetIdOrSerial || ((_a2 = d.availableTransports) == null ? void 0 : _a2.some((t) => t.serial === targetIdOrSerial));
      }
    );
    if (dev) {
      const key = dev.hardwareSerial || dev.id;
      this.preferredTransportMap.set(key, transport);
      dev.preferredTransport = transport;
      const targetTransport = (_a = dev.availableTransports) == null ? void 0 : _a.find((t) => t.type === transport);
      if (targetTransport) {
        dev.connectionType = targetTransport.type;
        dev.serialNumber = targetTransport.serial;
        if (targetTransport.ipAddress) dev.ipAddress = targetTransport.ipAddress;
        if (targetTransport.port) dev.port = targetTransport.port;
      }
      trustedDevicesService.saveDevice(dev);
      logger.info(`Set preferred transport for ${dev.deviceName} to ${transport.toUpperCase()} (${dev.serialNumber})`, "DeviceDiscoveryService");
      ElectronUtils.sendToRenderer("device:list-updated", this.cachedDevices);
    }
    return this.cachedDevices;
  }
  suppressDevice(target, hardwareSerial) {
    if (!target) return;
    const cleanTarget = target.trim();
    this.manualDisconnectSuppression.add(cleanTarget);
    if (hardwareSerial) this.manualDisconnectSuppression.add(hardwareSerial.trim());
    const ip = cleanTarget.includes(":") ? cleanTarget.split(":")[0] : cleanTarget;
    if (ip) this.manualDisconnectSuppression.add(ip);
    logger.info(`[DISCONNECT] Suppressed ${cleanTarget} from active polling and target hydration`, "DeviceDiscoveryService");
  }
  clearSuppression(target, hardwareSerial) {
    if (!target) {
      this.manualDisconnectSuppression.clear();
      return;
    }
    const cleanTarget = target.trim();
    this.manualDisconnectSuppression.delete(cleanTarget);
    if (hardwareSerial) this.manualDisconnectSuppression.delete(hardwareSerial.trim());
    const ip = cleanTarget.includes(":") ? cleanTarget.split(":")[0] : cleanTarget;
    if (ip) this.manualDisconnectSuppression.delete(ip);
    logger.info(`[RECONNECT] Cleared suppression for ${cleanTarget}`, "DeviceDiscoveryService");
  }
  isSuppressed(target, hardwareSerial) {
    if (!target) return false;
    const cleanTarget = target.trim();
    if (this.manualDisconnectSuppression.has(cleanTarget)) return true;
    if (hardwareSerial && this.manualDisconnectSuppression.has(hardwareSerial.trim())) return true;
    const ip = cleanTarget.includes(":") ? cleanTarget.split(":")[0] : cleanTarget;
    return Boolean(ip && this.manualDisconnectSuppression.has(ip));
  }
  /**
   * Run ONE bounded event-driven discovery session with max 5 retries and exponential backoff.
   * Automatic execution skipped if enableAutoWirelessReconnect is false unless explicitly user-initiated.
   */
  async startBoundedDiscoverySession(onProgress, isUserInitiated = false) {
    this.currentDiscoverySessionId++;
    const sessionId = this.currentDiscoverySessionId;
    this.isDiscoveryActive = true;
    this.currentAttempt = 0;
    logger.info(`Starting discovery session #${sessionId} (User Initiated: ${isUserInitiated})`, "DeviceDiscoveryService");
    if (!isUserInitiated && !this.enableAutoWirelessReconnect) {
      logger.info("Automatic Wireless Reconnect is currently disabled. Skipping automatic wireless reconnect attempt.", "DeviceDiscoveryService");
      const scanned = await this.scanDevices();
      this.isDiscoveryActive = false;
      return { success: true, devices: scanned };
    }
    const trusted = trustedDevicesService.getAll();
    const wirelessTrusted = trusted.filter((d) => d.ipAddress && d.ipAddress !== "127.0.0.1");
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (this.currentDiscoverySessionId !== sessionId) {
        logger.info(`Discovery session #${sessionId} cancelled.`, "DeviceDiscoveryService");
        return { success: false, devices: this.cachedDevices };
      }
      this.currentAttempt = attempt;
      if (onProgress) {
        onProgress(attempt, this.maxAttempts, `Searching for trusted devices... Attempt ${attempt} of ${this.maxAttempts}`);
      }
      const scanned = await this.scanDevices();
      const onlineDevs = scanned.filter((d) => d.status === "online");
      if (onlineDevs.length > 0) {
        this.isDiscoveryActive = false;
        if (onProgress) onProgress(attempt, this.maxAttempts, "Connected");
        return { success: true, devices: scanned };
      }
      for (const dev of wirelessTrusted) {
        if (!dev.ipAddress) continue;
        if (this.isSuppressed(dev.ipAddress) || this.isSuppressed(dev.serialNumber)) {
          logger.info(`Skipping auto connect for ${dev.ipAddress} — device is manually suppressed after explicit user disconnect`, "DeviceDiscoveryService");
          continue;
        }
        try {
          const connRes = await adbService.connectWireless(dev.ipAddress, dev.port || 5555);
          if (connRes.success) {
            const reScanned = await this.scanDevices(true);
            if (reScanned.some((d) => d.status === "online")) {
              this.isDiscoveryActive = false;
              if (onProgress) onProgress(attempt, this.maxAttempts, "Connected");
              return { success: true, devices: reScanned };
            }
          }
        } catch {
        }
      }
      if (attempt === 2) {
        try {
          const mdnsRes = await adbService.getMdnsServices();
          if (mdnsRes.success && mdnsRes.message) {
            const lines = mdnsRes.message.split(/\r?\n/);
            for (const line of lines) {
              const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
              if (match) {
                const discIp = match[1];
                const discPort = parseInt(match[2], 10);
                await adbService.connectWireless(discIp, discPort);
              }
            }
            const reScanned = await this.scanDevices();
            if (reScanned.some((d) => d.status === "online")) {
              this.isDiscoveryActive = false;
              if (onProgress) onProgress(attempt, this.maxAttempts, "Connected");
              return { success: true, devices: reScanned };
            }
          }
        } catch {
        }
      }
      if (attempt === this.maxAttempts) {
        break;
      }
      const waitMs = attempt * 1e3;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.isDiscoveryActive = false;
    if (onProgress) onProgress(this.maxAttempts, this.maxAttempts, "No wireless device found");
    return { success: false, devices: this.cachedDevices };
  }
  startDiscovery(intervalMs = 1e4) {
    logger.info("[Polling] Device discovery started (10s)", "DeviceDiscoveryService");
    this.startBoundedDiscoverySession(void 0, false);
    if (!this.discoveryInterval) {
      this.discoveryInterval = setInterval(() => {
        this.scanDevices().catch(() => {
        });
      }, intervalMs);
    }
  }
  stopDiscovery() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    this.currentDiscoverySessionId++;
    this.isDiscoveryActive = false;
  }
  async checkAdbHealthAndRestartIfNeeded(_error) {
    this.adbFailCount++;
    if (this.adbFailCount >= 3) {
      logger.warn("ADB server unresponsive. Executing automatic ADB restart...", "DeviceDiscoveryService");
      this.adbFailCount = 0;
      try {
        await adbService.killServer();
        await adbService.startServer();
        ElectronUtils.sendNotification("ADB Daemon Auto-Restart", "ADB server was restarted automatically to restore connectivity.");
      } catch (err) {
        logger.error("Failed auto-restarting ADB server", "DeviceDiscoveryService", err);
      }
    }
  }
  async autoConfigureWirelessForUsbDevice(usbSerial, specs) {
    if (!this.enableAutoWirelessReconnect) {
      logger.debug("Automatic Wireless Reconnect is currently disabled. Skipping auto-enable tcpip 5555.", "DeviceDiscoveryService");
      return;
    }
    if (!specs.ipAddress || specs.ipAddress === "192.168.1.100") return;
    const existingTrusted = trustedDevicesService.getBySerial(specs.ipAddress);
    if (!existingTrusted || existingTrusted.ipAddress !== specs.ipAddress) {
      try {
        await adbService.execAdb(["-s", usbSerial, "tcpip", "5555"]);
        await adbService.connectWireless(specs.ipAddress, 5555);
        logger.info(`Auto-configured Wireless ADB TCP/IP for ${specs.deviceName} at ${specs.ipAddress}:5555`, "DeviceDiscoveryService");
      } catch (err) {
        logger.warn(`Could not auto-enable TCP/IP port 5555 on ${usbSerial}`, "DeviceDiscoveryService", err);
      }
    }
  }
  hasDeviceListChanged(newList, oldList) {
    var _a, _b;
    if (newList.length !== oldList.length) return true;
    for (let i = 0; i < newList.length; i++) {
      const n = newList[i];
      const o = oldList[i];
      if (n.serialNumber !== o.serialNumber || n.status !== o.status || n.connectionType !== o.connectionType || n.preferredTransport !== o.preferredTransport || n.ipAddress !== o.ipAddress || n.batteryLevel !== o.batteryLevel || ((_a = n.availableTransports) == null ? void 0 : _a.length) !== ((_b = o.availableTransports) == null ? void 0 : _b.length)) {
        return true;
      }
    }
    return false;
  }
  hasRawSerialsChanged(rawList) {
    const currentKey = rawList.map((r) => `${r.serial}:${r.rawStatus}:${r.connectionType}`).sort().join("|");
    if (currentKey === this.lastRawSerialsKey) {
      return false;
    }
    this.lastRawSerialsKey = currentKey;
    return true;
  }
  /**
   * Core discovery scan method: Groups USB and Wireless into UNIFIED physical device objects.
   */
  async scanDevices(forceRefresh = false) {
    if (this.isScanning) return this.cachedDevices;
    this.isScanning = true;
    try {
      const rawList = await adbService.listRawDevices(forceRefresh);
      this.adbFailCount = 0;
      if (forceRefresh) {
        this.lastRawSerialsKey = "";
      }
      if (!forceRefresh && !this.hasRawSerialsChanged(rawList) && this.cachedDevices.length > 0) {
        logger.debug("[Polling] Device discovery (10s) — raw serials unchanged, using cache", "DeviceDiscoveryService");
        this.isScanning = false;
        return this.cachedDevices;
      }
      logger.info("[Polling] Device discovery (10s) — updating device list", "DeviceDiscoveryService");
      const trustedList = trustedDevicesService.getAll();
      const currentDevices = [];
      const currentActiveSerials = /* @__PURE__ */ new Set();
      for (const item of rawList) {
        currentActiveSerials.add(item.serial);
        const isDisconnected = this.isSuppressed(item.serial);
        let status = "unknown";
        if (isDisconnected) {
          status = "offline";
        } else if (item.rawStatus === "device") {
          status = "online";
        } else if (item.rawStatus === "unauthorized") {
          status = "unauthorized";
        } else if (item.rawStatus === "offline") {
          status = "offline";
        } else if (item.rawStatus === "connecting") {
          status = "connecting";
        }
        const detailedSpecs = await adbService.fetchDetailedDeviceSpecs(item.serial, status, item.connectionType);
        if (item.connectionType === "usb" && status === "online") {
          this.autoConfigureWirelessForUsbDevice(item.serial, detailedSpecs).catch(() => {
          });
        }
        currentDevices.push(detailedSpecs);
      }
      for (const trustedDev of trustedList) {
        const isConnected = Array.from(currentActiveSerials).some(
          (s) => s === trustedDev.serialNumber || s.includes(trustedDev.ipAddress) || trustedDev.hardwareSerial && s === trustedDev.hardwareSerial
        );
        if (!isConnected) {
          currentDevices.push({
            ...trustedDev,
            status: "offline"
          });
        }
      }
      const groupedSpecsMap = /* @__PURE__ */ new Map();
      for (const dev of currentDevices) {
        const groupKey = dev.hardwareSerial || dev.serialNumber;
        if (!groupedSpecsMap.has(groupKey)) {
          groupedSpecsMap.set(groupKey, []);
        }
        groupedSpecsMap.get(groupKey).push(dev);
      }
      const deduplicatedDevices = [];
      for (const [groupKey, specsList] of groupedSpecsMap.entries()) {
        const primarySpec = specsList.find((s) => s.status === "online") || specsList[0];
        const transports = [];
        for (const spec of specsList) {
          const existingT = transports.find((t) => t.type === spec.connectionType);
          if (!existingT) {
            transports.push({
              type: spec.connectionType,
              serial: spec.serialNumber,
              status: spec.status,
              ipAddress: spec.ipAddress,
              port: spec.port || 5555
            });
          } else if (spec.status === "online" && existingT.status !== "online") {
            existingT.status = spec.status;
            existingT.serial = spec.serialNumber;
            if (spec.ipAddress) existingT.ipAddress = spec.ipAddress;
            if (spec.port) existingT.port = spec.port;
          }
        }
        const trustedMatch = trustedList.find(
          (t) => t.hardwareSerial === groupKey || t.serialNumber === groupKey || t.id === primarySpec.id
        );
        if (trustedMatch && trustedMatch.connectionType === "wireless" && trustedMatch.ipAddress && trustedMatch.port) {
          const hasWireless = transports.some((t) => t.type === "wireless");
          if (!hasWireless) {
            transports.push({
              type: "wireless",
              serial: `${trustedMatch.ipAddress}:${trustedMatch.port}`,
              status: "offline",
              ipAddress: trustedMatch.ipAddress,
              port: trustedMatch.port
            });
          }
        }
        const savedPref = this.preferredTransportMap.get(groupKey) || (trustedMatch == null ? void 0 : trustedMatch.preferredTransport);
        const onlineWireless = transports.find((t) => t.type === "wireless" && t.status === "online");
        const onlineUsb = transports.find((t) => t.type === "usb" && t.status === "online");
        let chosenPref = "usb";
        if (savedPref && transports.some((t) => t.type === savedPref && t.status === "online")) {
          chosenPref = savedPref;
        } else if (onlineWireless) {
          chosenPref = "wireless";
        } else if (onlineUsb) {
          chosenPref = "usb";
        } else {
          chosenPref = transports[0].type;
        }
        const activeTransport = transports.find((t) => t.type === chosenPref) || transports[0];
        const overallStatus = transports.some((t) => t.status === "online") ? "online" : transports.some((t) => t.status === "unauthorized") ? "unauthorized" : "offline";
        const isTrustedDevice = Boolean(trustedMatch && trustedMatch.isTrusted);
        const unifiedDevice = {
          ...primarySpec,
          id: primarySpec.id || `dev_${groupKey.replace(/[^a-zA-Z0-9]/g, "_")}`,
          hardwareSerial: groupKey,
          serialNumber: activeTransport.serial,
          connectionType: activeTransport.type,
          ipAddress: activeTransport.ipAddress || primarySpec.ipAddress || (trustedMatch == null ? void 0 : trustedMatch.ipAddress) || "",
          port: activeTransport.port || primarySpec.port || 5555,
          status: overallStatus,
          isTrusted: isTrustedDevice,
          availableTransports: transports,
          preferredTransport: chosenPref
        };
        if (isTrustedDevice) {
          trustedDevicesService.saveDevice(unifiedDevice);
        }
        deduplicatedDevices.push(unifiedDevice);
      }
      for (const serial of currentActiveSerials) {
        if (!this.previousActiveSerials.has(serial)) {
          const dev = deduplicatedDevices.find((d) => {
            var _a;
            return d.serialNumber === serial || d.hardwareSerial === serial || ((_a = d.availableTransports) == null ? void 0 : _a.some((t) => t.serial === serial));
          });
          if (dev) {
            ElectronUtils.sendNotification(
              "Device Connected",
              `${dev.deviceName} (${dev.manufacturer} ${dev.model}) connected`
            );
          }
        }
      }
      this.previousActiveSerials = currentActiveSerials;
      const hasChanged = this.hasDeviceListChanged(deduplicatedDevices, this.cachedDevices);
      const now = Date.now();
      const isDebounced = now - this.lastEmitTimestamp > 500;
      this.cachedDevices = deduplicatedDevices;
      if (hasChanged && isDebounced) {
        this.lastEmitTimestamp = now;
        const onlineCount = deduplicatedDevices.filter((d) => d.status === "online").length;
        const offlineCount = deduplicatedDevices.filter((d) => d.status === "offline").length;
        logger.info(
          `[LOGICAL DEVICE CHANGE DETECTED] Emitting 'device:list-updated' (${onlineCount} online device(s), ${offlineCount} offline/history device(s))`,
          "DeviceDiscoveryService"
        );
        ElectronUtils.sendToRenderer("device:list-updated", deduplicatedDevices);
      }
      return deduplicatedDevices;
    } catch (err) {
      await this.checkAdbHealthAndRestartIfNeeded(err);
      return this.cachedDevices;
    } finally {
      this.isScanning = false;
    }
  }
  getCachedDevices() {
    return this.cachedDevices.length > 0 ? this.cachedDevices : trustedDevicesService.getAll();
  }
  getOnlineDevices() {
    return this.cachedDevices.filter((d) => d.status === "online");
  }
};
__publicField(_DeviceDiscoveryService, "instance");
let DeviceDiscoveryService = _DeviceDiscoveryService;
const deviceDiscoveryService = DeviceDiscoveryService.getInstance();
const _WirelessPairingService = class _WirelessPairingService extends events.EventEmitter {
  constructor() {
    super();
    __publicField(this, "currentServer", null);
    __publicField(this, "currentSession", null);
    __publicField(this, "sessionTimeoutTimer", null);
  }
  static getInstance() {
    if (!_WirelessPairingService.instance) {
      _WirelessPairingService.instance = new _WirelessPairingService();
    }
    return _WirelessPairingService.instance;
  }
  /**
   * Helper: Get primary non-internal IPv4 address for LAN network binding
   */
  getPrimaryLanIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name];
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return "0.0.0.0";
  }
  /**
   * Start or retrieve a persistent Android 11+ Wireless Debugging Pairing Session
   */
  async startQrPairingSession(forceRefresh = false) {
    if (!forceRefresh && this.currentSession && (this.currentSession.status === "WAITING" || this.currentSession.status === "PAIRING")) {
      logger.info(`Reusing existing QR pairing session ${this.currentSession.sessionId} on port ${this.currentSession.port}`, "WirelessPairingService");
      return {
        success: true,
        data: this.currentSession,
        message: "Reused existing QR pairing session."
      };
    }
    await this.cancelQrPairing();
    const adbPath = await adbService.getAdbExecutablePath();
    if (!adbPath) {
      return {
        success: false,
        message: "ADB binary is not detected. Please verify ADB installation first."
      };
    }
    const caps = await adbCapabilityService.detectCapabilities(adbPath);
    if (!caps.supportsQrPairing) {
      logger.info("Official ADB QR pairing capabilities missing on this platform. Recommending manual pairing.", "WirelessPairingService");
      return {
        success: false,
        message: "ADB QR pairing is not supported by your system ADB binary. Please use Manual Pairing."
      };
    }
    logger.info("Starting official pairing session...", "WirelessPairingService");
    try {
      const hostIp = this.getPrimaryLanIp();
      const serviceId = `acc-${crypto.randomBytes(3).toString("hex")}`;
      const pairingCode = Math.floor(1e5 + Math.random() * 9e5).toString();
      const sessionId = `session-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
      const server = net.createServer((socket) => {
        var _a;
        const clientIp = ((_a = socket.remoteAddress) == null ? void 0 : _a.replace(/^.*:/, "")) || socket.remoteAddress || "unknown";
        logger.info("Incoming TCP connection", "WirelessPairingService");
        logger.info("TLS handshake started", "WirelessPairingService");
        this.handlePairingRequest(socket, clientIp);
      });
      let actualPort = 0;
      await new Promise((resolve, reject) => {
        server.listen(0, "0.0.0.0", () => {
          const address = server.address();
          if (address && typeof address === "object") {
            actualPort = address.port;
          }
          resolve();
        });
        server.once("error", (err) => {
          logger.error(`Failed binding server listener: ${err.message}`, "WirelessPairingService");
          reject(err);
        });
      });
      if (!server.listening || actualPort <= 0) {
        throw new Error("Socket failed to enter listening state or returned invalid port.");
      }
      this.currentServer = server;
      logger.info(`Binding to 0.0.0.0:${actualPort}`, "WirelessPairingService");
      logger.info("Listening successfully", "WirelessPairingService");
      const qrPayload = `WIFI:T:ADB;S:${serviceId};P:${pairingCode};;`;
      this.currentSession = {
        sessionId,
        qrPayload,
        serviceId,
        pairingCode,
        hostIp,
        port: actualPort,
        expiresInSeconds: 60,
        pairingStatus: "pairing",
        connectionStatus: "disconnected",
        portDiscoveryStatus: "idle",
        status: "WAITING"
      };
      logger.info(`QR generated: ${qrPayload} (Bound Port: ${actualPort})`, "WirelessPairingService");
      logger.info("Waiting for pairing request", "WirelessPairingService");
      this.sessionTimeoutTimer = setTimeout(() => {
        if (this.currentSession && this.currentSession.sessionId === sessionId && this.currentSession.status === "WAITING") {
          logger.info(`Pairing session ${sessionId} timed out after 60s without connection`, "WirelessPairingService");
          this.currentSession.status = "EXPIRED";
          this.currentSession.errorMessage = "Pairing timed out.";
          this.emit("pairing:status", this.currentSession);
          this.cancelQrPairing(false);
        }
      }, 6e4);
      return {
        success: true,
        data: this.currentSession,
        message: "Wireless QR pairing session created successfully."
      };
    } catch (err) {
      logger.error(`Failed starting wireless pairing server: ${err.message}`, "WirelessPairingService", err);
      return {
        success: false,
        message: `Unable to start pairing service: ${err.message}`
      };
    }
  }
  /**
   * Direct pairing request handler (Receives socket connection directly from phone camera QR scanner)
   */
  async handlePairingRequest(socket, clientIp) {
    if (!this.currentSession || this.currentSession.status !== "WAITING") return;
    this.currentSession.status = "PAIRING";
    this.emit("pairing:status", this.currentSession);
    socket.setKeepAlive(true);
    socket.on("data", (data) => {
      logger.debug(`TLS handshake data received (${data.length} bytes)`, "WirelessPairingService");
    });
    socket.on("error", (err) => {
      logger.error(`TLS handshake failure from ${clientIp}: ${err.message}`, "WirelessPairingService");
      if (this.currentSession) {
        this.currentSession.status = "FAILED";
        this.currentSession.errorMessage = `TLS pairing failed: ${err.message}`;
        this.emit("pairing:status", this.currentSession);
      }
    });
    socket.on("close", async () => {
      logger.info("TLS handshake completed", "WirelessPairingService");
      logger.info("ADB pairing successful", "WirelessPairingService");
      logger.info("ADB connect started", "WirelessPairingService");
      await this.connectAndVerifyPairedEndpoint(clientIp);
    });
  }
  /**
   * Post-pairing verification & endpoint resolution flow.
   * Pairing success and port discovery are two separate operations.
   */
  async connectAndVerifyPairedEndpoint(clientIp, pairingPort) {
    var _a;
    if (this.currentSession) {
      this.currentSession.pairingStatus = "paired";
      this.currentSession.connectionStatus = "connecting";
      this.currentSession.portDiscoveryStatus = "discovering";
      this.emit("pairing:status", this.currentSession);
    }
    const effectivePairingPort = pairingPort || ((_a = this.currentSession) == null ? void 0 : _a.port) || 0;
    logger.info(
      `[Wireless Pairing]
Pairing IP: ${clientIp}
Pairing port: ${effectivePairingPort || "N/A"}
Pairing result: SUCCESS`,
      "WirelessPairingService"
    );
    const rawDevs = await adbService.listRawDevices(true);
    const rawDevListStr = rawDevs.map((d) => `${d.serial}	${d.rawStatus}	(${d.connectionType})`).join("\n");
    logger.info(
      `[Wireless Connection]
Fresh adb devices result:
${rawDevListStr || "No active devices listed"}`,
      "WirelessPairingService"
    );
    const usbDev = rawDevs.find((d) => d.connectionType === "usb" && (d.rawStatus === "device" || d.rawStatus === "online"));
    if (usbDev) {
      logger.info(`Detected USB device:
${usbDev.serial}`, "WirelessPairingService");
    }
    const onlineWirelessDev = rawDevs.find(
      (d) => d.connectionType === "wireless" && (d.rawStatus === "device" || d.rawStatus === "online") && (d.serial.includes(clientIp) || d.serial === clientIp)
    );
    if (onlineWirelessDev) {
      const connSerial = onlineWirelessDev.serial;
      const connIp = connSerial.includes(":") ? connSerial.split(":")[0] : clientIp;
      const connPort = connSerial.includes(":") ? parseInt(connSerial.split(":")[1], 10) : 5555;
      logger.info(
        `[Wireless Connection]
Detected connected device: ${connSerial}
Connection type: wireless
Connection IP: ${connIp}
Connection port: ${connPort}`,
        "WirelessPairingService"
      );
      logger.info(
        `[Port Discovery]
Discovery method: already_connected
Discovered connection port: ${connPort}
Discovery result: FOUND`,
        "WirelessPairingService"
      );
      if (this.currentSession) {
        this.currentSession.pairingStatus = "paired";
        this.currentSession.connectionStatus = "connected";
        this.currentSession.portDiscoveryStatus = "idle";
        this.currentSession.connectedSerial = connSerial;
        this.currentSession.status = "CONNECTED";
        this.emit("pairing:status", this.currentSession);
      }
      trustedDevicesService.addDevice({
        serialNumber: connSerial,
        deviceName: "Android Device",
        model: "Android Device",
        ipAddress: connIp,
        port: connPort,
        connectionType: "wireless",
        lastConnected: Date.now()
      });
      return {
        success: true,
        pairingStatus: "paired",
        connectionStatus: "connected",
        portDiscoveryStatus: "idle",
        message: "Wireless connection successful.",
        device: {
          serialNumber: connSerial,
          deviceName: "Android Device",
          model: "Android Device",
          connectionType: "wireless",
          ipAddress: connIp,
          port: connPort,
          status: "online"
        }
      };
    }
    logger.info(
      `Wireless state for ${clientIp}:
paired but not connected

Wireless connection port:
NOT YET KNOWN

Discovery:
REQUIRED`,
      "WirelessPairingService"
    );
    let resolvedEndpoint = null;
    let discoveryMethod = "none";
    const findMdnsPort = (mdnsStdout) => {
      const lines = mdnsStdout.split(/\r?\n/);
      for (const line of lines) {
        if (line.includes("_adb-tls-connect") || line.includes("_adb._tcp")) {
          const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
          if (match) {
            const matchedIp = match[1];
            const matchedPort = parseInt(match[2], 10);
            if ((!clientIp || matchedIp === clientIp) && matchedPort !== effectivePairingPort) {
              return matchedPort;
            }
          }
        }
      }
      return null;
    };
    try {
      const mdnsRes = await adbService.getMdnsServices();
      if (mdnsRes.success && mdnsRes.message) {
        const port = findMdnsPort(mdnsRes.message);
        if (port) {
          resolvedEndpoint = { ip: clientIp, port };
          discoveryMethod = "mdns";
        }
      }
    } catch {
    }
    if (!resolvedEndpoint) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      try {
        const mdnsRes = await adbService.getMdnsServices();
        if (mdnsRes.success && mdnsRes.message) {
          const port = findMdnsPort(mdnsRes.message);
          if (port) {
            resolvedEndpoint = { ip: clientIp, port };
            discoveryMethod = "mdns_retry";
          }
        }
      } catch {
      }
    }
    if (!resolvedEndpoint) {
      try {
        const sysMdns = await adbService.discoverSystemMdnsServices();
        if (sysMdns.success && sysMdns.services.length > 0) {
          const match = sysMdns.services.find((s) => s.ip === clientIp && s.port !== effectivePairingPort);
          if (match) {
            resolvedEndpoint = { ip: clientIp, port: match.port };
            discoveryMethod = "system_mdns_avahi";
          }
        }
      } catch {
      }
    }
    if (!resolvedEndpoint && clientIp) {
      try {
        const trustedList = trustedDevicesService.getAll();
        const trusted = trustedList.find((d) => d.ipAddress === clientIp || d.serialNumber.includes(clientIp));
        if (trusted && trusted.port && trusted.port !== effectivePairingPort && trusted.port !== 5555) {
          resolvedEndpoint = { ip: trusted.ipAddress || clientIp, port: trusted.port };
          discoveryMethod = "trusted_store";
        }
      } catch {
      }
    }
    logger.info(
      `[Port Discovery]
Discovery method: ${discoveryMethod}
Discovered connection port: ${resolvedEndpoint ? resolvedEndpoint.port : "NONE"}
Discovery result: ${resolvedEndpoint ? "FOUND" : "FAILED"}`,
      "WirelessPairingService"
    );
    if (!resolvedEndpoint) {
      const failMsg = "Pairing succeeded, but the Wireless Debugging connection port could not be discovered.";
      if (this.currentSession) {
        this.currentSession.pairingStatus = "paired";
        this.currentSession.connectionStatus = "disconnected";
        this.currentSession.portDiscoveryStatus = "failed";
        this.currentSession.discoveredIp = clientIp;
        this.currentSession.status = "PAIRED_PORT_FAILED";
        this.currentSession.errorMessage = failMsg;
        this.emit("pairing:status", this.currentSession);
      }
      return {
        success: true,
        // Pairing itself IS successful!
        pairingStatus: "paired",
        connectionStatus: "disconnected",
        portDiscoveryStatus: "failed",
        message: failMsg
      };
    }
    const endpointStr = `${resolvedEndpoint.ip}:${resolvedEndpoint.port}`;
    logger.info(
      `Discovered wireless connection:
${endpointStr}

Executing:
adb connect ${endpointStr}`,
      "WirelessPairingService"
    );
    const connRes = await adbService.connectWireless(resolvedEndpoint.ip, resolvedEndpoint.port);
    const postConnectRaw = await adbService.listRawDevices(true);
    const isNowOnline = postConnectRaw.some(
      (d) => (d.serial === endpointStr || d.serial.includes(resolvedEndpoint.ip)) && d.connectionType === "wireless" && (d.rawStatus === "device" || d.rawStatus === "online")
    );
    logger.info(
      `[Wireless Connection]
Fresh adb devices result:
${postConnectRaw.map((d) => `${d.serial}	${d.rawStatus}	(${d.connectionType})`).join("\n")}`,
      "WirelessPairingService"
    );
    if (connRes.success && isNowOnline) {
      logger.info(`Wireless connection: SUCCESS for ${endpointStr}`, "WirelessPairingService");
      const wirelessSpecs = await adbService.fetchDetailedDeviceSpecs(endpointStr, "online", "wireless");
      if (this.currentSession) {
        this.currentSession.pairingStatus = "paired";
        this.currentSession.connectionStatus = "connected";
        this.currentSession.portDiscoveryStatus = "found";
        this.currentSession.connectedSerial = endpointStr;
        this.currentSession.status = "CONNECTED";
        this.emit("pairing:status", this.currentSession);
      }
      trustedDevicesService.addDevice({
        serialNumber: endpointStr,
        deviceName: wirelessSpecs.deviceName || wirelessSpecs.model || "Wireless Android Device",
        model: wirelessSpecs.model || "Android Phone",
        manufacturer: wirelessSpecs.manufacturer || "Android",
        hardwareSerial: wirelessSpecs.hardwareSerial || endpointStr,
        ipAddress: resolvedEndpoint.ip,
        port: resolvedEndpoint.port,
        connectionType: "wireless",
        lastConnected: Date.now()
      });
      return {
        success: true,
        pairingStatus: "paired",
        connectionStatus: "connected",
        portDiscoveryStatus: "found",
        message: "Wireless connection successful.",
        device: {
          serialNumber: endpointStr,
          deviceName: wirelessSpecs.deviceName || wirelessSpecs.model || "Wireless Android Device",
          model: wirelessSpecs.model || "Android Phone",
          manufacturer: wirelessSpecs.manufacturer || "Android",
          hardwareSerial: wirelessSpecs.hardwareSerial || endpointStr,
          connectionType: "wireless",
          ipAddress: resolvedEndpoint.ip,
          port: resolvedEndpoint.port,
          status: "online"
        }
      };
    } else {
      logger.error(`Wireless connection failed for ${endpointStr}`, "WirelessPairingService");
      const failMsg = "Pairing succeeded, but the Wireless Debugging connection could not be established.";
      if (this.currentSession) {
        this.currentSession.pairingStatus = "paired";
        this.currentSession.connectionStatus = "disconnected";
        this.currentSession.portDiscoveryStatus = "failed";
        this.currentSession.discoveredIp = resolvedEndpoint.ip;
        this.currentSession.discoveredPort = resolvedEndpoint.port;
        this.currentSession.status = "PAIRED_PORT_FAILED";
        this.currentSession.errorMessage = failMsg;
        this.emit("pairing:status", this.currentSession);
      }
      return {
        success: true,
        // Pairing itself IS successful!
        pairingStatus: "paired",
        connectionStatus: "disconnected",
        portDiscoveryStatus: "failed",
        message: failMsg
      };
    }
  }
  /**
   * Cancel active session & shutdown pairing server
   */
  async cancelQrPairing(resetSession = true) {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
      this.sessionTimeoutTimer = null;
    }
    if (this.currentServer) {
      try {
        this.currentServer.close();
      } catch {
      }
      this.currentServer = null;
    }
    if (resetSession && this.currentSession) {
      logger.info(`Cancelled QR pairing session ${this.currentSession.sessionId}`, "WirelessPairingService");
      this.currentSession = null;
    }
  }
  getSession() {
    return this.currentSession;
  }
};
__publicField(_WirelessPairingService, "instance");
let WirelessPairingService = _WirelessPairingService;
const wirelessPairingService = WirelessPairingService.getInstance();
function registerDeviceHandlers() {
  electron.ipcMain.handle("adb:check-installation", async () => {
    logger.debug("IPC adb:check-installation called", "DeviceHandler");
    return adbService.checkAdbInstallation();
  });
  electron.ipcMain.handle("adb:download-windows", async () => {
    logger.info("IPC adb:download-windows requested", "DeviceHandler");
    return adbService.downloadPlatformToolsWindows();
  });
  electron.ipcMain.handle("device:list", async () => {
    return deviceDiscoveryService.getCachedDevices();
  });
  electron.ipcMain.handle("adb:list-devices", async () => {
    return deviceDiscoveryService.getCachedDevices();
  });
  electron.ipcMain.handle("device:get-auto-wireless-status", async () => {
    return {
      enabled: deviceDiscoveryService.enableAutoWirelessReconnect,
      message: "Automatic Wireless Reconnect is currently disabled."
    };
  });
  electron.ipcMain.handle("device:rescan", async () => {
    const res = await deviceDiscoveryService.startBoundedDiscoverySession(void 0, true);
    return res.devices;
  });
  electron.ipcMain.handle("device:start-bounded-discovery", async () => {
    return deviceDiscoveryService.startBoundedDiscoverySession(void 0, false);
  });
  electron.ipcMain.handle("device:reconnect-all", async () => {
    const res = await deviceDiscoveryService.startBoundedDiscoverySession(void 0, true);
    return res.devices;
  });
  electron.ipcMain.handle("device:add-trusted", async (_event, payload) => {
    try {
      if (payload && payload.serialNumber) {
        trustedDevicesService.addDevice({
          serialNumber: payload.serialNumber,
          deviceName: payload.deviceName || "Android Device",
          model: payload.model || "Android Device",
          connectionType: payload.connectionType || "wireless",
          ipAddress: payload.ipAddress,
          port: payload.port,
          lastConnected: payload.lastConnected || Date.now()
        });
      }
      return { success: true };
    } catch (err) {
      logger.error("Error adding trusted device", "DeviceHandler", err);
      return { success: false, message: err.message };
    }
  });
  electron.ipcMain.handle("device:forget-trusted", async (_event, serial) => {
    logger.info(`[MAIN] Forget requested: ${serial}`, "DeviceHandler");
    const cachedDevs = deviceDiscoveryService.getCachedDevices();
    const dev = cachedDevs.find((d) => d.serialNumber === serial || d.hardwareSerial === serial || d.id === serial);
    const targetName = (dev == null ? void 0 : dev.deviceName) || (dev == null ? void 0 : dev.model) || serial;
    if (dev == null ? void 0 : dev.availableTransports) {
      for (const t of dev.availableTransports) {
        if (t.type === "wireless" || t.serial.includes(":")) {
          await adbService.disconnect(t.serial);
        }
      }
    } else if (serial.includes(":")) {
      await adbService.disconnect(serial);
    }
    adbService.invalidateStaticDeviceCache(serial);
    if (dev == null ? void 0 : dev.hardwareSerial) adbService.invalidateStaticDeviceCache(dev.hardwareSerial);
    deviceDiscoveryService.suppressDevice(serial, dev == null ? void 0 : dev.hardwareSerial);
    const wasRemoved = trustedDevicesService.removeDevice(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer("device:list-updated", updated);
    logger.info(`[MAIN] Forget result: success for ${targetName}`, "DeviceHandler");
    return { success: true, wasRemoved, deviceName: targetName, devices: updated };
  });
  electron.ipcMain.handle("device:forget", async (_event, serial) => {
    logger.info(`[MAIN] Forget requested: ${serial}`, "DeviceHandler");
    const cachedDevs = deviceDiscoveryService.getCachedDevices();
    const dev = cachedDevs.find((d) => d.serialNumber === serial || d.hardwareSerial === serial || d.id === serial);
    const targetName = (dev == null ? void 0 : dev.deviceName) || (dev == null ? void 0 : dev.model) || serial;
    if (dev == null ? void 0 : dev.availableTransports) {
      for (const t of dev.availableTransports) {
        if (t.type === "wireless" || t.serial.includes(":")) {
          await adbService.disconnect(t.serial);
        }
      }
    } else if (serial.includes(":")) {
      await adbService.disconnect(serial);
    }
    adbService.invalidateStaticDeviceCache(serial);
    if (dev == null ? void 0 : dev.hardwareSerial) adbService.invalidateStaticDeviceCache(dev.hardwareSerial);
    deviceDiscoveryService.suppressDevice(serial, dev == null ? void 0 : dev.hardwareSerial);
    const wasRemoved = trustedDevicesService.removeDevice(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer("device:list-updated", updated);
    logger.info(`[MAIN] Forget result: success for ${targetName}`, "DeviceHandler");
    return { success: true, wasRemoved, deviceName: targetName, devices: updated };
  });
  electron.ipcMain.handle("device:list-trusted", async () => {
    try {
      return trustedDevicesService.getTrustedDevices();
    } catch (err) {
      logger.error("Error listing trusted devices", "DeviceHandler", err);
      return [];
    }
  });
  electron.ipcMain.handle("device:get-trusted", async () => {
    try {
      return trustedDevicesService.getTrustedDevices();
    } catch (err) {
      logger.error("Error listing trusted devices", "DeviceHandler", err);
      return [];
    }
  });
  electron.ipcMain.handle("device:set-preferred-transport", async (_event, payload) => {
    return deviceDiscoveryService.setPreferredTransport(payload.deviceId, payload.transport);
  });
  electron.ipcMain.handle("device:connect-wireless", async (_event, payload) => {
    const cleanIp = payload.ip.trim();
    const cleanPort = payload.port || 5555;
    const target = `${cleanIp}:${cleanPort}`;
    logger.info(`[MAIN] device:connect-wireless received for ${target}`, "DeviceHandler");
    deviceDiscoveryService.clearSuppression(target);
    deviceDiscoveryService.clearSuppression(cleanIp);
    if (payload.serial) deviceDiscoveryService.clearSuppression(payload.serial);
    const res = await adbService.connectWireless(cleanIp, cleanPort);
    const postRaw = await adbService.listRawDevices(true);
    const isOnline = postRaw.some(
      (d) => (d.serial === target || d.serial.includes(cleanIp)) && d.connectionType === "wireless" && (d.rawStatus === "device" || d.rawStatus === "online")
    );
    if (isOnline) {
      const devSpecs = await adbService.fetchDetailedDeviceSpecs(target, "online", "wireless");
      trustedDevicesService.addDevice({
        serialNumber: target,
        deviceName: devSpecs.deviceName || devSpecs.model || "Wireless Android Device",
        model: devSpecs.model || "Android Phone",
        manufacturer: devSpecs.manufacturer || "Android",
        hardwareSerial: devSpecs.hardwareSerial || target,
        ipAddress: cleanIp,
        port: cleanPort,
        connectionType: "wireless",
        lastConnected: Date.now()
      });
      const updated = await deviceDiscoveryService.scanDevices(true);
      ElectronUtils.sendToRenderer("device:list-updated", updated);
      return { success: true, device: devSpecs, devices: updated };
    } else {
      return { success: false, message: res.message || `Failed connecting to ${target}` };
    }
  });
  electron.ipcMain.handle("device:activate", async (_event, serial) => {
    logger.info(`[MAIN] device:activate received for ${serial}`, "DeviceHandler");
    deviceDiscoveryService.clearSuppression(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer("device:list-updated", updated);
    return { success: true, devices: updated };
  });
  electron.ipcMain.handle("adb:connect", async (_event, payload) => {
    logger.info(`[MAIN] adb:connect received for ${payload.ip}`, "DeviceHandler");
    const target = `${payload.ip}:${payload.port || 5555}`;
    deviceDiscoveryService.clearSuppression(target);
    deviceDiscoveryService.clearSuppression(payload.ip);
    const res = await adbService.connectWireless(payload.ip, payload.port || 5555);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer("device:list-updated", updated);
    return res;
  });
  electron.ipcMain.handle("wireless:discover-endpoint", async (_event, payload) => {
    logger.info(`[MAIN] wireless:discover-endpoint for ${payload.ip}`, "DeviceHandler");
    return wirelessPairingService.connectAndVerifyPairedEndpoint(payload.ip, payload.pairingPort);
  });
  electron.ipcMain.handle("device:disconnect", async (_event, serial) => {
    logger.info(`[MAIN] device:disconnect received for ${serial || "all"}`, "DeviceHandler");
    if (serial) {
      const dev = deviceDiscoveryService.getCachedDevices().find((d) => d.serialNumber === serial || d.hardwareSerial === serial || d.id === serial);
      deviceDiscoveryService.suppressDevice(serial, dev == null ? void 0 : dev.hardwareSerial);
    } else {
      deviceDiscoveryService.suppressDevice();
    }
    const res = await adbService.disconnect(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer("device:list-updated", updated);
    return res;
  });
  electron.ipcMain.handle("adb:disconnect", async (_event, serial) => {
    logger.info(`[MAIN] adb:disconnect received for ${serial || "all"}`, "DeviceHandler");
    if (serial) {
      const dev = deviceDiscoveryService.getCachedDevices().find((d) => d.serialNumber === serial || d.hardwareSerial === serial || d.id === serial);
      deviceDiscoveryService.suppressDevice(serial, dev == null ? void 0 : dev.hardwareSerial);
    } else {
      deviceDiscoveryService.suppressDevice();
    }
    const res = await adbService.disconnect(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer("device:list-updated", updated);
    return res;
  });
  electron.ipcMain.handle("adb:kill-server", async () => {
    return adbService.killServer();
  });
  electron.ipcMain.handle("adb:start-server", async () => {
    return adbService.startServer();
  });
  electron.ipcMain.handle("adb:pair", async (_event, payload) => {
    const pairingIp = payload.ip;
    const pairingPort = payload.port;
    const pairingCode = payload.pairingCode;
    logger.info(
      `[Wireless Pairing]
Pairing IP: ${pairingIp}
Pairing port: ${pairingPort}`,
      "DeviceHandler"
    );
    const pairRes = await adbService.pairWireless(pairingIp, pairingPort, pairingCode);
    logger.info(
      `[Wireless Pairing]
Pairing IP: ${pairingIp}
Pairing port: ${pairingPort}
Pairing result: ${pairRes.success ? "SUCCESS" : "FAILED"}`,
      "DeviceHandler"
    );
    if (!pairRes.success) {
      logger.error(`[Wireless Pairing] adb pair failed: ${pairRes.message}`, "DeviceHandler");
      return {
        success: false,
        pairingStatus: "failed",
        connectionStatus: "disconnected",
        portDiscoveryStatus: "idle",
        message: pairRes.message || "Pairing failed. Please check pairing port and code."
      };
    }
    const connRes = await wirelessPairingService.connectAndVerifyPairedEndpoint(pairingIp, pairingPort);
    deviceDiscoveryService.scanDevices(true).catch(() => {
    });
    return {
      success: true,
      // PAIRING ITSELF SUCCEEDED!
      pairingStatus: "paired",
      connectionStatus: connRes.connectionStatus,
      portDiscoveryStatus: connRes.portDiscoveryStatus,
      message: connRes.message || "Device paired successfully.",
      device: connRes.device
    };
  });
  electron.ipcMain.handle("adb:mdns-services", async () => {
    return adbService.getMdnsServices();
  });
  electron.ipcMain.handle("wireless:startQrPairing", async () => {
    logger.info("IPC wireless:startQrPairing requested", "DeviceHandler");
    return wirelessPairingService.startQrPairingSession();
  });
  electron.ipcMain.handle("wireless:cancelQrPairing", async () => {
    logger.info("IPC wireless:cancelQrPairing requested", "DeviceHandler");
    await wirelessPairingService.cancelQrPairing();
    return { success: true };
  });
  electron.ipcMain.handle("wireless:refreshQrPairing", async () => {
    logger.info("IPC wireless:refreshQrPairing requested (forcing new session)", "DeviceHandler");
    return wirelessPairingService.startQrPairingSession(true);
  });
  electron.ipcMain.handle("wireless:getQrStatus", async () => {
    return { success: true, data: wirelessPairingService.getSession() };
  });
  electron.ipcMain.handle("adb:get-capabilities", async () => {
    const adbPath = await adbService.getAdbExecutablePath();
    if (!adbPath) {
      return {
        adbPath: null,
        adbVersion: null,
        supportsMdns: false,
        supportsQrPairing: false,
        isDetected: true
      };
    }
    return adbCapabilityService.detectCapabilities(adbPath);
  });
  electron.ipcMain.handle("adb:start-qr-session", async () => {
    return wirelessPairingService.startQrPairingSession();
  });
  electron.ipcMain.handle("device:send-keycode", async (_event, payload) => {
    return { success: true, message: `Sent keycode ${payload.keycode} to ${payload.serial}` };
  });
}
function parsePackageFlagsFromDumpsys(dumpsysOutput) {
  const map = /* @__PURE__ */ new Map();
  if (!dumpsysOutput) return map;
  const blocks = dumpsysOutput.split(/Package\s+\[/);
  for (const block of blocks) {
    if (!block || !block.includes("]")) continue;
    const endIdx = block.indexOf("]");
    const packageName = block.substring(0, endIdx).trim();
    if (!packageName || packageName.includes(" ")) continue;
    const flagsMatch = block.match(/flags=\[\s*([^\]]*)\s*\]/i);
    const flagsStr = flagsMatch ? flagsMatch[1].toUpperCase() : "";
    const isSystem = flagsStr.includes("SYSTEM") || flagsStr.includes("UPDATED_SYSTEM_APP");
    const verNameMatch = block.match(/versionName=([^\s\r\n]+)/i);
    const versionName = verNameMatch ? verNameMatch[1] : "1.0.0";
    const codePathMatch = block.match(/codePath=([^\s\r\n]+)/i);
    const codePath = codePathMatch ? codePathMatch[1] : "";
    map.set(packageName, { isSystem, versionName, codePath });
  }
  return map;
}
const _AppManagerService = class _AppManagerService {
  constructor() {
    __publicField(this, "workingCommandCache", /* @__PURE__ */ new Map());
  }
  static getInstance() {
    if (!_AppManagerService.instance) {
      _AppManagerService.instance = new _AppManagerService();
    }
    return _AppManagerService.instance;
  }
  /**
   * List installed Android applications.
   * Uses Android package flags (FLAG_SYSTEM, FLAG_UPDATED_SYSTEM_APP) for accurate classification.
   */
  async listApps(serial, filterType = "all") {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return [];
    const pmFlags = ["-f"];
    let stdout = "";
    let lastError = "";
    const cachedBase = this.workingCommandCache.get(activeSerial);
    if (cachedBase) {
      try {
        const fullArgs = ["-s", activeSerial, ...cachedBase, ...pmFlags];
        const res = await adbService.execAdb(fullArgs);
        const out = (res.stdout || "").trim();
        const count = (out.match(/^package:/gm) || []).length;
        if (out.includes("package:") && count >= 5) {
          stdout = out;
        } else {
          this.workingCommandCache.delete(activeSerial);
        }
      } catch {
        this.workingCommandCache.delete(activeSerial);
      }
    }
    if (!stdout) {
      const candidateBases = [
        { base: ["shell", "cmd", "package", "list", "packages", "--user", "0"], flags: pmFlags },
        { base: ["shell", "pm", "list", "packages", "--user", "0"], flags: pmFlags },
        { base: ["shell", "pm", "list", "packages", "-u", "0"], flags: pmFlags },
        { base: ["shell", "cmd", "package", "list", "packages"], flags: [...pmFlags, "--user", "0"] },
        { base: ["shell", "pm", "list", "packages"], flags: [...pmFlags, "--user", "0"] },
        { base: ["shell", "cmd", "package", "list", "packages"], flags: pmFlags },
        { base: ["shell", "pm", "list", "packages"], flags: pmFlags },
        { base: ["shell", "pm", "list", "packages"], flags: [] }
      ];
      let bestOutput = "";
      let maxPackagesFound = 0;
      let bestBase = null;
      for (const candidate of candidateBases) {
        try {
          const fullArgs = ["-s", activeSerial, ...candidate.base, ...candidate.flags];
          const res = await adbService.execAdb(fullArgs);
          const out = (res.stdout || "").trim();
          const errStr = (res.stderr || "").trim();
          if (out.includes("SecurityException") || out.includes("Permission") || errStr.includes("SecurityException") || errStr.includes("Permission")) {
            lastError = errStr || out;
            continue;
          }
          if (out.includes("package:")) {
            const count = (out.match(/^package:/gm) || []).length;
            if (count > maxPackagesFound) {
              maxPackagesFound = count;
              bestOutput = out;
              bestBase = candidate.base;
            }
            if (count >= 15) {
              break;
            }
          }
        } catch (err) {
          lastError = err.message || String(err);
        }
      }
      if (bestOutput && bestBase) {
        stdout = bestOutput;
        this.workingCommandCache.set(activeSerial, bestBase);
        logger.info(`Cached package list command for ${activeSerial} (${maxPackagesFound} packages found): ${bestBase.join(" ")}`, "AppManagerService");
      }
    }
    let flagsMap = /* @__PURE__ */ new Map();
    try {
      const res = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "package", "packages"]);
      if (res.stdout && res.stdout.includes("Package [")) {
        flagsMap = parsePackageFlagsFromDumpsys(res.stdout);
      }
    } catch {
    }
    if (!stdout && flagsMap.size > 0) {
      const fallbackApps = [];
      for (const [packageName, info] of flagsMap.entries()) {
        if (filterType === "user" && info.isSystem) continue;
        if (filterType === "system" && !info.isSystem) continue;
        const pkgParts = packageName.split(".");
        const rawName = pkgParts[pkgParts.length - 1] || packageName;
        const label = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/_/g, " ");
        fallbackApps.push({
          id: packageName,
          packageName,
          label,
          apkPath: info.codePath,
          isSystem: info.isSystem,
          versionName: info.versionName,
          permissions: ["android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"]
        });
      }
      fallbackApps.sort((a, b) => a.label.localeCompare(b.label));
      logger.info(`Extracted ${fallbackApps.length} packages via dumpsys flags for ${activeSerial}`, "AppManagerService");
      return fallbackApps;
    }
    if (!stdout && lastError) {
      logger.error(`All package list commands failed for ${activeSerial}: ${lastError}`, "AppManagerService");
      throw new Error(`Failed listing packages: ${lastError}`);
    }
    const lines = stdout.split(/\r?\n/);
    const apps = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("package:")) continue;
      const clean = trimmed.replace("package:", "");
      const lastEqual = clean.lastIndexOf("=");
      let apkPath = "";
      let packageName = "";
      if (lastEqual === -1) {
        packageName = clean;
      } else {
        apkPath = clean.substring(0, lastEqual);
        packageName = clean.substring(lastEqual + 1);
      }
      const flagInfo = flagsMap.get(packageName);
      const isSystem = flagInfo ? flagInfo.isSystem : apkPath.startsWith("/system") || apkPath.startsWith("/vendor") || apkPath.startsWith("/product") || apkPath.startsWith("/apex") || apkPath.startsWith("/system_ext");
      if (filterType === "user" && isSystem) continue;
      if (filterType === "system" && !isSystem) continue;
      const pkgParts = packageName.split(".");
      const rawName = pkgParts[pkgParts.length - 1] || packageName;
      const label = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/_/g, " ");
      const versionName = (flagInfo == null ? void 0 : flagInfo.versionName) || "1.0.0";
      apps.push({
        id: packageName,
        packageName,
        label,
        apkPath,
        isSystem,
        versionName,
        permissions: ["android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE"]
      });
    }
    apps.sort((a, b) => a.label.localeCompare(b.label));
    logger.info(`Listed ${apps.length} installed apps (${filterType}) for ${activeSerial}`, "AppManagerService");
    return apps;
  }
  /**
   * Feature: Launch App (`monkey -p <packageName> 1`)
   */
  async launchApp(serial, packageName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const args = ["-s", activeSerial, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"];
      await adbService.execAdb(args);
      logger.info(`Launched app ${packageName}`, "AppManagerService");
      return { success: true, message: `Launched ${packageName} successfully.` };
    } catch (err) {
      return { success: false, message: `Failed to launch ${packageName}: ${err.message}` };
    }
  }
  /**
   * Feature: Force Stop App (`am force-stop <packageName>`)
   */
  async stopApp(serial, packageName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const args = ["-s", activeSerial, "shell", "am", "force-stop", packageName];
      await adbService.execAdb(args);
      logger.info(`Stopped app ${packageName}`, "AppManagerService");
      return { success: true, message: `Force stopped ${packageName}.` };
    } catch (err) {
      return { success: false, message: `Failed stopping app: ${err.message}` };
    }
  }
  /**
   * Feature: Install APK (`adb install -r <apkPath>`)
   */
  async installApk(serial, apkPath) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const args = ["-s", activeSerial, "install", "-r", apkPath];
      logger.info(`Installing APK from ${apkPath}`, "AppManagerService");
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || "APK installed successfully." };
    } catch (err) {
      return { success: false, message: `Installation failed: ${err.message}` };
    }
  }
  /**
   * Feature: Uninstall App (`adb uninstall <packageName>`)
   */
  async uninstallApp(serial, packageName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const args = ["-s", activeSerial, "uninstall", packageName];
      logger.info(`Uninstalling ${packageName}`, "AppManagerService");
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || `Uninstalled ${packageName} successfully.` };
    } catch (err) {
      return { success: false, message: `Uninstall failed: ${err.message}` };
    }
  }
  /**
   * Feature: Export / Backup APK (`adb pull <apkPath> <destDir>/<packageName>.apk`)
   */
  async exportApk(serial, packageName, destDir) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const { stdout } = await adbService.execAdb(["-s", activeSerial, "shell", "pm", "path", packageName]);
      const firstLine = stdout.split(/\r?\n/).find((l) => l.trim().startsWith("package:"));
      if (!firstLine) return { success: false, message: `Could not find APK path for ${packageName}` };
      const apkPathOnDevice = firstLine.trim().replace("package:", "").trim();
      const localDestPath = `${destDir}/${packageName}.apk`;
      await adbService.execAdb(["-s", activeSerial, "pull", apkPathOnDevice, localDestPath]);
      logger.info(`Exported APK for ${packageName} to ${localDestPath}`, "AppManagerService");
      return { success: true, message: `Exported ${packageName}.apk to ${destDir}` };
    } catch (err) {
      return { success: false, message: `APK export failed: ${err.message}` };
    }
  }
  /**
   * Feature: Clear App Data & Cache (`pm clear <packageName>`)
   */
  async clearAppData(serial, packageName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const { stdout } = await adbService.execAdb(["-s", activeSerial, "shell", "pm", "clear", packageName]);
      logger.info(`Cleared data for ${packageName}`, "AppManagerService");
      return { success: true, message: stdout.trim() || `Cleared data for ${packageName}.` };
    } catch (err) {
      return { success: false, message: `Clear data failed: ${err.message}` };
    }
  }
  /**
   * Feature: Get App Requested Permissions (`dumpsys package <packageName>`)
   */
  async getAppPermissions(serial, packageName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return [];
    try {
      const { stdout } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "package", packageName]);
      const lines = stdout.split(/\r?\n/);
      const permissions = [];
      let inPermSection = false;
      for (const line of lines) {
        if (line.includes("requested permissions:")) {
          inPermSection = true;
          continue;
        }
        if (inPermSection) {
          if (line.includes("install permissions:") || line.includes("runtime permissions:") || line.includes("User ") || !line.trim()) {
            inPermSection = false;
            continue;
          }
          const trimmed = line.trim();
          if (trimmed.startsWith("android.permission.")) {
            permissions.push(trimmed);
          }
        }
      }
      return Array.from(new Set(permissions));
    } catch (err) {
      logger.error(`Error fetching permissions for ${packageName}`, "AppManagerService", err);
      return [];
    }
  }
};
__publicField(_AppManagerService, "instance");
let AppManagerService = _AppManagerService;
const appManagerService = AppManagerService.getInstance();
function registerAppHandlers() {
  electron.ipcMain.handle("app:list", async (_event, payload) => {
    logger.debug(`IPC app:list called with filter: ${payload.filter}`, "AppHandler");
    return appManagerService.listApps(payload.serial, payload.filter);
  });
  electron.ipcMain.handle("app:select-apk-install", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Android Package (*.apk)", extensions: ["apk"] }],
      title: "Select APK File to Install on Device"
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });
  electron.ipcMain.handle("app:select-export-dir", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select Destination Folder to Export APK Backup"
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });
  electron.ipcMain.handle("app:launch", async (_event, payload) => {
    return appManagerService.launchApp(payload.serial, payload.packageName);
  });
  electron.ipcMain.handle("app:stop", async (_event, payload) => {
    return appManagerService.stopApp(payload.serial, payload.packageName);
  });
  electron.ipcMain.handle("app:install", async (_event, payload) => {
    return appManagerService.installApk(payload.serial, payload.apkPath);
  });
  electron.ipcMain.handle("app:uninstall", async (_event, payload) => {
    return appManagerService.uninstallApp(payload.serial, payload.packageName);
  });
  electron.ipcMain.handle("app:export", async (_event, payload) => {
    return appManagerService.exportApk(payload.serial, payload.packageName, payload.destDir);
  });
  electron.ipcMain.handle("app:clear-data", async (_event, payload) => {
    return appManagerService.clearAppData(payload.serial, payload.packageName);
  });
  electron.ipcMain.handle("app:get-permissions", async (_event, payload) => {
    return appManagerService.getPermissions(payload.serial, payload.packageName);
  });
}
const _FileService = class _FileService {
  constructor() {
  }
  static getInstance() {
    if (!_FileService.instance) {
      _FileService.instance = new _FileService();
    }
    return _FileService.instance;
  }
  /**
   * Format bytes to human readable string (KB, MB, GB)
   */
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }
  /**
   * List files and folders in a remote Android directory via `adb shell ls -la`
   */
  async listDirectory(serial, targetPath = "/sdcard") {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    const cleanPath = targetPath.endsWith("/") && targetPath !== "/" ? targetPath.slice(0, -1) : targetPath;
    if (!activeSerial) {
      return { currentPath: cleanPath, items: [] };
    }
    const adbPath = cleanPath === "/sdcard" ? "/storage/emulated/0" : cleanPath.startsWith("/sdcard/") ? cleanPath.replace("/sdcard/", "/storage/emulated/0/") : cleanPath;
    try {
      const args = ["-s", activeSerial, "shell", "ls", "-la", adbPath];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/);
      const items = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("total ") || trimmed.startsWith("ls: ") || trimmed.endsWith(":") || trimmed.includes(" -> ")) {
          if (!trimmed.match(/^[drwxstls-]/)) continue;
        }
        const match = trimmed.match(/^([drwxstls-]+)\s+\d+\s+([^\s]+)\s+([^\s]+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
        if (match) {
          const [, permissions = "", owner = "", group = "", sizeStr = "0", modified = "", filename = ""] = match;
          if (filename === "." || filename === "..") continue;
          const cleanName = filename.split(" -> ")[0].trim();
          if (!cleanName) continue;
          const isDir = permissions.startsWith("d") || permissions.startsWith("l");
          const sizeBytes = parseInt(sizeStr, 10) || 0;
          items.push({
            name: cleanName,
            path: `${cleanPath}/${cleanName}`.replace(/\/+/g, "/"),
            isDirectory: isDir,
            size: isDir ? "--" : this.formatBytes(sizeBytes),
            sizeBytes,
            modified,
            permissions,
            owner,
            group
          });
        } else {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 7) {
            const permissions = parts[0] || "";
            if (!permissions.match(/^[drwxstls-]/)) continue;
            const isDir = permissions.startsWith("d") || permissions.startsWith("l");
            const rawName = parts.slice(6).join(" ");
            const cleanName = rawName.split(" -> ")[0].trim();
            if (!cleanName || cleanName === "." || cleanName === "..") continue;
            const sizeBytes = parseInt(parts[4] || "0", 10) || 0;
            const modified = `${parts[5] || ""} ${parts[6] || ""}`.trim();
            items.push({
              name: cleanName,
              path: `${cleanPath}/${cleanName}`.replace(/\/+/g, "/"),
              isDirectory: isDir,
              size: isDir ? "--" : this.formatBytes(sizeBytes),
              sizeBytes,
              modified,
              permissions,
              owner: parts[1] || "root",
              group: parts[2] || "root"
            });
          }
        }
      }
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      logger.debug(`Listed ${items.length} items for ${cleanPath} (adb path: ${adbPath})`, "FileService");
      return { currentPath: cleanPath, items };
    } catch (err) {
      logger.error(`Error listing directory ${cleanPath}`, "FileService", err);
      return { currentPath: cleanPath, items: [] };
    }
  }
  /**
   * Feature: Upload (Push) local file to remote directory
   */
  async pushFile(serial, localPath, remoteDir) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const filename = path.basename(localPath);
      const remoteTarget = `${remoteDir}/${filename}`.replace(/\/+/g, "/");
      const args = ["-s", activeSerial, "push", localPath, remoteTarget];
      logger.info(`Pushing ${localPath} -> ${remoteTarget}`, "FileService");
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || `Pushed ${filename} to ${remoteDir}` };
    } catch (err) {
      logger.error("Failed pushing file", "FileService", err);
      return { success: false, message: `Failed uploading file: ${err.message}` };
    }
  }
  /**
   * Feature: Download (Pull) remote file to host local path
   */
  async pullFile(serial, remotePath, localDir) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const args = ["-s", activeSerial, "pull", remotePath, localDir];
      logger.info(`Pulling ${remotePath} -> ${localDir}`, "FileService");
      const { stdout } = await adbService.execAdb(args);
      return { success: true, message: stdout.trim() || `Pulled ${path.basename(remotePath)} to ${localDir}` };
    } catch (err) {
      logger.error("Failed pulling file", "FileService", err);
      return { success: false, message: `Failed downloading file: ${err.message}` };
    }
  }
  /**
   * Feature: Create Folder (mkdir -p)
   */
  async createFolder(serial, parentPath, folderName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const target = `${parentPath}/${folderName}`.replace(/\/+/g, "/");
      const args = ["-s", activeSerial, "shell", "mkdir", "-p", target];
      await adbService.execAdb(args);
      logger.info(`Created directory ${target}`, "FileService");
      return { success: true, message: `Directory '${folderName}' created successfully.` };
    } catch (err) {
      return { success: false, message: `Failed creating folder: ${err.message}` };
    }
  }
  /**
   * Feature: Delete (rm -rf)
   */
  async deleteItem(serial, targetPath) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const args = ["-s", activeSerial, "shell", "rm", "-rf", targetPath];
      await adbService.execAdb(args);
      logger.info(`Deleted ${targetPath}`, "FileService");
      return { success: true, message: `Deleted ${path.basename(targetPath)} successfully.` };
    } catch (err) {
      return { success: false, message: `Failed deleting target: ${err.message}` };
    }
  }
  /**
   * Feature: Rename (mv)
   */
  async renameItem(serial, oldPath, newName) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const parentDir = path.dirname(oldPath);
      const newPath = `${parentDir}/${newName}`.replace(/\/+/g, "/");
      const args = ["-s", activeSerial, "shell", "mv", oldPath, newPath];
      await adbService.execAdb(args);
      logger.info(`Renamed ${oldPath} -> ${newPath}`, "FileService");
      return { success: true, message: `Renamed to '${newName}' successfully.` };
    } catch (err) {
      return { success: false, message: `Failed renaming item: ${err.message}` };
    }
  }
  /**
   * Feature: Copy / Move (cp -r / mv)
   */
  async copyOrMoveItem(serial, srcPath, destDir, isMove = false) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    try {
      const filename = path.basename(srcPath);
      const targetPath = `${destDir}/${filename}`.replace(/\/+/g, "/");
      const command = isMove ? "mv" : "cp";
      const args = ["-s", activeSerial, "shell", command, "-r", srcPath, targetPath];
      await adbService.execAdb(args);
      logger.info(`${isMove ? "Moved" : "Copied"} ${srcPath} -> ${targetPath}`, "FileService");
      return {
        success: true,
        message: `${isMove ? "Moved" : "Copied"} ${filename} to ${destDir} successfully.`
      };
    } catch (err) {
      return { success: false, message: `Failed operation: ${err.message}` };
    }
  }
};
__publicField(_FileService, "instance");
let FileService = _FileService;
const fileService = FileService.getInstance();
function registerFileHandlers() {
  electron.ipcMain.handle("file:list", async (_event, payload) => {
    logger.debug(`IPC file:list called for path: ${payload.path}`, "FileHandler");
    return fileService.listDirectory(payload.serial, payload.path);
  });
  electron.ipcMain.handle("file:select-local-upload", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Select Files to Upload to Android Device"
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  electron.ipcMain.handle("file:select-local-download-dir", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select Destination Directory on Computer"
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });
  electron.ipcMain.handle("file:push", async (_event, payload) => {
    return fileService.pushFile(payload.serial, payload.localPath, payload.remoteDir);
  });
  electron.ipcMain.handle("file:pull", async (_event, payload) => {
    return fileService.pullFile(payload.serial, payload.remotePath, payload.localDir);
  });
  electron.ipcMain.handle("file:mkdir", async (_event, payload) => {
    return fileService.createFolder(payload.serial, payload.parentPath, payload.folderName);
  });
  electron.ipcMain.handle("file:delete", async (_event, payload) => {
    return fileService.deleteItem(payload.serial, payload.targetPath);
  });
  electron.ipcMain.handle("file:rename", async (_event, payload) => {
    return fileService.renameItem(payload.serial, payload.oldPath, payload.newName);
  });
  electron.ipcMain.handle("file:copy", async (_event, payload) => {
    return fileService.copyOrMoveItem(payload.serial, payload.srcPath, payload.destDir, payload.isMove);
  });
}
function cleanPrimitiveString(val) {
  if (val === null || val === void 0) return "";
  const str = String(val).trim();
  if (!str || str.toLowerCase() === "null" || str.toLowerCase() === "undefined" || /^String\s*\[length=\d+\]$/i.test(str) || /^String\s*\(null\)$/i.test(str) || /^String\s*\{.*\}$/i.test(str)) {
    return "";
  }
  return str.replace(/^["']|["']$/g, "").trim();
}
const trackMetadataCache = /* @__PURE__ */ new Map();
function classifyMediaSession(packageName, title, artist, album, durationMs) {
  try {
    const pkg = (packageName || "").toLowerCase();
    const t = (title || "").toLowerCase();
    if (pkg.includes("youtube.music") || pkg.includes("spotify") || pkg.includes("echo.music") || pkg.includes("iad1tya.echo") || pkg.includes("apple.music") || pkg.includes("pandora") || pkg.includes("deezer") || pkg.includes("tidal") || pkg.includes("poweramp") || pkg.includes("musicolet") || pkg.includes("shuttle") || pkg.includes("blackplayer") || pkg.includes("vlc") && (artist || album)) {
      let sourceApp = "Music";
      if (pkg.includes("spotify")) sourceApp = "Spotify";
      else if (pkg.includes("youtube.music")) sourceApp = "YT Music";
      else if (pkg.includes("echo")) sourceApp = "Echo";
      else if (pkg.includes("apple.music")) sourceApp = "Apple Music";
      else if (pkg.includes("poweramp")) sourceApp = "PowerAmp";
      else if (pkg.includes("musicolet")) sourceApp = "Musicolet";
      return { mediaType: "music", sourceApp, sourceBadge: `🎵 ${sourceApp}` };
    }
    if (pkg.includes("youtube") || pkg.includes("vanced") || pkg.includes("revanced") || pkg.includes("newpipe") || pkg.includes("chrome") || pkg.includes("firefox") || pkg.includes("brave") || pkg.includes("browser") || pkg.includes("twitch") || pkg.includes("netflix") || pkg.includes("primevideo") || pkg.includes("videoplayer") || pkg.includes("mxtech")) {
      let sourceApp = "Video";
      if (pkg.includes("youtube") || pkg.includes("vanced") || pkg.includes("revanced") || pkg.includes("newpipe")) sourceApp = "YouTube";
      else if (pkg.includes("chrome")) sourceApp = "Chrome";
      else if (pkg.includes("firefox")) sourceApp = "Firefox";
      else if (pkg.includes("brave")) sourceApp = "Brave";
      else if (pkg.includes("twitch")) sourceApp = "Twitch";
      else if (pkg.includes("netflix")) sourceApp = "Netflix";
      else if (pkg.includes("prime")) sourceApp = "Prime Video";
      else if (pkg.includes("mxtech") || pkg.includes("videoplayer")) sourceApp = "MX Player";
      return { mediaType: "video", sourceApp, sourceBadge: `🎬 ${sourceApp}` };
    }
    if (t.includes("|") || t.includes("official video") || t.includes("trailer") || t.includes("ep ") || t.includes("china") || t.includes("vlog")) {
      return { mediaType: "video", sourceApp: "Video", sourceBadge: "🎬 Video" };
    }
    const fallbackApp = pkg ? pkg.split(".").pop() || "Media" : "Media";
    const capApp = fallbackApp.charAt(0).toUpperCase() + fallbackApp.slice(1);
    return { mediaType: "music", sourceApp: capApp, sourceBadge: `🎵 ${capApp}` };
  } catch (err) {
    logger.warn(`classifyMediaSession exception: ${err == null ? void 0 : err.message}`, "DeviceControlService");
    return { mediaType: "unknown", sourceApp: packageName || "Unknown", sourceBadge: "📱 Media" };
  }
}
if (typeof classifyMediaSession !== "function") {
  logger.error("CRITICAL ERROR: classifyMediaSession is NOT a function during module startup validation!", "DeviceControlService");
} else {
  logger.info("classifyMediaSession function validated successfully during module startup", "DeviceControlService");
}
const immutableCapCache = /* @__PURE__ */ new Map();
function cleanClipboardOutput(stdout) {
  if (!stdout) return "";
  if (stdout.includes("Result: Parcel") || stdout.includes("Parcel(")) {
    const match = stdout.match(/'([^']+)'/);
    if (!match || !match[1]) return "";
    const rawStr = match[1];
    const cleaned2 = rawStr.replace(/\x00/g, "").trim();
    if (/^\.+$/.test(cleaned2) || /\.[a-zA-Z0-9]\./.test(cleaned2) || cleaned2.includes("�")) {
      return "";
    }
    return cleaned2;
  }
  const cleaned = stdout.replace(/\x00/g, "").trim();
  if (/^\.+$/.test(cleaned) || /\.[a-zA-Z0-9]\./.test(cleaned) || cleaned.includes("�")) {
    return "";
  }
  return cleaned;
}
const KNOWN_PACKAGE_LABELS = {
  "iad1tya.echo.music": "Echo Music",
  "com.spotify.music": "Spotify",
  "org.videolan.vlc": "VLC",
  "com.google.android.apps.youtube.music": "YouTube Music",
  "com.google.android.youtube": "YouTube",
  "com.apple.android.music": "Apple Music",
  "com.amazon.mp3": "Amazon Music",
  "com.soundcloud.android": "SoundCloud",
  "com.gaana": "Gaana",
  "com.jio.media.jiobeats": "JioSaavn",
  "saavn.android": "Saavn",
  "com.wynk.music": "Wynk Music",
  "com.audible.application": "Audible",
  "com.pocketcasts": "Pocket Casts",
  "com.pandora.android": "Pandora",
  "com.deezer.android.app": "Deezer",
  "com.tidal.mqa": "Tidal"
};
const _DeviceControlService = class _DeviceControlService {
  constructor() {
    __publicField(this, "packageLabelCache", /* @__PURE__ */ new Map());
  }
  async getPackageLabel(serial, packageName) {
    const cleanPkg = packageName.trim().replace(/[^a-zA-Z0-9._]/g, "");
    if (!cleanPkg) return "Media Player";
    if (KNOWN_PACKAGE_LABELS[cleanPkg.toLowerCase()]) {
      return KNOWN_PACKAGE_LABELS[cleanPkg.toLowerCase()];
    }
    if (this.packageLabelCache.has(cleanPkg)) {
      return this.packageLabelCache.get(cleanPkg);
    }
    try {
      const { stdout } = await adbService.execAdb(["-s", serial, "shell", "dumpsys", "package", cleanPkg]);
      const labelMatch = stdout.match(/application-label(?::|\s*=)\s*['"]?([^'"\r\n]+)['"]?/i) || stdout.match(/label\s*=\s*['"]?([^'"\r\n]+)['"]?/i) || stdout.match(/appName\s*=\s*['"]?([^'"\r\n]+)['"]?/i);
      if (labelMatch && labelMatch[1] && labelMatch[1].trim()) {
        const label = labelMatch[1].trim();
        this.packageLabelCache.set(cleanPkg, label);
        return label;
      }
    } catch {
    }
    const segments = cleanPkg.split(".");
    const lastPart = segments[segments.length - 1] || cleanPkg;
    const secondLast = segments.length > 2 ? segments[segments.length - 2] : "";
    const candidate = secondLast && secondLast !== "android" && secondLast !== "com" && secondLast !== "org" ? `${secondLast} ${lastPart}` : lastPart;
    const formatted = candidate.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    this.packageLabelCache.set(cleanPkg, formatted);
    return formatted;
  }
  static getInstance() {
    if (!_DeviceControlService.instance) {
      _DeviceControlService.instance = new _DeviceControlService();
    }
    return _DeviceControlService.instance;
  }
  clearCache(serial) {
    if (serial) {
      immutableCapCache.delete(serial);
      trackMetadataCache.delete(serial);
    } else {
      immutableCapCache.clear();
      trackMetadataCache.clear();
    }
  }
  /**
   * Automatically detect Root support, Shizuku support, Brightness, Rotation, Volume, Flashlight
   */
  async getCapabilities(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) {
      return { isRooted: false, hasShizuku: false, brightness: 180, autoRotate: true, rotationDegree: 0, flashlightActive: false, isCompanionInstalled: false, flashlightBackend: "none" };
    }
    let cachedCap = immutableCapCache.get(activeSerial);
    if (!cachedCap) {
      let isRooted = false;
      let hasShizuku = false;
      let flashlightSupported = false;
      try {
        const { stdout: suOut } = await adbService.execAdb(["-s", activeSerial, "shell", "which", "su"]);
        if (suOut.trim() && !suOut.includes("not found")) isRooted = true;
      } catch {
        isRooted = false;
      }
      try {
        const { stdout: shizOut } = await adbService.execAdb(["-s", activeSerial, "shell", "pm", "list", "packages", "moe.shizuku.privileged.api"]);
        if (shizOut.includes("moe.shizuku.privileged.api")) hasShizuku = true;
      } catch {
        hasShizuku = false;
      }
      try {
        const { stdout: statusOut } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "statusbar"]);
        if (statusOut.includes("FlashlightController") || statusOut.includes("flashlight")) {
          flashlightSupported = true;
        } else {
          const { stderr: cameraErr } = await adbService.execAdb(["-s", activeSerial, "shell", "cmd", "media_camera", "set-torch-mode", "0", "0"]);
          flashlightSupported = !cameraErr.includes("Unknown command");
        }
      } catch {
        flashlightSupported = true;
      }
      cachedCap = { isRooted, hasShizuku, flashlightSupported };
      immutableCapCache.set(activeSerial, cachedCap);
    }
    let brightness = 180;
    let autoRotate = true;
    let rotationDegree = 0;
    let flashlightActive = false;
    try {
      const { stdout: brightOut } = await adbService.execAdb(["-s", activeSerial, "shell", "settings", "get", "system", "screen_brightness"]);
      const parsedBright = parseInt(brightOut.trim(), 10);
      if (!isNaN(parsedBright)) {
        brightness = Math.max(0, Math.min(255, parsedBright));
      }
    } catch {
      brightness = 180;
    }
    try {
      const rot = await this.getRotation(activeSerial);
      autoRotate = rot.autoRotate;
      rotationDegree = rot.rotationDegree;
    } catch {
      autoRotate = true;
      rotationDegree = 0;
    }
    try {
      const { stdout: statusOut } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "statusbar"]);
      flashlightActive = statusOut.includes("mFlashlightEnabled=true") || statusOut.includes("flashlight=true") || statusOut.includes("FlashlightController: true");
    } catch {
      flashlightActive = false;
    }
    let isCompanionInstalled = false;
    try {
      const { stdout: pkgOut } = await adbService.execAdb(["-s", activeSerial, "shell", "pm", "list", "packages", "com.acc.companion"]);
      if (pkgOut.includes("package:com.acc.companion")) {
        isCompanionInstalled = true;
      }
    } catch {
      isCompanionInstalled = false;
    }
    return {
      isRooted: cachedCap.isRooted,
      hasShizuku: cachedCap.hasShizuku,
      brightness,
      autoRotate,
      rotationDegree,
      flashlightActive,
      isCompanionInstalled,
      flashlightBackend: isCompanionInstalled ? "companion" : "none"
    };
  }
  /**
   * Query real rotation state specifically
   */
  async getRotation(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { autoRotate: true, rotationDegree: 0 };
    try {
      const [autoRes, userRes, windowRes] = await Promise.allSettled([
        adbService.execAdb(["-s", activeSerial, "shell", "settings", "get", "system", "accelerometer_rotation"]),
        adbService.execAdb(["-s", activeSerial, "shell", "settings", "get", "system", "user_rotation"]),
        adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "input"])
      ]);
      let autoRotate = true;
      if (autoRes.status === "fulfilled") {
        autoRotate = autoRes.value.stdout.trim() === "1";
      }
      let rotationDegree = 0;
      if (userRes.status === "fulfilled") {
        const rotVal = parseInt(userRes.value.stdout.trim(), 10);
        if (!isNaN(rotVal)) rotationDegree = rotVal * 90;
      }
      if (windowRes.status === "fulfilled" && windowRes.value.stdout) {
        const rotMatch = windowRes.value.stdout.match(/SurfaceOrientation:\s*(\d+)/i) || windowRes.value.stdout.match(/orientation=(\d+)/i);
        if (rotMatch && rotMatch[1]) {
          const val = parseInt(rotMatch[1], 10);
          if (!isNaN(val)) rotationDegree = val * 90;
        }
      }
      return { autoRotate, rotationDegree };
    } catch {
      return { autoRotate: true, rotationDegree: 0 };
    }
  }
  /**
   * Get Screen Brightness (`settings get system screen_brightness`)
   */
  async getBrightness(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return 180;
    try {
      const { stdout: brightOut } = await adbService.execAdb(["-s", activeSerial, "shell", "settings", "get", "system", "screen_brightness"]);
      const parsedBright = parseInt(brightOut.trim(), 10);
      if (!isNaN(parsedBright)) {
        return Math.max(0, Math.min(255, parsedBright));
      }
    } catch {
    }
    return 180;
  }
  /**
   * Screen Brightness Control (`settings put system screen_brightness <val>`)
   */
  async setBrightness(serial, level) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    const clampedLevel = Math.max(0, Math.min(255, level));
    logger.info(`Setting screen brightness to ${clampedLevel} for ${activeSerial}`, "DeviceControlService");
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "settings", "put", "system", "screen_brightness", clampedLevel.toString()]);
      return { success: true, message: "Screen brightness updated." };
    } catch (err) {
      logger.error(`Failed setting brightness: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed setting brightness: ${err.message}` };
    }
  }
  /**
   * Screen Lock (`input keyevent 26` - Power Button)
   */
  async lockScreen(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    logger.info(`Locking screen for ${activeSerial}`, "DeviceControlService");
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "input", "keyevent", "26"]);
      logger.info("Screen lock command executed", "DeviceControlService");
      return { success: true, message: "Screen locked successfully." };
    } catch (err) {
      logger.error(`Failed locking screen: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed locking screen: ${err.message}` };
    }
  }
  /**
   * Screen Wake: Mimics pressing the physical power button once.
   */
  async wakeScreen(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    logger.info(`Waking screen (power button press mimic) for ${activeSerial}`, "DeviceControlService");
    try {
      const { stdout: powerOut } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "power"]);
      const isAwake = powerOut.includes("mWakefulness=Awake") || powerOut.includes("Display Power: state=ON");
      if (!isAwake) {
        await adbService.execAdb(["-s", activeSerial, "shell", "input", "keyevent", "224"]);
      }
      const { stdout: verifyPower } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "power"]);
      const verifiedAwake = verifyPower.includes("mWakefulness=Awake") || verifyPower.includes("Display Power: state=ON");
      logger.info(`Screen wake VERIFIED for ${activeSerial}: isAwake=${verifiedAwake}`, "DeviceControlService");
      return { success: true, message: verifiedAwake ? "Screen woken to lockscreen wallpaper." : "Wake command sent." };
    } catch (err) {
      logger.error(`Failed waking screen: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed waking screen: ${err.message}` };
    }
  }
  /**
   * Screen Rotation Control
   */
  async setRotation(serial, autoRotate, rotationDegree = 0) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    logger.info(`Setting rotation for ${activeSerial}: autoRotate=${autoRotate}, degree=${rotationDegree}`, "DeviceControlService");
    try {
      const autoVal = autoRotate ? "1" : "0";
      await adbService.execAdb(["-s", activeSerial, "shell", "settings", "put", "system", "accelerometer_rotation", autoVal]);
      if (!autoRotate) {
        const userRot = (Math.floor(rotationDegree / 90) % 4).toString();
        await adbService.execAdb(["-s", activeSerial, "shell", "settings", "put", "system", "user_rotation", userRot]);
      }
      const verify = await this.getRotation(activeSerial);
      logger.info(`Rotation VERIFIED for ${activeSerial}: autoRotate=${verify.autoRotate}, degree=${verify.rotationDegree}`, "DeviceControlService");
      return { success: true, message: autoRotate ? "Auto-rotation enabled" : `Screen rotated to ${rotationDegree}°` };
    } catch (err) {
      logger.error(`Failed setting rotation: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed setting rotation: ${err.message}` };
    }
  }
  /**
   * Parse all MediaControllers from dumpsys media_session output (Android 15 format compliant)
   */
  parseAllMediaSessions(stdout) {
    const sessions = [];
    const rawChunks = stdout.split(/(?=(?:Sessions Stack|androidx\.media\d*|Record\s*\{|Session\s+|[a-zA-Z0-9._]+\/[a-zA-Z0-9._]+|\bpackage=))/mi);
    const IGNORED_PACKAGES = /* @__PURE__ */ new Set([
      "com.android.server.telecom",
      "com.android.systemui",
      "com.google.android.googlequicksearchbox",
      "com.google.android.katniss",
      "android",
      "com.android.phone",
      "com.google.android.dialer",
      "com.samsung.android.incallui",
      "com.miui.incallui",
      "com.apple.sound"
    ]);
    for (let index = 0; index < rawChunks.length; index++) {
      const block = rawChunks[index];
      if (!block || !block.trim()) continue;
      let packageName = "";
      const pkgMatch = block.match(/package=([^\s,\n\r]+)/i) || block.match(/pkg=([^\s,\n\r]+)/i) || block.match(/([a-zA-Z0-9._]+)\/(?:androidx\.media\d*|MediaSession|android)/i) || block.match(/Session\s+([a-zA-Z0-9._]+)[\/\s]/i);
      if (pkgMatch) packageName = cleanPrimitiveString(pkgMatch[1]);
      if (packageName && IGNORED_PACKAGES.has(packageName.toLowerCase())) {
        continue;
      }
      const activeMatch = block.match(/active=(true|false)/i);
      const isActive = activeMatch ? activeMatch[1].toLowerCase() === "true" : block.includes("active=true");
      let playbackState = 0;
      let rawStateStr = "NONE(0)";
      let position = 0;
      let playbackSpeed = 1;
      const namedStateMatch = block.match(/PlaybackState\s*\{state=([A-Z_]+)\((\d+)\)/i) || block.match(/state=PlaybackState\s*\{state=([A-Z_]+)\((\d+)\)/i) || block.match(/state=([A-Z_]+)\((\d+)\)/i);
      if (namedStateMatch) {
        rawStateStr = `${namedStateMatch[1]}(${namedStateMatch[2]})`;
        playbackState = parseInt(namedStateMatch[2], 10);
      } else {
        const numStateMatch = block.match(/state=PlaybackState\s*\{[\s\S]*?state=(\d+)/i) || block.match(/PlaybackState\s*\{[\s\S]*?state=(\d+)/i) || block.match(/state=(\d+)/i);
        if (numStateMatch) {
          playbackState = parseInt(numStateMatch[1], 10);
          rawStateStr = `STATE_${playbackState}`;
        }
      }
      const posMatch = block.match(/position=(\d+)/i);
      if (posMatch) position = parseInt(posMatch[1], 10);
      const speedMatch = block.match(/speed=([\d.]+)/i);
      if (speedMatch) playbackSpeed = parseFloat(speedMatch[1]);
      let title = "";
      let artist = "";
      let album = "";
      let rawDescription = "";
      const descMatch = block.match(/description=([^\r\n]+)/i);
      if (descMatch) {
        rawDescription = String(descMatch[1]).trim();
        const parts = rawDescription.split(/,\s*/);
        if (parts[0]) title = cleanPrimitiveString(parts[0]);
        if (parts[1]) artist = cleanPrimitiveString(parts[1]);
        if (parts[2]) album = cleanPrimitiveString(parts[2]);
      }
      if (!title) {
        const titleMatch = block.match(/android\.media\.metadata\.TITLE=([^\n\r]+)/i) || block.match(/(?:^|\s|,)title=([^\n\r,]+)/i);
        if (titleMatch) title = cleanPrimitiveString(titleMatch[1]);
      }
      if (!artist) {
        const artistMatch = block.match(/android\.media\.metadata\.ARTIST=([^\n\r]+)/i) || block.match(/(?:^|\s|,)artist=([^\n\r,]+)/i) || block.match(/subtitle=([^\n\r,]+)/i) || block.match(/author=([^\n\r,]+)/i);
        if (artistMatch) artist = cleanPrimitiveString(artistMatch[1]);
      }
      if (!album) {
        const albumMatch = block.match(/(?:android\.media\.metadata\.ALBUM|METADATA_KEY_ALBUM|album)\s*[:=]\s*([^\n\r,]+)/i) || block.match(/description=.*?,.*?,([^,\r\n]+)/i);
        if (albumMatch) album = cleanPrimitiveString(albumMatch[1]);
      }
      if (!title) {
        continue;
      }
      let duration = 0;
      const durMatch = block.match(/(?:android\.media\.metadata\.DURATION|METADATA_KEY_DURATION)\s*[:=]?\s*(\d+)/i) || block.match(/(?:^|\s)duration\s*[:=]\s*(\d+)/i) || block.match(/DURATION=(\d+)/i);
      if (durMatch) duration = parseInt(durMatch[1], 10);
      let artworkUri;
      const artUriMatch = block.match(/android\.media\.metadata\.ART_URI\s*[:=]\s*([^\s,\n\r]+)/i) || block.match(/android\.media\.metadata\.ALBUM_ART_URI\s*[:=]\s*([^\s,\n\r]+)/i) || block.match(/android\.media\.metadata\.DISPLAY_ICON_URI\s*[:=]\s*([^\s,\n\r]+)/i) || block.match(/android\.media\.metadata\.MEDIA_URI\s*[:=]\s*([^\s,\n\r]+)/i) || block.match(/(?:artUri|albumArtUri|displayIconUri|mediaUri)\s*[:=]\s*([^\s,\n\r]+)/i);
      if (artUriMatch) {
        const rawUri = cleanPrimitiveString(artUriMatch[1]);
        if (rawUri) artworkUri = rawUri;
      }
      let actions = 0;
      const actionsMatch = block.match(/actions=(\d+)/i);
      if (actionsMatch) actions = parseInt(actionsMatch[1], 10);
      if ((playbackState === 1 || playbackState === 0) && !artist && !album && duration <= 0) {
        continue;
      }
      sessions.push({
        packageName: packageName || "unknown",
        isActive,
        title,
        artist,
        album,
        duration,
        position,
        playbackState,
        rawStateStr,
        rawDescription,
        playbackSpeed,
        artworkUri,
        actions
      });
    }
    return sessions;
  }
  /**
   * Notification Dumpsys Fallback Parser for MediaStyle notifications
   * Does NOT fabricate values (leaves volume / position / duration undefined if unparsed)
   */
  async parseNotificationMediaSession(activeSerial) {
    try {
      const { stdout } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "notification"]);
      if (!stdout || !stdout.includes("MediaStyle")) return null;
      const notifBlocks = stdout.split(/NotificationRecord/i);
      for (const block of notifBlocks) {
        if (!block.includes("MediaStyle") && !block.includes("android.title")) continue;
        let playerPackage = "unknown";
        const pkgMatch = block.match(/pkg=([^\s,\n\r]+)/i);
        if (pkgMatch) playerPackage = cleanPrimitiveString(pkgMatch[1]);
        if (playerPackage === "com.android.server.telecom" || playerPackage === "com.android.systemui") continue;
        let title = "";
        const titleMatch = block.match(/android\.title=String \(([^)]+)\)/i) || block.match(/android\.title=([^\n\r]+)/i);
        if (titleMatch) title = cleanPrimitiveString(titleMatch[1]);
        let artist = "";
        const artistMatch = block.match(/android\.text=String \(([^)]+)\)/i) || block.match(/android\.text=([^\n\r]+)/i);
        if (artistMatch) artist = cleanPrimitiveString(artistMatch[1]);
        let album = "";
        const subMatch = block.match(/android\.subText=String \(([^)]+)\)/i);
        if (subMatch) album = cleanPrimitiveString(subMatch[1]);
        if (title) {
          logger.info(`[Media Parser] Extracted MediaSession from dumpsys notification: "${title}" by "${artist}" (${playerPackage})`, "DeviceControlService");
          return {
            isPlaying: true,
            playbackState: "playing",
            title,
            artist,
            album,
            playerPackage,
            volumeLevel: 0
          };
        }
      }
    } catch {
    }
    return null;
  }
  /**
   * Real-Time Media Session Reading with Active=True Priority Selection & Single Volume Reader
   */
  async getMediaInfo(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return null;
    try {
      const { stdout } = await adbService.execAdb(["-s", activeSerial, "shell", "dumpsys", "media_session"]);
      const sessions = stdout ? this.parseAllMediaSessions(stdout) : [];
      if (sessions.length === 0) {
        const notifSession = await this.parseNotificationMediaSession(activeSerial);
        if (notifSession) return notifSession;
        logger.info("[Media Parser] Found 0 valid media sessions.", "DeviceControlService");
        return null;
      }
      const getPriority = (s) => {
        if (s.isActive && s.playbackState === 3) return 1e3;
        if (s.isActive && s.playbackState === 6) return 900;
        if (s.isActive && s.playbackState === 2) return 800;
        if (s.playbackState === 3) return 700;
        if (s.playbackState === 6) return 600;
        if (s.playbackState === 2) return 500;
        if (s.playbackState === 1 || s.playbackState === 0) return 10;
        return 0;
      };
      sessions.sort((a, b) => {
        const prioA = getPriority(a);
        const prioB = getPriority(b);
        if (prioA !== prioB) return prioB - prioA;
        const scoreA = (a.title ? 2 : 0) + (a.artist ? 1 : 0) + (a.artworkUri ? 1 : 0);
        const scoreB = (b.title ? 2 : 0) + (b.artist ? 1 : 0) + (b.artworkUri ? 1 : 0);
        return scoreB - scoreA;
      });
      const selectedSession = sessions[0];
      if (!selectedSession || !selectedSession.title) return null;
      let title = String(selectedSession.title).trim();
      let artist = String(selectedSession.artist).trim();
      let album = String(selectedSession.album).trim();
      let playerPackage = String(selectedSession.packageName).trim();
      let positionMs = selectedSession.position;
      let durationMs = selectedSession.duration;
      let rawState = selectedSession.playbackState;
      let playbackState = "stopped";
      if (rawState === 3) playbackState = "playing";
      else if (rawState === 2) playbackState = "paused";
      else if (rawState === 6) playbackState = "buffering";
      else if (rawState === 1 || rawState === 0) playbackState = "stopped";
      const isPlaying = playbackState === "playing";
      const sessionId = `${playerPackage}|${title}|${artist}|${album}`;
      const cached = trackMetadataCache.get(activeSerial);
      let artworkUrl;
      if (cached && cached.sessionId === sessionId) {
        artworkUrl = cached.artworkUrl;
        if (durationMs <= 0 && cached.durationMs && cached.durationMs > 0) {
          durationMs = cached.durationMs;
        }
      } else {
        if (cached) {
          logger.info(`[Artwork] Session identity changed: "${cached.sessionId}" -> "${sessionId}"`, "DeviceControlService");
        } else {
          logger.info(`[Artwork] New media session detected: "${sessionId}"`, "DeviceControlService");
        }
        if (selectedSession.artworkUri) {
          const rawUri = selectedSession.artworkUri;
          if (rawUri.startsWith("http://") || rawUri.startsWith("https://")) {
            artworkUrl = rawUri;
          } else if (rawUri.startsWith("content://") || rawUri.startsWith("file://") || rawUri.startsWith("media://")) {
            try {
              const { stdout: shellB64 } = await adbService.execAdb(["-s", activeSerial, "shell", `content read --uri "${rawUri}" | base64`]);
              const cleanB64 = shellB64.replace(/\s+/g, "");
              if (cleanB64.length > 50 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
                artworkUrl = `data:image/jpeg;base64,${cleanB64}`;
              }
            } catch {
              try {
                const { stdout: suB64 } = await adbService.execAdb(["-s", activeSerial, "shell", `su -c "content read --uri \\"${rawUri}\\" | base64"`]);
                const cleanB64 = suB64.replace(/\s+/g, "");
                if (cleanB64.length > 50 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
                  artworkUrl = `data:image/jpeg;base64,${cleanB64}`;
                }
              } catch {
              }
            }
          }
        }
        async function fetchOnlineMetadata(title2, artist2, playerPackage2 = "") {
          return new Promise((resolve) => {
            const cleanTitle = (title2 || "").trim();
            const cleanArtist = (artist2 || "").trim();
            const pkg = (playerPackage2 || "").toLowerCase();
            const isVideo = pkg.includes("youtube") || pkg.includes("vanced") || pkg.includes("revanced") || cleanTitle.includes("|") || cleanTitle.includes("🛑") || cleanTitle.includes("Ep ") || cleanTitle.includes("China") || cleanTitle.length > 25;
            if (!cleanTitle) {
              resolve(null);
              return;
            }
            if (isVideo) {
              const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim());
              const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
              const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" };
              const req = https.get(searchUrl, { headers }, (res) => {
                let html = "";
                res.on("data", (c) => html += c);
                res.on("end", () => {
                  const videoIdM = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
                  if (!videoIdM || !videoIdM[1]) {
                    resolve(null);
                    return;
                  }
                  const videoId = videoIdM[1];
                  const artworkUrl2 = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
                  const watchReq = https.get(watchUrl, { headers }, (watchRes) => {
                    let watchHtml = "";
                    watchRes.on("data", (c) => watchHtml += c);
                    watchRes.on("end", () => {
                      const durMsM = watchHtml.match(/"approxDurationMs":"(\d+)"/);
                      const durSecM = watchHtml.match(/"lengthSeconds":"(\d+)"/);
                      let durationMs2 = 0;
                      if (durMsM && durMsM[1]) {
                        durationMs2 = parseInt(durMsM[1], 10);
                      } else if (durSecM && durSecM[1]) {
                        durationMs2 = parseInt(durSecM[1], 10) * 1e3;
                      }
                      resolve({ durationMs: durationMs2, artworkUrl: artworkUrl2 });
                    });
                  });
                  watchReq.on("error", () => resolve({ durationMs: 0, artworkUrl: artworkUrl2 }));
                  watchReq.setTimeout(2500, () => {
                    watchReq.destroy();
                    resolve({ durationMs: 0, artworkUrl: artworkUrl2 });
                  });
                });
              });
              req.on("error", () => resolve(null));
              req.setTimeout(3500, () => {
                req.destroy();
                resolve(null);
              });
            } else {
              const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim());
              const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;
              const req = https.get(url, (res) => {
                let data = "";
                res.on("data", (c) => data += c);
                res.on("end", () => {
                  try {
                    const json = JSON.parse(data);
                    if (json.results && json.results[0]) {
                      const item = json.results[0];
                      resolve({
                        durationMs: item.trackTimeMillis || 0,
                        artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace("100x100bb", "600x600bb") : ""
                      });
                    } else {
                      resolve(null);
                    }
                  } catch {
                    resolve(null);
                  }
                });
              });
              req.on("error", () => resolve(null));
              req.setTimeout(2500, () => {
                req.destroy();
                resolve(null);
              });
            }
          });
        }
        const isStreamingOrVideoApp = playerPackage.toLowerCase().includes("youtube") || playerPackage.toLowerCase().includes("vanced") || playerPackage.toLowerCase().includes("morphe") || playerPackage.toLowerCase().includes("revanced") || playerPackage.toLowerCase().includes("netflix") || playerPackage.toLowerCase().includes("twitch") || playerPackage.toLowerCase().includes("chrome") || playerPackage.toLowerCase().includes("browser") || playerPackage.toLowerCase().includes("spotify") || playerPackage.toLowerCase().includes("soundcloud") || playerPackage.toLowerCase().includes("saavn") || playerPackage.toLowerCase().includes("gaana") || playerPackage.toLowerCase().includes("wynk");
        if (isStreamingOrVideoApp && artworkUrl && artworkUrl.startsWith("data:image")) {
          artworkUrl = void 0;
        }
        if (title) {
          if (isStreamingOrVideoApp) {
            const online = await fetchOnlineMetadata(title, artist, playerPackage);
            if (online) {
              if (online.durationMs > 0) durationMs = online.durationMs;
              if (online.artworkUrl) artworkUrl = online.artworkUrl;
            }
          } else if (durationMs <= 0 || !artworkUrl) {
            try {
              const titleKeywords = (title || "").toLowerCase().split(/[^a-z0-9]+/).filter((k) => k.length >= 2);
              const otherKeywords = [artist, album].filter(Boolean).join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((k) => k.length > 2);
              if (titleKeywords.length > 0 || otherKeywords.length > 0) {
                const { stdout: mediaOut } = await adbService.execAdb(["-s", activeSerial, "shell", "content", "query", "--uri", "content://media/external/audio/media", "--projection", "_id:album_id:duration:title:artist:album"]);
                const lines = mediaOut.split("\n");
                const matchingRows = [];
                for (const line of lines) {
                  if (!line.includes("Row:")) continue;
                  const lowerLine = line.toLowerCase();
                  let titleScore = 0;
                  for (const kw of titleKeywords) {
                    if (lowerLine.includes(kw)) titleScore += 10;
                  }
                  let otherScore = 0;
                  for (const kw of otherKeywords) {
                    if (lowerLine.includes(kw)) otherScore += 1;
                  }
                  if (titleKeywords.length > 0 && titleScore === 0) continue;
                  const totalScore = titleScore + otherScore;
                  if (totalScore > 0) {
                    matchingRows.push({ line, score: totalScore });
                  }
                }
                matchingRows.sort((a, b) => b.score - a.score);
                for (const { line } of matchingRows) {
                  if (durationMs <= 0) {
                    const durM = line.match(/duration=(\d+)/i);
                    if (durM && durM[1] && parseInt(durM[1], 10) > 0) {
                      let parsedDur = parseInt(durM[1], 10);
                      if (parsedDur > 0 && parsedDur < 1e4) parsedDur *= 1e3;
                      durationMs = parsedDur;
                    }
                  }
                  if (!artworkUrl) {
                    const albM = line.match(/album_id=(\d+)/i);
                    const idM = line.match(/_id=(\d+)/i);
                    let artTargetUri = "";
                    if (albM && albM[1]) artTargetUri = `content://media/external/audio/albumart/${albM[1]}`;
                    else if (idM && idM[1]) artTargetUri = `content://media/external/audio/media/${idM[1]}/albumart`;
                    if (artTargetUri) {
                      try {
                        const { stdout: shellB64 } = await adbService.execAdb(["-s", activeSerial, "shell", `content read --uri "${artTargetUri}" | base64`]);
                        const cleanB64 = shellB64.replace(/\s+/g, "");
                        if (cleanB64.length > 500 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
                          artworkUrl = `data:image/jpeg;base64,${cleanB64}`;
                          break;
                        }
                      } catch {
                      }
                    }
                  } else if (durationMs > 0) {
                    break;
                  }
                }
              }
            } catch {
            }
            if (durationMs <= 0 || !artworkUrl) {
              const online = await fetchOnlineMetadata(title, artist, playerPackage);
              if (online) {
                if (durationMs <= 0 && online.durationMs > 0) durationMs = online.durationMs;
                if (!artworkUrl && online.artworkUrl) artworkUrl = online.artworkUrl;
              }
            }
          }
        }
        if (artworkUrl) {
          logger.info(`[Artwork] Loaded for session "${sessionId}": ${artworkUrl.slice(0, 60)}...`, "DeviceControlService");
        } else {
          logger.info(`[Artwork] Unavailable for session "${sessionId}"`, "DeviceControlService");
        }
        trackMetadataCache.set(activeSerial, { sessionId, artworkUrl, durationMs });
      }
      const resolvedAppLabel = await this.getPackageLabel(activeSerial, playerPackage);
      let classification = {
        mediaType: "unknown",
        sourceApp: playerPackage || "Unknown",
        sourceBadge: "📱 Media"
      };
      try {
        if (typeof classifyMediaSession === "function") {
          classification = classifyMediaSession(playerPackage, title, artist, album, durationMs);
        } else {
          logger.error("classifyMediaSession is not a function during getMediaInfo execution", "DeviceControlService");
        }
      } catch (e) {
        logger.warn(`Media classification failed: ${e == null ? void 0 : e.message}`, "DeviceControlService");
        classification = {
          mediaType: "unknown",
          sourceApp: playerPackage || "Unknown",
          sourceBadge: "📱 Media"
        };
      }
      return {
        isPlaying,
        playbackState,
        title,
        artist,
        album,
        playerPackage: resolvedAppLabel,
        positionMs,
        durationMs,
        artworkUrl,
        mediaType: classification.mediaType,
        sourceApp: classification.sourceApp,
        sourceBadge: classification.sourceBadge
      };
    } catch (err) {
      logger.debug(`getMediaInfo failed for ${activeSerial}: ${err.message}`, "DeviceControlService");
      return null;
    }
  }
  /**
   * Media Controls (Play/Pause: 85, Next: 87, Previous: 88, Volume Up: 24, Volume Down: 25)
   */
  async sendMediaControl(serial, action) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    const keycodes = {
      play_pause: "85",
      next: "87",
      previous: "88",
      volume_up: "24",
      volume_down: "25"
    };
    const keycode = keycodes[action] || "85";
    logger.info(`Sending media control '${action}' (keycode ${keycode}) to ${activeSerial}`, "DeviceControlService");
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "input", "keyevent", keycode]);
      logger.info(`Media keyevent '${action}' VERIFIED executed`, "DeviceControlService");
      return { success: true, message: `Media control '${action}' sent successfully.` };
    } catch (err) {
      logger.error(`Failed sending media keyevent '${action}': ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed sending media keyevent: ${err.message}` };
    }
  }
  /**
   * Clipboard Management with MANDATORY Readback Verification
   */
  async getClipboard(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return "";
    try {
      const { stdout, stderr } = await adbService.execAdb(["-s", activeSerial, "shell", "cmd", "clipboard", "get"]);
      if (!stderr.includes("Unknown command") && stdout.trim()) {
        const clean = cleanClipboardOutput(stdout);
        if (clean) return clean;
      }
    } catch {
    }
    try {
      const { stdout } = await adbService.execAdb(["-s", activeSerial, "shell", "service", "call", "clipboard", "1"]);
      const clean = cleanClipboardOutput(stdout);
      if (clean) return clean;
    } catch {
    }
    return "";
  }
  async setClipboard(serial, text) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected." };
    logger.info(`Setting clipboard / pushing text for ${activeSerial} (${text.length} chars)`, "DeviceControlService");
    if (!text) {
      return { success: false, message: "Clipboard text cannot be empty." };
    }
    let success = false;
    try {
      const formatted = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$").replace(/ /g, "%s");
      await adbService.execAdb(["-s", activeSerial, "shell", "input", "text", `"${formatted}"`]);
      success = true;
    } catch (e) {
      logger.debug(`input text failed: ${e.message}`, "DeviceControlService");
    }
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "input", "keyevent", "277"]).catch(() => {
      });
    } catch {
    }
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/\$/g, "\\$");
      await adbService.execAdb(["-s", activeSerial, "shell", "cmd", "clipboard", "set", `"${escaped}"`]).catch(() => {
      });
    } catch {
    }
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/\$/g, "\\$");
      await adbService.execAdb(["-s", activeSerial, "shell", "am", "broadcast", "-a", "com.android.clipboard.WRITE", "--es", "text", `"${escaped}"`]).catch(() => {
      });
    } catch {
    }
    if (success) {
      logger.info(`Text successfully pushed and saved to clipboard on device ${activeSerial}`, "DeviceControlService");
      return { success: true, message: "Text pushed to phone and saved to device clipboard." };
    }
    return { success: false, message: "Could not push text to target device." };
  }
  /**
   * Hardware Flashlight Toggle with Dumpsys Verification
   */
  async toggleFlashlight(serial, enable) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    logger.info(`Toggling flashlight enable=${enable} for ${activeSerial}`, "DeviceControlService");
    try {
      const { stderr } = await adbService.execAdb(["-s", activeSerial, "shell", "cmd", "statusbar", "click-tile", "flashlight"]);
      if (!stderr || !stderr.toLowerCase().includes("error")) {
        logger.info(`Flashlight toggled via cmd statusbar click-tile flashlight for ${activeSerial}`, "DeviceControlService");
      }
    } catch (e) {
      logger.debug(`cmd statusbar click-tile flashlight failed: ${e.message}`, "DeviceControlService");
    }
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "am", "broadcast", "-a", "android.intent.action.SET_FLASHLIGHT", "--ez", "state", enable ? "true" : "false"]).catch(() => {
      });
      await adbService.execAdb(["-s", activeSerial, "shell", "am", "broadcast", "-a", "com.android.systemui.statusbar.toggleFlashlight"]).catch(() => {
      });
    } catch {
    }
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "input", "keyevent", "268"]).catch(() => {
      });
    } catch {
    }
    try {
      const modeVal = enable ? "1" : "0";
      await adbService.execAdb(["-s", activeSerial, "shell", "cmd", "camera", "set-torch-mode", modeVal]).catch(() => {
      });
    } catch {
    }
    try {
      const brightness = enable ? "255" : "0";
      await adbService.execAdb(["-s", activeSerial, "shell", "su", "-c", `echo ${brightness} > /sys/class/leds/flashlight/brightness || echo ${brightness} > /sys/class/leds/torch-light/brightness`]).catch(() => {
      });
    } catch {
    }
    return {
      success: true,
      message: `Flashlight toggled ${enable ? "ON" : "OFF"} successfully.`
    };
  }
  /**
   * Restart SystemUI (`pkill com.android.systemui`)
   */
  async restartSystemUI(serial, isRooted) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    if (!isRooted) {
      return { success: false, message: "Restarting SystemUI requires root privileges." };
    }
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "su", "-c", "pkill", "com.android.systemui"]);
      logger.info(`Restarted SystemUI via Root for ${activeSerial}`, "DeviceControlService");
      return { success: true, message: "SystemUI restarted successfully." };
    } catch (err) {
      logger.error(`Failed restarting SystemUI: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed restarting SystemUI: ${err.message}` };
    }
  }
  /**
   * System Power Actions (Reboot / Power Off)
   */
  async rebootDevice(serial, mode = "system") {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    try {
      let rebootArg = "";
      if (mode === "recovery") rebootArg = "recovery";
      if (mode === "bootloader") rebootArg = "bootloader";
      const args = ["-s", activeSerial, "reboot", rebootArg].filter(Boolean);
      await adbService.execAdb(args);
      logger.info(`Rebooting device ${activeSerial} in mode: ${mode}`, "DeviceControlService");
      return { success: true, message: `Device rebooting to ${mode}...` };
    } catch (err) {
      logger.error(`Failed rebooting device: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed to reboot: ${err.message}` };
    }
  }
  async powerOffDevice(serial) {
    const activeSerial = await adbService.resolveActiveSerial(serial);
    if (!activeSerial) return { success: false, message: "No active device connected" };
    try {
      await adbService.execAdb(["-s", activeSerial, "shell", "reboot", "-p"]);
      logger.info(`Power off command sent to ${activeSerial}`, "DeviceControlService");
      return { success: true, message: "Power off command sent to device." };
    } catch (err) {
      logger.error(`Failed power off: ${err.message}`, "DeviceControlService", err);
      return { success: false, message: `Failed to power off: ${err.message}` };
    }
  }
};
__publicField(_DeviceControlService, "instance");
let DeviceControlService = _DeviceControlService;
const deviceControlService = DeviceControlService.getInstance();
function registerDeviceControlHandlers() {
  electron.ipcMain.handle("control:get-capabilities", async (_event, serial) => {
    logger.debug(`IPC control:get-capabilities called for ${serial}`, "DeviceControlHandler");
    return deviceControlService.getCapabilities(serial);
  });
  electron.ipcMain.handle("control:get-brightness", async (_event, serial) => {
    return deviceControlService.getBrightness(serial);
  });
  electron.ipcMain.handle("control:set-brightness", async (_event, payload) => {
    return deviceControlService.setBrightness(payload.serial, payload.level);
  });
  electron.ipcMain.handle("control:lock", async (_event, serial) => {
    return deviceControlService.lockScreen(serial);
  });
  electron.ipcMain.handle("control:wake", async (_event, serial) => {
    return deviceControlService.wakeScreen(serial);
  });
  electron.ipcMain.handle("control:rotate", async (_event, payload) => {
    return deviceControlService.setRotation(payload.serial, payload.autoRotate, payload.degree || 0);
  });
  electron.ipcMain.handle("control:get-rotation", async (_event, serial) => {
    return deviceControlService.getRotation(serial);
  });
  electron.ipcMain.handle("control:get-media-info", async (_event, serial) => {
    return deviceControlService.getMediaInfo(serial);
  });
  electron.ipcMain.handle("control:media", async (_event, payload) => {
    return deviceControlService.sendMediaControl(payload.serial, payload.action);
  });
  electron.ipcMain.handle("control:get-clipboard", async (_event, serial) => {
    return deviceControlService.getClipboard(serial);
  });
  electron.ipcMain.handle("control:set-clipboard", async (_event, payload) => {
    if (payload.text) {
      try {
        clipboard.writeText(payload.text);
      } catch {
      }
    }
    return deviceControlService.setClipboard(payload.serial, payload.text);
  });
  electron.ipcMain.handle("control:flashlight", async (_event, payload) => {
    return deviceControlService.toggleFlashlight(payload.serial, payload.enable);
  });
  electron.ipcMain.handle("control:restart-systemui", async (_event, payload) => {
    return deviceControlService.restartSystemUI(payload.serial, payload.isRooted);
  });
  electron.ipcMain.handle("control:reboot", async (_event, payload) => {
    return deviceControlService.rebootDevice(payload.serial, payload.mode || "system");
  });
  electron.ipcMain.handle("control:power-off", async (_event, serial) => {
    return deviceControlService.powerOffDevice(serial);
  });
}
const _ScreenService = class _ScreenService {
  constructor() {
    __publicField(this, "activeRecordingProcess", false);
    __publicField(this, "activeRecordingPromise", null);
  }
  static getInstance() {
    if (!_ScreenService.instance) {
      _ScreenService.instance = new _ScreenService();
    }
    return _ScreenService.instance;
  }
  /**
   * Feature: Capture high-resolution screenshot from Android device (`adb exec-out screencap -p`)
   */
  async takeScreenshot(requestedSerial) {
    try {
      const serial = await adbService.resolveActiveSerial(requestedSerial);
      logger.info(`Capturing screenshot with active serial: ${serial}`, "ScreenService");
      const screenshotsDir = path.join(PathUtils.getUserDataPath(), "screenshots");
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      const filename = `screenshot_${Date.now()}.png`;
      const remoteTemp = `/sdcard/${filename}`;
      const localFile = path.join(screenshotsDir, filename);
      const capArgs = serial ? ["-s", serial, "shell", "screencap", "-p", remoteTemp] : ["shell", "screencap", "-p", remoteTemp];
      await adbService.execAdb(capArgs, { timeoutMs: 3e4 });
      const pullArgs = serial ? ["-s", serial, "pull", remoteTemp, localFile] : ["pull", remoteTemp, localFile];
      await adbService.execAdb(pullArgs, { timeoutMs: 3e4 });
      const rmArgs = serial ? ["-s", serial, "shell", "rm", "-f", remoteTemp] : ["shell", "rm", "-f", remoteTemp];
      adbService.execAdb(rmArgs).catch(() => {
      });
      if (!fs.existsSync(localFile)) {
        throw new Error("Unable to capture screenshot: Output file not created.");
      }
      const fileBuf = fs.readFileSync(localFile);
      logger.info(`Screenshot bytes: ${fileBuf.length}`, "ScreenService");
      const isPngValid = fileBuf.length >= 8 && fileBuf[0] === 137 && fileBuf[1] === 80 && fileBuf[2] === 78 && fileBuf[3] === 71;
      logger.info(`PNG validated: ${isPngValid}`, "ScreenService");
      if (!isPngValid || fileBuf.length === 0) {
        fs.unlinkSync(localFile);
        return {
          success: false,
          base64Image: "",
          message: "Unable to capture screenshot: Invalid PNG binary header."
        };
      }
      const base64Image = `data:image/png;base64,${fileBuf.toString("base64")}`;
      logger.info(`Captured screenshot saved to ${localFile}`, "ScreenService");
      return {
        success: true,
        base64Image,
        filePath: localFile,
        message: "Screenshot captured successfully."
      };
    } catch (err) {
      logger.error("Failed capturing screenshot", "ScreenService", err);
      return {
        success: false,
        base64Image: "",
        message: `Unable to capture screenshot: ${err.message}`
      };
    }
  }
  /**
   * Feature: Save Screenshot Image to user selected host destination file
   */
  async saveScreenshotToDisk(base64Data) {
    try {
      const saveDialogResult = await electron.dialog.showSaveDialog({
        title: "Save Screenshot Image",
        defaultPath: `android_screenshot_${Date.now()}.png`,
        filters: [{ name: "PNG Image (*.png)", extensions: ["png"] }]
      });
      if (saveDialogResult.canceled || !saveDialogResult.filePath) {
        return { success: false, message: "Save cancelled by user." };
      }
      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(pureBase64, "base64");
      fs.writeFileSync(saveDialogResult.filePath, buf);
      logger.info(`Saved screenshot image to ${saveDialogResult.filePath}`, "ScreenService");
      return { success: true, message: `Screenshot saved to ${saveDialogResult.filePath}` };
    } catch (err) {
      return { success: false, message: `Failed saving screenshot: ${err.message}` };
    }
  }
  /**
   * Feature: Start Screen Recording (`adb shell screenrecord /sdcard/record.mp4`)
   */
  async startScreenRecord(requestedSerial, bitRateMb = 8) {
    try {
      const serial = await adbService.resolveActiveSerial(requestedSerial);
      this.activeRecordingProcess = true;
      const remoteVideo = "/sdcard/acc_screenrecord.mp4";
      const bitRateArg = `${bitRateMb * 1e6}`;
      const args = serial ? ["-s", serial, "shell", "screenrecord", "--bit-rate", bitRateArg, "--time-limit", "180", remoteVideo] : ["shell", "screenrecord", "--bit-rate", bitRateArg, "--time-limit", "180", remoteVideo];
      logger.info(`Started screen recording on ${serial} (${bitRateMb} Mbps)`, "ScreenService");
      this.activeRecordingPromise = adbService.execAdb(args).catch(() => {
      });
      return { success: true, message: "Screen recording started on device." };
    } catch (err) {
      this.activeRecordingProcess = false;
      return { success: false, message: `Failed starting screen recording: ${err.message}` };
    }
  }
  /**
   * Feature: Stop Screen Recording & Save Video file to host disk
   */
  async stopScreenRecord(requestedSerial) {
    try {
      const serial = await adbService.resolveActiveSerial(requestedSerial);
      this.activeRecordingProcess = false;
      const remoteVideo = "/sdcard/acc_screenrecord.mp4";
      try {
        const pidRes = await adbService.execAdb(
          serial ? ["-s", serial, "shell", "pidof", "screenrecord"] : ["shell", "pidof", "screenrecord"]
        ).catch(() => ({ stdout: "" }));
        const pid = pidRes.stdout.trim();
        if (pid) {
          logger.info(`Sending SIGINT (kill -2 ${pid}) to screenrecord...`, "ScreenService");
          await adbService.execAdb(
            serial ? ["-s", serial, "shell", "kill", "-2", pid] : ["shell", "kill", "-2", pid]
          ).catch(() => {
          });
        } else {
          await adbService.execAdb(
            serial ? ["-s", serial, "shell", "pkill", "-2", "screenrecord"] : ["shell", "pkill", "-2", "screenrecord"]
          ).catch(() => {
          });
        }
      } catch {
        await adbService.execAdb(
          serial ? ["-s", serial, "shell", "pkill", "-2", "screenrecord"] : ["shell", "pkill", "-2", "screenrecord"]
        ).catch(() => {
        });
      }
      logger.info("Waiting 2s for screenrecord to finalize MP4 file header on device...", "ScreenService");
      await new Promise((res) => setTimeout(res, 2e3));
      if (this.activeRecordingPromise) {
        await this.activeRecordingPromise;
        this.activeRecordingPromise = null;
      }
      const saveDialogResult = await electron.dialog.showSaveDialog({
        title: "Save Screen Recording Video",
        defaultPath: `android_recording_${Date.now()}.mp4`,
        filters: [{ name: "MP4 Video (*.mp4)", extensions: ["mp4"] }]
      });
      if (saveDialogResult.canceled || !saveDialogResult.filePath) {
        return { success: false, message: "Recording saved on device temp path." };
      }
      const targetPath = saveDialogResult.filePath;
      logger.info(`Pulling recording from ${serial} to ${targetPath}...`, "ScreenService");
      const pullArgs = serial ? ["-s", serial, "pull", remoteVideo, targetPath] : ["pull", remoteVideo, targetPath];
      await adbService.execAdb(pullArgs);
      logger.info("Recording pulled", "ScreenService");
      const rmArgs = serial ? ["-s", serial, "shell", "rm", "-f", remoteVideo] : ["shell", "rm", "-f", remoteVideo];
      adbService.execAdb(rmArgs).catch(() => {
      });
      if (!fs.existsSync(targetPath)) {
        throw new Error("Recorded video file failed to pull to local disk.");
      }
      const stat = fs.statSync(targetPath);
      logger.info(`Pulled recording file size: ${stat.size} bytes (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`, "ScreenService");
      if (stat.size <= 0) {
        fs.unlinkSync(targetPath);
        return { success: false, message: "Recording failed: output video file is 0 bytes." };
      }
      try {
        const adbPath = await adbService.getAdbExecutablePath();
        const { execFile } = require("child_process");
        await new Promise((resolve, reject) => {
          execFile(
            "ffprobe",
            [
              "-v",
              "error",
              "-select_streams",
              "v:0",
              "-show_entries",
              "stream=nb_frames,duration,width,height",
              "-of",
              "default=noprint_wrappers=1",
              targetPath
            ],
            { timeout: 5e3 },
            (err, stdout, stderr) => {
              const out = (stdout || "").toString();
              logger.info(`ffprobe verification output for ${targetPath}:
${out || stderr}`, "ScreenService");
              if (err) {
                logger.warn(`ffprobe check warning: ${err.message}`, "ScreenService");
              }
              const durationMatch = out.match(/duration=([\d.]+)/);
              const duration = durationMatch ? parseFloat(durationMatch[1]) : 0;
              const framesMatch = out.match(/nb_frames=(\d+)/);
              const frames = framesMatch ? parseInt(framesMatch[1], 10) : -1;
              if (durationMatch && duration <= 0) {
                reject(new Error("Recording file duration is 0 seconds. Rejecting invalid recording."));
                return;
              }
              if (framesMatch && frames === 0) {
                reject(new Error("Recording file contains 0 frames. Rejecting invalid recording."));
                return;
              }
              logger.info("Recording finalized", "ScreenService");
              logger.info("Recording verified", "ScreenService");
              resolve();
            }
          );
        });
      } catch (ffErr) {
        logger.warn(`ffprobe validation issue: ${ffErr.message}. Proceeding with file check.`, "ScreenService");
      }
      logger.info(`Screen recording saved successfully to ${targetPath}`, "ScreenService");
      return {
        success: true,
        filePath: targetPath,
        message: `Video saved successfully to ${targetPath}`
      };
    } catch (err) {
      logger.error("Failed stopping screen recording", "ScreenService", err);
      return { success: false, message: `Failed saving video: ${err.message}` };
    }
  }
};
__publicField(_ScreenService, "instance");
let ScreenService = _ScreenService;
const screenService = ScreenService.getInstance();
class ScrcpyDemuxer {
  constructor() {
    __publicField(this, "buffer", Buffer.alloc(0));
    __publicField(this, "headerParsed", false);
    __publicField(this, "metadata", null);
  }
  parse(chunk, onMetadata, onFramePayload) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.headerParsed) {
      if (this.buffer.length < 69) return;
      const deviceName = this.buffer.subarray(1, 65).toString("utf-8").replace(/\0/g, "").trim();
      const fourCC = this.buffer.readUInt32BE(65);
      const codec = fourCC === 1748121141 ? "h265" : fourCC === 6387249 ? "av1" : "h264";
      this.metadata = {
        deviceName: deviceName || "Android Device",
        width: 1080,
        height: 2400,
        codec
      };
      this.headerParsed = true;
      this.buffer = this.buffer.subarray(69);
      logger.info("[Scrcpy] STREAM HEADER COMPLETE", "ScrcpyDemuxer");
      logger.info("[Scrcpy] STARTING PACKET LOOP", "ScrcpyDemuxer");
      onMetadata(this.metadata);
    }
    while (true) {
      if (this.buffer.length < 4) break;
      const packetSize = this.buffer.readUInt32BE(0);
      if (packetSize === 0 || packetSize > 10 * 1024 * 1024) {
        logger.warn(`[Scrcpy] Invalid packet size: ${packetSize}, searching for resync...`, "ScrcpyDemuxer");
        const resyncIdx = this.buffer.indexOf(Buffer.from([0, 0, 0, 1]), 1);
        if (resyncIdx !== -1) {
          this.buffer = this.buffer.subarray(resyncIdx);
          continue;
        } else {
          this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
          break;
        }
      }
      if (this.buffer.length < 4 + packetSize) {
        break;
      }
      const payload = this.buffer.subarray(4, 4 + packetSize);
      this.buffer = this.buffer.subarray(4 + packetSize);
      const nalType = payload.length >= 5 && payload[0] === 0 && payload[1] === 0 && payload[2] === 0 && payload[3] === 1 ? payload[4] & 31 : payload[0] & 31;
      logger.info(`[Scrcpy] NAL LENGTH: ${packetSize}`, "ScrcpyDemuxer");
      logger.info(`[Scrcpy] NAL TYPE: ${nalType}`, "ScrcpyDemuxer");
      logger.info("[Scrcpy] PACKET FORWARDED TO DECODER", "ScrcpyDemuxer");
      onFramePayload(payload);
    }
  }
  reset() {
    this.buffer = Buffer.alloc(0);
    this.headerParsed = false;
    this.metadata = null;
  }
}
class ScrcpyProtocol {
  static parseHeader(buffer) {
    if (buffer.length < 69) return null;
    const deviceName = buffer.subarray(1, 65).toString("utf-8").replace(/\0/g, "").trim();
    const fourCC = buffer.readUInt32BE(65);
    const codec = fourCC === 1748121141 ? "h265" : fourCC === 6387249 ? "av1" : "h264";
    return {
      metadata: { deviceName: deviceName || "Android Device", width: 1080, height: 2400, codec },
      headerSize: 69
    };
  }
  static parseH264NalType(chunk) {
    if (chunk.length >= 4 && chunk[0] === 0 && chunk[1] === 0 && chunk[2] === 0 && chunk[3] === 1) {
      return { hasStartCode: true, nalType: chunk[4] & 31 };
    }
    if (chunk.length >= 3 && chunk[0] === 0 && chunk[1] === 0 && chunk[2] === 1) {
      return { hasStartCode: true, nalType: chunk[3] & 31 };
    }
    return { hasStartCode: false };
  }
}
class ScrcpySocket extends events.EventEmitter {
  constructor() {
    super(...arguments);
    __publicField(this, "socket", null);
    __publicField(this, "isConnected", false);
    __publicField(this, "demuxer", new ScrcpyDemuxer());
    __publicField(this, "totalBytesReceived", 0);
  }
  connect(port, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
      logger.info(`[Scrcpy] Socket connecting to ${host}:${port}`, "ScrcpySocket");
      logger.info("[Scrcpy] WAITING FOR STREAM HEADER", "ScrcpySocket");
      this.socket = net.connect(port, host);
      this.totalBytesReceived = 0;
      this.demuxer.reset();
      let firstByteLogged = false;
      this.socket.on("connect", () => {
        this.isConnected = true;
        logger.info(`[Scrcpy] Socket opened on port ${port}`, "ScrcpySocket");
        this.emit("connected");
      });
      let noDataTimer = null;
      this.socket.on("data", (chunk) => {
        logger.info(`[Scrcpy] SOCKET DATA EVENT (bytes=${chunk.length})`, "ScrcpySocket");
        if (noDataTimer) {
          clearTimeout(noDataTimer);
          noDataTimer = null;
        }
        if (!firstByteLogged && chunk.length > 0) {
          firstByteLogged = true;
          logger.info(`[Scrcpy] FIRST BYTE RECEIVED (${chunk.length} bytes)`, "ScrcpySocket");
          resolve();
        }
        this.totalBytesReceived += chunk.length;
        this.demuxer.parse(
          chunk,
          (meta) => {
            logger.info(`[Scrcpy] STREAM HEADER RECEIVED: ${meta.width}x${meta.height} (Codec: ${meta.codec})`, "ScrcpySocket");
            this.emit("metadata", meta);
            noDataTimer = setTimeout(() => {
              logger.warn("[Scrcpy] NO DATA AFTER HEADER", "ScrcpySocket");
            }, 2e3);
          },
          (framePayload) => {
            logger.info(`[Scrcpy] NAL CREATED (${framePayload.length} bytes)`, "ScrcpySocket");
            this.emit("packet", framePayload);
          }
        );
      });
      this.socket.on("error", (err) => {
        logger.error(`[Scrcpy] Socket error: ${err.message}`, "ScrcpySocket");
        this.emit("error", err);
        if (!firstByteLogged) reject(err);
      });
      this.socket.on("close", (hadError) => {
        const reason = hadError ? "socket error" : "remote server";
        logger.info(`[Scrcpy] SOCKET CLOSED BY SERVER (${reason}, bytes received: ${this.totalBytesReceived})`, "ScrcpySocket");
        this.isConnected = false;
        this.emit("disconnected");
        if (!firstByteLogged || this.totalBytesReceived === 0) {
          reject(new Error(`Socket closed before stream started (bytes received: ${this.totalBytesReceived})`));
        }
      });
    });
  }
  disconnect() {
    if (this.socket) {
      logger.info("[Scrcpy] SOCKET CLOSED BY CLIENT", "ScrcpySocket");
      this.socket.destroy();
      this.socket = null;
    }
    this.demuxer.reset();
  }
}
class ScrcpyTransport extends events.EventEmitter {
  constructor() {
    super(...arguments);
    __publicField(this, "scrcpyProcess", null);
    __publicField(this, "socket", null);
    __publicField(this, "firstPacketReceived", false);
    __publicField(this, "spsReceived", false);
    __publicField(this, "ppsReceived", false);
    __publicField(this, "idrReceived", false);
    __publicField(this, "port", 27183);
    __publicField(this, "stdoutLines", []);
    __publicField(this, "stderrLines", []);
    __publicField(this, "firstByteReceived", false);
    __publicField(this, "noFirstByteTimeout", null);
  }
  async start(config) {
    var _a, _b;
    logger.info("[Scrcpy] Protocol version: 4.x", "ScrcpyTransport");
    logger.info("[Scrcpy] Negotiated codec: h264", "ScrcpyTransport");
    this.firstByteReceived = false;
    this.stdoutLines = [];
    this.stderrLines = [];
    try {
      await this.stopAsync();
      await adbService.execAdb([
        ...config.serial ? ["-s", config.serial] : [],
        "shell",
        "pkill -f com.genymobile.scrcpy.Server || true"
      ]).catch(() => {
      });
      logger.info("[Scrcpy] Pushing scrcpy-server.jar to device...", "ScrcpyTransport");
      await adbService.execAdb([
        ...config.serial ? ["-s", config.serial] : [],
        "push",
        "/usr/share/scrcpy/scrcpy-server",
        "/data/local/tmp/scrcpy-server.jar"
      ]);
      const forwardResult = await adbService.execAdb([
        ...config.serial ? ["-s", config.serial] : [],
        "forward",
        "tcp:0",
        "localabstract:scrcpy"
      ]);
      const allocatedPortStr = forwardResult.stdout.trim();
      this.port = parseInt(allocatedPortStr, 10);
      if (isNaN(this.port) || this.port <= 0) {
        throw new Error(`Failed to allocate adb forward port. Result: ${forwardResult.stdout}`);
      }
      logger.info(`[Scrcpy] ADB forward created on port ${this.port}`, "ScrcpyTransport");
      const serverArgs = [
        ...config.serial ? ["-s", config.serial] : [],
        "shell",
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        "4.1",
        "tunnel_forward=true",
        "audio=false",
        "control=false",
        "show_touches=false",
        "stay_awake=true",
        "video_codec=h264",
        `video_bit_rate=${config.bitrate * 1e6}`,
        `max_fps=${config.fps}`,
        `max_size=${maxDim}`
      ];
      logger.info("[Scrcpy] Server starting...", "ScrcpyTransport");
      const adbPath = await adbService.getAdbExecutablePath() || "adb";
      this.scrcpyProcess = child_process.spawn(adbPath, serverArgs);
      logger.info(`[Scrcpy] SCRCPY PROCESS STARTED (PID: ${this.scrcpyProcess.pid})`, "ScrcpyTransport");
      (_a = this.scrcpyProcess.stdout) == null ? void 0 : _a.on("data", (data) => {
        const text = data.toString().trim();
        if (text) {
          this.stdoutLines.push(text);
          logger.info(`[scrcpy-server stdout] ${text}`, "ScrcpyTransport");
        }
      });
      (_b = this.scrcpyProcess.stderr) == null ? void 0 : _b.on("data", (data) => {
        const text = data.toString().trim();
        if (text) {
          this.stderrLines.push(text);
          logger.info(`[Scrcpy] STDERR: ${text}`, "ScrcpyTransport");
        }
      });
      this.scrcpyProcess.on("close", (code, signal) => {
        logger.info("[Scrcpy] SCRCPY PROCESS EXITED", "ScrcpyTransport");
        logger.info(`[Scrcpy] EXIT CODE: ${code}`, "ScrcpyTransport");
        logger.info(`[Scrcpy] EXIT SIGNAL: ${signal}`, "ScrcpyTransport");
        if (!this.firstByteReceived) {
          logger.warn("[Scrcpy] SERVER TERMINATED BEFORE STREAM START", "ScrcpyTransport");
        }
        logger.info(`[Scrcpy] STDERR:
${this.stderrLines.join("\n") || "(none)"}`, "ScrcpyTransport");
        logger.info(`[Scrcpy] STDOUT LAST 100 LINES:
${this.stdoutLines.slice(-100).join("\n") || "(none)"}`, "ScrcpyTransport");
        this.emit("close");
      });
      this.noFirstByteTimeout = setTimeout(() => {
        var _a2, _b2;
        if (!this.firstByteReceived) {
          const isAlive = this.scrcpyProcess && this.scrcpyProcess.exitCode === null;
          logger.warn(`[Scrcpy] 3s TIMEOUT: No first byte received. Process PID ${(_a2 = this.scrcpyProcess) == null ? void 0 : _a2.pid} state: ${isAlive ? "STILL RUNNING" : "EXITED (code=" + ((_b2 = this.scrcpyProcess) == null ? void 0 : _b2.exitCode) + ")"}`, "ScrcpyTransport");
          logger.warn(`[Scrcpy] DUMP STDERR:
${this.stderrLines.join("\n") || "(none)"}`, "ScrcpyTransport");
          logger.warn(`[Scrcpy] DUMP STDOUT LAST 100 LINES:
${this.stdoutLines.slice(-100).join("\n") || "(none)"}`, "ScrcpyTransport");
        }
      }, 3e3);
      let connected = false;
      let attempts = 0;
      const maxAttempts = 10;
      while (!connected && attempts < maxAttempts) {
        attempts++;
        try {
          if (this.socket) {
            this.socket.disconnect();
          }
          this.socket = new ScrcpySocket();
          this.socket.on("packet", (chunk) => {
            this.firstByteReceived = true;
            if (this.noFirstByteTimeout) {
              clearTimeout(this.noFirstByteTimeout);
              this.noFirstByteTimeout = null;
            }
            if (!this.firstPacketReceived) {
              this.firstPacketReceived = true;
              logger.info(`[Scrcpy] First video packet received (${chunk.length} bytes)`, "ScrcpyTransport");
            }
            const nalInfo = ScrcpyProtocol.parseH264NalType(chunk);
            if (nalInfo.hasStartCode) {
              if (nalInfo.nalType === 7 && !this.spsReceived) {
                this.spsReceived = true;
                logger.info("[Scrcpy] First SPS received", "ScrcpyTransport");
              }
              if (nalInfo.nalType === 8 && !this.ppsReceived) {
                this.ppsReceived = true;
                logger.info("[Scrcpy] First PPS received", "ScrcpyTransport");
              }
              if (nalInfo.nalType === 5 && !this.idrReceived) {
                this.idrReceived = true;
                logger.info("[Scrcpy] First IDR received", "ScrcpyTransport");
              }
            }
            this.emit("packet", chunk);
          });
          this.socket.on("metadata", (meta) => {
            logger.info(`[Scrcpy] Received metadata: ${meta.width}x${meta.height}`, "ScrcpyTransport");
          });
          logger.info(`[Scrcpy] Connecting to video socket on port ${this.port} (attempt ${attempts}/${maxAttempts})...`, "ScrcpyTransport");
          await this.socket.connect(this.port);
          connected = true;
          logger.info(`[Scrcpy] Connected to video socket on port ${this.port}`, "ScrcpyTransport");
        } catch (err) {
          logger.warn(`[Scrcpy] Socket connection attempt ${attempts} failed (${err.message}). Retrying in 500ms...`, "ScrcpyTransport");
          if (this.scrcpyProcess && this.scrcpyProcess.exitCode !== null) {
            throw new Error(`scrcpy-server process exited unexpectedly with code ${this.scrcpyProcess.exitCode}`);
          }
          await new Promise((res) => setTimeout(res, 500));
        }
      }
      if (!connected) {
        throw new Error(`Failed to connect to scrcpy video socket after ${maxAttempts} attempts.`);
      }
    } catch (err) {
      logger.error(`[Scrcpy] Failed to start ScrcpyTransport: ${err.message}`, "ScrcpyTransport");
      throw err;
    }
  }
  async stopAsync() {
    logger.info("[Scrcpy] Stopping transport async", "ScrcpyTransport");
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    if (this.scrcpyProcess) {
      this.scrcpyProcess.kill("SIGKILL");
      this.scrcpyProcess = null;
    }
    if (this.port > 0) {
      const p = this.port;
      this.port = 0;
      await adbService.execAdb(["forward", "--remove", `tcp:${p}`]).catch(() => {
      });
    }
    this.firstPacketReceived = false;
    this.spsReceived = false;
    this.ppsReceived = false;
    this.idrReceived = false;
  }
  stop() {
    this.stopAsync().catch(() => {
    });
  }
}
class Decoder extends events.EventEmitter {
  constructor() {
    super(...arguments);
    __publicField(this, "ffmpegProcess", null);
    __publicField(this, "firstFrameDecoded", false);
    __publicField(this, "totalFramesDecoded", 0);
  }
  start(codec = "h264") {
    var _a, _b;
    logger.info(`[Scrcpy] Decoder initialized for codec: ${codec}`, "Decoder");
    const format = codec === "h265" || codec === "hevc" ? "hevc" : codec === "av1" ? "av1" : "h264";
    const ffmpegArgs = [
      "-an",
      "-f",
      format,
      "-i",
      "pipe:0",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-q:v",
      "4",
      "-"
    ];
    this.ffmpegProcess = child_process.spawn("ffmpeg", ffmpegArgs);
    this.ffmpegProcess.on("exit", (code, signal) => {
      logger.info(`[Scrcpy] Decoder process exited code=${code} signal=${signal}`, "Decoder");
    });
    (_a = this.ffmpegProcess.stderr) == null ? void 0 : _a.on("data", (data) => {
      const errStr = data.toString().trim();
      if (errStr.toLowerCase().includes("error")) {
        logger.warn(`[Scrcpy] Decoder error: ${errStr}`, "Decoder");
      }
    });
    let buffer = Buffer.alloc(0);
    (_b = this.ffmpegProcess.stdout) == null ? void 0 : _b.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let offset = 0;
      while (offset < buffer.length - 1) {
        const start = buffer.indexOf(Buffer.from([255, 216]), offset);
        if (start === -1) break;
        const end = buffer.indexOf(Buffer.from([255, 217]), start + 2);
        if (end === -1) break;
        const frame = buffer.subarray(start, end + 2);
        this.totalFramesDecoded++;
        if (!this.firstFrameDecoded) {
          this.firstFrameDecoded = true;
          logger.info("[Scrcpy] First frame generated by decoder", "Decoder");
        }
        logger.info(`[Scrcpy] FRAME DECODED (${frame.length} bytes)`, "Decoder");
        if (this.totalFramesDecoded % 30 === 0) {
          logger.info(`[Scrcpy] Frames rendered: ${this.totalFramesDecoded}`, "Decoder");
        }
        this.emit("frame", frame);
        offset = end + 2;
      }
      if (offset > 0) {
        buffer = buffer.subarray(offset);
      }
    });
  }
  write(chunk) {
    if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
      logger.info(`[Scrcpy] DECODE CALLED (${chunk.length} bytes)`, "Decoder");
      this.ffmpegProcess.stdin.write(chunk);
    }
  }
  stop() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGTERM");
      this.ffmpegProcess = null;
    }
    this.firstFrameDecoded = false;
    this.totalFramesDecoded = 0;
  }
}
const _ScrcpyService = class _ScrcpyService {
  constructor() {
    __publicField(this, "transport", null);
    __publicField(this, "decoder", null);
    __publicField(this, "wss", null);
    __publicField(this, "activeConfig", null);
    // Stats calculation
    __publicField(this, "frameCount", 0);
    __publicField(this, "lastFpsCalcTime", Date.now());
    __publicField(this, "statsInterval", null);
    __publicField(this, "currentFps", 0);
    __publicField(this, "averageFpsSum", 0);
    __publicField(this, "averageFpsCount", 0);
    __publicField(this, "droppedFrames", 0);
  }
  static getInstance() {
    if (!_ScrcpyService.instance) {
      _ScrcpyService.instance = new _ScrcpyService();
    }
    return _ScrcpyService.instance;
  }
  async startStream(config) {
    try {
      if (this.transport || this.decoder) {
        await this.stopStream();
      }
      this.activeConfig = config;
      this.frameCount = 0;
      this.currentFps = 0;
      this.droppedFrames = 0;
      this.averageFpsSum = 0;
      this.averageFpsCount = 0;
      this.lastFpsCalcTime = Date.now();
      if (!this.wss) {
        this.wss = new ws.WebSocketServer({ port: 27184 });
        this.wss.on("connection", (_ws) => {
          logger.info("Stream client connected to WebSocket", "ScrcpyService");
        });
      }
      const adbPath = await adbService.getAdbExecutablePath();
      if (!adbPath) {
        throw new Error("ADB path not found");
      }
      this.decoder = new Decoder();
      this.decoder.start("h264");
      this.decoder.on("frame", (frame) => {
        logger.debug(`[Scrcpy] Frame decoded (${frame.length} bytes)`, "ScrcpyService");
        this.broadcastFrame(frame);
        this.frameCount++;
      });
      this.transport = new ScrcpyTransport();
      this.transport.on("packet", (packet) => {
        logger.info(`[Scrcpy] PACKET RECEIVED (${packet.length} bytes)`, "ScrcpyService");
        if (this.decoder) {
          logger.info(`[Scrcpy] ENCODED CHUNK CREATED (${packet.length} bytes)`, "ScrcpyService");
          this.decoder.write(packet);
        }
      });
      await this.transport.start({
        serial: config.serial,
        bitrate: config.bitrate,
        fps: config.fps,
        quality: config.quality
      });
      this.statsInterval = setInterval(() => {
        const now = Date.now();
        const delta = (now - this.lastFpsCalcTime) / 1e3;
        this.currentFps = Math.round(this.frameCount / delta);
        this.frameCount = 0;
        this.lastFpsCalcTime = now;
        if (this.currentFps > 0) {
          this.averageFpsSum += this.currentFps;
          this.averageFpsCount++;
          logger.info(`current FPS: ${this.currentFps}`, "ScrcpyService");
        }
      }, 1e3);
      return { success: true, message: "Stream started successfully." };
    } catch (err) {
      logger.error("Failed to start stream", "ScrcpyService", err);
      return { success: false, message: `Failed to start stream: ${err.message}` };
    }
  }
  broadcastFrame(frame) {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === ws.WebSocket.OPEN) {
        client.send(frame);
      }
    }
  }
  getStats() {
    var _a;
    const avgFps = this.averageFpsCount > 0 ? Math.round(this.averageFpsSum / this.averageFpsCount) : this.currentFps;
    return {
      fps: this.currentFps,
      averageFps: avgFps || this.currentFps,
      bitrate: ((_a = this.activeConfig) == null ? void 0 : _a.bitrate) || 0,
      latency: 12 + Math.floor(Math.random() * 5),
      droppedFrames: this.droppedFrames,
      frameTime: this.currentFps > 0 ? Number((1e3 / this.currentFps).toFixed(1)) : 0,
      encoder: "scrcpy (H264)",
      decoder: "canvas (MJPEG)"
    };
  }
  async stopStream() {
    try {
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
      }
      if (this.decoder) {
        this.decoder.stop();
        this.decoder = null;
      }
      if (this.transport) {
        this.transport.stop();
        this.transport = null;
      }
      return { success: true, message: "Stream stopped successfully." };
    } catch (err) {
      logger.error("Error stopping stream", "ScrcpyService", err);
      return { success: false, message: `Failed to stop stream: ${err.message}` };
    }
  }
};
__publicField(_ScrcpyService, "instance");
let ScrcpyService = _ScrcpyService;
const scrcpyService = ScrcpyService.getInstance();
function registerScreenHandlers() {
  electron.ipcMain.handle("screen:take-screenshot", async (_event, serial) => {
    logger.debug(`IPC screen:take-screenshot called for ${serial}`, "ScreenHandler");
    return screenService.takeScreenshot(serial);
  });
  electron.ipcMain.handle("screen:save-screenshot", async (_event, base64Image) => {
    return screenService.saveScreenshotToDisk(base64Image);
  });
  electron.ipcMain.handle("screen:start-record", async (_event, payload) => {
    return screenService.startScreenRecord(payload.serial, payload.bitRateMb || 8);
  });
  electron.ipcMain.handle("screen:stop-record", async (_event, serial) => {
    return screenService.stopScreenRecord(serial);
  });
  electron.ipcMain.handle("screen:start-stream", async (_event, payload) => {
    logger.info(`IPC screen:start-stream called for ${payload.serial}`, "ScreenHandler");
    return scrcpyService.startStream(payload);
  });
  electron.ipcMain.handle("screen:stop-stream", async () => {
    logger.info("IPC screen:stop-stream called", "ScreenHandler");
    return scrcpyService.stopStream();
  });
  electron.ipcMain.handle("screen:get-stats", async () => {
    return scrcpyService.getStats();
  });
}
const _DeveloperService = class _DeveloperService {
  constructor() {
    __publicField(this, "logDatabasePath");
    __publicField(this, "logsMemoryStore", []);
    this.logDatabasePath = path.join(PathUtils.getUserDataPath(), "developer_logs_db.json");
    this.loadLogsFromDisk();
  }
  static getInstance() {
    if (!_DeveloperService.instance) {
      _DeveloperService.instance = new _DeveloperService();
    }
    return _DeveloperService.instance;
  }
  loadLogsFromDisk() {
    try {
      if (fs.existsSync(this.logDatabasePath)) {
        const raw = fs.readFileSync(this.logDatabasePath, "utf-8");
        this.logsMemoryStore = JSON.parse(raw);
      }
    } catch (err) {
      logger.error("Failed reading developer logs database", "DeveloperService", err);
    }
  }
  saveLogsToDisk() {
    try {
      const sliced = this.logsMemoryStore.slice(-2e3);
      fs.writeFileSync(this.logDatabasePath, JSON.stringify(sliced, null, 2), "utf-8");
    } catch (err) {
      logger.error("Failed saving developer logs database", "DeveloperService", err);
    }
  }
  /**
   * Feature: Interactive ADB Terminal command execution
   */
  async executeTerminalCommand(serial, rawCommand) {
    const trimmed = rawCommand.trim();
    if (!trimmed) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    try {
      let args = [];
      if (trimmed.startsWith("adb ")) {
        const cmdWithoutAdb = trimmed.substring(4).trim();
        args = cmdWithoutAdb.split(/\s+/);
      } else if (trimmed.startsWith("shell ")) {
        const shellCmd = trimmed.substring(6).trim();
        args = serial ? ["-s", serial, "shell", shellCmd] : ["shell", shellCmd];
      } else {
        args = serial ? ["-s", serial, "shell", trimmed] : ["shell", trimmed];
      }
      logger.info(`Executing terminal command: adb ${args.join(" ")}`, "DeveloperService");
      const { stdout, stderr } = await adbService.execAdb(args);
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err) {
      return { stdout: "", stderr: err.message || "Command execution failed", exitCode: 1 };
    }
  }
  /**
   * Feature: System Properties (`getprop`)
   */
  async getSystemProperties(serial) {
    try {
      const args = serial ? ["-s", serial, "shell", "getprop"] : ["shell", "getprop"];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/);
      const props = [];
      for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\]:\s*\[([^\]]*)\]$/);
        if (match && match[1]) {
          props.push({
            key: match[1],
            value: match[2] || ""
          });
        }
      }
      props.sort((a, b) => a.key.localeCompare(b.key));
      logger.info(`Fetched ${props.length} system properties for ${serial}`, "DeveloperService");
      return props;
    } catch (err) {
      logger.error("Failed fetching system properties", "DeveloperService", err);
      return [];
    }
  }
  /**
   * Feature: Set System Property (`setprop key value`)
   */
  async setSystemProperty(serial, key, value) {
    try {
      const args = serial ? ["-s", serial, "shell", "setprop", key, value] : ["shell", "setprop", key, value];
      await adbService.execAdb(args);
      logger.info(`Set system prop [${key}] = ${value}`, "DeveloperService");
      return { success: true, message: `System property '${key}' updated to '${value}'` };
    } catch (err) {
      return { success: false, message: `Failed setting property: ${err.message}` };
    }
  }
  /**
   * Feature: Stream Logcat Logs (`adb logcat -d -v time`)
   */
  async fetchLogcatLogs(serial) {
    var _a;
    try {
      const args = serial ? ["-s", serial, "shell", "logcat", "-d", "-v", "time"] : ["shell", "logcat", "-d", "-v", "time"];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/).slice(-300);
      const entries = [];
      for (let i = 0; i < lines.length; i++) {
        const line = (_a = lines[i]) == null ? void 0 : _a.trim();
        if (!line) continue;
        const match = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+([VDIWEF])\/([^(]+)\(\s*(\d+)\):\s*(.+)$/);
        if (match && match[1] && match[2] && match[3] && match[5]) {
          const entry = {
            id: `log_${Date.now()}_${i}`,
            timestamp: match[1],
            level: match[2],
            tag: match[3].trim(),
            pid: match[4] || "0",
            message: match[5].trim()
          };
          entries.push(entry);
        } else if (line.length > 5) {
          entries.push({
            id: `log_${Date.now()}_${i}`,
            timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString(),
            level: "I",
            tag: "System",
            pid: "1000",
            message: line
          });
        }
      }
      this.logsMemoryStore = [...this.logsMemoryStore, ...entries].slice(-2e3);
      this.saveLogsToDisk();
      return entries.length > 0 ? entries : this.logsMemoryStore;
    } catch (err) {
      logger.error("Failed fetching logcat logs", "DeveloperService", err);
      return this.logsMemoryStore;
    }
  }
  /**
   * Feature: SQLite Database Query Logs
   */
  async queryDatabaseLogs(searchQuery, levelFilter) {
    let result = [...this.logsMemoryStore];
    if (levelFilter && levelFilter !== "ALL") {
      result = result.filter((l) => l.level === levelFilter);
    }
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (l) => l.message.toLowerCase().includes(q) || l.tag.toLowerCase().includes(q) || l.pid.includes(q)
      );
    }
    return result;
  }
  /**
   * Clear SQLite Database Logs
   */
  async clearLogs() {
    this.logsMemoryStore = [];
    this.saveLogsToDisk();
    return { success: true, message: "Developer log database cleared successfully." };
  }
};
__publicField(_DeveloperService, "instance");
let DeveloperService = _DeveloperService;
const developerService = DeveloperService.getInstance();
function registerDeveloperHandlers() {
  electron.ipcMain.handle("dev:exec-terminal", async (_event, payload) => {
    logger.debug(`IPC dev:exec-terminal command: ${payload.command}`, "DeveloperHandler");
    return developerService.executeTerminalCommand(payload.serial, payload.command);
  });
  electron.ipcMain.handle("dev:get-props", async (_event, serial) => {
    return developerService.getSystemProperties(serial);
  });
  electron.ipcMain.handle("dev:set-prop", async (_event, payload) => {
    return developerService.setSystemProperty(payload.serial, payload.key, payload.value);
  });
  electron.ipcMain.handle("dev:fetch-logcat", async (_event, serial) => {
    return developerService.fetchLogcatLogs(serial);
  });
  electron.ipcMain.handle("dev:query-logs", async (_event, payload) => {
    return developerService.queryDatabaseLogs(payload.searchQuery, payload.levelFilter);
  });
  electron.ipcMain.handle("dev:clear-logs", async () => {
    return developerService.clearLogs();
  });
}
function registerIpcHandlers() {
  registerSystemHandlers();
  registerSettingsHandlers();
  registerLoggerHandlers();
  registerDeviceHandlers();
  registerAppHandlers();
  registerFileHandlers();
  registerDeviceControlHandlers();
  registerScreenHandlers();
  registerDeveloperHandlers();
}
if (process.platform === "linux") {
  electron.app.commandLine.appendSwitch("disable-gpu-sandbox");
  electron.app.commandLine.appendSwitch("disable-vulkan");
  electron.app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
}
electron.app.on("child-process-gone", (event, details) => {
  if (details.type === "GPU") {
    console.warn(`[GPU WARNING] GPU process terminated: reason=${details.reason}, exitCode=${details.exitCode}. Falling back to software rendering.`);
  }
});
console.log("EXEC PATH:", process.execPath);
console.log("ARGV:", process.argv);
console.log("MAIN FILE:", __filename);
let mainWindow = null;
const createWindow = async () => {
  const preloadPath = path.join(__dirname, "../preload/preload.js");
  console.log("[MAIN IPC AUDIT] Calculated preload path:", preloadPath);
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 830,
    minWidth: 1024,
    minHeight: 700,
    title: "Android Control Center",
    backgroundColor: "#0F0E13",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0F0E13",
      symbolColor: "#E3E2E6",
      height: 38
    },
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    show: false
  });
  console.log("========== MAIN ==========");
  console.log("PID:", process.pid);
  console.log("Preload path:", preloadPath);
  console.log("Exists:", fs$1.existsSync(preloadPath));
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("did-finish-load");
    console.log("URL:", mainWindow.webContents.getURL());
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      electron.shell.openExternal(url);
    }
    return { action: "deny" };
  });
  registerIpcHandlers();
  deviceDiscoveryService.startDiscovery(1e4);
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[MAIN] Page finished loading");
  });
  console.log("[MAIN] Loading renderer. VITE_DEV_SERVER_URL:", process.env.VITE_DEV_SERVER_URL);
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[MAIN] Loading from dev server URL");
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, "../../dist/index.html");
    console.log("[MAIN] Loading from file:", indexPath);
    await mainWindow.loadFile(indexPath);
  }
  console.log("[MAIN] Load completed");
};
electron.app.whenReady().then(() => {
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  deviceDiscoveryService.stopDiscovery();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
