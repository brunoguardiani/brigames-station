import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
export type MicWorkletOptions = { rnnoise: boolean; gain: number };

let rnnoiseBytesPromise: Promise<Uint8Array> | null = null;

function loadRnnoiseBytes(): Promise<Uint8Array> {
  rnnoiseBytesPromise ??= import('./rnnoise-wasm').then(({ RNNOISE_WASM_BASE64 }) => {
    const binary = atob(RNNOISE_WASM_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });
  return rnnoiseBytesPromise;
}

const MIC_WORKLET_SOURCE = `
class MicWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 32, automationRate: 'k-rate' }];
  }
  constructor(options) {
    super();
    this.frameSize = 480;
    this.inFrame = new Float32Array(this.frameSize);
    this.inFill = 0;
    this.outRing = new Float32Array(this.frameSize * 4);
    this.outRead = 0;
    this.outWrite = 0;
    this.rnnoise = options.processorOptions.rnnoise === true;
    this.ready = false;
    this.failed = false;
    this.primed = false;
    this.meterCounter = 0;
    this.meterSum = 0;
    this.meterSamples = 0;
    this.limitThreshold = 0.9;
    this.gateValue = 1;
    this.gateAttack = 0.632;
    this.gateRelease = 0.049;
    const w0 = 2 * Math.PI * 80 / sampleRate;
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / 1.4142135623730951;
    this.hpB0 = (1 + cosW0) / 2 / (1 + alpha);
    this.hpB1 = -(1 + cosW0) / (1 + alpha);
    this.hpB2 = (1 + cosW0) / 2 / (1 + alpha);
    this.hpA1 = -2 * cosW0 / (1 + alpha);
    this.hpA2 = (1 - alpha) / (1 + alpha);
    this.hpX1 = 0;
    this.hpX2 = 0;
    this.hpY1 = 0;
    this.hpY2 = 0;
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.rnnoise === 'boolean') this.rnnoise = event.data.rnnoise;
    };
    const wasmBytes = options.processorOptions.wasmBytes;
    WebAssembly.instantiate(wasmBytes, {
      a: {
        a: (requested) => {
          const current = this.memory.buffer.byteLength;
          if (requested <= current) return 1;
          try { this.memory.grow(Math.ceil((requested - current) / 65536)); return 1; } catch (error) { return 0; }
        },
        b: (dest, src, num) => new Uint8Array(this.memory.buffer).copyWithin(dest, src, src + num),
      },
    }).then((result) => {
      const exports = result.instance.exports;
      this.exports = exports;
      this.memory = exports.c;
      exports.d();
      this.state = exports.h();
      this.inPtr = exports.e(this.frameSize * 4);
      this.outPtr = exports.e(this.frameSize * 4);
      this.inView = new Float32Array(this.memory.buffer, this.inPtr, this.frameSize);
      this.outView = new Float32Array(this.memory.buffer, this.outPtr, this.frameSize);
      this.ready = true;
    }).catch((error) => {
      this.failed = true;
      console.error('[mic-processor] rnnoise failed to start', error);
    });
  }
  highpass(x) {
    const y = this.hpB0 * x + this.hpB1 * this.hpX1 + this.hpB2 * this.hpX2 - this.hpA1 * this.hpY1 - this.hpA2 * this.hpY2;
    if (!Number.isFinite(y)) {
      this.hpX1 = this.hpX2 = this.hpY1 = this.hpY2 = 0;
      return x;
    }
    this.hpX2 = this.hpX1;
    this.hpX1 = x;
    this.hpY2 = this.hpY1;
    this.hpY1 = y;
    return y;
  }
  emitLevel() {
    const rms = Math.sqrt(this.meterSum / Math.max(1, this.meterSamples));
    this.port.postMessage({ level: Math.min(1, rms * 4) });
    this.meterSum = 0;
    this.meterSamples = 0;
  }
  countMeter(sample) {
    this.meterSum += sample * sample;
    this.meterSamples++;
  }
  limit(sample) {
    if (!Number.isFinite(sample)) return 0;
    const threshold = this.limitThreshold;
    if (sample > threshold) return threshold + (1 - threshold) * Math.tanh((sample - threshold) / (1 - threshold));
    if (sample < -threshold) return -threshold + (1 - threshold) * Math.tanh((sample + threshold) / (1 - threshold));
    return sample;
  }
  ringLevel() {
    let available = this.outWrite - this.outRead;
    if (available < 0) available += this.outRing.length;
    return available;
  }
  bypass(input, output, gain) {
    for (let i = 0; i < output.length; i++) {
      const sample = this.limit(this.highpass(input[i]) * gain);
      output[i] = sample;
      this.countMeter(sample);
    }
  }
  tickMeter() {
    this.meterCounter++;
    if (this.meterCounter >= 4) {
      this.emitLevel();
      this.meterCounter = 0;
    }
  }
  processFrame(gain) {
    if (this.inView.length !== this.frameSize) {
      this.inView = new Float32Array(this.memory.buffer, this.inPtr, this.frameSize);
      this.outView = new Float32Array(this.memory.buffer, this.outPtr, this.frameSize);
    }
    for (let i = 0; i < this.frameSize; i++) this.inView[i] = this.inFrame[i] * 32768;
    const voiceProbability = this.exports.j(this.state, this.outPtr, this.inPtr);
    let target = Math.min(1, Math.max(0, (voiceProbability - 0.1) / 0.25));
    if (!Number.isFinite(target)) target = 1;
    const coefficient = target > this.gateValue ? this.gateAttack : this.gateRelease;
    const gateStart = this.gateValue;
    const gateEnd = this.gateValue + coefficient * (target - this.gateValue);
    this.gateValue = gateEnd;
    for (let j = 0; j < this.frameSize; j++) {
      const gate = gateStart + (gateEnd - gateStart) * ((j + 1) / this.frameSize);
      const sample = this.limit((this.outView[j] / 32768) * gate * gain);
      this.outRing[this.outWrite++] = sample;
      if (this.outWrite === this.outRing.length) this.outWrite = 0;
      this.countMeter(sample);
    }
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    const gain = parameters.gain.length ? parameters.gain[0] : 1;
    if (this.rnnoise && this.ready && !this.failed) {
      let healthy = true;
      try {
        for (let i = 0; i < input.length; i++) {
          this.inFrame[this.inFill++] = this.highpass(input[i]);
          if (this.inFill === this.frameSize) {
            this.processFrame(gain);
            this.inFill = 0;
          }
        }
        if (!this.primed) {
          if (this.ringLevel() < this.frameSize * 2) {
            output.fill(0);
            this.tickMeter();
            return true;
          }
          this.primed = true;
        }
        if (this.ringLevel() < output.length) {
          output.fill(0);
          this.tickMeter();
          return true;
        }
        for (let i = 0; i < output.length; i++) {
          output[i] = this.outRing[this.outRead++];
          if (this.outRead === this.outRing.length) this.outRead = 0;
        }
      } catch (error) {
        healthy = false;
        this.failed = true;
        this.port.postMessage({ rnnoiseFailed: true });
      }
      if (healthy) {
        this.tickMeter();
        return true;
      }
    }
    this.bypass(input, output, gain);
    this.tickMeter();
    return true;
  }
}
registerProcessor('mic-processor', MicWorkletProcessor);
`;

function createWorkletURL(): string {
  return URL.createObjectURL(new Blob([MIC_WORKLET_SOURCE], { type: 'application/javascript' }));
}

const workletModules = new WeakMap<AudioContext, Promise<void>>();

function ensureWorkletModule(context: AudioContext): Promise<void> {
  let module = workletModules.get(context);
  if (!module) {
    module = (async () => {
      const url = createWorkletURL();
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletModules.set(context, module);
  }
  return module;
}

export async function createMicWorkletNode(context: AudioContext, options: MicWorkletOptions): Promise<AudioWorkletNode> {
  const [wasmBytes] = await Promise.all([loadRnnoiseBytes(), ensureWorkletModule(context)]);
  return new AudioWorkletNode(context, 'mic-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { wasmBytes, rnnoise: options.rnnoise },
  });
}

export function decibelsToLinearGain(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'mic-processor';
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: AudioWorkletNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  constructor(private readonly options: { rnnoise: boolean; gainDecibels: number }) {}

  onLevel?: (level: number) => void;
  onRnnoiseFailed?: () => void;

  async init(processorOptions: AudioProcessorOptions): Promise<void> {
    const context = processorOptions.audioContext ?? new AudioContext();
    if (context.state === 'suspended') await context.resume().catch(() => undefined);
    if (context.sampleRate !== 48000) throw new Error(`O processador de voz requer áudio em 48kHz (obtido ${context.sampleRate}Hz).`);
    this.audioContext = context;
    this.sourceNode = context.createMediaStreamSource(new MediaStream([processorOptions.track]));
    this.workletNode = await createMicWorkletNode(context, { rnnoise: this.options.rnnoise, gain: 1 });
    this.workletNode.parameters.get('gain')!.value = decibelsToLinearGain(this.options.gainDecibels);
    this.workletNode.port.onmessage = (event: MessageEvent<{ level?: number; rnnoiseFailed?: boolean }>) => {
      if (typeof event.data?.level === 'number') this.onLevel?.(event.data.level);
      if (event.data?.rnnoiseFailed === true) this.onRnnoiseFailed?.();
    };
    this.destinationNode = context.createMediaStreamDestination();
    this.sourceNode.connect(this.workletNode).connect(this.destinationNode);
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(processorOptions: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(processorOptions);
  }

  setGainDecibels(decibels: number): void {
    this.workletNode?.parameters.get('gain')?.setValueAtTime(decibelsToLinearGain(decibels), this.audioContext?.currentTime ?? 0);
  }

  setRnnoise(enabled: boolean): void {
    this.workletNode?.port.postMessage({ rnnoise: enabled });
  }

  async destroy(): Promise<void> {
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    this.destinationNode?.disconnect();
    this.processedTrack?.stop();
    this.sourceNode = undefined;
    this.workletNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
  }
}
