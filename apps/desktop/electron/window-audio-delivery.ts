// Bound delivery to the renderer independently of the worker's Node IPC pipe.
// A successful child-process send does not mean the renderer consumed its PCM.
export class WindowAudioDelivery {
  private sequence = 0;
  private pending?: number;
  private stopped = false;

  constructor(
    private readonly send: (pcm: Uint8Array, sequence: number) => void,
    private readonly failed: (error: unknown) => void,
  ) {}

  deliver(pcm: Uint8Array): void {
    if (this.stopped || this.pending !== undefined || !pcm.byteLength
      || pcm.byteLength % 4 !== 0 || pcm.byteLength > 48_000) return;
    const sequence = ++this.sequence;
    this.pending = sequence;
    try { this.send(pcm, sequence); }
    catch (error) { this.stop(); this.failed(error); }
  }

  acknowledge(sequence: unknown): void {
    if (!this.stopped && sequence === this.pending) this.pending = undefined;
  }

  stop(): void {
    this.stopped = true;
    this.pending = undefined;
  }
}
