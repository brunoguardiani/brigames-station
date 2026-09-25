import assert from 'node:assert/strict';
import test from 'node:test';
import { displayMediaStreams, windowHandle } from './display-media';

test('a window can never grant system loopback, even if audio was requested', () => {
  const source = { id: 'window:123:0' };
  for (const platform of ['win32', 'linux', 'darwin']) {
    assert.deepEqual(displayMediaStreams(source, true, platform), { video: source });
  }
});
test('full-screen loopback requires both Windows and an explicit audio request', () => {
  const source = { id: 'screen:0:0' };
  assert.equal(displayMediaStreams(source, true, 'win32').audio, 'loopback');
  assert.equal(displayMediaStreams(source, false, 'win32').audio, undefined);
  assert.equal(displayMediaStreams(source, true, 'linux').audio, undefined);
});
test('resolves an exact HWND and rejects screens, zero and command text', () => {
  assert.equal(windowHandle('window:123456:0'), '123456');
  for (const source of ['screen:123:0', 'window:0:0', 'window:1;exit:0', 'window:-1:0', 'window:99999999999999999999999:0']) {
    assert.throws(() => windowHandle(source));
  }
});
