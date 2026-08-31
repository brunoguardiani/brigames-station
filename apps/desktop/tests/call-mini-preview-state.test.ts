import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCallMiniPreviewModel, type CallMediaDescriptor } from '../src/app/call-mini-preview-state.js';

const cameraA: CallMediaDescriptor = { id: 'remote:1:camera', kind: 'camera', participantIdentity: '1' };
const cameraB: CallMediaDescriptor = { id: 'remote:2:camera', kind: 'camera', participantIdentity: '2' };
const screen: CallMediaDescriptor = { id: 'remote:2:screen', kind: 'screen', participantIdentity: '2' };

test('stays hidden while the active call view is open', () => {
  assert.deepEqual(deriveCallMiniPreviewModel({
    connected: true, viewingActiveCall: true, reconnecting: false,
    media: [screen], featuredMediaID: null, activeSpeakerIDs: [],
  }), { visible: false, state: 'screen-share', mediaID: screen.id });
});

test('shows a shared screen before cameras while navigating elsewhere', () => {
  assert.deepEqual(deriveCallMiniPreviewModel({
    connected: true, viewingActiveCall: false, reconnecting: false,
    media: [cameraA, screen], featuredMediaID: cameraA.id, activeSpeakerIDs: ['1'],
  }), { visible: true, state: 'screen-share', mediaID: screen.id });
});

test('uses the featured camera, then the active speaker, then a stable camera fallback', () => {
  const base = { connected: true, viewingActiveCall: false, reconnecting: false, media: [cameraA, cameraB] };
  assert.equal(deriveCallMiniPreviewModel({ ...base, featuredMediaID: cameraA.id, activeSpeakerIDs: ['2'] }).mediaID, cameraA.id);
  assert.equal(deriveCallMiniPreviewModel({ ...base, featuredMediaID: null, activeSpeakerIDs: ['2'] }).mediaID, cameraB.id);
  assert.equal(deriveCallMiniPreviewModel({ ...base, featuredMediaID: null, activeSpeakerIDs: [] }).mediaID, cameraA.id);
  assert.deepEqual(
    deriveCallMiniPreviewModel({ ...base, featuredMediaID: null, activeSpeakerIDs: [] }),
    deriveCallMiniPreviewModel({ ...base, featuredMediaID: null, activeSpeakerIDs: [] }),
  );
});

test('falls back to voice, reports reconnecting, and disappears after leaving', () => {
  assert.deepEqual(deriveCallMiniPreviewModel({
    connected: true, viewingActiveCall: false, reconnecting: false,
    media: [], featuredMediaID: null, activeSpeakerIDs: [],
  }), { visible: true, state: 'voice', mediaID: null });
  assert.deepEqual(deriveCallMiniPreviewModel({
    connected: true, viewingActiveCall: false, reconnecting: true,
    media: [cameraA], featuredMediaID: null, activeSpeakerIDs: [],
  }), { visible: true, state: 'reconnecting', mediaID: null });
  assert.equal(deriveCallMiniPreviewModel({
    connected: false, viewingActiveCall: false, reconnecting: false,
    media: [screen], featuredMediaID: null, activeSpeakerIDs: [],
  }).visible, false);
});
