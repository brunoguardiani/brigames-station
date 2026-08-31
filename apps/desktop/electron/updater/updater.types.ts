export const DESKTOP_UPDATER_CHANNELS = {
  getStatus: 'updater:get-status',
  checkForUpdates: 'updater:check-for-updates',
  installUpdate: 'updater:install-update',
  statusChanged: 'updater:status-changed',
} as const;

interface UpdaterStatusBase {
  currentVersion: string;
}

export type DesktopUpdaterStatus =
  | (UpdaterStatusBase & {
      state: 'idle';
    })
  | (UpdaterStatusBase & {
      state: 'disabled';
      reason: 'development';
    })
  | (UpdaterStatusBase & {
      state: 'checking-for-update';
    })
  | (UpdaterStatusBase & {
      state: 'update-available';
      version: string;
    })
  | (UpdaterStatusBase & {
      state: 'update-not-available';
    })
  | (UpdaterStatusBase & {
      state: 'download-progress';
      version: string;
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    })
  | (UpdaterStatusBase & {
      state: 'update-downloaded';
      version: string;
    })
  | (UpdaterStatusBase & {
      state: 'error';
      message: string;
    });

export interface AvailableUpdate {
  version: string;
}

export interface UpdateDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export type RemoveUpdaterListener = () => void;

/**
 * Narrow interface around electron-updater. Keeping the package behind this
 * boundary makes the update lifecycle testable without booting Electron.
 */
export interface AutoUpdaterAdapter {
  configureAutomaticUpdates(): void;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): void;
  onCheckingForUpdate(listener: () => void): RemoveUpdaterListener;
  onUpdateAvailable(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener;
  onUpdateNotAvailable(listener: () => void): RemoveUpdaterListener;
  onDownloadProgress(listener: (progress: UpdateDownloadProgress) => void): RemoveUpdaterListener;
  onUpdateDownloaded(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener;
  onError(listener: (error: Error) => void): RemoveUpdaterListener;
}

export interface UpdaterLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
