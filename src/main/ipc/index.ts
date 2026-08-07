import { registerSystemHandlers } from './systemHandler';
import { registerSettingsHandlers } from './settingsHandler';
import { registerLoggerHandlers } from './loggerHandler';
import { registerDeviceHandlers } from './deviceHandler';
import { registerAppHandlers } from './appHandler';
import { registerFileHandlers } from './fileHandler';
import { registerDeviceControlHandlers } from './deviceControlHandler';
import { registerScreenHandlers } from './screenHandler';
import { registerDeveloperHandlers } from './developerHandler';

export function registerIpcHandlers(): void {
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
