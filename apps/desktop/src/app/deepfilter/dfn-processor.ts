import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

export type DfnWorkletOptions = { enabled: boolean };

const DFN_PROCESSOR_CODE = `
class BrigamesDfnProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 32, automationRate: 'k-rate' }];
  }
  constructor(options) {
    super();
    this.enabled = options.processorOptions.enabled === true;
    this.ready = false;
    this.failed = false;
    this.primed = false;
    this.meterCounter = 0;
    this.meterSum = 0;
    this.meterSamples = 0;
    this.limitThreshold = 0.9;
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
      if (event.data && typeof event.data.enabled === 'boolean') this.enabled = event.data.enabled;
    };
    try {
      initSync({ module: options.processorOptions.wasmModule });
      this.handle = df_create_default(100);
      this.frameLength = df_get_frame_length(this.handle);
      this.inRing = new Float32Array(this.frameLength * 4);
      this.inRead = 0;
      this.inWrite = 0;
      this.outRing = new Float32Array(this.frameLength * 4);
      this.outRead = 0;
      this.outWrite = 0;
      this.frame = new Float32Array(this.frameLength);
      this.ready = true;
    } catch (error) {
      this.fail();
    }
  }
  fail() {
    this.failed = true;
    this.port.postMessage({ dfnFailed: true });
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
  limit(sample) {
    if (!Number.isFinite(sample)) return 0;
    const threshold = this.limitThreshold;
    if (sample > threshold) return threshold + (1 - threshold) * Math.tanh((sample - threshold) / (1 - threshold));
    if (sample < -threshold) return -threshold + (1 - threshold) * Math.tanh((sample + threshold) / (1 - threshold));
    return sample;
  }
  countMeter(sample) {
    this.meterSum += sample * sample;
    this.meterSamples++;
  }
  emitLevel() {
    const rms = Math.sqrt(this.meterSum / Math.max(1, this.meterSamples));
    this.port.postMessage({ level: Math.min(1, rms * 4) });
    this.meterSum = 0;
    this.meterSamples = 0;
  }
  tickMeter() {
    this.meterCounter++;
    if (this.meterCounter >= 4) {
      this.emitLevel();
      this.meterCounter = 0;
    }
  }
  ringAvailable(ring, write, read) {
    let available = write - read;
    if (available < 0) available += ring.length;
    return available;
  }
  bypass(input, output, gain) {
    for (let i = 0; i < output.length; i++) {
      const sample = this.limit(this.highpass(input[i]) * gain);
      output[i] = sample;
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
    if (this.ready && !this.failed && this.enabled) {
      let healthy = true;
      try {
        for (let i = 0; i < input.length; i++) {
          this.inRing[this.inWrite++] = this.highpass(input[i]);
          if (this.inWrite === this.inRing.length) this.inWrite = 0;
        }
        while (this.ringAvailable(this.inRing, this.inWrite, this.inRead) >= this.frameLength) {
          for (let i = 0; i < this.frameLength; i++) {
            this.frame[i] = this.inRing[this.inRead++];
            if (this.inRead === this.inRing.length) this.inRead = 0;
          }
          const processed = df_process_frame(this.handle, this.frame);
          for (let i = 0; i < processed.length; i++) {
            const sample = this.limit(processed[i] * gain);
            this.outRing[this.outWrite++] = sample;
            if (this.outWrite === this.outRing.length) this.outWrite = 0;
            this.countMeter(sample);
          }
        }
        if (!this.primed) {
          if (this.ringAvailable(this.outRing, this.outWrite, this.outRead) < this.frameLength * 2) {
            output.fill(0);
            this.tickMeter();
            return true;
          }
          this.primed = true;
        }
        if (this.ringAvailable(this.outRing, this.outWrite, this.outRead) < output.length) {
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
        this.fail();
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
registerProcessor('dfn-processor', BrigamesDfnProcessor);
`;

interface DfnAssets {
  module: WebAssembly.Module;
  source: string;
}

let dfnAssetsPromise: Promise<DfnAssets> | null = null;

function loadDfnAssets(): Promise<DfnAssets> {
  dfnAssetsPromise ??= window.desktop.assets.readDenoiser().then(({ wasm, worklet }) => {
    if (!/}\)\(\);\s*$/.test(worklet)) throw new Error('Unsupported dfn-worklet.js format.');
    const source = worklet.replace(/}\)\(\);\s*$/, DFN_PROCESSOR_CODE + '})();\n');
    const bytes = wasm.slice();
    return { module: new WebAssembly.Module(bytes.buffer), source };
  });
  return dfnAssetsPromise;
}

const dfnWorkletModules = new WeakMap<AudioContext, Promise<void>>();

function ensureDfnWorkletModule(context: AudioContext, source: string): Promise<void> {
  let module = dfnWorkletModules.get(context);
  if (!module) {
    module = (async () => {
      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    dfnWorkletModules.set(context, module);
  }
  return module;
}

export async function createDfnWorkletNode(context: AudioContext, options: DfnWorkletOptions): Promise<AudioWorkletNode> {
  const { module, source } = await loadDfnAssets();
  await ensureDfnWorkletModule(context, source);
  return new AudioWorkletNode(context, 'dfn-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { wasmModule: module, enabled: options.enabled },
  });
}

export function dfnGainDecibelsToLinear(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

export class DfnProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'dfn-processor';
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: AudioWorkletNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  constructor(private readonly options: { enabled: boolean; gainDecibels: number }) {}

  onLevel?: (level: number) => void;
  onProcessorFailed?: () => void;

  async init(processorOptions: AudioProcessorOptions): Promise<void> {
    const context = processorOptions.audioContext ?? new AudioContext();
    if (context.state === 'suspended') await context.resume().catch(() => undefined);
    if (context.sampleRate !== 48000) throw new Error(`O processador de voz requer áudio em 48kHz (obtido ${context.sampleRate}Hz).`);
    this.audioContext = context;
    this.sourceNode = context.createMediaStreamSource(new MediaStream([processorOptions.track]));
    this.workletNode = await createDfnWorkletNode(context, { enabled: this.options.enabled });
    this.workletNode.parameters.get('gain')!.value = dfnGainDecibelsToLinear(this.options.gainDecibels);
    this.workletNode.port.onmessage = (event: MessageEvent<{ level?: number; dfnFailed?: boolean }>) => {
      if (typeof event.data?.level === 'number') this.onLevel?.(event.data.level);
      if (event.data?.dfnFailed === true) this.onProcessorFailed?.();
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
    this.workletNode?.parameters.get('gain')?.setValueAtTime(dfnGainDecibelsToLinear(decibels), this.audioContext?.currentTime ?? 0);
  }

  setEnabled(enabled: boolean): void {
    this.workletNode?.port.postMessage({ enabled });
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
