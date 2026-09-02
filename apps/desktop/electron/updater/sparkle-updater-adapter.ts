import type { SparkleBridge, SparkleBridgeEvent } from 'electron-sparkle-updater';

import {
  AutoUpdaterAdapter,
  AvailableUpdate,
  RemoveUpdaterListener,
  UpdateDownloadProgress,
  UpdaterLogger,
} from './updater.types';

export const MACOS_APPCAST_URL =
  'https://github.com/brunoguardiani/brigames-station/releases/latest/download/appcast.xml';
export const SPARKLE_ED_PUBLIC_KEY = '1/K7+eGRHMy6hPZCqQcyVcgidr9F1LGrQbFCIE4c5Vo=';

type ListenerMap = {
  checking: () => void;
  available: (update: AvailableUpdate) => void;
  notAvailable: () => void;
  progress: (progress: UpdateDownloadProgress) => void;
  downloaded: (update: AvailableUpdate) => void;
  error: (error: Error) => void;
};

type ListenerKey = keyof ListenerMap;

export class SparkleAutoUpdaterAdapter implements AutoUpdaterAdapter {
  private readonly listeners: { [K in ListenerKey]: Set<ListenerMap[K]> } = {
    checking: new Set(),
    available: new Set(),
    notAvailable: new Set(),
    progress: new Set(),
    downloaded: new Set(),
    error: new Set(),
  };
  private lastAvailableVersion: string | null = null;
  private configured = false;

  constructor(
    private readonly bridge: SparkleBridge,
    private readonly currentVersion: string,
    private readonly logger: UpdaterLogger,
  ) {
    if (!bridge.init({ appcastUrl: MACOS_APPCAST_URL, publicEdKey: SPARKLE_ED_PUBLIC_KEY })) {
      throw new Error('Sparkle bridge initialization failed.');
    }
  }

  configureAutomaticUpdates(): void {
    if (this.configured) return;
    this.bridge.setEventHandler((event) => this.handleEvent(event));
    this.bridge.setAutomaticChecks(false);
    this.configured = true;
  }

  checkForUpdates(): Promise<void> {
    this.bridge.checkForUpdates();
    return Promise.resolve();
  }

  quitAndInstall(): void {
    this.bridge.installUpdateNow();
  }

  onCheckingForUpdate(listener: () => void): RemoveUpdaterListener {
    return this.addListener('checking', listener);
  }

  onUpdateAvailable(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener {
    return this.addListener('available', listener);
  }

  onUpdateNotAvailable(listener: () => void): RemoveUpdaterListener {
    return this.addListener('notAvailable', listener);
  }

  onDownloadProgress(listener: (progress: UpdateDownloadProgress) => void): RemoveUpdaterListener {
    return this.addListener('progress', listener);
  }

  onUpdateDownloaded(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener {
    return this.addListener('downloaded', listener);
  }

  onError(listener: (error: Error) => void): RemoveUpdaterListener {
    return this.addListener('error', listener);
  }

  private addListener<K extends ListenerKey>(key: K, listener: ListenerMap[K]): RemoveUpdaterListener {
    this.listeners[key].add(listener);
    return () => this.listeners[key].delete(listener);
  }

  private emit<K extends ListenerKey>(key: K, ...args: Parameters<ListenerMap[K]>): void {
    for (const listener of this.listeners[key]) {
      (listener as (...values: Parameters<ListenerMap[K]>) => void)(...args);
    }
  }

  private versionOrFallback(version: string | undefined): string {
    const normalized = version?.trim();
    return normalized || this.lastAvailableVersion || this.currentVersion;
  }

  private handleEvent(event: SparkleBridgeEvent): void {
    switch (event.type) {
      case 'checking':
        this.emit('checking');
        break;
      case 'update-available': {
        const version = this.versionOrFallback(event.version);
        this.lastAvailableVersion = version;
        this.emit('available', { version });
        break;
      }
      case 'download-progress':
        this.emit('progress', {
          percent: clampPercent(event.percent),
          transferred: numberOrZero(event.transferred),
          total: numberOrZero(event.total),
          bytesPerSecond: 0,
        });
        break;
      case 'update-downloaded': {
        const version = this.versionOrFallback(event.version);
        this.lastAvailableVersion = version;
        this.emit('downloaded', { version });
        break;
      }
      case 'update-not-available':
        this.lastAvailableVersion = null;
        this.emit('notAvailable');
        break;
      case 'error':
        this.emit('error', new Error(event.message?.trim() || 'Sparkle update failed.'));
        break;
      default: {
        const error = new Error(`Unknown Sparkle event type: ${String(event.type)}`);
        this.logger.error(`[sparkle] ${error.message}`);
        this.emit('error', error);
      }
    }
  }
}

function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clampPercent(value: number | undefined): number {
  return Math.min(100, Math.max(0, numberOrZero(value)));
}
