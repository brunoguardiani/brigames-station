import * as electronUpdater from 'electron-updater';

import {
  AutoUpdaterAdapter,
  AvailableUpdate,
  RemoveUpdaterListener,
  UpdateDownloadProgress,
} from './updater.types';

const { autoUpdater } = electronUpdater;

/**
 * Production adapter for electron-updater. Feed information is intentionally
 * not configured at runtime: electron-builder writes app-update.yml into the
 * packaged application from its publish configuration.
 */
export class ElectronAutoUpdaterAdapter implements AutoUpdaterAdapter {
  configureAutomaticUpdates(): void {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  async checkForUpdates(): Promise<void> {
    await autoUpdater.checkForUpdates();
  }

  quitAndInstall(): void {
    // Not silent, and explicitly launch the application again after install.
    autoUpdater.quitAndInstall(false, true);
  }

  onCheckingForUpdate(listener: () => void): RemoveUpdaterListener {
    autoUpdater.on('checking-for-update', listener);
    return () => autoUpdater.removeListener('checking-for-update', listener);
  }

  onUpdateAvailable(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener {
    const handler = (update: { version: string }): void => listener({ version: update.version });
    autoUpdater.on('update-available', handler);
    return () => autoUpdater.removeListener('update-available', handler);
  }

  onUpdateNotAvailable(listener: () => void): RemoveUpdaterListener {
    autoUpdater.on('update-not-available', listener);
    return () => autoUpdater.removeListener('update-not-available', listener);
  }

  onDownloadProgress(listener: (progress: UpdateDownloadProgress) => void): RemoveUpdaterListener {
    const handler = (progress: UpdateDownloadProgress): void => listener(progress);
    autoUpdater.on('download-progress', handler);
    return () => autoUpdater.removeListener('download-progress', handler);
  }

  onUpdateDownloaded(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener {
    const handler = (update: { version: string }): void => listener({ version: update.version });
    autoUpdater.on('update-downloaded', handler);
    return () => autoUpdater.removeListener('update-downloaded', handler);
  }

  onError(listener: (error: Error) => void): RemoveUpdaterListener {
    autoUpdater.on('error', listener);
    return () => autoUpdater.removeListener('error', listener);
  }
}
