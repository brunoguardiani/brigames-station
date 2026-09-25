import assert from 'node:assert/strict';
import test from 'node:test';
import { attachWindowAudio } from '../src/app/window-audio.js';

function setup(fail = false, startup?: Promise<void>) {
  let data: ((event: { id: string; pcm: Uint8Array }) => void) | undefined;
  let ended: ((id: string) => void) | undefined;
  let captureID = '';
  let stopped = 0;
  let closed = 0;
  const audio = { stop: () => { stopped++; } };
  const video = Object.assign(new EventTarget(), { readyState: 'live' });
  const tracks: unknown[] = [];
  const buffers: Float32Array[][] = [];
  const destinations: unknown[] = [];
  const destination = { stream: { getAudioTracks: () => [audio], getTracks: () => [audio] } };
  class Context {
    currentTime = 0;
    createMediaStreamDestination() { return destination; }
    async resume() {}
    async close() { closed++; }
    createBuffer(_channels: number, frames: number, rate: number) {
      const channels = [new Float32Array(frames), new Float32Array(frames)];
      buffers.push(channels);
      return { getChannelData: (i: number) => channels[i], duration: frames / rate };
    }
    createBufferSource() {
      return { buffer: null, connect: (target: unknown) => destinations.push(target), disconnect() {}, stop() {}, start() {}, onended: null };
    }
  }
  const api = {
    startWindowAudio: async (_sourceID: string, id: string) => { captureID = id; if (fail) throw new Error('unsupported'); await startup; },
    stopWindowAudio: async (id: string) => { assert.equal(id, captureID); },
    onWindowAudioData: (callback: typeof data) => { data = callback; return () => { data = undefined; }; },
    onWindowAudioEnded: (callback: typeof ended) => { ended = callback; return () => { ended = undefined; }; },
  };
  const stream = {
    getVideoTracks: () => [video], addTrack: (track: unknown) => tracks.push(track),
    removeTrack: (track: unknown) => { const i = tracks.indexOf(track); if (i >= 0) tracks.splice(i, 1); },
  } as unknown as MediaStream;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { screenShare: api } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  return {
    stream, tracks, buffers, destinations, destination, video,
    send: (pcm: Uint8Array, id = captureID) => data?.({ id, pcm }),
    end: () => ended?.(captureID),
    cleaned: () => !data && !ended && closed === 1 && stopped === 1,
    restore: () => {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
      if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
    },
  };
}

test('selected app PCM becomes a stereo stream without playing through local speakers', async () => {
  const f = setup();
  try {
    const stop = await attachWindowAudio(f.stream, 'window:123:0', () => {});
    assert.equal(f.tracks.length, 1);
    f.send(new Uint8Array([0, 128, 0, 64]), 'another-capture');
    assert.equal(f.buffers.length, 0);
    f.send(new Uint8Array([0, 128, 0, 64]));
    assert.deepEqual(f.buffers[0].map((channel) => channel[0]), [-1, 0.5]);
    assert.deepEqual(f.destinations, [f.destination]);
    stop(); stop();
    assert.equal(f.tracks.length, 0);
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});

test('native startup failure cleans up without adding another audio source', async () => {
  const f = setup(true);
  try {
    await assert.rejects(attachWindowAudio(f.stream, 'window:123:0', () => {}), /unsupported/);
    assert.equal(f.tracks.length, 0);
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});

test('ending video releases the native capture and audio resources', async () => {
  const f = setup();
  try {
    await attachWindowAudio(f.stream, 'window:123:0', () => {});
    f.video.dispatchEvent(new Event('ended'));
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});

test('a native crash removes its audio and notifies the sharing UI once', async () => {
  const f = setup();
  let ended = 0;
  try {
    await attachWindowAudio(f.stream, 'window:123:0', () => { ended++; });
    f.end(); f.end();
    assert.equal(ended, 1);
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});

test('leaving the call during native startup cancels capture before it can publish', async () => {
  let finish!: () => void;
  const startup = new Promise<void>((resolve) => { finish = resolve; });
  const f = setup(false, startup);
  const cancellation = new AbortController();
  try {
    const pending = attachWindowAudio(f.stream, 'window:123:0', () => {}, cancellation.signal);
    await Promise.resolve();
    cancellation.abort();
    finish();
    await assert.rejects(pending, /cancelled/);
    assert.equal(f.tracks.length, 0);
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});
