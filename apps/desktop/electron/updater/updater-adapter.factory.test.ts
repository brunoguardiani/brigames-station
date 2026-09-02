import assert from 'node:assert/strict';
import test from 'node:test';

import type { SparkleBridge } from 'electron-sparkle-updater';

import { SparkleAutoUpdaterAdapter } from './sparkle-updater-adapter';
import { createUpdaterAdapter } from './updater-adapter.factory';
import { AutoUpdaterAdapter } from './updater.types';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function fakeBridge(initResult = true): SparkleBridge {
  return {
    init: () => initResult,
    checkForUpdates: () => undefined,
    installUpdateNow: () => undefined,
    setAutomaticChecks: () => undefined,
    setEventHandler: () => undefined,
  };
}

test('selects Sparkle on macOS', async () => {
  const adapter = await createUpdaterAdapter({
    platform: 'darwin',
    currentVersion: '1.0.0',
    logger,
    loadSparkleBridge: async () => fakeBridge(),
  });
  assert.ok(adapter instanceof SparkleAutoUpdaterAdapter);
});

test('selects electron-updater outside macOS without loading Sparkle', async () => {
  let sparkleLoads = 0;
  const expected = {} as AutoUpdaterAdapter;
  const adapter = await createUpdaterAdapter({
    platform: 'linux',
    currentVersion: '1.0.0',
    loadSparkleBridge: async () => { sparkleLoads += 1; return fakeBridge(); },
    createElectronAdapter: () => expected,
  });
  assert.equal(adapter, expected);
  assert.equal(sparkleLoads, 0);
});

test('a null bridge and failed init both fail closed', async () => {
  for (const bridge of [null, fakeBridge(false)]) {
    const adapter = await createUpdaterAdapter({
      platform: 'darwin',
      currentVersion: '1.0.0',
      logger,
      loadSparkleBridge: async () => bridge,
    });
    assert.throws(() => adapter.configureAutomaticUpdates());
  }
});
