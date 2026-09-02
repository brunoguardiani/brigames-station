import type { SparkleBridge } from 'electron-sparkle-updater';

import { SparkleAutoUpdaterAdapter } from './sparkle-updater-adapter';
import { AutoUpdaterAdapter, RemoveUpdaterListener, UpdaterLogger } from './updater.types';

interface UpdaterAdapterFactoryDependencies {
  platform?: NodeJS.Platform;
  currentVersion: string;
  logger?: UpdaterLogger;
  loadSparkleBridge?: (log: (message: string) => void) => Promise<SparkleBridge | null>;
  createElectronAdapter?: () => AutoUpdaterAdapter;
}

const consoleLogger: UpdaterLogger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

class FailedAutoUpdaterAdapter implements AutoUpdaterAdapter {
  constructor(private readonly error: Error) {}
  configureAutomaticUpdates(): void { throw this.error; }
  checkForUpdates(): Promise<void> { return Promise.reject(this.error); }
  quitAndInstall(): void { throw this.error; }
  onCheckingForUpdate(): RemoveUpdaterListener { return () => undefined; }
  onUpdateAvailable(): RemoveUpdaterListener { return () => undefined; }
  onUpdateNotAvailable(): RemoveUpdaterListener { return () => undefined; }
  onDownloadProgress(): RemoveUpdaterListener { return () => undefined; }
  onUpdateDownloaded(): RemoveUpdaterListener { return () => undefined; }
  onError(): RemoveUpdaterListener { return () => undefined; }
}

export async function createUpdaterAdapter(
  dependencies: UpdaterAdapterFactoryDependencies,
): Promise<AutoUpdaterAdapter> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'darwin') {
    if (dependencies.createElectronAdapter) return dependencies.createElectronAdapter();
    const { ElectronAutoUpdaterAdapter } = await import('./electron-updater-adapter.js');
    return new ElectronAutoUpdaterAdapter();
  }

  const logger = dependencies.logger ?? consoleLogger;
  try {
    const loadBridge = dependencies.loadSparkleBridge ?? (async (log) => {
      const { loadSparkleBridgeForApp } = await import('electron-sparkle-updater');
      return loadSparkleBridgeForApp(log);
    });
    const bridge = await loadBridge((message) => logger.info(`[sparkle] ${message}`));
    if (!bridge) throw new Error('Sparkle native bridge is unavailable.');
    return new SparkleAutoUpdaterAdapter(bridge, dependencies.currentVersion, logger);
  } catch (error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error));
    logger.error(`[sparkle] ${failure.message}`);
    return new FailedAutoUpdaterAdapter(failure);
  }
}
