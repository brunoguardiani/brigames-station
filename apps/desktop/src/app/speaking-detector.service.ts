const DETECTION_INTERVAL_MS = 50;
const SPEAKING_HOLD_MS = 450;
const SPEAKING_RMS_THRESHOLD = 0.015;
const LOCAL_SPEAKING_LEVEL_THRESHOLD = 0.06;

type DetectorEntry = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  lastAboveAt: number;
};

export type SpeakingChangeCallback = (identities: ReadonlySet<string>) => void;

export class SpeakingDetectorService {
  private context?: AudioContext;
  private readonly entries = new Map<string, DetectorEntry>();
  private local?: { identity: string; lastAboveAt: number };
  private timer?: ReturnType<typeof setInterval>;
  private speaking: ReadonlySet<string> = new Set();

  constructor(private readonly onChange: SpeakingChangeCallback) {}

  register(identity: string, track: MediaStreamTrack): void {
    this.unregister(identity);
    try {
      const context = this.ensureContext();
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      this.entries.set(identity, { source, analyser, buffer: new Float32Array(analyser.fftSize), lastAboveAt: 0 });
      this.start();
    } catch (error) {
      console.warn('[voice] speaking detector unavailable', error instanceof Error ? error.message : String(error));
    }
  }

  unregister(identity: string): void {
    const entry = this.entries.get(identity);
    if (!entry) return;
    this.entries.delete(identity);
    try {
      entry.source.disconnect();
    } catch { /* Node already disconnected. */ }
  }

  setLocalLevel(identity: string | null, level: number): void {
    if (!identity) {
      this.local = undefined;
      return;
    }
    const now = Date.now();
    if (level >= LOCAL_SPEAKING_LEVEL_THRESHOLD) {
      this.local = { identity, lastAboveAt: now };
    } else if (!this.local || this.local.identity !== identity) {
      this.local = { identity, lastAboveAt: 0 };
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.source.disconnect();
      } catch { /* Node already disconnected. */ }
    }
    this.entries.clear();
    this.local = undefined;
    this.stop();
    if (this.speaking.size > 0) {
      this.speaking = new Set();
      this.onChange(this.speaking);
    }
  }

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    return this.context;
  }

  private start(): void {
    this.timer ??= setInterval(() => this.tick(), DETECTION_INTERVAL_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private tick(): void {
    const now = Date.now();
    const next = new Set<string>();
    for (const [identity, entry] of this.entries) {
      entry.analyser.getFloatTimeDomainData(entry.buffer);
      let sum = 0;
      for (let i = 0; i < entry.buffer.length; i++) sum += entry.buffer[i] * entry.buffer[i];
      const rms = Math.sqrt(sum / entry.buffer.length);
      if (rms >= SPEAKING_RMS_THRESHOLD) entry.lastAboveAt = now;
      if (now - entry.lastAboveAt <= SPEAKING_HOLD_MS) next.add(identity);
    }
    if (this.local && now - this.local.lastAboveAt <= SPEAKING_HOLD_MS) next.add(this.local.identity);
    if (!sameSet(next, this.speaking)) {
      this.speaking = next;
      this.onChange(next);
    }
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
