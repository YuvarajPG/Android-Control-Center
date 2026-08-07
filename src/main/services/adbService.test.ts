import { describe, it, expect } from 'vitest';
import { adbService } from './adbService';

describe('ADBService Core Functionality', () => {
  it('should instantiate singleton instance cleanly', () => {
    expect(adbService).toBeDefined();
  });

  it('should format platform detection cleanly', async () => {
    const check = await adbService.checkAdbInstallation();
    expect(check).toHaveProperty('installed');
    expect(check).toHaveProperty('platform');
  });

  it('should parse raw adb devices list structure', async () => {
    const rawDevices = await adbService.listRawDevices();
    expect(Array.isArray(rawDevices)).toBe(true);
  });
});
