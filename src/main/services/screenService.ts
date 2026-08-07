import { adbService } from './adbService';
import { logger } from './loggerService';
import path from 'path';
import fs from 'fs';
import { dialog } from 'electron';
import { PathUtils } from '../utils/pathUtils';

export interface ScreenshotResult {
  success: boolean;
  base64Image: string;
  filePath?: string;
  message: string;
}

export interface RecordResult {
  success: boolean;
  filePath?: string;
  message: string;
}

export class ScreenService {
  private static instance: ScreenService;
  private activeRecordingProcess = false;
  private activeRecordingPromise: Promise<any> | null = null;

  private constructor() {}

  public static getInstance(): ScreenService {
    if (!ScreenService.instance) {
      ScreenService.instance = new ScreenService();
    }
    return ScreenService.instance;
  }

  /**
   * Feature: Capture high-resolution screenshot from Android device (`adb exec-out screencap -p`)
   */
  public async takeScreenshot(requestedSerial: string): Promise<ScreenshotResult> {
    try {
      const serial = await adbService.resolveActiveSerial(requestedSerial);
      logger.info(`Capturing screenshot with active serial: ${serial}`, 'ScreenService');

      const screenshotsDir = path.join(PathUtils.getUserDataPath(), 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      const filename = `screenshot_${Date.now()}.png`;
      const remoteTemp = `/sdcard/${filename}`;
      const localFile = path.join(screenshotsDir, filename);

      // 1. Capture on device with 30s timeout
      const capArgs = serial ? ['-s', serial, 'shell', 'screencap', '-p', remoteTemp] : ['shell', 'screencap', '-p', remoteTemp];
      await adbService.execAdb(capArgs, { timeoutMs: 30000 });

      // 2. Pull file to host with 30s timeout
      const pullArgs = serial ? ['-s', serial, 'pull', remoteTemp, localFile] : ['pull', remoteTemp, localFile];
      await adbService.execAdb(pullArgs, { timeoutMs: 30000 });

      // 3. Remove remote temp file
      const rmArgs = serial ? ['-s', serial, 'shell', 'rm', '-f', remoteTemp] : ['shell', 'rm', '-f', remoteTemp];
      adbService.execAdb(rmArgs).catch(() => {});

      if (!fs.existsSync(localFile)) {
        throw new Error('Unable to capture screenshot: Output file not created.');
      }

      const fileBuf = fs.readFileSync(localFile);
      logger.info(`Screenshot bytes: ${fileBuf.length}`, 'ScreenService');

      // Validate PNG magic signature: 89 50 4E 47 (0x89 'P' 'N' 'G')
      const isPngValid = fileBuf.length >= 8 && fileBuf[0] === 0x89 && fileBuf[1] === 0x50 && fileBuf[2] === 0x4e && fileBuf[3] === 0x47;
      logger.info(`PNG validated: ${isPngValid}`, 'ScreenService');

      if (!isPngValid || fileBuf.length === 0) {
        fs.unlinkSync(localFile);
        return {
          success: false,
          base64Image: '',
          message: 'Unable to capture screenshot: Invalid PNG binary header.',
        };
      }

      const base64Image = `data:image/png;base64,${fileBuf.toString('base64')}`;
      logger.info(`Captured screenshot saved to ${localFile}`, 'ScreenService');
      return {
        success: true,
        base64Image,
        filePath: localFile,
        message: 'Screenshot captured successfully.',
      };
    } catch (err: any) {
      logger.error('Failed capturing screenshot', 'ScreenService', err);
      return {
        success: false,
        base64Image: '',
        message: `Unable to capture screenshot: ${err.message}`,
      };
    }
  }

  /**
   * Feature: Save Screenshot Image to user selected host destination file
   */
  public async saveScreenshotToDisk(base64Data: string): Promise<{ success: boolean; message: string }> {
    try {
      const saveDialogResult = await dialog.showSaveDialog({
        title: 'Save Screenshot Image',
        defaultPath: `android_screenshot_${Date.now()}.png`,
        filters: [{ name: 'PNG Image (*.png)', extensions: ['png'] }],
      });

      if (saveDialogResult.canceled || !saveDialogResult.filePath) {
        return { success: false, message: 'Save cancelled by user.' };
      }

      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(pureBase64, 'base64');
      fs.writeFileSync(saveDialogResult.filePath, buf);

      logger.info(`Saved screenshot image to ${saveDialogResult.filePath}`, 'ScreenService');
      return { success: true, message: `Screenshot saved to ${saveDialogResult.filePath}` };
    } catch (err: any) {
      return { success: false, message: `Failed saving screenshot: ${err.message}` };
    }
  }

  /**
   * Feature: Start Screen Recording (`adb shell screenrecord /sdcard/record.mp4`)
   */
  public async startScreenRecord(requestedSerial: string, bitRateMb: number = 8): Promise<{ success: boolean; message: string }> {
    try {
      const serial = await adbService.resolveActiveSerial(requestedSerial);
      this.activeRecordingProcess = true;
      const remoteVideo = '/sdcard/acc_screenrecord.mp4';
      const bitRateArg = `${bitRateMb * 1000000}`;

      const args = serial
        ? ['-s', serial, 'shell', 'screenrecord', '--bit-rate', bitRateArg, '--time-limit', '180', remoteVideo]
        : ['shell', 'screenrecord', '--bit-rate', bitRateArg, '--time-limit', '180', remoteVideo];

      logger.info(`Started screen recording on ${serial} (${bitRateMb} Mbps)`, 'ScreenService');
      this.activeRecordingPromise = adbService.execAdb(args).catch(() => {});

      return { success: true, message: 'Screen recording started on device.' };
    } catch (err: any) {
      this.activeRecordingProcess = false;
      return { success: false, message: `Failed starting screen recording: ${err.message}` };
    }
  }

  /**
   * Feature: Stop Screen Recording & Save Video file to host disk
   */
  public async stopScreenRecord(requestedSerial: string): Promise<RecordResult> {
    try {
      const serial = await adbService.resolveActiveSerial(requestedSerial);
      this.activeRecordingProcess = false;
      const remoteVideo = '/sdcard/acc_screenrecord.mp4';

      // 1. Kill screenrecord process on device
      const pkillArgs = serial
        ? ['-s', serial, 'shell', 'pkill', '-2', 'screenrecord']
        : ['shell', 'pkill', '-2', 'screenrecord'];

      await adbService.execAdb(pkillArgs).catch(() => {});

      if (this.activeRecordingPromise) {
        logger.info('Waiting for screenrecord process to exit gracefully...', 'ScreenService');
        await this.activeRecordingPromise;
        this.activeRecordingPromise = null;
      } else {
        // Fallback check if it was started outside this instance
        let isRunning = true;
        let attempts = 0;
        while (isRunning && attempts < 10) {
          const psArgs = serial ? ['-s', serial, 'shell', 'ps', '-A'] : ['shell', 'ps', '-A'];
          const psResult = await adbService.execAdb(psArgs).catch(() => ({ stdout: '' }));
          if (!psResult.stdout.includes('screenrecord')) {
            isRunning = false;
          } else {
            await new Promise(res => setTimeout(res, 500));
            attempts++;
          }
        }
      }

      // 2. Prompt user for save destination
      const saveDialogResult = await dialog.showSaveDialog({
        title: 'Save Screen Recording Video',
        defaultPath: `android_recording_${Date.now()}.mp4`,
        filters: [{ name: 'MP4 Video (*.mp4)', extensions: ['mp4'] }],
      });

      if (saveDialogResult.canceled || !saveDialogResult.filePath) {
        return { success: false, message: 'Recording saved on device temp path.' };
      }

      const targetPath = saveDialogResult.filePath;
      logger.info(`Pulling recording from ${serial} to ${targetPath}...`, 'ScreenService');
      const pullArgs = serial ? ['-s', serial, 'pull', remoteVideo, targetPath] : ['pull', remoteVideo, targetPath];
      await adbService.execAdb(pullArgs);
      logger.info('Recording pulled', 'ScreenService');

      // 3. Remove remote temp video
      const rmArgs = serial ? ['-s', serial, 'shell', 'rm', '-f', remoteVideo] : ['shell', 'rm', '-f', remoteVideo];
      adbService.execAdb(rmArgs).catch(() => {});

      // 4. Validate pulled video file: check size & run ffprobe
      if (!fs.existsSync(targetPath)) {
        throw new Error('Recorded video file failed to pull to local disk.');
      }

      const stat = fs.statSync(targetPath);
      logger.info(`Pulled recording file size: ${stat.size} bytes (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`, 'ScreenService');

      if (stat.size <= 0) {
        fs.unlinkSync(targetPath);
        return { success: false, message: 'Recording failed: output video file is 0 bytes.' };
      }

      // Run ffprobe validation to verify video stream, duration, and frame count
      try {
        const adbPath = await adbService.getAdbExecutablePath();
        const { execFile } = require('child_process');
        await new Promise<void>((resolve, reject) => {
          execFile(
            'ffprobe',
            [
              '-v',
              'error',
              '-select_streams',
              'v:0',
              '-show_entries',
              'stream=nb_frames,duration,width,height',
              '-of',
              'default=noprint_wrappers=1',
              targetPath,
            ],
            { timeout: 5000 },
            (err: any, stdout: string, stderr: string) => {
              const out = (stdout || '').toString();
              logger.info(`ffprobe verification output for ${targetPath}:\n${out || stderr}`, 'ScreenService');

              if (err) {
                logger.warn(`ffprobe check warning: ${err.message}`, 'ScreenService');
              }

              const durationMatch = out.match(/duration=([\d.]+)/);
              const duration = durationMatch ? parseFloat(durationMatch[1]) : 0;
              const framesMatch = out.match(/nb_frames=(\d+)/);
              const frames = framesMatch ? parseInt(framesMatch[1], 10) : -1;

              if (durationMatch && duration <= 0) {
                reject(new Error('Recording file duration is 0 seconds. Rejecting invalid recording.'));
                return;
              }
              if (framesMatch && frames === 0) {
                reject(new Error('Recording file contains 0 frames. Rejecting invalid recording.'));
                return;
              }
              
              logger.info('Recording finalized', 'ScreenService');
              logger.info('Recording verified', 'ScreenService');
              resolve();
            });
        });
      } catch (ffErr: any) {
        logger.warn(`ffprobe validation issue: ${ffErr.message}. Proceeding with file check.`, 'ScreenService');
      }

      logger.info(`Screen recording saved successfully to ${targetPath}`, 'ScreenService');
      return {
        success: true,
        filePath: targetPath,
        message: `Video saved successfully to ${targetPath}`,
      };
    } catch (err: any) {
      logger.error('Failed stopping screen recording', 'ScreenService', err);
      return { success: false, message: `Failed saving video: ${err.message}` };
    }
  }
}

export const screenService = ScreenService.getInstance();
