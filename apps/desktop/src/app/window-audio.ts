// Native capture produces stereo signed 16-bit PCM at 48 kHz. Schedule a small
// bounded queue into a MediaStream destination; never connect to local speakers.
export async function attachWindowAudio(stream: MediaStream, sourceID: string, onEnded: () => void, signal?: AbortSignal): Promise<() => void> {
  const id = crypto.randomUUID();
  const context = new AudioContext({ sampleRate: 48_000 });
  const destination = context.createMediaStreamDestination();
  const playing = new Map<AudioBufferSourceNode, number>();
  let nextTime = 0;
  let stopped = false;
  let resuming = false;
  const releaseSource = (source: AudioBufferSourceNode): void => {
    playing.delete(source);
    source.onended = null;
    try { source.stop(); } catch { /* A failed/ended source must not interrupt capture cleanup. */ }
    source.disconnect();
  };
  const resumeAudio = (): void => {
    if (stopped || resuming || context.state !== 'suspended') return;
    resuming = true;
    void context.resume().catch(() => {
      if (!stopped) { cleanup(); onEnded(); }
    }).finally(() => { resuming = false; });
  };
  context.addEventListener('statechange', resumeAudio);
  const removeData = window.desktop.screenShare.onWindowAudioData((event) => {
    if (event.id !== id || stopped || event.pcm.byteLength % 4 !== 0) return;
    resumeAudio();
    // Ended events can be delayed in the renderer. Release expired buffers by
    // the audio clock as well, so a long capture does not retain old nodes.
    for (const [source, endTime] of playing) if (endTime <= context.currentTime) releaseSource(source);
    // Drop queued latency if the renderer was suspended or fell behind.
    if (nextTime > context.currentTime + 0.25) return;
    const samples = new DataView(event.pcm.buffer, event.pcm.byteOffset, event.pcm.byteLength);
    const frames = event.pcm.byteLength / 4;
    if (!frames) return;
    const buffer = context.createBuffer(2, frames, 48_000);
    for (let channel = 0; channel < 2; channel++) {
      const output = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) output[frame] = samples.getInt16(frame * 4 + channel * 2, true) / 32768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    source.onended = () => releaseSource(source);
    nextTime = Math.max(nextTime, context.currentTime + 0.02);
    source.start(nextTime);
    nextTime += buffer.duration;
    playing.set(source, nextTime);
  });
  const removeEnded = window.desktop.screenShare.onWindowAudioEnded((endedID) => {
    if (endedID === id && !stopped) { cleanup(); onEnded(); }
  });
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    removeData(); removeEnded();
    context.removeEventListener('statechange', resumeAudio);
    signal?.removeEventListener('abort', cleanup);
    stream.getVideoTracks().forEach((track) => track.removeEventListener('ended', cleanup));
    destination.stream.getTracks().forEach((track) => { stream.removeTrack(track); track.stop(); });
    // Stop native delivery even if closing the Web Audio context fails.
    void window.desktop.screenShare.stopWindowAudio(id).catch(() => undefined);
    for (const source of playing.keys()) releaseSource(source);
    playing.clear();
    void context.close().catch(() => undefined);
  };
  stream.getVideoTracks().forEach((track) => track.addEventListener('ended', cleanup, { once: true }));
  signal?.addEventListener('abort', cleanup, { once: true });
  try {
    if (signal?.aborted) throw new Error('Capture was cancelled.');
    await context.resume();
    if (stopped) throw new Error('Capture was cancelled.');
    await window.desktop.screenShare.startWindowAudio(sourceID, id);
    if (stopped || stream.getVideoTracks().every((track) => track.readyState === 'ended')) throw new Error('Capture was cancelled.');
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
