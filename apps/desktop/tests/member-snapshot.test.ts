import assert from 'node:assert/strict';
import test from 'node:test';
import { MemberSnapshot } from '../src/app/member-snapshot.js';

type Member = { id: number; voice_channel_id: number | null; muted?: boolean; username?: string };
const a: Member = { id: 1, voice_channel_id: 10 };
const b: Member = { id: 2, voice_channel_id: 10 };
const c: Member = { id: 3, voice_channel_id: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('C joins while A and B load the new membership: the late HTTP response retains C in the call', async () => {
  const state = new MemberSnapshot<Member>();
  const response = deferred<Member[]>();
  const refresh = state.load(() => response.promise);
  state.patch(3, { voice_channel_id: 10, muted: true });
  response.resolve([a, b, c]);
  assert.deepEqual(await refresh, [a, b, { ...c, voice_channel_id: 10, muted: true }]);
});
test('multiple events retain the latest state and independent profile changes', async () => {
  const state = new MemberSnapshot<Member>();
  const response = deferred<Member[]>();
  const refresh = state.load(() => response.promise);
  state.patch(3, { voice_channel_id: 10, muted: true });
  state.patch(3, { username: 'C' });
  state.patch(3, { voice_channel_id: null, muted: false });
  response.resolve([a, b, c]);
  assert.deepEqual((await refresh)[2], { ...c, username: 'C', muted: false });
});
test('overlapping requests both preserve events received while pending', async () => {
  const state = new MemberSnapshot<Member>();
  const first = deferred<Member[]>();
  const second = deferred<Member[]>();
  const one = state.load(() => first.promise);
  const two = state.load(() => second.promise);
  state.patch(3, { voice_channel_id: 10 });
  second.resolve([c]); first.resolve([c]);
  assert.deepEqual(await one, await two);
});
test('completed or failed requests do not retain obsolete events for later snapshots', async () => {
  const state = new MemberSnapshot<Member>();
  await assert.rejects(state.load(async () => { state.patch(3, { voice_channel_id: 10 }); throw new Error('offline'); }));
  assert.deepEqual(await state.load(async () => [c]), [c]);
});
