export function displayMediaStreams<T extends { id: string }>(source: T, audioRequested: boolean, platform: string): { video: T; audio?: 'loopback' } {
  // Electron loopback captures all apps, regardless of the video source.
  return { video: source, ...(audioRequested && platform === 'win32' && source.id.startsWith('screen:') ? { audio: 'loopback' as const } : {}) };
}

export function windowHandle(sourceID: string): string {
  const match = /^window:([1-9]\d*):\d+$/.exec(sourceID);
  if (!match || BigInt(match[1]) > 0x7fffffffffffffffn) throw new Error('Invalid window source.');
  return match[1];
}
