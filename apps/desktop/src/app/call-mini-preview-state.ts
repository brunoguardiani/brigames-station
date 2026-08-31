export type CallMediaKind = 'camera' | 'screen';

export type CallMediaDescriptor = {
  id: string;
  kind: CallMediaKind;
  participantIdentity: string;
};

export type CallMiniPreviewState = 'screen-share' | 'camera' | 'voice' | 'reconnecting';

export type CallMiniPreviewModel = {
  visible: boolean;
  state: CallMiniPreviewState;
  mediaID: string | null;
};

export type CallMiniPreviewInput = {
  connected: boolean;
  viewingActiveCall: boolean;
  reconnecting: boolean;
  media: readonly CallMediaDescriptor[];
  featuredMediaID: string | null;
  activeSpeakerIDs: readonly string[];
};

export function deriveCallMiniPreviewModel(input: CallMiniPreviewInput): CallMiniPreviewModel {
  const visible = input.connected && !input.viewingActiveCall;
  if (input.reconnecting) return { visible, state: 'reconnecting', mediaID: null };

  const featured = input.media.find((media) => media.id === input.featuredMediaID);
  const screen = featured?.kind === 'screen'
    ? featured
    : input.media.find((media) => media.kind === 'screen');
  if (screen) return { visible, state: 'screen-share', mediaID: screen.id };

  const camera = featured?.kind === 'camera'
    ? featured
    : input.media.find((media) => media.kind === 'camera' && input.activeSpeakerIDs.includes(media.participantIdentity))
      ?? input.media.find((media) => media.kind === 'camera');
  if (camera) return { visible, state: 'camera', mediaID: camera.id };

  return { visible, state: 'voice', mediaID: null };
}
