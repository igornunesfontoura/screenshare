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
}

type RtpStats = RTCStats & Record<string, unknown>;

// Lê o RTP de vídeo (enviado pelo host ou recebido pelo viewer) e calcula o bitrate
// a partir da diferença de bytes entre duas amostras.
export class StatsSampler {
  private last: { bytes: number; timestamp: number } | null = null;
  private readonly direction: "outbound-rtp" | "inbound-rtp";

  constructor(direction: "outbound-rtp" | "inbound-rtp") {
    this.direction = direction;
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

    return {
      width: numberOrNull(rtp.frameWidth),
      height: numberOrNull(rtp.frameHeight),
      fps: numberOrNull(rtp.framesPerSecond),
      kbps,
      codec: typeof codec?.mimeType === "string" ? codec.mimeType.replace(/^video\//, "") : null,
      implementation: stringOrNull(outbound ? rtp.encoderImplementation : rtp.decoderImplementation),
      hardware: booleanOrNull(outbound ? rtp.powerEfficientEncoder : rtp.powerEfficientDecoder),
      limitation: outbound ? stringOrNull(rtp.qualityLimitationReason) : null,
    };
  }
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
