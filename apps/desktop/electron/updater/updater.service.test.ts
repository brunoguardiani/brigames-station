import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopUpdaterService } from './updater.service';
import {
  AutoUpdaterAdapter,
  AvailableUpdate,
  DesktopUpdaterStatus,
  RemoveUpdaterListener,
  UpdateDownloadProgress,
} from './updater.types';

class FakeAutoUpdaterAdapter implements AutoUpdaterAdapter {
  configured = false;
  checks = 0;
  installs = 0;
  failCheckWith: Error | null = null;
  private checkingListener: (() => void) | null = null;
  private availableListener: ((update: AvailableUpdate) => void) | null = null;
  private notAvailableListener: (() => void) | null = null;
  private progressListener: ((progress: UpdateDownloadProgress) => void) | null = null;
  private downloadedListener: ((update: AvailableUpdate) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  configureAutomaticUpdates(): void {
    this.configured = true;
  }

  async checkForUpdates(): Promise<void> {
    this.checks += 1;
    if (this.failCheckWith) throw this.failCheckWith;
  }

  quitAndInstall(): void {
    this.installs += 1;
  }

  onCheckingForUpdate(listener: () => void): RemoveUpdaterListener {
    this.checkingListener = listener;
    return () => { this.checkingListener = null; };
  }

  onUpdateAvailable(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener {
    this.availableListener = listener;
    return () => { this.availableListener = null; };
  }

  onUpdateNotAvailable(listener: () => void): RemoveUpdaterListener {
    this.notAvailableListener = listener;
    return () => { this.notAvailableListener = null; };
  }

  onDownloadProgress(listener: (progress: UpdateDownloadProgress) => void): RemoveUpdaterListener {
    this.progressListener = listener;
    return () => { this.progressListener = null; };
  }

  onUpdateDownloaded(listener: (update: AvailableUpdate) => void): RemoveUpdaterListener {
    this.downloadedListener = listener;
    return () => { this.downloadedListener = null; };
  }

  onError(listener: (error: Error) => void): RemoveUpdaterListener {
    this.errorListener = listener;
    return () => { this.errorListener = null; };
  }

  emitAvailable(version: string): void {
    this.availableListener?.({ version });
  }

  emitChecking(): void {
    this.checkingListener?.();
  }

  emitNotAvailable(): void {
    this.notAvailableListener?.();
  }

  emitProgress(progress: UpdateDownloadProgress): void {
    this.progressListener?.(progress);
  }

  emitDownloaded(version: string): void {
    this.downloadedListener?.({ version });
  }
}

function createService(isPackaged: boolean): {
  adapter: FakeAutoUpdaterAdapter;
  service: DesktopUpdaterService;
  statuses: DesktopUpdaterStatus[];
} {
  const adapter = new FakeAutoUpdaterAdapter();
  const statuses: DesktopUpdaterStatus[] = [];
  const service = new DesktopUpdaterService({
    adapter,
    isPackaged,
    currentVersion: '1.0.7',
    publishStatus: (status) => statuses.push(status),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    initialCheckDelayMs: 60_000,
    periodicCheckIntervalMs: null,
  });
  return { adapter, service, statuses };
}

test('does not contact the update provider in development', async () => {
  const { adapter, service } = createService(false);
  service.start();

  assert.equal(service.getStatus().state, 'disabled');
  await service.checkForUpdates();
  assert.equal(adapter.checks, 0);
  assert.equal(adapter.configured, false);
  service.stop();
});

test('publishes the download lifecycle and installs only after download', async () => {
  const { adapter, service, statuses } = createService(true);
  service.start();

  assert.equal(service.installDownloadedUpdate(), false);
  adapter.emitAvailable('1.1.0');
  adapter.emitProgress({ percent: 45.5, transferred: 455, total: 1_000, bytesPerSecond: 50 });
  adapter.emitDownloaded('1.1.0');

  assert.deepEqual(statuses.map((status) => status.state), [
    'update-available',
    'download-progress',
    'update-downloaded',
  ]);
  assert.equal(service.installDownloadedUpdate(), true);
  assert.equal(adapter.installs, 1);
  await service.checkForUpdates('manual');
  assert.equal(adapter.checks, 0);
  service.stop();
});

test('publishes checking and up-to-date states', () => {
  const { adapter, service, statuses } = createService(true);
  service.start();

  adapter.emitChecking();
  adapter.emitNotAvailable();

  assert.deepEqual(statuses.map((status) => status.state), [
    'checking-for-update',
    'update-not-available',
  ]);
  service.stop();
});

test('converts provider failures into a safe public error state', async () => {
  const { adapter, service } = createService(true);
  adapter.failCheckWith = new Error('request failed?token=do-not-expose');
  service.start();

  const status = await service.checkForUpdates();
  assert.equal(status.state, 'error');
  if (status.state === 'error') {
    assert.equal(status.message.includes('do-not-expose'), false);
  }
  service.stop();
});
