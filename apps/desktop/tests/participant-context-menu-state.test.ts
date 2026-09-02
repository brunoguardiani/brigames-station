import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSelectedMediaWhenUnavailable, fitContextMenuPosition, selectedMediaSourceForParticipant } from '../src/app/participant-context-menu-state.js';

test('keeps a context menu beside the cursor when it fits', () => {
  assert.deepEqual(fitContextMenuPosition(100, 80, { width: 240, height: 200 }, { width: 1000, height: 700 }), { x: 100, y: 80 });
});

test('moves a context menu inside the bottom-right viewport edge', () => {
  assert.deepEqual(fitContextMenuPosition(950, 680, { width: 240, height: 200 }, { width: 1000, height: 700 }), { x: 752, y: 492 });
});

test('keeps a context menu inside the top-left viewport margin', () => {
  assert.deepEqual(fitContextMenuPosition(-20, -10, { width: 240, height: 200 }, { width: 1000, height: 700 }), { x: 8, y: 8 });
});

test('shows selected media only beside its selected participant and switches source', () => {
  const screen = { participantID: 20, source: 'screen' as const };
  assert.equal(selectedMediaSourceForParticipant(screen, 20), 'screen');
  assert.equal(selectedMediaSourceForParticipant(screen, 21), null);

  const camera = { participantID: 21, source: 'camera' as const };
  assert.equal(selectedMediaSourceForParticipant(camera, 20), null);
  assert.equal(selectedMediaSourceForParticipant(camera, 21), 'camera');
});

test('clears selected media only when that exact participant source becomes unavailable', () => {
  const selected = { participantID: 20, source: 'screen' as const };
  assert.equal(clearSelectedMediaWhenUnavailable(selected, 20, 'screen'), null);
  assert.deepEqual(clearSelectedMediaWhenUnavailable(selected, 20, 'camera'), selected);
  assert.deepEqual(clearSelectedMediaWhenUnavailable(selected, 21, 'screen'), selected);
});
