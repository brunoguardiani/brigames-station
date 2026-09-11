import assert from 'node:assert/strict';
import test from 'node:test';
import { ParticipantAudioService, type ParticipantAudioPreference, type ParticipantAudioPreferencesBySource, type ParticipantAudioSource } from '../src/app/participant-audio.service.js';

type TestAudio = { volume: number; setSinkId(deviceID: string): Promise<void> };

function audio(): TestAudio { return { volume: 1, setSinkId: async () => undefined }; }

function storage(initial: Partial<ParticipantAudioPreferencesBySource> = {}) {
  const saved: ParticipantAudioPreferencesBySource = structuredClone({ microphone: initial.microphone ?? {}, 'screen-share': initial['screen-share'] ?? {} });
  const writes: Array<{ userID: string; source: ParticipantAudioSource; preference: ParticipantAudioPreference | null }> = [];
  return {
    saved, writes,
    adapter: {
      load: async () => structuredClone(saved),
      save: async (userID: string, source: ParticipantAudioSource, preference: ParticipantAudioPreference | null) => {
        writes.push({ userID, source, preference: structuredClone(preference) });
        if (preference) saved[source][userID] = structuredClone(preference);
        else delete saved[source][userID];
      },
    },
  };
}

test('starts unknown participants at 100% and changes only the selected participant', () => {
  const state = storage();
  const service = new ParticipantAudioService(state.adapter);
  const joao = audio(); const pedro = audio();
  service.register('1', 'screen-share', joao); service.register('2', 'screen-share', pedro);
  service.setVolume('1', 'screen-share', .4);
  assert.equal(joao.volume, .4);
  assert.equal(pedro.volume, 1);
  assert.deepEqual(service.getPreference('2', 'screen-share'), { volume: 1, muted: false });
});

test('supports zero volume and local mute without changing the stored volume', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const joao = audio(); service.register('1', 'screen-share', joao);
  service.setVolume('1', 'screen-share', 0); assert.equal(joao.volume, 0);
  service.setVolume('1', 'screen-share', .65); service.setMuted('1', 'screen-share', true);
  assert.equal(joao.volume, 0);
  assert.deepEqual(service.getPreference('1', 'screen-share'), { volume: .65, muted: true });
  service.setMuted('1', 'screen-share', false); assert.equal(joao.volume, .65);
});

test('reapplies a preference when a participant or track returns', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const firstTrack = audio(); service.register('1', 'screen-share', firstTrack); service.setVolume('1', 'screen-share', .35);
  service.unregister('1', 'screen-share', firstTrack);
  const replacementTrack = audio(); service.register('1', 'screen-share', replacementTrack);
  assert.equal(replacementTrack.volume, .35);
});

test('restores preferences across application sessions and resets to defaults', async () => {
  const state = storage();
  const firstSession = new ParticipantAudioService(state.adapter, () => undefined, 0);
  firstSession.setVolume('1', 'screen-share', .45); firstSession.setMuted('1', 'screen-share', true);
  await firstSession.flushPersistence();
  const secondSession = new ParticipantAudioService(state.adapter);
  await secondSession.restore();
  const restoredTrack = audio(); secondSession.register('1', 'screen-share', restoredTrack);
  assert.equal(restoredTrack.volume, 0);
  assert.deepEqual(secondSession.getPreference('1', 'screen-share'), { volume: .45, muted: true });
  secondSession.reset('1', 'screen-share');
  assert.equal(restoredTrack.volume, 1);
  assert.deepEqual(secondSession.getPreference('1', 'screen-share'), { volume: 1, muted: false });
});

test('keeps the same local mix while the UI navigates or enters mini preview', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const track = audio(); service.register('1', 'screen-share', track); service.setVolume('1', 'screen-share', .3);
  // Navigation and Picture-in-Picture do not unregister or recreate call audio.
  assert.equal(track.volume, .3);
  assert.equal(track.volume, service.getPreference('1', 'screen-share').volume);
});

test('keeps microphone and screen-share preferences independent for the same participant', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const microphone = audio(); const screenShare = audio();
  service.register('1', 'microphone', microphone);
  service.register('1', 'screen-share', screenShare);
  service.setVolume('1', 'microphone', .8);
  service.setVolume('1', 'screen-share', .25);
  assert.equal(microphone.volume, .8);
  assert.equal(screenShare.volume, .25);
  service.setMuted('1', 'screen-share', true);
  assert.equal(screenShare.volume, 0);
  assert.equal(microphone.volume, .8);
});

test('keeps each viewer local by storing preferences in separate service instances', () => {
  const viewerB = new ParticipantAudioService(storage().adapter);
  const viewerC = new ParticipantAudioService(storage().adapter);
  const audioForB = audio(); const audioForC = audio();
  viewerB.register('1', 'screen-share', audioForB);
  viewerC.register('1', 'screen-share', audioForC);
  viewerB.setVolume('1', 'screen-share', .2);
  viewerC.setVolume('1', 'screen-share', .8);
  assert.equal(audioForB.volume, .2);
  assert.equal(audioForC.volume, .8);
});

test('restores the correct saved preference when switching transmitters', async () => {
  const state = storage({ 'screen-share': { '1': { volume: .4, muted: false }, '2': { volume: .7, muted: false } } });
  const service = new ParticipantAudioService(state.adapter);
  await service.restore();
  const first = audio(); const second = audio();
  service.register('1', 'screen-share', first);
  service.register('2', 'screen-share', second);
  assert.equal(first.volume, .4);
  assert.equal(second.volume, .7);
});

test('applies output changes to both sources without merging their preferences', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const microphone = audio(); const screenShare = audio();
  service.register('1', 'microphone', microphone);
  service.register('1', 'screen-share', screenShare);
  service.setVolume('1', 'microphone', .8);
  service.setVolume('1', 'screen-share', .25);
  service.setOutput(.5, null);
  assert.equal(microphone.volume, .4);
  assert.equal(screenShare.volume, .125);
  assert.deepEqual(service.getPreference('1', 'microphone'), { volume: .8, muted: false });
  assert.deepEqual(service.getPreference('1', 'screen-share'), { volume: .25, muted: false });
});

test('applies rapid slider changes immediately and persists only the latest value', async () => {
  const state = storage();
  const service = new ParticipantAudioService(state.adapter, () => undefined, 60_000);
  const track = audio();
  service.register('1', 'screen-share', track);
  service.setVolume('1', 'screen-share', .1); assert.equal(track.volume, .1);
  service.setVolume('1', 'screen-share', .5); assert.equal(track.volume, .5);
  service.setVolume('1', 'screen-share', .9); assert.equal(track.volume, .9);
  assert.equal(state.writes.length, 0);
  await service.flushPersistence();
  assert.deepEqual(state.writes, [{ userID: '1', source: 'screen-share', preference: { volume: .9, muted: false } }]);
});
