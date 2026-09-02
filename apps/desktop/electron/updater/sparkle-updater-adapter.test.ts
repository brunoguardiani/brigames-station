import assert from 'node:assert/strict';
import test from 'node:test';

import type { SparkleBridge, SparkleBridgeEvent } from 'electron-sparkle-updater';

import { SparkleAutoUpdaterAdapter } from './sparkle-updater-adapter';

class FakeSparkleBridge implements SparkleBridge {
  initCalls = 0;
  handlerCalls = 0;
  checks = 0;
  installs = 0;
  automaticChecks: boolean[] = [];
  handler: ((event: SparkleBridgeEvent) => void) | null = null;
  initResult = true;

  init(): boolean { this.initCalls += 1; return this.initResult; }
  checkForUpdates(): void { this.checks += 1; }
  installUpdateNow(): void { this.installs += 1; }
  setAutomaticChecks(enabled: boolean): void { this.automaticChecks.push(enabled); }
  setEventHandler(handler: (event: SparkleBridgeEvent) => void): void {
    this.handlerCalls += 1;
    this.handler = handler;
  }
  emit(event: SparkleBridgeEvent): void { this.handler?.(event); }
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

test('maps every Sparkle lifecycle event and normalizes optional values', () => {
  const bridge = new FakeSparkleBridge();
  const adapter = new SparkleAutoUpdaterAdapter(bridge, '1.0.0', logger);
  const received: unknown[] = [];

  adapter.onCheckingForUpdate(() => received.push('checking'));
  adapter.onUpdateAvailable((update) => received.push(update));
  adapter.onDownloadProgress((progress) => received.push(progress));
  adapter.onUpdateDownloaded((update) => received.push(update));
  adapter.onUpdateNotAvailable(() => received.push('not-available'));
  adapter.onError((error) => received.push(error.message));
  adapter.configureAutomaticUpdates();

  bridge.emit({ type: 'checking' });
  bridge.emit({ type: 'update-available', version: ' 2.0.0 ' });
  bridge.emit({ type: 'download-progress', percent: 150 });
  bridge.emit({ type: 'update-downloaded', version: ' ' });
  bridge.emit({ type: 'update-not-available' });
  bridge.emit({ type: 'error' });
  bridge.emit({ type: 'future-event' });

  assert.deepEqual(received, [
    'checking',
    { version: '2.0.0' },
    { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
    { version: '2.0.0' },
    'not-available',
    'Sparkle update failed.',
    'Unknown Sparkle event type: future-event',
  ]);
  assert.equal(bridge.initCalls, 1);
  assert.deepEqual(bridge.automaticChecks, [false]);
});

test('registers one bridge handler and unsubscribe stops delivery', () => {
  const bridge = new FakeSparkleBridge();
  const adapter = new SparkleAutoUpdaterAdapter(bridge, '1.0.0', logger);
  let first = 0;
  let second = 0;
  const unsubscribe = adapter.onCheckingForUpdate(() => { first += 1; });
  adapter.onCheckingForUpdate(() => { second += 1; });

  adapter.configureAutomaticUpdates();
  adapter.configureAutomaticUpdates();
  bridge.emit({ type: 'checking' });
  unsubscribe();
  bridge.emit({ type: 'checking' });

  assert.equal(bridge.handlerCalls, 1);
  assert.equal(first, 1);
  assert.equal(second, 2);
});

test('check and install invoke the native bridge once', async () => {
  const bridge = new FakeSparkleBridge();
  const adapter = new SparkleAutoUpdaterAdapter(bridge, '1.0.0', logger);
  await adapter.checkForUpdates();
  adapter.quitAndInstall();
  assert.equal(bridge.checks, 1);
  assert.equal(bridge.installs, 1);
});

test('throws when Sparkle init fails', () => {
  const bridge = new FakeSparkleBridge();
  bridge.initResult = false;
  assert.throws(() => new SparkleAutoUpdaterAdapter(bridge, '1.0.0', logger), /initialization failed/);
});
