import assert from 'node:assert/strict';
import test from 'node:test';
import { WindowAudioDelivery } from './window-audio-delivery';

test('a stalled renderer receives only one PCM packet until it consumes it', () => {
  const sent: number[] = [];
  const delivery = new WindowAudioDelivery((_pcm, sequence) => sent.push(sequence), (error) => assert.fail(String(error)));
  const pcm = new Uint8Array(1920);
  for (let i = 0; i < 100_000; i++) delivery.deliver(pcm);
  assert.deepEqual(sent, [1]);
  delivery.acknowledge(1);
  delivery.deliver(pcm);
  assert.deepEqual(sent, [1, 2]);
});

test('stale and invalid acknowledgements cannot release the current packet', () => {
  let sent = 0;
  const delivery = new WindowAudioDelivery(() => { sent++; }, (error) => assert.fail(String(error)));
  const pcm = new Uint8Array(1920);
  delivery.deliver(pcm);
  delivery.acknowledge(1);
  delivery.deliver(pcm);
  for (const ack of [1, '2', 3, null, undefined]) {
    delivery.acknowledge(ack);
    delivery.deliver(pcm);
  }
  assert.equal(sent, 2);
  delivery.acknowledge(2);
  delivery.deliver(pcm);
  assert.equal(sent, 3);
});

test('stopping a stalled capture ignores late consumption and further PCM', () => {
  let sent = 0;
  const delivery = new WindowAudioDelivery(() => { sent++; }, (error) => assert.fail(String(error)));
  delivery.deliver(new Uint8Array(1920));
  delivery.stop(); delivery.stop();
  delivery.acknowledge(1);
  delivery.deliver(new Uint8Array(1920));
  assert.equal(sent, 1);
});

test('renderer send failure stops delivery and reports failure only once', () => {
  const error = new Error('Renderer is unavailable');
  const failures: unknown[] = [];
  const delivery = new WindowAudioDelivery(() => { throw error; }, (failure) => failures.push(failure));
  assert.doesNotThrow(() => delivery.deliver(new Uint8Array(1920)));
  delivery.acknowledge(1);
  delivery.deliver(new Uint8Array(1920));
  assert.deepEqual(failures, [error]);
});

test('rejects empty, partial frames and packets larger than 250 ms of stereo PCM', () => {
  const sent: number[] = [];
  const delivery = new WindowAudioDelivery((pcm) => sent.push(pcm.byteLength), (error) => assert.fail(String(error)));
  for (const size of [0, 1, 3, 48_004]) delivery.deliver(new Uint8Array(size));
  delivery.deliver(new Uint8Array(48_000));
  assert.deepEqual(sent, [48_000]);
});
