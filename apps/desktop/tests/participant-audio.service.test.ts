import assert from 'node:assert/strict';
import test from 'node:test';
import { ParticipantAudioService, type ParticipantAudioPreference, type ParticipantAudioPreferences } from '../src/app/participant-audio.service.js';

type TestAudio = { volume: number; setSinkId(deviceID: string): Promise<void> };

function audio(): TestAudio { return { volume: 1, setSinkId: async () => undefined }; }

function storage(initial: ParticipantAudioPreferences = {}) {
  const saved: ParticipantAudioPreferences = structuredClone(initial);
  return {
    saved,
    adapter: {
      load: async () => structuredClone(saved),
      save: async (userID: string, preference: ParticipantAudioPreference | null) => {
        if (preference) saved[userID] = structuredClone(preference);
        else delete saved[userID];
      },
    },
  };
}

test('starts unknown participants at 100% and changes only the selected participant', () => {
  const state = storage();
  const service = new ParticipantAudioService(state.adapter);
  const joao = audio(); const pedro = audio();
  service.register('1', joao); service.register('2', pedro);
  service.setVolume('1', .4);
  assert.equal(joao.volume, .4);
  assert.equal(pedro.volume, 1);
  assert.deepEqual(service.getPreference('2'), { volume: 1, muted: false });
});

test('supports zero volume and local mute without changing the stored volume', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const joao = audio(); service.register('1', joao);
  service.setVolume('1', 0); assert.equal(joao.volume, 0);
  service.setVolume('1', .65); service.setMuted('1', true);
  assert.equal(joao.volume, 0);
  assert.deepEqual(service.getPreference('1'), { volume: .65, muted: true });
  service.setMuted('1', false); assert.equal(joao.volume, .65);
});

test('reapplies a preference when a participant or track returns', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const firstTrack = audio(); service.register('1', firstTrack); service.setVolume('1', .35);
  service.unregister('1', firstTrack);
  const replacementTrack = audio(); service.register('1', replacementTrack);
  assert.equal(replacementTrack.volume, .35);
});

test('restores preferences across application sessions and resets to defaults', async () => {
  const state = storage();
  const firstSession = new ParticipantAudioService(state.adapter, () => undefined, 0);
  firstSession.setVolume('1', .45); firstSession.setMuted('1', true);
  await firstSession.flushPersistence();
  const secondSession = new ParticipantAudioService(state.adapter);
  await secondSession.restore();
  const restoredTrack = audio(); secondSession.register('1', restoredTrack);
  assert.equal(restoredTrack.volume, 0);
  assert.deepEqual(secondSession.getPreference('1'), { volume: .45, muted: true });
  secondSession.reset('1');
  assert.equal(restoredTrack.volume, 1);
  assert.deepEqual(secondSession.getPreference('1'), { volume: 1, muted: false });
});

test('keeps the same local mix while the UI navigates or enters mini preview', () => {
  const service = new ParticipantAudioService(storage().adapter);
  const track = audio(); service.register('1', track); service.setVolume('1', .3);
  // Navigation and Picture-in-Picture do not unregister or recreate call audio.
  assert.equal(track.volume, .3);
  assert.equal(track.volume, service.getPreference('1').volume);
});
