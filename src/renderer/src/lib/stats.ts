export interface MediaStats {
  width: number | null;
  height: number | null;
  fps: number | null;
  kbps: number | null;
  codec: string | null;
  // Nome do encoder/decoder do Chromium (ex.: "VaapiVideoEncodeAccelerator", "libvpx").
  implementation: string | null;
  hardware: boolean | null;
  // Motivo de queda de qualidade no envio: "cpu", "bandwidth" ou "none".
  limitation: string | null;
  // Áudio da transmissão (não a voz): perda de pacotes e áudio "inventado" pelo
  // receptor para cobrir falhas, em % no último intervalo.
  audioLossPct: number | null;
  audioConcealedPct: number | null;
}

// mid do transceiver de voz (m-line 0); o áudio da transmissão é o outro.
const VOICE_MID = "0";

type RtpStats = RTCStats & Record<string, unknown>;

// Lê o RTP de vídeo (enviado pelo host ou recebido pelo viewer) e calcula o bitrate
// a partir da diferença de bytes entre duas amostras.
export class StatsSampler {
  private last: { bytes: number; timestamp: number } | null = null;
  private lastAudio: { lost: number; received: number; concealed: number; samples: number } | null =
    null;
  private readonly direction: "outbound-rtp" | "inbound-rtp";

  constructor(direction: "outbound-rtp" | "inbound-rtp") {
    this.direction = direction;
  }

  // Host: perda relatada pelo viewer (RTCP) para o áudio enviado.
  private outboundAudio(report: RTCStatsReport): AudioStats {
    const sent = findMediaAudio(report, "outbound-rtp");
    if (!sent) return NO_AUDIO;
    let remote: RtpStats | undefined;
    report.forEach((stat: RtpStats) => {
      if (stat.type === "remote-inbound-rtp" && stat.localId === sent.id) remote = stat;
    });
    const fraction = remote ? Number(remote.fractionLost ?? 0) : null;
    return { audioLossPct: fraction === null ? null : Math.round(fraction * 1000) / 10, audioConcealedPct: null };
  }

  // Viewer: diferença desde a última amostra.
  private inboundAudio(report: RTCStatsReport): AudioStats {
    const received = findMediaAudio(report, "inbound-rtp");
    if (!received) return NO_AUDIO;
    const now = {
      lost: Number(received.packetsLost ?? 0),
      received: Number(received.packetsReceived ?? 0),
      concealed: Number(received.concealedSamples ?? 0),
      samples: Number(received.totalSamplesReceived ?? 0),
    };
    const prev = this.lastAudio;
    this.lastAudio = now;
    if (!prev) return NO_AUDIO;
    const lost = now.lost - prev.lost;
    return {
      audioLossPct: percent(lost, lost + now.received - prev.received),
      audioConcealedPct: percent(now.concealed - prev.concealed, now.samples - prev.samples),
    };
  }

  async sample(pc: RTCPeerConnection): Promise<MediaStats | null> {
    const report = await pc.getStats();
    let rtp: RtpStats | undefined;
    report.forEach((stat: RtpStats) => {
      if (stat.type === this.direction && stat.kind === "video") rtp = stat;
    });
    if (!rtp) return null;

    const bytesKey = this.direction === "outbound-rtp" ? "bytesSent" : "bytesReceived";
    const bytes = Number(rtp[bytesKey] ?? 0);
    const kbps =
      this.last && rtp.timestamp > this.last.timestamp
        ? Math.round(((bytes - this.last.bytes) * 8) / (rtp.timestamp - this.last.timestamp))
        : null;
    this.last = { bytes, timestamp: rtp.timestamp };

    const codec = report.get(rtp.codecId as string) as RtpStats | undefined;
    const outbound = this.direction === "outbound-rtp";

    const audio = outbound ? this.outboundAudio(report) : this.inboundAudio(report);

    return {
      width: numberOrNull(rtp.frameWidth),
      height: numberOrNull(rtp.frameHeight),
      fps: numberOrNull(rtp.framesPerSecond),
      kbps,
      codec: typeof codec?.mimeType === "string" ? codec.mimeType.replace(/^video\//, "") : null,
      implementation: stringOrNull(outbound ? rtp.encoderImplementation : rtp.decoderImplementation),
      hardware: booleanOrNull(outbound ? rtp.powerEfficientEncoder : rtp.powerEfficientDecoder),
      limitation: outbound ? stringOrNull(rtp.qualityLimitationReason) : null,
      ...audio,
    };
  }
}

type AudioStats = Pick<MediaStats, "audioLossPct" | "audioConcealedPct">;

const NO_AUDIO: AudioStats = { audioLossPct: null, audioConcealedPct: null };

function findMediaAudio(report: RTCStatsReport, type: string): RtpStats | undefined {
  let found: RtpStats | undefined;
  report.forEach((stat: RtpStats) => {
    if (stat.type === type && stat.kind === "audio" && stat.mid !== VOICE_MID) found = stat;
  });
  return found;
}

function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((1000 * part) / total) / 10 : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
