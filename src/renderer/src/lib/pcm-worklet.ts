// AudioWorklet que toca o PCM do helper de áudio do Windows (Float32 estéreo
// intercalado, 48 kHz). Recebe um MessagePort pela própria porta do node e vai
// enchendo um buffer circular; a saída vira a trilha de áudio da transmissão.

export {};

// Escopo do AudioWorklet (não faz parte da lib DOM do TypeScript).
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const CHANNELS = 2;
const seconds = (s: number) => Math.round(s * sampleRate) * CHANNELS;
const CAPACITY = seconds(1);
// Folga antes de tocar, contra o jitter do pipe/IPC.
const START = seconds(0.04);
// Acima disto (relógios divergentes ou o renderer travou) volta para TARGET.
const MAX = seconds(0.2);
const TARGET = seconds(0.06);

class PcmPlayer extends AudioWorkletProcessor {
  private buffer = new Float32Array(CAPACITY);
  private read = 0;
  private size = 0;
  private playing = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ port?: MessagePort }>) => {
      const source = event.data.port;
      if (source) source.onmessage = (message: MessageEvent<Float32Array>) => this.push(message.data);
    };
  }

  private push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[(this.read + this.size) % CAPACITY] = samples[i];
      if (this.size < CAPACITY) this.size++;
      else this.read = (this.read + 1) % CAPACITY;
    }
    if (this.size > MAX) {
      const skip = this.size - TARGET;
      this.read = (this.read + skip) % CAPACITY;
      this.size -= skip;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    const frames = left.length;
    if (!this.playing && this.size >= START) this.playing = true;
    if (!this.playing || this.size < frames * CHANNELS) {
      // Faltou áudio: silêncio e junta folga de novo.
      this.playing = false;
      return true;
    }
    for (let i = 0; i < frames; i++) {
      left[i] = this.buffer[this.read];
      right[i] = this.buffer[(this.read + 1) % CAPACITY];
      this.read = (this.read + CHANNELS) % CAPACITY;
    }
    this.size -= frames * CHANNELS;
    return true;
  }
}

registerProcessor("pcm-player", PcmPlayer);
