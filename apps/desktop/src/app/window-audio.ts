// Native capture produces stereo signed 16-bit PCM at 48 kHz. Schedule a small
// bounded queue into a MediaStream destination; never connect to local speakers.
export async function attachWindowAudio(stream: MediaStream, sourceID: string, onEnded: () => void, signal?: AbortSignal): Promise<() => void> {
  const id = crypto.randomUUID();
  const context = new AudioContext({ sampleRate: 48_000 });
  const destination = context.createMediaStreamDestination();
  const playing = new Set<AudioBufferSourceNode>();
  let nextTime = 0;
  let stopped = false;
  const removeData = window.desktop.screenShare.onWindowAudioData((event) => {
    if (event.id !== id || stopped || event.pcm.byteLength % 4 !== 0) return;
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
    playing.add(source);
    source.onended = () => { playing.delete(source); source.disconnect(); };
    nextTime = Math.max(nextTime, context.currentTime + 0.02);
    source.start(nextTime);
    nextTime += buffer.duration;
  });
  const removeEnded = window.desktop.screenShare.onWindowAudioEnded((endedID) => {
    if (endedID === id && !stopped) { cleanup(); onEnded(); }
  });
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    removeData(); removeEnded();
    signal?.removeEventListener('abort', cleanup);
    stream.getVideoTracks().forEach((track) => track.removeEventListener('ended', cleanup));
    destination.stream.getTracks().forEach((track) => { stream.removeTrack(track); track.stop(); });
    for (const source of playing) { source.stop(); source.disconnect(); }
    playing.clear();
    void context.close();
    void window.desktop.screenShare.stopWindowAudio(id).catch(() => undefined);
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
