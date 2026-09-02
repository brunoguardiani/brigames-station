export type ParticipantContextMenuState = {
  participantID: number;
  channelID: number;
  x: number;
  y: number;
};

export type SelectedMediaSource = 'camera' | 'screen';
export type SelectedParticipantMedia = { participantID: number; source: SelectedMediaSource };

export function selectedMediaSourceForParticipant(selected: SelectedParticipantMedia | null, participantID: number): SelectedMediaSource | null {
  return selected?.participantID === participantID ? selected.source : null;
}

export function clearSelectedMediaWhenUnavailable(selected: SelectedParticipantMedia | null, participantID: number, source: SelectedMediaSource): SelectedParticipantMedia | null {
  return selected?.participantID === participantID && selected.source === source ? null : selected;
}

export type ViewportSize = { width: number; height: number };
export type MenuSize = { width: number; height: number };

export function fitContextMenuPosition(
  x: number,
  y: number,
  menu: MenuSize,
  viewport: ViewportSize,
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(x, viewport.width - menu.width - margin)),
    y: Math.max(margin, Math.min(y, viewport.height - menu.height - margin)),
  };
}
