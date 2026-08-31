import {
  AutoUpdaterAdapter,
  DesktopUpdaterStatus,
  RemoveUpdaterListener,
  UpdaterLogger,
} from './updater.types';

const DEFAULT_INITIAL_CHECK_DELAY_MS = 10_000;
const DEFAULT_PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const PUBLIC_ERROR_MESSAGE = 'Nao foi possivel verificar ou baixar a atualizacao.';

export interface DesktopUpdaterServiceOptions {
  adapter: AutoUpdaterAdapter;
  isPackaged: boolean;
  currentVersion: string;
  publishStatus: (status: DesktopUpdaterStatus) => void;
  logger?: UpdaterLogger;
  initialCheckDelayMs?: number;
  /** Pass null to disable periodic checks (useful in deterministic tests). */
  periodicCheckIntervalMs?: number | null;
}

const consoleLogger: UpdaterLogger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function safeMilliseconds(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function safeNonNegativeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safePercent(value: number): number {
  return Math.min(100, safeNonNegativeNumber(value));
}

function safeVersion(version: string | undefined, fallback: string): string {
  const candidate = version?.trim();
  return candidate ? candidate : fallback;
}

function errorMessageForLog(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/([?&](?:access_token|token|key|secret)=)[^&\s]+/gi, '$1***');
}

export class DesktopUpdaterService {
  private readonly adapter: AutoUpdaterAdapter;
  private readonly isPackaged: boolean;
  private readonly currentVersion: string;
  private readonly publishStatus: (status: DesktopUpdaterStatus) => void;
  private readonly logger: UpdaterLogger;
  private readonly initialCheckDelayMs: number;
  private readonly periodicCheckIntervalMs: number | null;
  private status: DesktopUpdaterStatus;
  private availableVersion: string | null = null;
  private started = false;
  private checkInFlight: Promise<DesktopUpdaterStatus> | null = null;
  private initialCheckTimer: NodeJS.Timeout | null = null;
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private removeAdapterListeners: RemoveUpdaterListener[] = [];

  constructor(options: DesktopUpdaterServiceOptions) {
    this.adapter = options.adapter;
    this.isPackaged = options.isPackaged;
    this.currentVersion = options.currentVersion;
    this.publishStatus = options.publishStatus;
    this.logger = options.logger ?? consoleLogger;
    this.initialCheckDelayMs = safeMilliseconds(
      options.initialCheckDelayMs,
      DEFAULT_INITIAL_CHECK_DELAY_MS,
    );
    this.periodicCheckIntervalMs = options.periodicCheckIntervalMs === null
      ? null
      : safeMilliseconds(options.periodicCheckIntervalMs, DEFAULT_PERIODIC_CHECK_INTERVAL_MS);
    this.status = { state: 'idle', currentVersion: this.currentVersion };
  }

  getStatus(): DesktopUpdaterStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.isPackaged) {
      this.logger.info('[updater] automatic checks disabled in development');
      this.setStatus({ state: 'disabled', currentVersion: this.currentVersion, reason: 'development' });
      return;
    }

    try {
      this.adapter.configureAutomaticUpdates();
      this.attachAdapterListeners();
    } catch (error: unknown) {
      this.reportError(error);
      return;
    }

    this.logger.info(`[updater] initialized for version ${this.currentVersion}`);
    this.initialCheckTimer = setTimeout(() => {
      void this.checkForUpdates('automatic');
    }, this.initialCheckDelayMs);
    this.initialCheckTimer.unref();

    if (this.periodicCheckIntervalMs !== null && this.periodicCheckIntervalMs > 0) {
      this.periodicCheckTimer = setInterval(() => {
        void this.checkForUpdates('periodic');
      }, this.periodicCheckIntervalMs);
      this.periodicCheckTimer.unref();
    }
  }

  stop(): void {
    if (this.initialCheckTimer) clearTimeout(this.initialCheckTimer);
    if (this.periodicCheckTimer) clearInterval(this.periodicCheckTimer);
    this.initialCheckTimer = null;
    this.periodicCheckTimer = null;
    for (const removeListener of this.removeAdapterListeners.splice(0)) removeListener();
    this.started = false;
  }

  checkForUpdates(source: 'automatic' | 'periodic' | 'manual' = 'manual'): Promise<DesktopUpdaterStatus> {
    if (!this.started) this.start();

    if (!this.isPackaged) return Promise.resolve(this.getStatus());
    if (this.status.state === 'update-downloaded') return Promise.resolve(this.getStatus());
    if (this.checkInFlight) return this.checkInFlight;

    this.logger.info(`[updater] checking for updates (${source})`);
    this.setStatus({ state: 'checking-for-update', currentVersion: this.currentVersion });
    this.checkInFlight = this.adapter.checkForUpdates()
      .catch((error: unknown) => {
        this.reportError(error);
      })
      .then(() => this.getStatus())
      .finally(() => {
        this.checkInFlight = null;
      });
    return this.checkInFlight;
  }

  installDownloadedUpdate(): boolean {
    if (this.status.state !== 'update-downloaded') {
      this.logger.warn('[updater] install ignored because no update is downloaded');
      return false;
    }

    try {
      this.logger.info(`[updater] installing version ${this.status.version}`);
      this.adapter.quitAndInstall();
      return true;
    } catch (error: unknown) {
      this.reportError(error);
      return false;
    }
  }

  private attachAdapterListeners(): void {
    this.removeAdapterListeners = [
      this.adapter.onCheckingForUpdate(() => {
        this.setStatus({ state: 'checking-for-update', currentVersion: this.currentVersion });
      }),
      this.adapter.onUpdateAvailable((update) => {
        const version = safeVersion(update.version, this.currentVersion);
        this.availableVersion = version;
        this.logger.info(`[updater] version ${version} is available; download started`);
        this.setStatus({ state: 'update-available', currentVersion: this.currentVersion, version });
      }),
      this.adapter.onUpdateNotAvailable(() => {
        this.availableVersion = null;
        this.logger.info('[updater] application is up to date');
        this.setStatus({ state: 'update-not-available', currentVersion: this.currentVersion });
      }),
      this.adapter.onDownloadProgress((progress) => {
        const version = this.availableVersion ?? this.currentVersion;
        const percent = safePercent(progress.percent);
        this.logger.info(`[updater] download progress ${percent.toFixed(1)}%`);
        this.setStatus({
          state: 'download-progress',
          currentVersion: this.currentVersion,
          version,
          percent,
          transferred: safeNonNegativeNumber(progress.transferred),
          total: safeNonNegativeNumber(progress.total),
          bytesPerSecond: safeNonNegativeNumber(progress.bytesPerSecond),
        });
      }),
      this.adapter.onUpdateDownloaded((update) => {
        const version = safeVersion(update.version, this.availableVersion ?? this.currentVersion);
        this.availableVersion = version;
        this.logger.info(`[updater] version ${version} downloaded and ready to install`);
        this.setStatus({ state: 'update-downloaded', currentVersion: this.currentVersion, version });
      }),
      this.adapter.onError((error) => this.reportError(error)),
    ];
  }

  private reportError(error: unknown): void {
    this.logger.error(`[updater] ${errorMessageForLog(error)}`);
    this.setStatus({
      state: 'error',
      currentVersion: this.currentVersion,
      message: PUBLIC_ERROR_MESSAGE,
    });
  }

  private setStatus(status: DesktopUpdaterStatus): void {
    this.status = status;
    try {
      this.publishStatus(this.getStatus());
    } catch (error: unknown) {
      this.logger.warn(`[updater] could not publish status: ${errorMessageForLog(error)}`);
    }
  }
}
