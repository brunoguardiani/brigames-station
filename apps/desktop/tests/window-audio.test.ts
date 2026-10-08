import assert from 'node:assert/strict';
import test from 'node:test';
import { attachWindowAudio } from '../src/app/window-audio.js';

function setup(fail = false, startup?: Promise<void>) {
  let data: ((event: { id: string; pcm: Uint8Array }) => void) | undefined;
  let ended: ((id: string) => void) | undefined;
  let captureID = '';
  let stopped = 0;
  let closed = 0;
  let resumed = 0;
  let failResume = false;
  let failClose = false;
  let failStop = false;
  let nativeStops = 0;
  const audio = { stop: () => { stopped++; } };
  const video = Object.assign(new EventTarget(), { readyState: 'live' });
  const tracks: unknown[] = [];
  const buffers: Float32Array[][] = [];
  const destinations: unknown[] = [];
  const sources: { disconnected: boolean; onended: (() => void) | null }[] = [];
  const destination = { stream: { getAudioTracks: () => [audio], getTracks: () => [audio] } };
  let context!: Context;
  class Context extends EventTarget {
    constructor() { super(); context = this; }
    currentTime = 0;
    state = 'running';
    createMediaStreamDestination() { return destination; }
    async resume() { resumed++; if (failResume) throw new Error('resume failed'); this.state = 'running'; }
    async close() { closed++; if (failClose) throw new Error('close failed'); this.state = 'closed'; }
    createBuffer(_channels: number, frames: number, rate: number) {
      const channels = [new Float32Array(frames), new Float32Array(frames)];
      buffers.push(channels);
      return { getChannelData: (i: number) => channels[i], duration: frames / rate };
    }
    createBufferSource() {
      const source = { buffer: null, disconnected: false, connect: (target: unknown) => destinations.push(target),
        disconnect() { source.disconnected = true; }, stop() { if (failStop) throw new Error('stop failed'); }, start() {}, onended: null };
      sources.push(source);
      return source;
    }
  }
  const api = {
    startWindowAudio: async (_sourceID: string, id: string) => { captureID = id; if (fail) throw new Error('unsupported'); await startup; },
    stopWindowAudio: async (id: string) => { assert.equal(id, captureID); nativeStops++; },
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
    sources,
    advance: (seconds: number) => { context.currentTime += seconds; },
    suspend: () => { context.state = 'suspended'; context.dispatchEvent(new Event('statechange')); },
    resumed: () => resumed,
    nativeStops: () => nativeStops,
    failResume: () => { failResume = true; },
    failCleanup: () => { failClose = true; failStop = true; },
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

test('long capture releases expired buffers even when ended events are delayed', async () => {
  const f = setup();
  try {
    const stop = await attachWindowAudio(f.stream, 'window:123:0', () => {});
    for (let i = 0; i < 1000; i++) {
      f.send(new Uint8Array(1920));
      f.advance(0.04);
    }
    assert.equal(f.sources.filter((source) => !source.disconnected).length, 1);
    stop();
    assert.ok(f.sources.every((source) => source.disconnected && source.onended === null));
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});

test('suspended audio resumes and continues receiving PCM', async () => {
  const f = setup();
  try {
    const stop = await attachWindowAudio(f.stream, 'window:123:0', () => {});
    f.suspend();
    await Promise.resolve();
    f.send(new Uint8Array([0, 128, 0, 64]));
    assert.equal(f.resumed(), 2);
    assert.equal(f.buffers.length, 1);
    stop();
    f.suspend();
    assert.equal(f.resumed(), 2);
    assert.ok(f.cleaned());
  } finally { f.restore(); }
});

test('audio failure followed by stopping sharing releases native capture exactly once', async () => {
  const f = setup();
  let ended = 0;
  try {
    const stop = await attachWindowAudio(f.stream, 'window:123:0', () => { ended++; });
    f.send(new Uint8Array(1920));
    f.failResume();
    f.failCleanup();
    f.suspend();
    await new Promise<void>((resolve) => setImmediate(resolve));
    stop(); stop();
    assert.equal(ended, 1);
    assert.equal(f.nativeStops(), 1);
    assert.ok(f.cleaned());
    assert.ok(f.sources.every((source) => source.disconnected));
    assert.equal(f.tracks.length, 0);
  } finally { f.restore(); }
});
